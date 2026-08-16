import { warn, debug, debugEnabled, error, daeManagesTurnExpiry } from "../dae.js";
import { expireEffects, getApplicableEffects, daeMacro, actionQueue, resolveEffectExpiryAction } from "./dae.js";
export let expireRoundEffectsOnCombatEnd = false;
export function fetchDurationParams() {
    expireRoundEffectsOnCombatEnd = game.settings.get("dae", "expireRoundEffectsOnCombatEnd");
}
// ---- Duration helpers ----
function getExpireTransferEffectUpdate(effect) {
    return {
        "disabled": true,
        "start.time": null,
        "start.round": null,
        "start.turn": null,
        "duration.expired": false
    };
}
function getUnexpireEffectUpdate(effect) {
    return {
        "start.round": game.combat?.round ?? null,
        "start.turn": game.combat?.turn ?? null,
        "start.time": game.time?.worldTime,
        "duration.expired": false,
        "disabled": false
    };
}
// ---- Exported utility functions ----
/**
 * Expire an effect. Transfer effects are disabled instead of deleted (except applied enchantments).
 */
export async function expireEffect(effect, options = {}) {
    if (debugEnabled > 0)
        warn("Expire effect", effect.uuid, effect);
    if (isTransferEffect(effect)) {
        if (isAppliedEnchantment(effect)) {
            await effect.delete(options);
        }
        else {
            const update = getExpireTransferEffectUpdate(effect);
            await effect.update(update, options);
        }
    }
    else {
        if (game.system?.id === "dnd5e") {
            // Don't expire effects whose concentration origin is still active
            const origin = fromUuidSync(effect.origin);
            //@ts-expect-error
            if (origin instanceof ActiveEffect && origin.statuses?.has(CONFIG.specialStatusEffects.CONCENTRATING)) {
                const concentrationDuration = origin.updateDuration();
                const hasRemaining = 
                // @ts-expect-error v14 duration.units
                (effect.duration.units === concentrationDuration.units && concentrationDuration.remaining > 0) ||
                    // @ts-expect-error v14 duration.units
                    (["rounds", "turns"].includes(effect.duration.units) && concentrationDuration.units === "seconds" && concentrationDuration.remaining >= CONFIG.time.roundTime) ||
                    // @ts-expect-error v14 duration.units
                    (effect.duration.units === "seconds" && ["rounds", "turns"].includes(concentrationDuration.units) && concentrationDuration.remaining >= 1);
                if (!hasRemaining)
                    return; // concentration expired, let concentration removal handle dependents
            }
        }
        // Respect per-effect expiry mode, falling back to global setting
        if (resolveEffectExpiryAction(effect) === "delete") {
            await effect.delete(options);
        }
        else {
            // "update" mode marks the effect expired (kept, inactive) rather than deleting it. On dnd5e 6.0+
            // the system itself deletes an expired effect the moment `duration.expired` is set while the
            // actor is out of combat (ActiveEffect5e._onUpdate), and reaps in-combat ones on combat exit — so
            // mark-and-keep only holds during combat. Out of combat (incl. combat-end expiry) delete directly
            // to match the system and avoid leaving an orphaned marked-expired effect behind.
            const actor = effect.parent instanceof Actor ? effect.parent : effect.parent?.parent;
            if (!daeManagesTurnExpiry && !actor?.inCombat)
                await effect.delete(options);
            else
                await effect.update({ "duration.expired": true }, options);
        }
    }
}
/**
 * Check if an effect is expired, using v14's native duration calculations.
 */
export function isEffectExpired(effect /* ActiveEffect */) {
    if (effect.duration?.expired)
        return true;
    if (!effect.isTemporary)
        return false;
    const duration = effect.updateDuration();
    return duration.remaining <= 0 && Number.isFinite(duration.remaining);
}
export function isTransferEffect(effect) {
    return effect.transfer;
}
/**
 * Check if an effect is an applied enchantment (dnd5e specific).
 */
export function isAppliedEnchantment(effect) {
    return effect.isAppliedEnchantment ?? false;
}
/**
 * Check if there's a circular dependency between effects.
 */
function hasCircularDependency(startUuid, expiringUuids, maxDepth = 10) {
    const visited = new Set();
    function checkDependencyChain(currentUuid, depth) {
        if (depth > maxDepth)
            return false;
        if (visited.has(currentUuid))
            return false;
        visited.add(currentUuid);
        const effect = fromUuidSync(currentUuid);
        if (!effect)
            return false;
        const dependentOn = foundry.utils.getProperty(effect, "flags.dnd5e.dependentOn");
        if (!dependentOn)
            return false;
        if (dependentOn === startUuid)
            return true;
        if (expiringUuids.has(dependentOn)) {
            return checkDependencyChain(dependentOn, depth + 1);
        }
        return false;
    }
    const startEffect = fromUuidSync(startUuid);
    if (!startEffect)
        return false;
    const startDependentOn = foundry.utils.getProperty(startEffect, "flags.dnd5e.dependentOn");
    if (!startDependentOn || !expiringUuids.has(startDependentOn))
        return false;
    return checkDependencyChain(startDependentOn, 0);
}
/**
 * Expire a list of effects, handling dependent effects that should be skipped.
 */
async function expireEffectsSkipDependents(effectsToExpire, expiringUuids, logPrefix) {
    const deletionInitiated = new Set();
    for (let { effect, reason } of effectsToExpire) {
        if (deletionInitiated.has(effect.uuid)) {
            if (debugEnabled > 0)
                warn("deletion already initiated, skipping", effect.name, effect.uuid);
            continue;
        }
        const parentEffects = effect.parent?.effects;
        if (parentEffects && effect.id && !parentEffects.has(effect.id)) {
            if (debugEnabled > 0)
                warn("effect already deleted, skipping", effect.name, effect.uuid);
            continue;
        }
        const dependentOn = foundry.utils.getProperty(effect, "flags.dnd5e.dependentOn");
        if (dependentOn && expiringUuids.has(dependentOn)) {
            if (hasCircularDependency(effect.uuid, expiringUuids)) {
                warn("circular dependency detected, deleting to break cycle", effect.name, effect.uuid, "dependentOn:", dependentOn);
                deletionInitiated.add(dependentOn);
            }
            else {
                if (debugEnabled > 0)
                    warn("skipping dependent effect (dependentOn also expiring)", effect.name, effect.uuid, "dependentOn:", dependentOn);
                continue;
            }
        }
        if (debugEnabled > 0)
            warn(logPrefix, effect.name, effect.updateDuration(), isTransferEffect(effect), reason);
        deletionInitiated.add(effect.uuid);
        await expireEffect(effect, { "expiry-reason": reason });
    }
}
export function hasDuration(effect) {
    return hasExpiry(effect);
}
export function hasExpiry(effect) {
    const duration = effect?.duration ?? effect;
    const start = effect?.start;
    return duration
        && (duration.value != null && duration.units && duration.units !== "none")
        && (start?.round != null || start?.turn != null || start?.time != null);
}
// ---- Macro Repeat helpers ----
export function hasMacroRepeat(effectData) {
    return ["startEveryTurn", "endEveryTurn", "startEndEveryTurn",
        "startEveryTurnAny", "endEveryTurnAny", "startEndEveryTurnAny"]
        .includes(effectData.flags?.dae?.macroRepeat);
}
export function getMacroRepeat(effectData) {
    return effectData.flags?.dae?.macroRepeat;
}
// ---- Macro Repeat processing on turn change ----
export function processMacroRepeats(combat, update, options) {
    const totalTurns = combat.combatants?.contents.length ?? 0;
    let combatantIndex = 0;
    for (let combatant of combat.turns) {
        if (combatant.actor) {
            let actor = combatant.actor;
            const checkTurn = (update.round ?? combat.round) * totalTurns + (update.turn ?? combat.turn ?? 0);
            let lastCheckedTurn = (foundry.utils.getProperty(options, "dae.combat.round") ?? combat.round) * totalTurns
                + (foundry.utils.getProperty(options, "dae.combat.turn") ?? combat.turn);
            const advanced1Turn = lastCheckedTurn + 1 === checkTurn;
            let combatantNextTurn = (update.round ?? combat.round) * totalTurns + combatantIndex;
            if (combatantNextTurn < checkTurn)
                combatantNextTurn += totalTurns;
            let combatantLastTurn = (foundry.utils.getProperty(options, "dae.combat.round") ?? combat.round) * totalTurns + combatantIndex;
            for (let effect of getApplicableEffects(actor, { includeEnchantments: true })) {
                const macroRepeat = getMacroRepeat(effect);
                switch (macroRepeat) {
                    case "startEveryTurn":
                    case "startEveryTurnAny":
                    case "startEndEveryTurn":
                    case "startEndEveryTurnAny":
                        if ((checkTurn >= combatantLastTurn && lastCheckedTurn < combatantLastTurn) || checkTurn === combatantNextTurn) {
                            if (!(["startEveryTurn", "startEndEveryTurn"].includes(macroRepeat)) || (!effect.disabled && !effect.isSuppressed))
                                daeMacro("each", actor, effect, { actor, effectId: effect.id, tokenId: combatant.token?.id, actorUuid: actor.uuid, actorID: actor.id, efData: effect.toObject(), turn: "startTurn" });
                        }
                        if (["startEveryTurn", "startEveryTurnAny"].includes(macroRepeat))
                            break;
                    case "endEveryTurn":
                    case "endEveryTurnAny":
                        if ((advanced1Turn && combatantLastTurn + 1 === checkTurn)
                            || (!advanced1Turn && combatantLastTurn < checkTurn && combatantLastTurn >= lastCheckedTurn)) {
                            if (["endEveryTurn", "startEndEveryTurn"].includes(macroRepeat) && (effect.disabled || effect.isSuppressed))
                                break;
                            daeMacro("each", actor, effect, { actor, effectId: effect.id, tokenId: combatant.token?.id, actorUuid: actor.uuid, actorID: actor.id, efData: effect.toObject(), turn: "endTurn" });
                        }
                        break;
                }
            }
        }
        combatantIndex += 1;
    }
}
// ---- Expire round effects when combat ends ----
async function expireRoundEffectsOnEnd(actor) {
    if (!expireRoundEffectsOnCombatEnd)
        return;
    const effectsToExpire = [];
    const expiringUuids = new Set();
    for (let effect of getApplicableEffects(actor, { includeEnchantments: true })) {
        const expiry = effect.duration?.expiry;
        const turnExpiries = daeManagesTurnExpiry
            ? ["roundStart", "roundEnd", "turnStart", "turnEnd", "sourceStart", "sourceEnd", "targetStart", "targetEnd"]
            : ["roundStart", "roundEnd", "turnStart", "turnEnd"];
        if (turnExpiries.includes(expiry) && !isTransferEffect(effect)) {
            effectsToExpire.push({ effect, reason: "dae:expired:combat-end-rounds" });
            expiringUuids.add(effect.uuid);
        }
    }
    if (effectsToExpire.length > 0) {
        await expireEffectsSkipDependents(effectsToExpire, expiringUuids, "end combat expired effect");
    }
}
// ---- Migrate deprecated special durations to v14 duration.expiry ----
// Both DAE (dnd5e < 6.0, which registers these events and converts them to core turnStart/turnEnd +
// start.combatant itself) and dnd5e 6.0+ (native PSEUDO_EXPIRIES sourceStart/sourceEnd/targetStart/
// targetEnd) understand the same expiry names, so one map serves both. Previously the 6.0+ branch
// mapped source/target → plain turnStart/turnEnd, silently dropping the source/target distinction now
// that dnd5e 6.0 handles these values natively (confirmed in PR #6837).
export function getDeprecatedSpecialDurMap() {
    return {
        "turnStart": "targetStart",
        "turnEnd": "targetEnd",
        "turnStartSource": "sourceStart",
        "turnEndSource": "sourceEnd",
        "combatEnd": "combatEnd"
    };
}
function migrateDeprecatedSpecialDurations(effectData) {
    const update = {};
    // Migrate old special duration flags to expiry events
    const deprecatedSpecialDurMap = getDeprecatedSpecialDurMap();
    let specialDurs = effectData.flags?.dae?.specialDuration;
    if (specialDurs && Array.isArray(specialDurs)) {
        const deprecated = specialDurs.filter(sd => sd in deprecatedSpecialDurMap);
        if (deprecated.length > 0) {
            const expiry = deprecatedSpecialDurMap[deprecated[0]];
            update["flags.dae.specialDuration"] = specialDurs.filter(sd => !(sd in deprecatedSpecialDurMap));
            update["duration.expiry"] = expiry;
            if (debugEnabled > 0)
                warn("Migrating deprecated special durations on effect creation", effectData.name, deprecated, "→", expiry);
        }
    }
    if (Object.keys(update).length > 0)
        effectData.updateSource(update);
}
// ---- Combat End expiry (special duration) ----
export function preDeleteCombatHook(combat, options, user) {
    if (user !== game.user?.id)
        return;
    for (let combatant of combat.combatants) {
        const actor = combatant.actor;
        if (!actor)
            continue;
        const effects = getApplicableEffects(actor, { includeEnchantments: true })
            .filter(ef => ef.flags?.dae?.specialDuration?.includes("combatEnd"));
        actionQueue.add(expireEffects, actor, effects, { "expiry-reason": "combat-end" });
    }
}
// ---- Join Combat expiry (special duration) ----
export function preCreateCombatantHook(combatant, data, options, user) {
    const actor = combatant.actor;
    if (!actor)
        return;
    const effects = getApplicableEffects(actor, { includeEnchantments: true })
        .filter(ef => ef.flags?.dae?.specialDuration?.includes("joinCombat"));
    actionQueue.add(expireEffects, actor, effects, { "expiry-reason": "join-combat" });
}
// ---- Hook registration ----
// @ts-expect-error v14 game.users.activeGM not in fvtt-types yet
function isResponsibleGM() { return game.users.activeGM?.isSelf; }
export function setupSpecialDurationHooks() {
    Hooks.on("preDeleteCombat", preDeleteCombatHook);
    Hooks.on("preCreateCombatant", preCreateCombatantHook);
    Hooks.on("preUpdateCombat", (combat, update, options, user) => {
        foundry.utils.setProperty(options, "dae.combat.round", combat.round);
        foundry.utils.setProperty(options, "dae.combat.turn", combat.turn);
        return true;
    });
    Hooks.on("updateCombat", async (combat, update, options, user) => {
        // @ts-expect-error v14 game.users.activeGM not in fvtt-types yet
        if (!game.users.activeGM?.isSelf)
            return;
        if (update.round === undefined && update.turn === undefined)
            return;
        if (debugEnabled > 1)
            debug("updateCombat (macro repeats)", combat, update, options);
        processMacroRepeats(combat, update, options);
    });
    // --- Duration management hooks (formerly times-up) ---
    Hooks.on("preCreateActiveEffect", (effectData, options, user) => {
        try {
            migrateDeprecatedSpecialDurations(effectData);
        }
        catch (err) {
            error("preCreateActiveEffect error", err);
        }
        finally {
            return true;
        }
    });
    Hooks.on("preUpdateActiveEffect", (effect, update, options, user) => {
        if (!isTransferEffect(effect))
            return true;
        const durationToUse = effect.updateDuration();
        if (update.duration) {
            // @ts-expect-error v14 duration.value
            if (update.duration.value !== undefined)
                durationToUse.value = update.duration.value;
            // @ts-expect-error v14 duration.units
            if (update.duration.units !== undefined)
                durationToUse.units = update.duration.units;
        }
        if (!hasExpiry(effect))
            return true;
        if (debugEnabled > 1)
            debug("Update active effect", effect.uuid, update, effect.updateDuration(), isTransferEffect(effect));
        //@ts-expect-error v14 duration.expired not in fvtt-types yet
        const isExpired = effect.duration?.expired || effect.start?.time == null;
        if (!isExpired)
            return true;
        if (update.disabled === false) {
            if (debugEnabled > 0)
                warn("resetting duration", effect.uuid, durationToUse, isTransferEffect(effect));
            foundry.utils.mergeObject(update, getUnexpireEffectUpdate(effect), { inplace: true });
        }
        else if (update.disabled ?? effect.disabled === true) {
            if (debugEnabled > 0)
                warn("expiring effect", effect.uuid, effect.updateDuration(), isTransferEffect(effect));
            foundry.utils.mergeObject(update, getExpireTransferEffectUpdate(effect), { inplace: true });
        }
        if (debugEnabled > 0)
            warn("update effect", effect.uuid, update, effect.updateDuration(), isTransferEffect(effect));
        return true;
    });
    Hooks.on("deleteCombatant", async (combatant) => {
        if (!isResponsibleGM() || !combatant.actor)
            return;
        await expireRoundEffectsOnEnd(combatant.actor);
    });
    Hooks.on("deleteCombat", async (combat) => {
        if (!isResponsibleGM())
            return;
        for (let combatant of combat.combatants) {
            if (!combatant.actor)
                continue;
            await expireRoundEffectsOnEnd(combatant.actor);
        }
    });
}
