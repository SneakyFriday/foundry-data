import { applyActiveEffects, socketlibSocket } from "./GMAction.js";
import { warn, error, debug, setDebugLevel, i18n, debugEnabled, daeManagesTurnExpiry } from "../dae.js";
import { ActiveEffects } from "./apps/ActiveEffects.js";
import { macroActorUpdate } from "./daeMacros.js";
import { ValidSpec } from "./Systems/DAESystem.js";
import { DAESystemDND5E } from "./Systems/DAEdnd5e.js";
import { DIMEditor } from "./apps/DIMEditor.js";
import { registerFieldEditor } from "./apps/DAEActiveEffectConfig.js";
import { setupSpecialDurationHooks, fetchDurationParams } from "./specialDurations.js";
import { resolveItemFromEffect, resolveMacro, createFunctionMacro, getItemMacroCommand as _getItemMacroCommand } from "./lib/macroResolution.js";
import { registerChangeHandler, getChangeHandler, isRegisteredMacroKey, getChangeDestination, getAllMacroEffectKeys } from "./lib/changeHandlerRegistry.js";
import { filterEffectsForTargeting } from "./lib/effectFiltering.js";
import { handleExistingEffects, handleStackIncrement } from "./lib/stackingPolicy.js";
import { rewriteAtlChanges } from "./atlMigration.js";
const { SchemaField } = foundry.data.fields;
let templates = {};
export let aboutTimeInstalled = false;
export let timesUpActive = false;
export let simpleCalendarInstalled = false;
export let atlActive = false;
/** Cached value of the world setting "dae.atlCompatibility". Updated in fetchParams(). */
export let atlCompatMode = "legacy";
/** Convenience flags derived from atlCompatMode. */
export let atlRewriteAtPreWrite = false; // layer A — enabled by "migrate" and "full"
export let atlRewriteAtRuntime = false; // layer B — enabled by "runtime" and "full"
export let atlMigrateWorldData = false; // layer C — enabled by "migrate" and "full"
export let midiActive = false;
export let ceInterface;
export let localizationMap = {};
// export let useAbilitySave;
export let noDupDamageMacro;
export let disableEffects;
export let daeTitleBar;
export let DIMETitleBar;
export let daeColorTitleBar;
export let daeNoTitleText;
export let libWrapper;
export let actionQueue;
// export let linkedTokens;
// export let DAESetupComplete;
export let DAEReadyComplete;
export let dependentConditions;
export let specialDurationExpiryAction = "default";
/**
 * Resolve the effective expiry action for special durations.
 * "default" falls through to core's CONFIG.ActiveEffect.expiryAction.
 */
export function resolveSpecialDurationExpiryAction() {
    if (specialDurationExpiryAction === "delete" || specialDurationExpiryAction === "update") {
        return specialDurationExpiryAction;
    }
    // "default" (or legacy "none") — use core's setting
    // @ts-expect-error v14 CONFIG.ActiveEffect.expiryAction
    return CONFIG.ActiveEffect.expiryAction ?? "update";
}
/**
 * Resolve the expiry action for a specific effect, checking per-effect flag first.
 * Per-effect flags.dae.expiryMode overrides the global setting.
 */
export function resolveEffectExpiryAction(effect) {
    const mode = effect.getFlag("dae", "expiryMode");
    if (mode === "delete")
        return "delete";
    if (mode === "suppress")
        return "update";
    // "default" or unset — use global setting
    return resolveSpecialDurationExpiryAction() === "delete" ? "delete" : "update";
}
// Track actors with pending status reconciliation to avoid duplicate reconciliations
const reconciliationPending = new Set();
// Track actors with pending conditional effects processing to coalesce rapid-fire hook calls
const conditionalEffectsPending = new Set();
// Track actor UUIDs that have had init macros fired (reset on world load)
export const daeInitMacroActors = new Set();
// Effects pending init macro calls (queued before game.ready, processed in daeReadyActions)
export const pendingInitMacroEffects = [];
/** Return CONFIG.statusEffects as an array, handling systems (e.g. Crucible) that replace it with a plain object. */
export function getStatusEffectsArray() {
    return Array.isArray(CONFIG.statusEffects) ? CONFIG.statusEffects : Object.values(CONFIG.statusEffects);
}
// Re-export from shared library for backward compatibility
export const getItemMacroCommand = _getItemMacroCommand;
// --- Change handler registration (data-driven) ---
// Special change handlers: [key, onAdd, onRemove, destination]
const specialHandlers = [
    ["macro.CE",
        ctx => addConvenientEffectsChange(ctx.change.value, ctx.actor.uuid, ctx.effect.origin, ctx.context ?? {}, ctx.actor.isToken),
        ctx => removeConvenientEffectsChange(ctx.change.value, ctx.actor.uuid, ctx.effect.origin, ctx.actor.isToken), "local"],
    ["macro.StatusEffect",
        ctx => addConditionChange(ctx.actor, ctx.change, ctx.token, ctx.effect),
        ctx => removeConditionChange(ctx.actor, ctx.change, ctx.token ?? null, ctx.effect, ctx.context), "local"],
    ["StatusEffect",
        ctx => addConditionChange(ctx.actor, ctx.change, ctx.token, ctx.effect),
        ctx => removeConditionChange(ctx.actor, ctx.change, ctx.token ?? null, ctx.effect, ctx.context), "local"],
    ["macro.tokenMagic",
        ctx => addTokenMagicChange(ctx.actor, ctx.change, ctx.tokens),
        ctx => removeTokenMagicChange(ctx.actor, ctx.change, ctx.tokens, ctx.context), "local"],
    ["macro.createItem",
        ctx => addCreateItemChange(ctx.change, ctx.actor, ctx.effect, ctx.context),
        ctx => removeCreateItemChange(ctx.change.value, ctx.actor, ctx.effect, ctx.context), "GM"],
    ["macro.createItemRunMacro",
        ctx => addCreateItemChange(ctx.change, ctx.actor, ctx.effect, ctx.context),
        ctx => removeCreateItemChange(ctx.change.value, ctx.actor, ctx.effect, ctx.context), "GM"],
];
for (const [key, on, off, destination] of specialHandlers) {
    registerChangeHandler(key, { on, off, destination });
}
// Macro change handlers — batched through daeMacro (on/off are no-ops, dispatch handled by daeMacro)
const noop = async () => { };
for (const key of ["macro.execute", "macro.itemMacro", "macro.actorUpdate", "macro.activityMacro"]) {
    registerChangeHandler(key, { on: noop, off: noop, destination: "mixed", isMacroKey: true });
}
// Backward-compatible exports derived from registry
export let allMacroEffects = getAllMacroEffectKeys();
export const isMacroChangeKey = isRegisteredMacroKey;
export let macroDestination = {};
for (const key of allMacroEffects) {
    macroDestination[key] = getChangeDestination(key);
}
export let daeSystemClass;
if (!globalThis.daeSystems)
    globalThis.daeSystems = {};
// export let showDeprecation = true;
export let showInline = false;
export const deprecatedKeyPatterns = [
    { pattern: /^data\.abilities\.(\w{3})\.save$/, replacement: id => `system.abilities.${id}.bonuses.save` },
    { pattern: /^data\.abilities\.(\w{3})\.mod$/, replacement: id => `system.abilities.${id}.bonuses.check` },
    { pattern: /^data\.skills\.(\w{3})\.mod$/, replacement: id => `system.skills.${id}.bonuses.check` },
    { pattern: /^data\.skills\.(\w{3})\.passive$/, replacement: id => `system.skills.${id}.bonuses.passive` },
];
function flagChangeKeys(actor, change) {
    if (!(["dnd5e"].includes(game.system.id ?? "")))
        return;
    for (const { pattern, replacement } of deprecatedKeyPatterns) {
        const match = change.key.match(pattern);
        if (match) {
            console.error(`dae | deprecated change key ${change.key} found in ${actor.name} use ${replacement(match[1])} instead`);
            return;
        }
    }
}
/*
 * v14 WRAPPER for Actor.applyActiveEffects(phase).
 * Chains to core+dnd5e, then applies "missed" changes whose ValidSpec phase
 * differs from the phase core assigned them to.
 */
/** A change's effective application phase.
 *  - If the effect was authored through the DAE editor (`flags.dae.phaseStamped`), every change has an
 *    explicit phase, so `change.phase` is authoritative — including a deliberately-chosen "initial" on
 *    a key whose ValidSpec phase is "final".
 *  - Otherwise (legacy/foreign effects): a non-default phase is explicit and wins; the schema default
 *    "initial" defers to the ValidSpec phase so unstamped derived-key changes still apply at the right time.
 *  `effect` is supplied where `change.effect` isn't populated yet (the missed-changes scan). */
export function effectivePhase(change, spec, effect) {
    const stamped = (effect ?? change?.effect)?.flags?.dae?.phaseStamped;
    if (stamped)
        return change?.phase ?? spec?.phase ?? "initial";
    if (change?.phase && change.phase !== "initial")
        return change.phase;
    return spec?.phase ?? change?.phase ?? "initial";
}
export function daeApplyActiveEffects(wrapped, phase) {
    if (disableEffects) {
        wrapped(phase);
        return;
    }
    const ActiveEffectDoc = CONFIG.ActiveEffect.documentClass;
    // Store current phase for daeApplyChange WRAPPER to use for phase correction
    this._daeCurrentPhase = phase;
    debug("daeApplyActiveEffects: phase", phase, this.name);
    // Deprecation checks (before core filters effects)
    const deprecatedSpecialDurs = ["turnStart", "turnEnd", "turnStartSource", "turnEndSource", "combatEnd"];
    for (let effect of this.allApplicableEffects()) {
        if (effect.flags?.dae?.showIcon) {
            foundry.utils.logCompatibilityWarning(`dae | Effect "${effect.name}" on actor "${this.name}": flags.dae.showIcon is deprecated, use ActiveEffect.showIcon. Edit the effect or re-create it to auto-migrate.`, { once: true, stack: false });
        }
        const specialDurs = effect.flags?.dae?.specialDuration;
        if (specialDurs?.some(sd => deprecatedSpecialDurs.includes(sd))) {
            foundry.utils.logCompatibilityWarning(`dae | Effect "${effect.name}" on actor "${this.name}" uses deprecated dae special duration (${specialDurs.filter(sd => deprecatedSpecialDurs.includes(sd)).join(", ")}). Edit the effect to migrate to native duration.expiry.`, { once: true, stack: false });
        }
    }
    // Collect "missed" changes: their EFFECTIVE phase is THIS phase (e.g. an unstamped change on a
    // derived-field key still carrying the default "initial"), but their stored change.phase differs,
    // so core's phase filter skipped them. Apply them after core+dnd5e finish their normal processing.
    const missedChanges = [];
    for (const effect of this.appliedEffects) {
        if (effect.disabled || effect.isSuppressed)
            continue;
        // @ts-expect-error v14 effect.system.changes
        for (const change of effect.system.changes) {
            if (!change.key || change.key.startsWith("ATL."))
                continue;
            const spec = ValidSpec.actorSpecs?.["union"]?.allSpecsObj?.[change.key];
            if (effectivePhase(change, spec, effect) === phase && change.phase !== phase) {
                // ValidSpec says this phase, but original phase doesn't match — core will skip it
                const c = foundry.utils.deepClone(change);
                c.effect = effect;
                c.count = effect.flags?.dae?.stacks || 1;
                if (["system.traits.ci.value", "system.traits.ci.all", "system.traits.ci.custom"].includes(c.key))
                    c.priority = 0;
                else {
                    // @ts-expect-error v14 CHANGE_TYPES
                    const typeDefaults = ActiveEffectDoc.CHANGE_TYPES ?? {};
                    c.priority = c.priority ?? typeDefaults[c.type]?.defaultPriority ?? (c.mode !== undefined ? c.mode * 10 : 0);
                }
                missedChanges.push(c);
            }
        }
    }
    // Let core + dnd5e handle normal effect application:
    // - dnd5e: determineSuppression(), prepareEmbeddedData(), super call
    // - core: phase validation/tracking, change collection, sorting, token changes,
    //         status effects, applyChange() for each, overrides merge
    // Our daeApplyChange WRAPPER intercepts each applyChange call to add:
    //   phase correction (skip wrong-phase), ATL exclusion, bonusSelector expansion,
    //   field mappings, dae.eval, @data rewrite, @stackCount, stacks
    wrapped(phase);
    // ATL → token.* runtime rewrite (Layer B — enabled by "runtime" and "full").
    // Core's actor.applyActiveEffects already split off "token.*" prefixed changes; ATL.* keys
    // were ignored. Here we walk the active effects, rewrite each ATL.* change to the equivalent
    // token.* change(s) via the shared transformer, and append them to tokenActiveEffectChanges
    // so TokenDocument.applyActiveEffects(phase) processes them as if authored natively.
    if (atlRewriteAtRuntime) {
        let extras = null;
        for (const effect of this.appliedEffects) {
            if (effect.disabled || effect.isSuppressed)
                continue;
            // @ts-expect-error v14 effect.system.changes
            for (const change of effect.system.changes) {
                if (!change?.key || !change.key.startsWith("ATL."))
                    continue;
                if (change.phase !== phase)
                    continue;
                const rewrites = rewriteAtlChanges([change]);
                if (rewrites === undefined || rewrites.length === 0)
                    continue;
                for (const r of rewrites) {
                    if (!r.key.startsWith("token."))
                        continue;
                    const c = foundry.utils.deepClone(r);
                    c.key = c.key.slice(6); // strip "token." prefix to match core's expectation
                    c.effect = effect;
                    extras ??= [];
                    extras.push(c);
                }
            }
        }
        if (extras && extras.length > 0) {
            // @ts-expect-error v14 tokenActiveEffectChanges
            this.tokenActiveEffectChanges[phase] ??= [];
            // @ts-expect-error v14 tokenActiveEffectChanges
            this.tokenActiveEffectChanges[phase].push(...extras);
        }
    }
    {
        const tac = this.tokenActiveEffectChanges?.[phase];
        if (Array.isArray(tac) && tac.length > 0) {
            const extras = [];
            for (const change of tac) {
                if (change.key !== "sight.visionMode")
                    continue;
                const mode = CONFIG.Canvas?.visionModes?.[change.value];
                const defaults = mode?.vision?.defaults;
                if (!defaults)
                    continue;
                for (const [k, v] of Object.entries(defaults)) {
                    if (v === undefined || v === null)
                        continue;
                    const siblingKey = `sight.${k}`;
                    if (tac.some(c => c.key === siblingKey))
                        continue;
                    if (extras.some(c => c.key === siblingKey))
                        continue;
                    extras.push({
                        key: siblingKey,
                        value: String(v),
                        type: "override",
                        priority: change.priority,
                        phase: change.phase,
                        effect: change.effect,
                    });
                }
            }
            if (extras.length > 0)
                tac.push(...extras);
        }
    }
    // Apply missed changes (ValidSpec says this phase, original phase was different)
    if (missedChanges.length > 0) {
        if (debugEnabled > 0)
            warn("Applying missed phase-corrected changes", phase, this.name, missedChanges);
        missedChanges.sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));
        const replacementData = this.getRollData();
        const overrides = {};
        for (const c of missedChanges) {
            if (!c.key || !c.count)
                continue;
            if (c.key.startsWith("token.")) {
                c.key = c.key.slice(6);
                // @ts-expect-error v14 tokenActiveEffectChanges
                this.tokenActiveEffectChanges[phase] ??= [];
                // @ts-expect-error v14 tokenActiveEffectChanges
                this.tokenActiveEffectChanges[phase].push(c);
                continue;
            }
            // @ts-expect-error v14 static applyChange
            const result = ActiveEffectDoc.applyChange(this, c, { replacementData });
            if (result && typeof result === "object")
                Object.assign(overrides, result);
        }
        foundry.utils.mergeObject(this.overrides || {}, foundry.utils.expandObject(overrides) || {}, { inplace: true, overwrite: true });
    }
    // Clean up phase context after final phase
    if (phase === "final") {
        delete this._daeCurrentPhase;
    }
}
// Keep the old name as an alias for backward compatibility with any external callers
export const applyDaeEffects = daeApplyActiveEffects;
/**
 * WRAPPER for ActiveEffect.applyChange (static method).
 * Handles all per-change DAE transformations before delegating to Foundry core.
 *
 * Transformations applied:
 * - Field mappings (deprecated key migration)
 * - flagChangeKeys (deprecation warnings for old dnd5e key patterns)
 * - midi-qol.optional key fix (missing .all suffix)
 * - OverTime key suffix (randomID to prevent flag collision)
 * - @data. deprecation rewrite
 * - dae.eval() and dae.roll() expression evaluation
 * - @stackCount substitution
 * - Stack count (multi-apply for stacked effects)
 */
export function daeApplyChange(wrapped, targetDoc, change, options = {}) {
    if (disableEffects) {
        return wrapped(targetDoc, change, options);
    }
    // --- Item changes: UUID/uuid unmapping + actor rollData for @-expression resolution ---
    if (targetDoc instanceof CONFIG.Item.documentClass) {
        const item = targetDoc;
        if (typeof change.value === "string") {
            // Prevent Foundry's roll data replacement from treating @UUID/@uuid as data paths
            change.value = change.value.replaceAll("@UUID", "##UUID").replaceAll("@uuid", "##uuid");
        }
        // Provide actor's rollData so item enchantment effects can reference @abilities.str.mod etc.
        // Also add @mod for the item's ability modifier.
        if (item.actor && !options.replacementData) {
            const rollData = item.actor.getRollData();
            // @ts-expect-error no dnd5e-types — abilityMod is dnd5e-specific
            rollData.mod = rollData.abilities?.[item.abilityMod]?.mod ?? 0;
            options.replacementData = rollData;
        }
        return wrapped(targetDoc, change, options);
    }
    if (!(targetDoc instanceof CONFIG.Actor.documentClass)) {
        return wrapped(targetDoc, change, options);
    }
    const actor = targetDoc;
    // --- Phase correction ---
    // Skip a change here if its EFFECTIVE phase (the change's own phase when explicitly set, else the
    // ValidSpec phase for the key) differs from the current phase. The applyActiveEffects WRAPPER
    // collects and re-applies these "missed" changes in their correct phase.
    // For token.* keys: core strips the "token." prefix before calling applyChange, so we also
    // check the prefixed key against ValidSpec.
    const currentPhase = actor._daeCurrentPhase;
    if (currentPhase) {
        const spec = ValidSpec.actorSpecs?.["union"]?.allSpecsObj?.[change.key]
            ?? ValidSpec.actorSpecs?.["union"]?.allSpecsObj?.[`token.${change.key}`];
        if (effectivePhase(change, spec) !== currentPhase) {
            return {};
        }
    }
    // --- ATL handling ---
    // When atlRewriteAtRuntime is on (Layer B), ATL.* changes have already been pre-translated
    // into token.* synthetic changes in daeApplyActiveEffects (see below) and routed to the
    // TokenDocument's tokenActiveEffectChanges, so we never reach here with an ATL.* key.
    // When it's off, defer the key to the ATL module by returning empty (the legacy behavior).
    if (change.key.startsWith("ATL."))
        return {};
    // --- bonusSelector expansion ---
    // Synthetic keys like "system.bonuses.All-Attacks" expand into multiple real keys
    // (e.g. system.bonuses.mwak.attack, system.bonuses.rwak.attack, etc.)
    if (daeSystemClass.bonusSelectors[change.key]) {
        const selector = daeSystemClass.bonusSelectors[change.key];
        const overrides = {};
        const keys = selector.replaceList
            ?? selector.attacks.map((at) => `system.bonuses.${at}.${selector.selector}`);
        for (const key of keys) {
            const c = foundry.utils.deepClone(change);
            c.key = key;
            // Call through the full applyChange chain (including this WRAPPER)
            // so expanded changes get field mappings, dae.eval, phase checks, etc.
            // @ts-expect-error v14 static applyChange
            const result = CONFIG.ActiveEffect.documentClass.applyChange(targetDoc, c, options);
            if (result && typeof result === "object")
                Object.assign(overrides, result);
        }
        return overrides;
    }
    // --- Field mappings (deprecated key migration) ---
    if (daeSystemClass.fieldMappings[change.key]) {
        const mapping = daeSystemClass.fieldMappings[change.key];
        const displayMapping = typeof mapping === "string" ? mapping : `${mapping.key}${mapping.value !== undefined ? ` ${mapping.value}` : ""}`;
        foundry.utils.logCompatibilityWarning(`dae | Actor ${actor.name} ${change.key} deprecated use ${displayMapping} instead.`, { once: true, stack: false });
        if (typeof mapping !== "string") {
            change.key = mapping.key;
            if (mapping.value !== undefined)
                change.value = mapping.value;
            if (mapping.type !== undefined)
                change.type = mapping.type;
            else if (mapping.mode !== undefined) {
                // Legacy field mapping with numeric mode — convert to v14 string type
                const modeToType = { 0: "custom", 1: "multiply", 2: "add", 3: "downgrade", 4: "upgrade", 5: "override" };
                change.type = modeToType[mapping.mode] ?? "custom";
            }
        }
        else if (mapping.startsWith("system.traits.da") && mapping.endsWith(".value")) {
            const damageType = change.key.split(".").slice(-1)[0];
            change.key = mapping;
            change.value = damageType;
            if (change.type === "custom")
                change.type = "add";
        }
        else {
            if (change.key.includes("DR") && change.value?.length > 0)
                change.value = `-(${change.value})`;
            if (debugEnabled > 0)
                warn("Doing field mapping mapping ", change.key, mapping);
            change.key = mapping;
        }
    }
    // --- flagChangeKeys (deprecation warnings for old dnd5e key patterns) ---
    flagChangeKeys(actor, change);
    // --- midi-qol.optional fix (missing .all suffix) ---
    if (change.key.startsWith("flags.midi-qol.optional")) {
        const parts = change.key.split(".");
        // Only apply deprecation fix for bare category keys like flags.midi-qol.optional.NAME.save (5 parts)
        // Don't match deeper keys like flags.midi-qol.optional.NAME.damage.save where save is an action type
        if (parts.length === 5 && ["save", "check", "skill", "damage", "attack"].includes(parts[4])) {
            console.error(`dae/midi-qol | deprecation error ${change.key} should be ${change.key}.all on actor ${actor.name}`);
            change.key = `${change.key}.all`;
        }
    }
    // --- OverTime suffix (randomID to prevent flag collision between effects) ---
    if (change.key === "flags.midi-qol.OverTime")
        change.key = `flags.midi-qol.OverTime.${foundry.utils.randomID()}`;
    // --- Value transformations (resolved once, then applied for each stack) ---
    // @data. deprecation rewrite
    if (typeof change.value === "string" && change.value.includes("@data.")) {
        const parentInfo = change.effect?.parent ? ` on ${change.effect.parent.name} (${change.effect.parent.id})` : '';
        console.warn(`dae | @data.key is deprecated, use @key instead (${change.effect?.name} (${change.effect?.id})${parentInfo} has value ${change.value})`);
        change.value = change.value.replace(/@data./g, "@");
    }
    // dae.eval() and dae.roll() expression handling
    const stacks = change.count ?? change.effect?.flags?.dae?.stacks ?? 1;
    if (typeof change.value === "string" && (change.value.includes("dae.eval(") || change.value.includes("dae.roll("))) {
        const conditionData = actor.getRollData();
        foundry.utils.mergeObject(conditionData, { stackCount: stacks, effect: change.effect?.toObject() });
        change.value = daeSystemClass.safeEvalExpression(change.value, conditionData);
    }
    // @stackCount substitution
    if (typeof change.value === "string") {
        change.value = change.value.replace("@stackCount", String(stacks));
    }
    if (options.replacementData) {
        options.replacementData.stackCount = stacks;
    }
    // --- Stack count (multi-apply for stacked effects) ---
    const overrides = {};
    // Custom type changes are handled directly to avoid a v14 core bug:
    // DataField.applyChange runs clean()/initialize() on _applyChangeCustom's undefined
    // return (meaning "no change"), converting it to the field's initial value (e.g. "" for
    // StringField), then applying that via setProperty — resetting the value the hook set.
    // By firing the hook directly, we skip the field-based path entirely.
    if (change.type === "custom") {
        for (let i = 0; i < stacks; i++) {
            const preVal = foundry.utils.getProperty(targetDoc, change.key);
            Hooks.call("applyActiveEffect", targetDoc, change, preVal, change.value, {});
            const postVal = foundry.utils.getProperty(targetDoc, change.key);
            if (postVal !== preVal && postVal !== undefined) {
                overrides[change.key] = postVal;
            }
        }
        return overrides;
    }
    for (let i = 0; i < stacks; i++) {
        const result = wrapped(targetDoc, change, options);
        if (result && typeof result === "object")
            Object.assign(overrides, result);
    }
    return overrides;
}
export async function addCreateItemChange(change, actor, effect, context) {
    let itemDetails = change.value;
    if (itemDetails.startsWith("@")) {
        itemDetails = Roll.replaceFormulaData(change.value, actor.getRollData(), { missing: "", warn: false });
    }
    await socketlibSocket.executeAsGM("createActorItem", { uuid: actor.uuid, itemDetails, effectUuid: effect.uuid, callItemMacro: change.key === "macro.createItemRunMacro" });
}
export async function removeCreateItemChange(itemId, actor, effect, context = {}) {
    if (itemId.startsWith("@")) {
        itemId = Roll.replaceFormulaData(itemId, actor.getRollData(), { missing: "", warn: false });
    }
    let [uuid, option] = itemId.split(",").map(s => s.trim());
    if (option === "permanent")
        return; // don't delete permanent items
    const itemsToDelete = (effect.flags?.dae?.itemsToDelete ?? []).slice();
    if (itemsToDelete.length === 0)
        return;
    if (!(context.effectDeleted || context.itemDeleted))
        await effect.setFlag("dae", "itemsToDelete", []);
    await socketlibSocket.executeAsGM("removeActorItem", { uuid: actor.uuid, itemUuid: itemId, itemUuids: itemsToDelete, context });
}
export async function addTokenMagicChange(actor, change, tokens) {
    const tokenMagic = globalThis.TokenMagic;
    if (!tokenMagic)
        return;
    for (let token of tokens) {
        if (token instanceof foundry.canvas.placeables.Token)
            token = token.document;
        const tokenUuid = token?.uuid;
        await socketlibSocket.executeAsGM("applyTokenMagic", { tokenUuid, effectId: change.value });
    }
}
export async function removeTokenMagicChange(actor, change, tokens, context = {}) {
    const tokenMagic = globalThis.TokenMagic;
    if (!tokenMagic)
        return;
    for (let token of tokens) {
        if (token instanceof foundry.canvas.placeables.Token)
            token = token.document;
        const tokenUuid = token?.uuid;
        await socketlibSocket.executeAsGM("removeTokenMagic", { tokenUuid, effectId: change.value });
    }
}
async function myRemoveCEEffect(effectName, uuid, origin, isToken) {
    await delay(1); // let all of the stuff settle down
    return await ceInterface?.removeEffect({ effectName, uuid, origin });
}
export async function removeConvenientEffectsChange(effectName, uuid, origin, isToken) {
    if (isToken)
        await delay(1); // let all of the stuff settle down
    return await myRemoveCEEffect(effectName, uuid, origin, isToken);
}
async function myAddCEEffectWith(effectData, uuid, origin, overlay, isToken) {
    if (!ceInterface)
        return;
    await delay(1);
    return await ceInterface.addEffect({ effectName: effectData.name, uuid, origin, effectData, overlay });
}
export async function addConvenientEffectsChange(effectName, uuid, origin, context, isToken) {
    if (!ceInterface)
        return;
    let ceEffect;
    ceEffect = ceInterface.findEffect({ effectName });
    if (!ceEffect)
        return;
    let effectData = foundry.utils.mergeObject(ceEffect.toObject(), context.metaData);
    effectData.origin = origin;
    return await myAddCEEffectWith(effectData, uuid, origin, false, isToken);
}
export async function addConditionChange(actor, change, token, effect) {
    // This is from macro.statusEffect
    const condition = getStatusEffectsArray().find(se => se.id === change.value);
    if (!condition)
        return;
    const overlay = foundry.utils.getProperty(effect, "flags.core.overlay");
    if (change.value.startsWith("Convenient Effect")) {
        console.warn("Convenient Effect change detected in macro.StatusEffect which is deprecated use macro.CE instead");
        console.warn(`Actor: ${actor.name} Change: ${change.value} Token: ${token?.name} Effect: ${effect.name} ${effect.uuid}`);
        const effectName = change.value.split("Convenient Effect: ")[1];
        return await ceInterface?.addEffect({ effectName, uuid: actor.uuid, origin: effect.uuid, overlay });
    }
    else if (change.value.startsWith("zce-")) {
        console.warn("Convenient Effect change detected in macro.StatusEffect which is deprecated use macro.CE instead");
        console.warn(`Actor: ${actor.name} Change: ${change.value} Token: ${token?.name} Effect: ${effect.name} ${effect.uuid}`);
        const effectId = change.value.replace("zce-", "ce-");
        return await ceInterface?.addEffect({ effectId, uuid: actor.uuid, origin: effect.uuid, overlay });
    }
    if (condition.statuses?.length > 1 && !condition?._id) {
        condition._id = condition.id.replaceAll(/[ :,.\+\-\*\&\^\%\$\#\@\!\[\]{}\(\)]/g, "").padEnd(16, "0").slice(-16);
    }
    await toggleActorStatusEffect(actor, condition.id, { active: true, origin: effect.uuid, flags: { dnd5e: { dependentOn: effect.uuid } } });
}
export async function removeConditionChange(actor, change, token, effect, context = {}) {
    if (change.value.startsWith("Convenient Effect")) {
        const effectName = change.value.split("Convenient Effect: ")[1];
        return await ceInterface?.removeEffect({ effectName, uuid: actor.uuid, origin: effect.uuid });
    }
    else if (change.value.startsWith("zce-") && ceInterface) {
        const effectId = change.value.replace("zce-", "ce-");
        return await ceInterface?.removeEffect({ effectId, uuid: actor.uuid, origin: effect.uuid });
    }
    const condition = actor.effects.find(ef => ef.origin === effect.uuid && ef.statuses.has(change.value));
    // Effect will auto remove
    // if (condition) await (actionQueue.add(actor.deleteEmbeddedDocuments.bind(actor), "ActiveEffect", [condition.id]));
}
export async function addStatusEffectChange(actor, change, tokens, sourceEffect, context = {}) {
    if (change.key !== "StatusEffect")
        return false;
    if (change.value.startsWith("zce-")) {
        const effectId = change.value.replace("zce-", "ce-");
        const effect = ceInterface?.findEffect && ceInterface.findEffect({ effectId });
        if (effect) {
            return await ceInterface.addEffect({ effectId, uuid: actor.uuid, origin: sourceEffect.uuid, overlay: false });
        }
    }
    else {
        let statusEffect = getStatusEffectsArray().find(se => se.id === change.value);
        if (statusEffect) {
            return toggleActorStatusEffect(actor, statusEffect.id, { active: true, origin: sourceEffect.uuid });
        }
    }
    return false;
}
export async function removeStatusEffectChange(actor, change, tokens, effect, context = {}) {
    // TODO this might remove too many effects
    const effectsToRemove = actor.effects.filter(ef => ef.origin === effect.uuid)?.map(ef => ef.id);
    if (effectsToRemove && effectsToRemove.length > 0)
        await actor.deleteEmbeddedDocuments("ActiveEffect", effectsToRemove, context);
}
export async function expireEffects(actor, effects, context) {
    if (!effects)
        return {};
    const actorEffectsToExpire = [];
    const effectsToDelete = [];
    const effectsToDisable = [];
    for (let effect of effects) {
        if (!effect.id)
            continue;
        if (!fromUuidSync(effect.uuid))
            continue;
        if (effect.transfer)
            effectsToDisable.push(effect);
        else if (effect.parent instanceof Actor)
            actorEffectsToExpire.push(effect.id);
        else if (effect.parent instanceof Item) // this should be enchantments
            effectsToDelete.push(effect);
    }
    if (actorEffectsToExpire.length > 0) {
        const toDelete = [];
        const toSuppress = [];
        for (const id of actorEffectsToExpire) {
            const ef = actor.effects.get(id);
            if (!ef)
                continue;
            if (resolveEffectExpiryAction(ef) === "delete")
                toDelete.push(id);
            else
                toSuppress.push(id);
        }
        if (toDelete.length > 0) {
            await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete, context);
        }
        if (toSuppress.length > 0) {
            const updates = toSuppress.map(id => ({ _id: id, "duration.expired": true }));
            await actor.updateEmbeddedDocuments("ActiveEffect", updates, context);
        }
    }
    if (effectsToDisable.length > 0) {
        for (let effect of effectsToDisable) {
            await effect.update({ "disabled": true }, context);
        }
    }
    if (effectsToDelete.length > 0) {
        for (let effect of effectsToDelete)
            await effect.delete(context);
    }
    return { expired: actorEffectsToExpire, disabled: effectsToDisable, itemEffects: effectsToDelete };
}
function createActiveEffectHook(effect, options, userId) {
    if (userId !== game.user?.id)
        return true;
    // @ts-expect-error Can this happen?
    if (options.isUndo)
        return true;
    if (!effect.parent)
        return true;
    let actor = effect.parent;
    if (actor instanceof CONFIG.Item.documentClass) {
        if (!effect.transfer)
            return true; // non-transfer effects on items should not be applied to the actor
        actor = effect.parent.parent;
    }
    if (!actor) {
        // not an effect on an actor so do nothing
        return true;
    }
    const tokens = actor.isToken ? [actor.token?.object] : actor.getActiveTokens();
    if (!(tokens[0] instanceof foundry.canvas.placeables.Token))
        return;
    const token = tokens[0];
    // @ts-expect-error v14 effect.system.changes
    if (effect.system?.changes?.length && effect.active) {
        const selfAuraChange = foundry.utils.getProperty(effect, "flags.ActiveAuras.isAura") === true
            && foundry.utils.getProperty(effect, "flags.ActiveAuras.ignoreSelf") === true
            && effect.origin?.startsWith(actor.uuid);
        // don't apply macro or macro like effects if active aura and not targeting self
        if (!selfAuraChange) {
            // @ts-expect-error v14 effect.system.changes
            actionQueue.add(processEffectChanges, "on", actor, tokens, effect, undefined, effect.system.changes, options)
                .catch(err => {
                const message = "dae | createActiveEffectHook | create effect error";
                if (globalThis.MidiQOL?.apps?.TroubleShooter) {
                    globalThis.MidiQOL.apps.TroubleShooter.recordError(err, message);
                }
                console.warn(message, err);
            });
        }
    }
    return true;
}
async function _preCreateActiveEffectRemoveExisting(effectData, options, user) {
    if (debugEnabled > 0)
        warn("preCreateActiveEffectRemoveExisting", effectData, options, user);
    let result = true;
    try {
        // @ts-expect-error Can this happen?
        options.deleted = false;
        result = await handleExistingEffects(this, options);
    }
    catch (err) {
        error("removeExistingEffects ", err);
        result = true;
    }
    finally {
        return result;
    }
}
async function _preCreateActiveEffectIncrement(data, options, user) {
    if (debugEnabled > 0)
        warn("_preCreateActiveEffect", this, data, options, user);
    // Make changes to the effect data as needed
    let result = true;
    try {
        // @ts-expect-error Can this happen?
        if (options.isUndo)
            return result = true;
        const parent = this.parent;
        if (!(parent instanceof CONFIG.Actor.documentClass))
            return result = true;
        if (!this.flags?.dae?.specialDuration) {
            this.updateSource({ "flags.dae.specialDuration": [] });
            foundry.utils.setProperty(data, "flags.dae.specialDuration", []);
        }
        if (parent instanceof Actor) {
            // Handle count/countDeleteDecrement stacking
            const shouldCreate = await handleStackIncrement(this, data, options);
            if (!shouldCreate)
                return result = false;
            // Prevent duplicate status effects
            if (getStatusEffectsArray().find(se => se._id === this.id) && parent.effects.find(ef => ef.id === this._id)) {
                console.warn(`dae | Attempting to add ${this.id} when already present - ignoring`);
                return result = false;
            }
            let updates = {};
            // Update the duration on the effect if needed
            if (this.flags?.dae?.durationExpression && parent instanceof Actor) {
                let sourceActor = parent;
                if (!data.transfer) { // for non-transfer effects we might be pointing to a different actor
                    const thing = fromUuidSync(this.origin);
                    if (thing?.actor)
                        sourceActor = thing.actor;
                }
                let theDurationRoll = new Roll(`${this.flags.dae.durationExpression}`, sourceActor?.getRollData());
                let theDuration = await theDurationRoll.evaluate();
                updates["duration.value"] = theDuration.total;
            }
            let changesChanged = false;
            let newChanges = [];
            debug("dae _preCreate changes input:", JSON.stringify(this.system.changes.map(c => ({ key: c.key, value: c.value }))));
            for (let change of this.system.changes) {
                if (typeof change.value === "string") {
                    const token = getSelfTarget(parent);
                    const tokenUuid = token instanceof TokenDocument ? token.uuid : token.document.uuid;
                    const context = {
                        "@actorUuid": parent?.uuid,
                        "@tokenUuid": tokenUuid,
                        "@targetUuid": tokenUuid
                    };
                    for (let key of Object.keys(context)) {
                        // Can't do a Roll.replaceFormula because of non-matches being replaced.
                        let newValue;
                        if (change.value.includes(`@${key}`))
                            continue;
                        newValue = change.value.replaceAll(key, context[key]);
                        if (newValue !== change.value) {
                            changesChanged = true;
                            change.value = newValue;
                        }
                    }
                }
                const inline = typeof change.value === "string" && change.value.includes("[[");
                if (change.key === "StatusEffect") {
                    console.warn("ActiveEffect | StatusEffect change key is deprecated, use macro.StatusEffect instead");
                    continue;
                }
                else if (inline) {
                    const rgx = /[\[]{2,3}(\/[a-zA-Z]+\s)?(.*?)([\]]{2,3})(?:{([^}]+)})?/gi;
                    const silentInline = change.value.includes("[[[");
                    const newChange = foundry.utils.duplicate(change);
                    changesChanged = true;
                    for (let match of change.value.matchAll(rgx)) {
                        if (!match[1]) {
                            const newValue = await evalInline(match[2], parent, this, silentInline);
                            newChange.value = newChange.value.replace(match[0], `${newValue}`);
                        }
                    }
                    newChanges.push(newChange);
                }
                else if (change.key.startsWith("macro.itemMacro")) {
                    const item = fromUuidSync(this.origin);
                    if (item instanceof Item) {
                        let macroCommand = getItemMacroCommand(item);
                        foundry.utils.setProperty(updates, `flags.dae.itemMacro`, macroCommand);
                    }
                }
                else if (change.key.startsWith("macro.activityMacro") && this.activity) {
                    const activity = fromUuidSync(this.activity);
                    // @ts-expect-error no dnd5e-types _AND_ no midi typing (which is what adds `macro`)
                    foundry.utils.setProperty(updates, "flags.dae.activityMacro", activity?.macro?.command);
                }
                else
                    newChanges.push(change);
            }
            if (changesChanged)
                updates["system.changes"] = newChanges;
            debug("dae _preCreate changes output:", JSON.stringify(newChanges.map(c => ({ key: c.key, value: c.value }))), "changesChanged:", changesChanged);
            this.updateSource(updates);
        }
    }
    catch (err) {
        console.error("dae | _preCreateActiveEffect", err);
    }
    finally {
        return result;
    }
}
async function evalInline(expression, actor, effect, silent) {
    try {
        warn("Doing inline eval", expression);
        expression = expression.replaceAll("@data.", "@");
        const roll = await (new Roll(expression, actor?.getRollData())).evaluate();
        if (showInline && !silent) {
            roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `${effect.name} ${expression}` });
        }
        return `${roll.total}`;
    }
    catch (err) {
        console.warn(`dae | evaluate args error: rolling ${expression} failed`, err);
        return "0";
    }
}
function recordDisabledSuppressedHook(effect, updates, options, userId) {
    // @ts-expect-error v14 effect.system.changes
    foundry.utils.setProperty(options, "dae.active", { wasDisabled: effect.disabled, wasSuppressed: effect.isSuppressed, oldChanges: foundry.utils.duplicate(effect.system.changes) });
    return true;
}
export function updateActiveEffectHook(effect, updates, options, userId) {
    let result = true;
    // @ts-expect-error Can this happen?
    if (options.isUndo)
        return result = true;
    if (userId !== game.user?.id)
        return result = true;
    const parent = effect.parent;
    if (!parent)
        return true;
    // if ((foundry.utils.getProperty(updates, "flags.dae.itemsToDelete") ?? []).length > 0) return true;
    let actor;
    if (parent instanceof CONFIG.Item.documentClass) {
        if (!effect.transfer)
            return;
        // Suppressed effects are covered by the item update
        actor = parent.parent;
        if (actor instanceof CONFIG.Actor.documentClass) {
            // if disabled status changed remove dependent effects macro.execute, createItem etc
            const wasDisabled = options.dae?.active?.wasDisabled ?? false;
            const becameDisabled = effect.disabled && !(options.dae?.active?.wasDisabled ?? false);
            const becameEnabled = (options.dae?.active?.wasDisabled ?? false) && !(effect.disabled ?? false);
            const item = effect.parent;
            if (becameDisabled) {
                // @ts-expect-error v14 effect.system.changes
                for (let change of effect.system.changes) {
                    removeEffectChange(actor, [], effect, item, change, options);
                }
            }
            else if (becameEnabled) {
                // @ts-expect-error v14 effect.system.changes
                for (let change of effect.system.changes) {
                    addEffectChange(actor, [], effect, item, change, options);
                }
            }
            return true;
        }
    }
    if (parent instanceof Actor)
        actor = parent;
    // if (effect.disabled === context.dae?.active?.disabled && effect.isSuppressed === context.dae?.active?.isSuppressed) return true;
    if (!actor)
        return true;
    actionQueue.add(async () => {
        if (!actor)
            return;
        const tokens = actor.isToken ? [actor.token?.object] : actor.getActiveTokens();
        const token = tokens[0];
        if (!(token instanceof foundry.canvas.placeables.Token))
            return;
        warn("add active effect actions", actor, updates);
        let addedChanges = [];
        let removedChanges = [];
        let existingChanges = [];
        let oldChanges = [];
        let newChanges = [];
        // @ts-expect-error v14 updates.system?.changes
        if (updates.system?.changes) {
            oldChanges = (foundry.utils.getProperty(options, "dae.active.oldChanges") ?? []).sort((a, b) => a.key < b.key ? -1 : 1);
            // @ts-expect-error v14 effect.system.changes
            newChanges = effect.system.changes.filter(c => c.key && c.key !== "").sort((a, b) => a.key < b.key ? -1 : 1);
            // @ts-expect-error v14 change.type replaces change.mode
            removedChanges = oldChanges.filter(change => !newChanges.some(c => c.key === change.key && c.type === change.type && c.value === change.value));
            // @ts-expect-error v14 change.type replaces change.mode
            existingChanges = oldChanges.filter(change => newChanges.some(c => c.key === change.key && c.type === change.type && c.value === change.value));
            // @ts-expect-error v14 change.type replaces change.mode
            addedChanges = newChanges.filter(change => !oldChanges.some(c => c.key === change.key && c.type === change.type && c.value === change.value));
            if (debugEnabled > 0) {
                warn("updateActiveEffect hook | old changes", oldChanges);
                warn("updateActiveEffect hook | new changes", newChanges);
                warn("updateActiveEffect hook | removed Changes ", removedChanges);
                warn("updateActiveEffect hook | added changes ", addedChanges);
                warn("updateActiveEffect hook | existing changes", existingChanges);
            }
            // @ts-expect-error v14 effect.system.changes
        }
        else
            existingChanges = effect.system.changes;
        const wasDisabled = options.dae?.active?.wasDisabled ?? false;
        const wasSuppressed = options.dae?.active?.wasSuppressed ?? false;
        const becameDisabled = effect.disabled && !(options.dae?.active?.wasDisabled ?? false);
        const becameSuppressed = effect.isSuppressed && !(options.dae?.active?.wasSuppressed ?? false);
        if (becameSuppressed || becameDisabled || removedChanges.length > 0) {
            let changesToDisable = [];
            if (becameSuppressed || becameDisabled) {
                changesToDisable = existingChanges.concat(removedChanges);
            }
            else if (!wasDisabled && !wasSuppressed) {
                changesToDisable = removedChanges;
            }
            if (changesToDisable.length > 0) {
                const disableContext = { ...options };
                if (becameDisabled)
                    disableContext["expiry-reason"] = "effect-disabled";
                else if (becameSuppressed)
                    disableContext["expiry-reason"] = "effect-suppressed";
                else
                    disableContext["expiry-reason"] = "change-deleted";
                await processEffectChanges("off", actor, tokens, effect, undefined, changesToDisable, disableContext);
            }
        }
        const becameEnabled = (options.dae?.active?.wasDisabled ?? false) && !(effect.disabled ?? false);
        const becameUnsuppressed = (options.dae?.active?.wasSuppressed ?? false) && !(effect.isSuppressed ?? false);
        if (becameEnabled || becameUnsuppressed || addedChanges.length > 0) {
            let changesToEnable = [];
            if (becameEnabled || becameUnsuppressed) {
                changesToEnable = existingChanges.concat(addedChanges);
            }
            else if (!effect.disabled && !effect.isSuppressed) {
                changesToEnable = addedChanges;
            }
            if (changesToEnable.length > 0) {
                await processEffectChanges("on", actor, tokens, effect, undefined, changesToEnable, options);
            }
        }
        // @ts-expect-error no dnd5e-types
        for (let dependent of effect.getDependents()) {
            if (dependent.disabled !== undefined && (dependent.disabled !== effect.disabled || dependent.isSuppressed !== effect.isSuppressed)) {
                await dependent.update({ "disabled": effect.disabled || effect.isSuppressed });
            }
        }
    }).catch(err => {
        console.warn("dae | updating active effect error", err);
    });
    return result = true;
}
async function _preDeleteActiveEffectDecrement(options, user) {
    if (!options.removeStacks)
        options.removeStacks = 1;
    if (this.flags.dae?.stackable === "count")
        options.removeStacks = Math.max(1, this.flags.dae.stacks ?? 1);
    // @ts-expect-error Can this happen?
    if (options.forceDelete || !(this.parent instanceof Actor))
        return true;
    const stacks = Math.max(0, this.flags?.dae?.stacks ?? 1);
    const newStacks = Math.max(1, stacks - options.removeStacks);
    if (stacks <= options.removeStacks) {
        options.removeStacks = Math.max(1, stacks);
        return true;
    }
    foundry.utils.setProperty(this, "flags.dae.stacks", newStacks);
    await this.update({
        name: `${effectBaseName(this)} (${newStacks})`,
        flags: {
            dae: {
                stacks: newStacks
            }
        }
    });
    // const counter = globalThis.EffectCounter?.findCounter(getTokenDocument(this.parent), this.img ?? this.icon);
    // await counter?.setValue(newStacks);
    debug("decrementing complete", this.name, stacks);
    // @ts-expect-error no dnd5e-types
    const dependents = this.getDependents();
    if (dependents)
        for (let dependent of dependents) {
            if (fromUuidSync(dependent.uuid))
                await dependent.delete(options);
        }
    return false;
}
export function deleteActiveEffectHook(effect, options, userId) {
    if (game.user?.id !== userId)
        return true;
    // @ts-expect-error Can this happen?
    if (options.isUndo)
        return true;
    if (!effect.parent)
        return true;
    let actor;
    if (effect.parent instanceof CONFIG.Actor.documentClass)
        actor = effect.parent;
    else if (effect.parent instanceof CONFIG.Item.documentClass && effect.transfer)
        actor = effect.parent.parent;
    if (!actor)
        return true;
    // @ts-expect-error v14 effect.system.changes
    if (effect.system?.changes) {
        // @ts-expect-error Is this okay?
        options.effectDeleted = true;
        if (!foundry.utils.getProperty(options, "expiry-reason"))
            foundry.utils.setProperty(options, "expiry-reason", "effect-deleted");
        actionQueue.add(async () => {
            if (!actor)
                return;
            // @ts-expect-error v14 effect.system.changes
            const changes = effect.system.changes;
            // Process standard change types and macro changes via processEffectChanges
            await processEffectChanges("off", actor, actor.token ? [actor.token.object] : actor.getActiveTokens(), effect, undefined, changes, options);
            // Handle special delete-only change keys not covered by processEffectChanges
            let entityToDelete;
            for (const change of changes) {
                try {
                    if (change.key === "flags.dae.deleteUuid" && change.value) {
                        await socketlibSocket.executeAsGM("deleteUuid", { uuid: change.value });
                    }
                    if (change.key === "flags.dae.suspendActiveEffect" && change.value) {
                        await socketlibSocket.executeAsGM("suspendActiveEffect", { uuid: change.value });
                    }
                    if (change.key === "flags.dae.deleteOrigin")
                        entityToDelete = effect.origin;
                    if (entityToDelete)
                        await socketlibSocket.executeAsGM("deleteUuid", { uuid: entityToDelete });
                }
                catch (err) {
                    console.warn("dae | error deleting active effect ", effect, err);
                }
            }
            if (effect.origin) {
                let origin = await fromUuid(effect.origin);
                if (globalThis.Sequencer && (origin === actor || origin?.parent === actor))
                    globalThis.Sequencer.EffectManager.endEffects({ origin: effect.origin });
            }
        }).catch(err => {
            console.warn("dae | deleteActiveEffectHook error", err);
        });
    }
    return true;
}
export function getSelfTarget(actor) {
    if (actor?.token)
        return actor.token.object;
    const speaker = ChatMessage.getSpeaker({ actor });
    if (speaker.token) {
        const token = canvas?.tokens?.get(speaker.token);
        if (token)
            return token;
    }
    const tokenData = actor?.prototypeToken.toObject(false);
    return new CONFIG.Token.documentClass(tokenData);
}
export async function daeMacro(action, actor, effectData, lastArgOptions = {}) {
    let selfTarget;
    let macro;
    let theItem;
    if (effectData instanceof ActiveEffect && !lastArgOptions.effectUuid)
        lastArgOptions.effectUuid = effectData.uuid;
    // Work out what itemData should be
    warn("Dae macro ", action, actor, effectData, lastArgOptions);
    // @ts-expect-error v14 system.changes on toObject() data
    if (!effectData.system?.changes)
        return effectData;
    if (effectData instanceof ActiveEffect) {
        if (effectData.transfer && effectData.parent instanceof Item)
            theItem = effectData.parent;
        effectData = effectData.toObject(false);
    }
    if (lastArgOptions.item)
        theItem = lastArgOptions.item;
    if (!theItem)
        theItem = await resolveItemFromEffect(effectData, actor);
    let context = actor.getRollData();
    if (theItem) {
        context.item = theItem;
        context.itemData = theItem.toObject(false);
        if (theItem)
            foundry.utils.setProperty(effectData, "flags.dae.itemData", theItem.toObject());
    }
    let tokenUuid;
    if (actor.token) {
        tokenUuid = actor.token.uuid;
        selfTarget = actor.token.object;
    }
    else {
        selfTarget = getSelfTarget(actor);
        tokenUuid = selfTarget instanceof TokenDocument ? selfTarget.uuid : selfTarget.document.uuid;
    }
    // @ts-expect-error v14 system.changes on toObject() data
    for (let change of (effectData.system?.changes ?? [])) {
        try {
            if (!allMacroEffects.includes(change.key))
                continue;
            context.stackCount = effectData.flags?.dae?.stacks ?? 1;
            let functionMatch;
            if (typeof change.value === "string")
                change.value = change.value.trim();
            if (change.value.startsWith("function.")) {
                const paramRe = /function\.\w+(\.\w+)*\("[^"]*"(?:\s*,\s*"[^"]*")+?\)/;
                const paramMatch = change.value.match(paramRe);
                if (paramMatch)
                    functionMatch = paramMatch[0];
                else
                    functionMatch = change.value.split(" ")[0];
                functionMatch = functionMatch.replace("function.", "");
                if (change.key.includes("macro.execute"))
                    change.value = change.value.replace(functionMatch, "FunctionMatch");
            }
            const theChange = await evalArgs({ item: theItem, effectData, context, actor, change, doRolls: true });
            let args = [];
            let v11args = {};
            if (typeof theChange.value === "string") {
                tokenizer.tokenize(theChange.value, (token) => args.push(token));
                if (theItem)
                    args = args.map(arg => {
                        if ("@itemData" === arg) {
                            return theItem.toObject(false);
                        }
                        else if ("@item" === arg) {
                            return theItem;
                        }
                        if (typeof arg === "string") {
                            const splitArg = arg.split("=");
                            if (splitArg.length === 2) {
                                if (splitArg[1] === "@itemData") {
                                    const itemData = theItem?.toObject(false);
                                    v11args[splitArg[0]] = itemData;
                                    return itemData;
                                }
                                else if (splitArg[1] === "@item") {
                                    v11args[splitArg[0]] = theItem;
                                    return theItem;
                                }
                                else
                                    v11args[splitArg[0]] = splitArg[1];
                            }
                        }
                        return arg;
                    });
            }
            else
                args = [change.value];
            if (theChange.key.includes("macro.execute") || theChange.key.includes("macro.itemMacro") || change.key.startsWith("macro.activityMacro")) {
                if (functionMatch) {
                    macro = createFunctionMacro(functionMatch);
                }
                else
                    macro = await resolveMacro(change.key, args[0], theItem, effectData, lastArgOptions.effectUuid);
                if (!macro) {
                    //TODO localize this
                    if (action !== "off") {
                        ui.notifications?.warn(`macro.execute/macro.itemMacro | No macro ${args[0]} found`);
                        warn(`macro.execute/macro.itemMacro | No macro ${args[0]} found`);
                        continue;
                    }
                }
                // doing this refetch to try and make sure the actor has not been deleted
                if (!fromUuidSync(actor.uuid)) {
                    error("actor vanished", actor.name, actor.uuid);
                    return;
                }
                const activityUuid = effectData.flags?.dae?.activity;
                let lastArg = foundry.utils.mergeObject(lastArgOptions, {
                    effectId: effectData._id,
                    origin: effectData.origin,
                    activity: activityUuid,
                    efData: effectData,
                    actorId: actor.id,
                    actorUuid: actor.uuid,
                    tokenId: selfTarget?.id,
                    effectUuid: lastArgOptions.effectUuid,
                    tokenUuid,
                }, { overwrite: false, insertKeys: true, insertValues: true, inplace: false });
                if (theChange.key.includes("macro.execute"))
                    args = args.slice(1);
                let macroArgs = [action];
                macroArgs = macroArgs.concat(args).concat(lastArg);
                const macroActivity = await fromUuid(activityUuid);
                const effect = fromUuidSync(lastArgOptions.effectUuid);
                const scope = {
                    actor,
                    token: selfTarget instanceof TokenDocument ? selfTarget.object : selfTarget,
                    lastArgValue: lastArg,
                    item: theItem,
                    macroItem: theItem,
                    macroActivity,
                    effect
                };
                scope.args = macroArgs.filter(arg => {
                    if (typeof arg === "string") {
                        const parts = arg.split("=");
                        if (parts.length === 2) {
                            scope[parts[0]] = parts[1];
                            return false;
                        }
                    }
                    return true;
                });
                await macro?.execute(scope);
            }
            else if (theChange.key === "macro.actorUpdate") {
                let lastArg = foundry.utils.mergeObject(lastArgOptions, {
                    effectId: effectData._id,
                    origin: effectData.origin,
                    efData: effectData,
                    actorId: actor.id,
                    actorUuid: actor.uuid,
                    tokenId: selfTarget?.id,
                    tokenUuid,
                }, { overwrite: false, insertKeys: true, insertValues: true, inplace: false });
                // try and make sure the actor has not vanished
                if (!fromUuidSync(actor.uuid)) {
                    error("actor vanished", actor.name, actor.uuid);
                }
                await macroActorUpdate(action, ...args, lastArg);
                // result = await macroActorUpdate(action, ...args, lastArg);
            }
        }
        catch (err) {
            const message = `daeMacro | "${action}" macro "${macro?.name}" for actor ${actor?.name} in ${theItem ? "item " + theItem.name : ""} ${actor?.uuid} ${theItem?.uuid}`;
            console.warn(message, err);
            if (globalThis.MidiQOL?.apps?.TroubleShooter)
                globalThis.MidiQOL.apps.TroubleShooter.recordError(err, message);
        }
    }
    ;
    return effectData;
}
export async function evalArgs({ effectData, item, context, actor, change, spellLevel = undefined, damageTotal = 0, doRolls = false, critical = false, fumble = false, whisper = false, itemCardUuid = null, tokenUuid = null }) {
    const itemUuid = item?.uuid ?? effectData.flags?.dae?.itemUuid;
    if (!item && itemUuid)
        item = await fromUuid(itemUuid);
    if (typeof change.value !== 'string')
        return change; // nothing to do
    const returnChange = foundry.utils.duplicate(change);
    // @ts-expect-error context isn't typed
    spellLevel ??= context.flags?.dnd5e?.spellLevel;
    let contextToUse = foundry.utils.mergeObject({
        scene: canvas?.scene?.id,
        token: ChatMessage.getSpeaker({ actor }).token,
        target: "@target",
        targetUuid: "@targetUuid",
        targetActorUuid: "@targetActorUuid",
        spellLevel,
        itemLevel: spellLevel,
        damage: damageTotal,
        itemCardUuid: itemCardUuid,
        unique: foundry.utils.randomID(),
        actor: actor.id,
        actorUuid: actor.uuid,
        critical,
        fumble,
        whisper,
        change: JSON.stringify(change),
        itemId: item?.id,
        itemUuid: item?.uuid,
        tokenUuid
    }, context, { overwrite: true });
    //contextToUse["item"] = "@item";
    if (item) {
        foundry.utils.setProperty(effectData, "flags.dae.itemUuid", item.uuid);
        foundry.utils.setProperty(effectData, "flags.dae.itemData", item.toObject(false));
        contextToUse["itemData"] = "@itemData";
        contextToUse["item"] = item.getRollData()?.item;
    }
    else {
        contextToUse["itemData"] = "@itemData";
        contextToUse["item"] = "@item";
    }
    returnChange.value = returnChange.value.replace("@item.level", "@itemLevel");
    returnChange.value = returnChange.value.replace(/@data./g, "@");
    const returnChangeValue = Roll.replaceFormulaData(returnChange.value, contextToUse, { missing: "0", warn: false });
    if (typeof returnChange.value === "object") {
        console.error("object returned from replaceFormula Data", returnChange.value);
    }
    else {
        returnChange.value = returnChangeValue;
    }
    returnChange.value = returnChange.value.replaceAll("##", "@");
    if (typeof returnChange.value === "string" && !returnChange.value.includes("[[")) {
        switch (change.key) {
            case "macro.itemMacro":
            case "macro.itemMacro.local":
            case "macro.itemMacro.GM":
            case "macro.execute":
            case "macro.execute.local":
            case "macro.execute.GM":
            case "macro.actorUpdate":
            case "macro.activityMacro":
                break;
            case "macro.CE":
            case "macro.StatusEffect":
            case "StatusEffect":
            case "macro.tokenMagic":
            case "macro.createItem":
            case "macro.createItemRunMacro":
            case "macro.summonToken":
                break;
            default:
                const currentValue = foundry.utils.getProperty(actor, change.key);
                if (doRolls && typeof (currentValue ?? ValidSpec.actorSpecs[actor.type].allSpecsObj[change.key]?.fieldType) === "number") {
                    const roll = new Roll(returnChange.value, contextToUse);
                    if (!roll.isDeterministic) {
                        error("evalArgs: expression is not deterministic dice terms ignored", actor.name, actor.uuid, returnChange.value);
                        returnChange.value = String(roll.evaluateSync({ strict: false }).total);
                    }
                }
                ;
                break;
        }
        ;
        debug("evalargs: change is ", returnChange);
    }
    return returnChange;
}
/*
 * apply non-transfer effects to target tokens - provided for backwards compat
 */
export async function doEffects(item, activate, targets = undefined, options) {
    return await applyNonTransferEffects(item, activate, targets, options);
}
export async function doActivityEffects(activity, activate, targets = undefined, activityEffectsUuids, options) {
    const activityEffects = activityEffectsUuids.map(aeUuid => fromUuidSync(aeUuid) ?? activity.effects.find(ae => ae.effect.uuid === aeUuid)?.effect).filter(ef => ef).map(ef => ef.toObject());
    // TODO dnd5e v4 - a temporary fix to make sure the effects are not disabled when applied
    activityEffects.forEach(ef => ef.disabled = false);
    return await applyActivityEffects(activity, activate, targets, activityEffects, options);
}
export async function applyActivityEffects(activity, activate, targets, activityEffects, options = {
    context: {},
    critical: false,
    damageTotal: null,
    effectsToApply: [],
    fumble: false,
    itemCardUuid: null,
    origin: activity.item.uuid,
    removeMatchLabel: false,
    selfEffects: "none",
    spellLevel: 0,
    toggleEffect: false,
    whisper: false,
}) {
    if (!options.applyAll)
        activityEffects = activityEffects.filter(aeData => aeData.flags?.dae?.dontApply !== true);
    else
        activityEffects.forEach(aeData => foundry.utils.setProperty(aeData, "flags.dae.dontApply", false));
    if (activityEffects.length === 0)
        return;
    const rollData = activity.item.getRollData(); //TODO if not caster eval move to evalArgs call
    options.toggleEffect = activity.midiProperties?.toggleEffect || activity.item.flags?.midiProperties?.toggleEffect;
    let macroLocation = "mixed";
    for (let [aeIndex, activeEffectData] of activityEffects.entries()) {
        // @ts-expect-error v14 system.changes on toObject() data
        for (let [changeIndex, change] of activeEffectData.system.changes.entries()) {
            const doRolls = isRegisteredMacroKey(change.key);
            if (doRolls) {
                const dest = getChangeDestination(change.key);
                if (dest === "local" && macroLocation !== "GM")
                    macroLocation = "local";
                else if (dest === "GM")
                    macroLocation = "GM";
            }
            // eval args before calling GMAction so macro arguments are evaled in the casting context.
            // Any @fields for macros are looked up in actor context and left unchanged otherwise
            rollData.stackCount = activeEffectData.flags?.dae?.stacks ?? 1;
            const evalArgsOptions = Object.assign({}, options, {
                effectData: activeEffectData,
                change,
                doRolls
            });
            evalArgsOptions.context = { ...rollData, ...(options.context ?? {}) };
            evalArgsOptions.context.activity = activity.getRollData?.() ?? activity;
            evalArgsOptions.item = activity.item;
            if (activity.actor)
                evalArgsOptions.actor = activity.actor;
            let newChange = await evalArgs(evalArgsOptions);
            // @ts-expect-error v14 system.changes on toObject() data
            activeEffectData.system.changes[changeIndex] = newChange;
        }
        ;
        // @ts-expect-error Thinks `uuid` shouldn't exist
        activeEffectData.origin = options.origin ?? activityEffects[aeIndex].uuid;
        daeSystemClass.addDAEMetaData(activeEffectData, activity.item, options);
        activityEffects[aeIndex] = activeEffectData;
    }
    // Split up targets according to whether they are owned on not. Owned targets have effects applied locally, only unowned are passed ot the GM
    let targetList = Array.from(targets ?? []);
    targetList = targetList.map(t => (typeof t === "string") ? fromUuidSync(t)?.actor : t);
    targetList = targetList.map(t => (t instanceof foundry.canvas.placeables.Token) || (t instanceof TokenDocument) ? t.actor : t);
    targetList = targetList.filter(t => t instanceof Actor);
    let localTargets = targetList.filter(t => macroLocation === "local" || (t.isOwner && macroLocation === "mixed")).map(t => t.uuid);
    let gmTargets = targetList.filter(t => (!t.isOwner && macroLocation === "mixed") || macroLocation === "GM").map(t => t.uuid);
    debug("apply non-transfer effects: About to call gmaction ", activate, activityEffects, targets, localTargets, gmTargets);
    if (gmTargets.length > 0) {
        await socketlibSocket.executeAsGM("applyActiveEffects", { userId: game.user?.id, activate, activityUuid: activity.uuid, activeEffects: activityEffects, targetList: gmTargets, effectDuration: activity.duration, itemCardUuid: options.itemCardUuid, removeMatchLabel: options.removeMatchLabel, toggleEffect: options.toggleEffect, metaData: options.metaData });
    }
    if (localTargets.length > 0) {
        const result = await applyActiveEffects({ activate, activityUuid: activity.uuid, targetList: localTargets, activeEffects: activityEffects, effectDuration: activity.duration, itemCardUuid: options.itemCardUuid, removeMatchLabel: !!options.removeMatchLabel, toggleEffect: !!options.toggleEffect, metaData: options.metaData, origin: options.origin });
    }
}
// Apply non-transfer effects to targets.
// macro arguments are evaluated in the context of the actor applying to the targets
// @target is left unevaluated.
// request is passed to a GM client if the token is not owned
export async function applyNonTransferEffects(item, activate, targets, options = {
    critical: false,
    damageTotal: null,
    effectsToApply: [],
    fumble: false,
    itemCardUuid: null,
    removeMatchLabel: false,
    selfEffects: "none",
    spellLevel: 0,
    toggleEffect: false,
    tokenId: undefined,
    whisper: false,
}) {
    if (!targets)
        return;
    let macroLocation = "mixed";
    let appliedEffects = filterEffectsForTargeting(item.effects, options.selfEffects ?? "none");
    if (!options.applyAll)
        appliedEffects = appliedEffects.filter(aeData => aeData.flags?.dae?.dontApply !== true);
    else
        appliedEffects.forEach(aeData => foundry.utils.setProperty(aeData, "flags.dae.dontApply", false));
    if (options.effectsToApply?.length)
        appliedEffects = appliedEffects.filter(aeData => options.effectsToApply?.includes(aeData._id ?? ""));
    if (appliedEffects.length === 0)
        return;
    const rollData = item.getRollData(); //TODO if not caster eval move to evalArgs call
    // options.toggleEffect = item.flags?.midiProperties?.toggleEffect === true;
    for (let [aeIndex, activeEffectData] of appliedEffects.entries()) {
        // @ts-expect-error v14 system.changes on toObject() data
        for (let [changeIndex, change] of activeEffectData.system.changes.entries()) {
            const doRolls = isRegisteredMacroKey(change.key);
            if (doRolls) {
                const dest = getChangeDestination(change.key);
                if (dest === "local" && macroLocation !== "GM")
                    macroLocation = "local";
                else if (dest === "GM")
                    macroLocation = "GM";
            }
            // eval args before calling GMAction so macro arguments are evaluated in the casting context.
            // Any @fields for macros are looked up in actor context and left unchanged otherwise
            rollData.stackCount = activeEffectData.flags?.dae?.stacks ?? 1;
            const evalArgsOptions = Object.assign({}, options, {
                effectData: activeEffectData,
                change,
                doRolls
            });
            evalArgsOptions.context = { ...rollData, ...(options.context ?? {}) };
            evalArgsOptions.item = item;
            if (item.actor)
                evalArgsOptions.actor = item.actor;
            let newChange = await evalArgs(evalArgsOptions);
            // @ts-expect-error v14 system.changes on toObject() data
            activeEffectData.system.changes[changeIndex] = newChange;
        }
        ;
        activeEffectData.origin = options.origin ?? item.uuid;
        daeSystemClass.addDAEMetaData(activeEffectData, item, options);
        appliedEffects[aeIndex] = activeEffectData;
    }
    // Split up targets according to whether they are owned on not. Owned targets have effects applied locally, only unowned are passed ot the GM
    let targetList = Array.from(targets).map(t => (typeof t === "string")
        ? fromUuidSync(t)?.actor
        : (t instanceof Actor)
            ? t
            : t.actor).filter(t => t instanceof Actor);
    let localTargets = targetList.filter(t => macroLocation === "local" || (t.isOwner && macroLocation === "mixed")).map(t => t.uuid);
    let gmTargets = targetList.filter(t => (!t.isOwner && macroLocation === "mixed") || macroLocation === "GM").map(t => t.uuid);
    debug("apply non-transfer effects: About to call gmaction ", activate, appliedEffects, targets, localTargets, gmTargets);
    if (gmTargets.length > 0) {
        // @ts-expect-error no dnd5e-types
        await socketlibSocket.executeAsGM("applyActiveEffects", { userId: game.user?.id, activate, activeEffects: appliedEffects, targetList: gmTargets, effectDuration: item.system.duration, itemCardUuid: options.itemCardUuid, removeMatchLabel: options.removeMatchLabel, toggleEffect: options.toggleEffect, metaData: options.metaData });
    }
    if (localTargets.length > 0) {
        // @ts-expect-error no dnd5e-types
        await applyActiveEffects({ activate, targetList: localTargets, activeEffects: appliedEffects, effectDuration: item.system.duration, itemCardUuid: options.itemCardUuid, removeMatchLabel: options.removeMatchLabel, toggleEffect: options.toggleEffect, metaData: options.metaData, origin: options.origin });
    }
}
/**
 * Processes all effect changes for a single effect, dispatching to the appropriate
 * async helper for each change type and running daeMacro for macro change keys.
 * This function must be called from within actionQueue to ensure serialization.
 * Inner helpers no longer use actionQueue internally, avoiding deadlock.
 */
export async function processEffectChanges(action, actor, tokens, effect, item, changes, context) {
    let token = tokens[0] ?? undefined;
    if (!token) {
        token = getToken(actor);
        tokens = token ? [token] : [];
    }
    if (debugEnabled > 0)
        warn(`processEffectChanges ${action}`, actor, changes, tokens, effect);
    // Dispatch non-macro changes through the registry
    for (const change of changes) {
        const handler = getChangeHandler(change.key);
        if (handler && !handler.isMacroKey) {
            const handlerCtx = { actor, change, effect, token, tokens, context };
            await handler[action](handlerCtx);
        }
    }
    // Batch macro change keys through daeMacro
    if (changes.some(c => isRegisteredMacroKey(c.key))) {
        if (debugEnabled > 0)
            warn(`processEffectChanges daeMacro ${action}`, actionQueue.remaining);
        const macroContext = { effectUuid: effect.uuid };
        if (item)
            macroContext.item = item;
        if (action === "off") {
            if (item)
                macroContext.origin = item.uuid;
            if (context?.["expiry-reason"])
                macroContext["expiry-reason"] = context["expiry-reason"];
        }
        await daeMacro(action, actor, effect.toObject(false), macroContext);
    }
}
export function addEffectChange(actor, tokens, effectToApply, item, change, context) {
    if (debugEnabled > 0)
        warn("addEffectChange ", actor, change, tokens, effectToApply);
    // Queue all changes for this effect through actionQueue for serialization
    actionQueue.add(processEffectChanges, "on", actor, tokens, effectToApply, item, [change], context);
}
export function removeEffectChange(actor, tokens, effectToApply, item, change, context) {
    // Queue all changes for this effect through actionQueue for serialization
    actionQueue.add(processEffectChanges, "off", actor, tokens, effectToApply, item, [change], context);
}
// When an item is created any effects have a source that points to the original item
export async function deleteItemHook(candidateItem, options, userId) {
    if (userId !== game.user?.id)
        return;
    // @ts-expect-error Can this happen?
    if (options.isUndo)
        return;
    const actor = candidateItem.parent;
    if (!(actor instanceof Actor))
        return;
    const token = tokenForActor(actor);
    // @ts-expect-error Is this okay?
    options.itemDeleted = true;
    for (let effect of candidateItem.effects) {
        if (!effect.transfer)
            continue;
        if (effect.disabled || effect.isSuppressed)
            continue;
        const selfAuraChange = foundry.utils.getProperty(effect, "flags.ActiveAuras.isAura") === true
            && foundry.utils.getProperty(effect, "flags.ActiveAuras.ignoreSelf") === true
            && effect.origin?.startsWith(actor.uuid);
        if (selfAuraChange)
            return;
        // @ts-expect-error v14 effect.system.changes
        await actionQueue.add(processEffectChanges, "off", actor, token ? [token] : [], effect, candidateItem, effect.system.changes, options);
    }
    return;
}
export async function createItemHook(item, options, userId) {
    // @ts-expect-error Can this happen?
    if (options.isUndo)
        return;
    if (userId !== game.user?.id)
        return;
    const actor = item.parent;
    if (!(actor instanceof Actor))
        return;
    const token = tokenForActor(actor);
    for (let effect of item.effects) {
        if (!effect.transfer)
            continue;
        if (effect.disabled || effect.isSuppressed)
            continue;
        const selfAuraChange = foundry.utils.getProperty(effect, "flags.ActiveAuras.isAura") === true
            && foundry.utils.getProperty(effect, "flags.ActiveAuras.ignoreSelf") === true
            && effect.origin?.startsWith(actor.uuid);
        if (selfAuraChange)
            return;
        // @ts-expect-error v14 effect.system.changes
        await actionQueue.add(processEffectChanges, "on", actor, [token], effect, item, effect.system.changes, options);
    }
    return;
}
// Process onUpdateTarget flags
export function preUpdateActorHook(candidate, updates, options, userId) {
    let result = true;
    try {
        // @ts-expect-error Can this happen?
        if (options.onUpdateCalled)
            return result = true;
        for (let onUpdate of (candidate.flags?.dae?.onUpdateTarget ?? [])) {
            if (onUpdate.macroName.length === 0)
                continue;
            if (onUpdate.filter.startsWith("data.")) {
                onUpdate.filter = onUpdate.filter.replace("data.", "system.");
            }
            if (foundry.utils.getProperty(updates, onUpdate.filter) === undefined)
                continue;
            const originObject = fromUuidSync(onUpdate.origin);
            const sourceTokenDocument = fromUuidSync(onUpdate.sourceTokenUuid);
            const targetTokenDocument = fromUuidSync(onUpdate.targetTokenUuid);
            const sourceActor = actorFromUuid(onUpdate.sourceActorUuid);
            const sourceToken = sourceTokenDocument?.object;
            const targetActor = targetTokenDocument?.actor;
            const targetToken = targetTokenDocument?.object;
            let originItem = (originObject instanceof Item) ? originObject : undefined;
            if (!originItem && originObject instanceof ActiveEffect)
                originItem = originObject.parent;
            if (!originItem) {
                const theEffect = targetActor?.appliedEffects.find(ef => ef.origin === onUpdate.origin);
                if (theEffect?.flags?.dae?.itemUuid) {
                    originItem = fromUuidSync(theEffect.flags.dae.itemUuid);
                }
            }
            let lastArg = {
                tag: "onUpdateTarget",
                effectId: null,
                origin: onUpdate.origin,
                efData: null,
                actorId: targetActor?.id,
                actorUuid: targetActor?.uuid,
                tokenId: targetToken?.id,
                tokenUuid: targetTokenDocument?.uuid,
                actor: candidate,
                updates,
                options,
                user: userId,
                userId,
                sourceActor,
                sourceToken,
                targetActor,
                targetToken,
                originItem,
                macroItem: originItem
            };
            let macroText;
            if (onUpdate.macroName.startsWith("ItemMacro")) { // TODO Come back and make sure this is tagged to the effect
                if (onUpdate.macroName === "ItemMacro") {
                    macroText = getItemMacroCommand(originItem);
                }
                else if (onUpdate.macroName.startsWith("ItemMacro.")) {
                    let macroObject = sourceActor?.items.getName(onUpdate.macroName.split(".")[1]);
                    const originActor = originObject?.parent instanceof Actor ? originObject.parent : originObject?.parent?.parent;
                    if (!macroObject)
                        macroObject = originActor?.items.getName(onUpdate.macroName.split(".")[1]);
                    if (macroObject)
                        macroText = getItemMacroCommand(macroObject);
                }
            }
            else if (onUpdate.macroName.trim().startsWith("function.")) {
                macroText = `return await ${onUpdate.macroName.trim().replace("function.", "").trim()}(speaker, actor, token, character, scope)`;
            }
            else {
                const theMacro = game.macros?.getName(onUpdate.macroName);
                if (!theMacro) {
                    console.warn(`dae | onUpdateActor no macro found for actor ${candidate.name} macro ${onUpdate.macroName}`);
                    continue;
                }
                if (theMacro?.type === "chat") {
                    theMacro.execute(); // use the core foundry processing for chat macros
                    continue;
                }
                macroText = theMacro?.command;
            }
            try { // TODO make an actual macro and then call macro.execute....
                const speaker = ChatMessage.getSpeaker({ actor: candidate });
                const args = ["onUpdateActor"].concat(onUpdate.args);
                args.push(lastArg);
                const character = undefined; // game.user?.character;
                const scope = { args, lastArgValue: lastArg, item: originItem, macroItem: originItem };
                args.forEach(argString => {
                    if (typeof argString === "string") {
                        const parts = argString.split("=");
                        if (parts.length === 2) {
                            scope[parts[0]] = parts[1];
                        }
                    }
                });
                macroText = `try { ${macroText} } catch(err) { console.warn("dae | macro error", err) };`;
                const AsyncFunction = (async function () { }).constructor;
                const argNames = Object.keys(scope);
                const argValues = Object.values(scope);
                //@ts-expect-error for some reason
                const fn = new AsyncFunction("speaker", "actor", "token", "character", "item", "macroItem", "scope", ...argNames, macroText);
                fn.call(this, speaker, candidate, targetTokenDocument?.object, character, scope.item, scope.macroItem, scope, ...argValues);
            }
            catch (err) {
                ui.notifications?.error(`There was an error running your macro. See the console (F12) for details`);
                error("dae | Error evaluating macro for onUpdateActor", err);
            }
        }
    }
    catch (err) {
        console.error("dae | error in onUpdateTarget", err);
    }
    finally {
        return result;
        // return wrapped(updates, options, user);
    }
}
export function daeReadyActions() {
    DAEReadyComplete = true;
    // @ts-expect-error no typings for dfreds ce
    ceInterface = game.modules.get("dfreds-convenient-effects")?.active ? game.modules.get("dfreds-convenient-effects").api : undefined;
    ValidSpec.localizeSpecs();
    // initSheetTab();
    if (game.settings.get("dae", "disableEffects")) {
        ui.notifications?.warn("DAE effects disabled no DAE effect processing");
        console.warn("dae disabled - no active effects");
    }
    daeSystemClass.readyActions();
    // Process init macros that were deferred during prepareData before game.ready
    // Pass the live ActiveEffect (not .toObject()) so daeMacro resolves theItem
    // from effect.parent (the owned item) rather than following origin to a compendium.
    if (pendingInitMacroEffects.length > 0) {
        for (const { effectUuid, actorUuid } of pendingInitMacroEffects) {
            const effect = fromUuidSync(effectUuid);
            const actor = fromUuidSync(actorUuid);
            if (!effect || !actor)
                continue;
            actionQueue.add(daeMacro, "init", actor, effect, { effectUuid });
        }
        pendingInitMacroEffects.length = 0;
    }
    aboutTimeInstalled = game.modules.get("about-time")?.active ?? false;
    simpleCalendarInstalled = game.modules.get("foundryvtt-simple-calendar")?.active ?? false;
    timesUpActive = game.modules.get("times-up")?.active ?? false;
    // Provide human-readable labels for module flags (midi-qol, etc.) to dnd5e's
    // effect change display (PR #6820). Falls back to DAE's localizationMap which
    // modules populate via the DAE API.
    Hooks.on("dnd5e.getUnknownAttributeLabel", (attr, options) => {
        const entry = localizationMap[attr];
        if (entry?.name)
            options.label = entry.name;
    });
}
export let tokenizer;
Hooks.on("spotlightOmnisearch.indexBuilt", async (index) => {
    const fieldData = await foundry.utils.fetchJsonWithTimeout('modules/dae/data/field-data.json');
    const entries = Object.entries(fieldData).flatMap(([category, fields]) => Object.entries(fields).map(([key, { name, description }]) => ({
        key,
        name,
        description,
        category
    })));
    for (let entry of entries) {
        // @ts-expect-error no typings for spotlight omnisearch
        index.push(new CONFIG.SpotlightOmnisearch.SearchTerm({
            icon: ["fas fa-heart"],
            dragData: { fieldName: entry.key },
            name: entry.key,
            description: entry.description,
            query: "",
            keywords: ["dae", entry.category],
            type: "DAE attributes"
        }));
    }
});
export function daeInitActions() {
    atlActive = game.modules.get("ATL")?.active ?? false;
    midiActive = game.modules.get("midi-qol")?.active ?? false;
    const dnd5System = DAESystemDND5E; // force reference so they are installed?
    libWrapper = globalThis.libWrapper;
    daeSystemClass = foundry.utils.getProperty(globalThis.daeSystems, game.system.id ?? "");
    daeSystemClass ??= CONFIG.DAE.systemClass;
    daeSystemClass.initActions();
    daeSystemClass.initSystemData();
    // Patch Roll.replaceFormulaData for limited recursion of nested formula references
    libWrapper.register("dae", "Roll.replaceFormulaData", replaceFormulaData, "MIXED");
    if (game.settings.get("dae", "disableEffects")) {
        ui.notifications?.warn("DAE effects disabled no DAE effect processing");
        console.warn("dae | All active effects disabled.");
        return;
    }
    // Augment actor getRollData with actorUuid, actorId, tokenId, tokenUuid
    if (daeSystemClass.getRollDataWrapper) {
        libWrapper.register("dae", "CONFIG.Actor.documentClass.prototype.getRollData", daeSystemClass.getRollDataWrapper, "MIXED");
    }
    Hooks.on("createItem", createItemHook);
    Hooks.on("deleteItem", deleteItemHook);
    // process onUpdateTarget flags
    Hooks.on("preUpdateActor", preUpdateActorHook);
    // Hooks for conditional effects — route through actionQueue to prevent race conditions
    // during bulk imports (e.g., DDB-importer) where many hooks fire concurrently
    Hooks.on("updateActor", scheduleConditionalEffects);
    Hooks.on("updateToken", (tokenDocument, updates) => {
        if (updates.x || updates.y)
            scheduleConditionalEffects(tokenDocument.actor, updates);
    });
    Hooks.on("updateItem", (item, updates) => {
        if (item.parent instanceof Actor)
            scheduleConditionalEffects(item.parent, updates);
    });
    Hooks.on("createActiveEffect", (effect, options, userId) => {
        if (game.user !== game.users?.activeGM)
            return;
        if (effect.parent instanceof Actor) {
            scheduleConditionalEffects(effect.parent, {});
        }
        else if (effect.transfer) {
            const item = effect.parent;
            const actor = item?.parent;
            if (actor)
                scheduleConditionalEffects(actor, {});
        }
    });
    Hooks.on("updateActiveEffect", (effect, updates) => {
        if (game.user !== game.users?.activeGM)
            return;
        if (effect.parent instanceof Actor) {
            scheduleConditionalEffects(effect.parent, updates);
        }
        else if (effect.transfer) {
            const item = effect.parent;
            const actor = item?.parent;
            if (actor)
                scheduleConditionalEffects(actor, updates);
        }
    });
    Hooks.on("deleteActiveEffect", (effect) => {
        if (game.user !== game.users?.activeGM)
            return;
        if (effect.parent instanceof Actor) {
            scheduleConditionalEffects(effect.parent, {});
        }
        else if (effect.transfer) {
            const item = effect.parent;
            const actor = item?.parent;
            if (actor)
                scheduleConditionalEffects(actor, {});
        }
    });
    libWrapper.register("dae", "CONFIG.ActiveEffect.documentClass.prototype._preCreate", _preCreateActiveEffect, "MIXED");
    async function _preCreateActiveEffect(wrapped, data, context, user) {
        // Migrate deprecated flags.dae.showIcon to native showIcon field
        if (this.flags?.dae?.showIcon) {
            // @ts-expect-error showIcon not in fvtt-types
            this.updateSource({ showIcon: 2, "flags.dae.-=showIcon": null });
            foundry.utils.logCompatibilityWarning(`dae | Effect "${this.name}": flags.dae.showIcon is deprecated, auto-migrated to ActiveEffect.showIcon.`, { once: true, stack: false });
        }
        // ATL → token.* pre-write normalisation (Layer A — enabled by "migrate" and "full").
        if (atlRewriteAtPreWrite) {
            // @ts-expect-error v14 effect.system.changes
            const changes = this.system?.changes;
            if (Array.isArray(changes) && changes.length > 0) {
                const rewritten = rewriteAtlChanges(changes);
                if (rewritten !== changes) {
                    // @ts-expect-error v14 updateSource accepts system.changes
                    this.updateSource({ "system.changes": rewritten });
                }
            }
        }
        let result = await _preCreateActiveEffectRemoveExisting.bind(this)(data, context, user);
        if (result !== false)
            result = await _preCreateActiveEffectIncrement.bind(this)(data, context, user);
        // @ts-expect-error no dnd5e-types
        if (this.active && this.type !== "enchantment" && dependentConditions /* && !this.flags?.dae?.autoCreated */) {
            await daeSystemClass.preCreateActiveEffect(this);
            if (debugEnabled > 0)
                warn("_preCreateActiveEffect", this, context);
            // Status effect reconciliation now handled via queueStatusReconciliation hook
        }
        // For source/target expiry events, convert to core turnStart/turnEnd before
        // calling wrapped so core sees a recognized expiry value. Record the original
        // expiry and target actor so we can override start.combatant after wrapped.
        // dnd5e 6.0+ handles source/target turn expiry natively.
        let coreExpiry;
        let expiry;
        if (daeManagesTurnExpiry) {
            const daeExpiryMap = {
                sourceStart: "turnStart", sourceEnd: "turnEnd",
                targetStart: "turnStart", targetEnd: "turnEnd",
            };
            //@ts-expect-error v14 types
            expiry = this.duration?.expiry;
            coreExpiry = expiry ? daeExpiryMap[expiry] : undefined;
            if (coreExpiry) {
                this.updateSource({ duration: { expiry: coreExpiry } });
            }
        }
        if (result !== false)
            result = await wrapped(data, context, user);
        // After wrapped, override start.combatant for source/target expiry
        if (coreExpiry && this.parent instanceof Actor && game.combat?.started) {
            const overrideActor = (expiry === "sourceStart" || expiry === "sourceEnd")
                ? (this.origin ? actorFromUuid(this.origin) : null) ?? this.parent
                : this.parent;
            const combatant = game.combat.getCombatantsByActor(overrideActor)?.[0];
            if (combatant) {
                this.updateSource({
                    start: {
                        combatant: combatant.id,
                        combat: game.combat.id,
                        round: game.combat.round,
                        turn: game.combat.turn,
                        initiative: combatant.initiative,
                    }
                });
            }
        }
        return result;
    }
    libWrapper.register("dae", "CONFIG.ActiveEffect.documentClass.prototype._preDelete", _preDeleteActiveEffect, "MIXED");
    async function _preDeleteActiveEffect(wrapped, options, user) {
        let result = await _preDeleteActiveEffectDecrement.bind(this)(options, user);
        if (result !== false)
            result = wrapped(options, user);
        return result;
    }
    libWrapper.register("dae", "CONFIG.ActiveEffect.documentClass.prototype._preUpdate", _preUpdateActiveEffect, "MIXED");
    async function _preUpdateActiveEffect(wrapped, ...args) {
        const [changed, options, userId] = args;
        // ATL → token.* pre-write normalisation (Layer A — enabled by "migrate" and "full").
        // Only rewrite when the update touches system.changes; otherwise leave as-is so non-change
        // updates (name, disabled toggle, etc.) don't cause spurious work.
        if (atlRewriteAtPreWrite && Array.isArray(changed?.system?.changes)) {
            const rewritten = rewriteAtlChanges(changed.system.changes);
            if (rewritten !== changed.system.changes) {
                changed.system.changes = rewritten;
            }
        }
        if (dependentConditions) {
            let shouldInclude = this.active;
            if (this.parent instanceof Item && !this.transfer)
                shouldInclude = false;
            // If the effect is active only process changes if the statuses of the effect changed
            const changedStatuses = new Set(changed.statuses);
            const statusesChanged = this.statuses.difference(changedStatuses).size > 0 && this.statuses.size !== changedStatuses.size;
            if (shouldInclude && (statusesChanged || changed.disabled !== undefined || changed.isSuppressed !== undefined)) {
                if (debugEnabled > 0)
                    warn("preUpdateActiveEffect ", this, changed, options);
                // Status effect reconciliation now handled via queueStatusReconciliation hook
            }
        }
        // Evaluate [[formula]] inline expressions in change values.
        // Merge pre-update changes with the update diff to get the post-update changes,
        // then resolve inline rolls before Foundry applies the update.
        const parent = this.parent;
        let actor;
        if (parent instanceof CONFIG.Actor.documentClass)
            actor = parent;
        else if (parent instanceof CONFIG.Item.documentClass && effectIsTransfer(this))
            actor = parent.parent;
        if (actor) {
            try {
                const effectiveChanges = foundry.utils.deepClone(changed.system?.changes ?? this.system?.changes ?? []);
                let anyResolved = false;
                for (const change of effectiveChanges) {
                    const silentInline = typeof change.value === "string" && change.value.includes("[[[");
                    const inline = typeof change.value === "string" && change.value.includes("[[");
                    if (inline || silentInline) {
                        const rgx = /[\[]{2,3}(\/[a-zA-Z]+\s)?(.*?)([\]]{2,3})(?:{([^}]+)})?/gi;
                        let newChangeValue = foundry.utils.duplicate(change.value);
                        for (const match of change.value.matchAll(rgx)) {
                            if (!match[1]) {
                                const newValue = await evalInline(match[2], actor, this, silentInline);
                                newChangeValue = newChangeValue.replace(match[0], `${newValue}`);
                            }
                        }
                        change.value = newChangeValue;
                        anyResolved = true;
                    }
                }
                if (anyResolved) {
                    foundry.utils.setProperty(changed, "system.changes", effectiveChanges);
                }
            }
            catch (err) {
                console.warn(`dae | _preUpdateActiveEffect inline eval error: Actor ${actor.name}, Effect ${this.name}`, changed, err);
            }
        }
        return wrapped(...args);
    }
    Hooks.on("createActiveEffect", createActiveEffectHook);
    Hooks.on("updateItem", (item, data, options, userId) => updateStatusEffects(item, options, userId));
    Hooks.on("deleteItem", (item, options, userId) => updateStatusEffects(item, options, userId));
    Hooks.on("createItem", (item, options, userId) => updateStatusEffects(item, options, userId));
    Hooks.on("deleteActiveEffect", deleteActiveEffectHook);
    //  Hooks.on("preDeleteActiveEffect", preDeleteActiveEffectHook); - moved wrapper to avoid race conditions
    Hooks.on("preUpdateActiveEffect", recordDisabledSuppressedHook);
    Hooks.on("updateActiveEffect", updateActiveEffectHook);
    // Queue status reconciliation after effect changes complete
    Hooks.on("createActiveEffect", (effect, options, userId) => {
        queueStatusesReconciliation(effect, userId);
    });
    Hooks.on("deleteActiveEffect", (effect, options, userId) => {
        queueStatusesReconciliation(effect, userId);
    });
    Hooks.on("updateActiveEffect", (effect, data, options, userId) => {
        queueStatusesReconciliation(effect, userId);
    });
    // Add the active effects title bar actions
    Hooks.on("getHeaderControlsItemSheet5e", appendDocumentSheetHeaderControls);
    Hooks.on("getHeaderControlsActorSheetV2", appendDocumentSheetHeaderControls);
    Hooks.on("renderItemSheetV2", colorSheetHeaderButtons); // tidy5e item sheets
    Hooks.on("renderItemSheet5e", colorSheetHeaderButtons); // dnd5e item sheets
    Hooks.on("renderActorSheetV2", colorSheetHeaderButtons);
    Hooks.on("renderActorSheetV2", injectDeleteExpiredButton);
    setupSpecialDurationHooks();
    // Open DIMEditor as the field editor for macro-command change rows in the active effect sheet.
    registerFieldEditor({
        keyMatch: "flags.dae.macro.command",
        editor: async (currentValue, context) => new Promise((resolve) => {
            new DIMEditor({
                initialCommand: currentValue,
                name: context.effect?.name ?? i18n("dae.DIMEditor.Name"),
                img: context.effect?.img,
                uniqueIdSuffix: `${context.effect?.uuid ?? foundry.utils.randomID()}-${context.changeIndex}`,
                onSubmit: (newValue) => resolve(newValue),
                onCancel: () => resolve(null),
            }).render({ force: true });
        }),
        icon: "fas fa-code",
        tooltip: i18n("dae.DIMEditor.Name"),
    });
    //@ts-expect-error no typings for this (can we maybe ditch in favor of our own tokenization?)
    tokenizer = new DETokenizeThis({
        shouldTokenize: ['(', ')', ',', '*', '/', '%', '+', '===', '==', '!=', '!', '<', '> ', '<=', '>=', '^']
    });
    actionQueue = new foundry.utils.Semaphore();
}
function scheduleReconciliation(actor) {
    if (!dependentConditions || reconciliationPending.has(actor.uuid))
        return;
    reconciliationPending.add(actor.uuid);
    actionQueue.add(async () => {
        try {
            reconciliationPending.delete(actor.uuid);
            await reconcileActorStatuses(actor);
        }
        catch (err) {
            console.warn("dae | Error reconciling actor statuses:", err);
        }
    });
}
function scheduleConditionalEffects(actor, updates) {
    if (conditionalEffectsPending.has(actor.uuid))
        return;
    conditionalEffectsPending.add(actor.uuid);
    actionQueue.add(async () => {
        try {
            conditionalEffectsPending.delete(actor.uuid);
            await processConditionalEffects(actor, updates);
        }
        catch (err) {
            console.warn("dae | Error processing conditional effects:", err);
        }
    });
}
function updateStatusEffects(doc, options, userId) {
    if (!dependentConditions || userId !== game.user?.id)
        return;
    let actor = doc;
    if (doc instanceof Item || doc instanceof ActiveEffect)
        actor = doc.parent;
    if (actor instanceof Item)
        actor = actor.parent;
    if (actor instanceof Actor)
        scheduleReconciliation(actor);
}
function queueStatusesReconciliation(effect, userId) {
    if (!dependentConditions || userId !== game.user?.id)
        return;
    const hasStatuses = !!effect.statuses?.size;
    // @ts-expect-error v14 effect.system.changes
    const hasCIChanges = effect.system?.changes?.some(c => c.key.startsWith("system.traits.ci"));
    if (!hasStatuses && !hasCIChanges)
        return;
    const actor = effect.parent instanceof Actor ? effect.parent : effect.parent?.parent;
    if (actor instanceof Actor)
        scheduleReconciliation(actor);
}
/**
 * Reconcile the status effects on an actor based on all active effects.
 * This calculates what statuses SHOULD exist based on current effects,
 * then adds missing statuses and removes extra ones.
 *
 * Status effect documents use static _ids (e.g., staticID("dnd5eparalyzed")).
 * The dnd5e character sheet determines active conditions by checking for these
 * documents, not actor.statuses. So reconciliation must create/remove the
 * actual documents to keep the sheet in sync.
 */
async function reconcileActorStatuses(actor) {
    if (!dependentConditions)
        return;
    if (debugEnabled > 0)
        warn("reconcileActorStatuses", actor.name);
    const excludedStatuses = ["concentrating", "bonusaction", "reaction", "encumbered", "heavilyEncumbered", "exceedingCarryingCapacity"];
    // Calculate expected statuses from all active effects
    // Skip status effect documents with static _ids (those are the output, not the input)
    let expectedStatuses = new Set();
    const existingStaticStatusIds = new Set(); // Track which static-_id status effect documents exist
    const autoCreatedStaticStatusIds = new Set(); // Track which were created by DAE (vs manually by user)
    for (let effect of actor.allApplicableEffects()) {
        if (effect.flags?.["dfreds-convenient-effects"])
            continue;
        // Check if this effect has a static _id matching a CONFIG status effect.
        // These are status effect documents (created by toggleStatusEffect, fromStatusEffect,
        // or by this reconciliation). They are the OUTPUT of reconciliation, not input.
        // Track these REGARDLESS of active state — an inactive (disabled/suppressed) static-id
        // document still needs to be removed if the actor is immune to that condition.
        const configStatusEffect = getStatusEffectsArray().find(se => se._id === effect.id);
        if (configStatusEffect) {
            existingStaticStatusIds.add(configStatusEffect.id);
            if (effect.flags?.dae?.autoCreated) {
                autoCreatedStaticStatusIds.add(configStatusEffect.id);
            }
            // Only count sub-statuses from ACTIVE static-id effects as expected
            if (effect.active) {
                for (const status of effect.statuses) {
                    if (status !== configStatusEffect.id) {
                        expectedStatuses.add(status);
                    }
                }
            }
            continue; // Don't add all statuses via the union below
        }
        if (!effect.active)
            continue;
        expectedStatuses = expectedStatuses.union(effect.statuses);
    }
    // Filter out statuses we don't manage
    for (const status of excludedStatuses) {
        expectedStatuses.delete(status);
    }
    // Filter out statuses the actor is immune to
    // @ts-expect-error no dnd5e-types
    const conditionImmunities = actor.system.traits?.ci?.value;
    if (conditionImmunities) {
        for (const condition of conditionImmunities) {
            expectedStatuses.delete(condition);
        }
    }
    // Add status effect documents that should exist but don't
    for (let status of expectedStatuses) {
        if (existingStaticStatusIds.has(status))
            continue;
        const statusEffect = getStatusEffectsArray().find(se => se.id === status);
        if (!statusEffect)
            continue;
        if (!statusEffect._id)
            continue;
        if (statusEffect.statuses?.includes(status))
            continue; // Self referential
        try {
            await toggleActorStatusEffect(actor, status, { active: true, flags: { dae: { autoCreated: true } } });
        }
        catch (err) {
            if (!String(err).includes("does not exist") && !String(err).includes("already exists")) {
                console.warn("dae | Error adding status effect:", status, err);
            }
        }
    }
    // Remove status effect documents that should not exist
    // Only remove auto-created documents (created by DAE reconciliation), not ones
    // manually applied by the user from the character sheet
    // Exception: CI overrides even manual statuses
    for (let statusEffectId of existingStaticStatusIds) {
        if (expectedStatuses.has(statusEffectId))
            continue;
        if (!autoCreatedStaticStatusIds.has(statusEffectId) && !conditionImmunities?.has(statusEffectId))
            continue;
        const statusEffect = getStatusEffectsArray().find(se => se.id === statusEffectId);
        if (!statusEffect)
            continue;
        if (!statusEffect._id)
            continue;
        try {
            await toggleActorStatusEffect(actor, statusEffectId, { active: false });
        }
        catch (err) {
            if (!String(err).includes("does not exist")) {
                console.warn("dae | Error removing status effect:", statusEffectId, err);
            }
        }
    }
}
Hooks.once("tidy5e-sheet.ready", api => {
    api.registerItemHeaderControls?.({
        controls: [
            {
                icon: 'fas fa-wrench',
                label: "DAE",
                async onClickAction() {
                    new ActiveEffects({ document: this.document }).render({ force: true });
                }
            },
            {
                icon: 'fas fa-file-pen',
                label: "DIME",
                async onClickAction() {
                    new DIMEditor({ document: this.document }).render({ force: true });
                }
            }
        ]
    });
});
function appendDocumentSheetHeaderControls(app, controls) {
    const daeTitle = i18n("dae.ActiveEffectName");
    const DIMETitle = i18n("dae.DIMEditor.Name");
    if (daeTitleBar) {
        controls.push({
            label: daeTitle,
            icon: "fa-solid fa-wrench",
            action: "dae-effects",
            onClick: () => new ActiveEffects({ document: app.document }).render({ force: true })
        });
    }
    if (DIMETitleBar && app.document instanceof Item) {
        controls.push({
            label: DIMETitle,
            icon: "fa-solid fa-file-pen",
            action: "dae-dime",
            onClick: () => new DIMEditor({ document: app.document }).render({ force: true })
        });
    }
    // Color icons in the dnd5e context menu (nav#context-menu).
    // dnd5e replaces the standard Foundry .controls-dropdown with a ContextMenu5e,
    // and getHeaderControls fires when that context menu opens.
    // Use setTimeout so the context menu DOM has been built.
    if (!daeColorTitleBar)
        return;
    const doc = app.document;
    if (!doc)
        return;
    const green = "#36ba36";
    let hasEffects = false;
    let hasMacro = false;
    if (daeTitleBar) {
        if (doc instanceof Actor)
            hasEffects = doc.allApplicableEffects().next().value !== undefined;
        else
            hasEffects = doc.effects?.size > 0;
    }
    if (DIMETitleBar && doc instanceof Item) {
        const validMacroFlags = ["flags.dae.macro.command", "flags.itemacro.macro.command", "flags.itemacro.macro.data.command"];
        hasMacro = validMacroFlags.some(f => foundry.utils.getProperty(doc, f));
    }
    if (!hasEffects && !hasMacro)
        return;
    setTimeout(() => {
        const contextItems = document.querySelectorAll("nav#context-menu .context-item");
        contextItems.forEach(item => {
            const label = item.textContent?.trim() ?? "";
            const icon = item.querySelector("i");
            if (!icon)
                return;
            if (hasEffects && label.includes(daeTitle)) {
                icon.style.color = green;
            }
            if (hasMacro && label.includes(DIMETitle)) {
                icon.style.color = green;
            }
        });
    });
}
// Inject global CSS rules once for DAE/DIME icon coloring.
// Color tidy5e header buttons on render (tidy5e puts buttons directly in .window-header)
function colorSheetHeaderButtons(app, _element) {
    if (!daeColorTitleBar)
        return;
    const appElement = app.element;
    if (!appElement)
        return;
    const doc = app.document;
    if (!doc)
        return;
    const green = "#36ba36";
    if (daeTitleBar) {
        let hasEffects = false;
        if (doc instanceof Actor)
            hasEffects = doc.allApplicableEffects().next().value !== undefined;
        else
            hasEffects = doc.effects?.size > 0;
        if (hasEffects) {
            const tidyWrench = appElement.querySelector(".window-header .header-control.fa-wrench");
            if (tidyWrench)
                tidyWrench.style.color = green;
        }
    }
    if (DIMETitleBar && doc instanceof Item) {
        const validMacroFlags = ["flags.dae.macro.command", "flags.itemacro.macro.command", "flags.itemacro.macro.data.command"];
        const hasMacro = validMacroFlags.some(f => foundry.utils.getProperty(doc, f));
        if (hasMacro) {
            const tidyFilePen = appElement.querySelector(".window-header .header-control.fa-file-pen");
            if (tidyFilePen)
                tidyFilePen.style.color = green;
        }
    }
}
function injectDeleteExpiredButton(app, _element) {
    const actor = app.document;
    if (!(actor instanceof Actor))
        return;
    const appElement = app.element;
    if (!appElement)
        return;
    // Find the suppressed effects section header
    const suppressedSection = appElement.querySelector('.items-section[data-effect-type="suppressed"]');
    if (!suppressedSection)
        return;
    const header = suppressedSection.querySelector('.items-header');
    if (!header)
        return;
    // Don't add duplicate buttons
    if (header.querySelector('[data-action="deleteExpiredEffects"]'))
        return;
    const controlsDiv = header.querySelector('.item-controls, .effect-controls') ?? header;
    const btn = document.createElement("a");
    btn.classList.add("effect-control", "item-control");
    btn.dataset.action = "deleteExpiredEffects";
    btn.dataset.tooltip = i18n("dae.deleteExpiredEffects");
    btn.setAttribute("aria-label", i18n("dae.deleteExpiredEffects"));
    btn.style.color = "var(--color-text-primary, #191813)";
    btn.innerHTML = '<i class="fas fa-trash-can"></i>';
    btn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const expiredEffects = [];
        for (const effect of actor.allApplicableEffects()) {
            // @ts-expect-error expired not in fvtt-types _source schema
            if (effect.duration?.expired || effect._source?.duration?.expired) {
                if (effect.id)
                    expiredEffects.push(effect.id);
            }
        }
        if (expiredEffects.length === 0)
            return;
        await actor.deleteEmbeddedDocuments("ActiveEffect", expiredEffects);
    });
    controlsDiv.prepend(btn);
}
export function daeSetupActions() {
    daeSystemClass.setupActions();
}
export function fetchParams() {
    setDebugLevel(game.settings.get("dae", "ZZDebug"));
    // useAbilitySave = game.settings.get("dae", "useAbilitySave") disabled as of 0.8.74
    noDupDamageMacro = game.settings.get("dae", "noDupDamageMacro");
    disableEffects = game.settings.get("dae", "disableEffects");
    daeTitleBar = game.settings.get("dae", "DAETitleBar");
    DIMETitleBar = game.settings.get("dae", "DIMETitleBar");
    daeColorTitleBar = game.settings.get("dae", "DAEColorTitleBar");
    daeNoTitleText = game.settings.get("dae", "DAENoTitleText");
    // showDeprecation = game.settings.get("dae", "showDeprecation") ?? true;
    showInline = game.settings.get("dae", "showInline") ?? false;
    dependentConditions = game.settings.get("dae", "DependentConditions") ?? false;
    specialDurationExpiryAction = game.settings.get("dae", "expiryAction") ?? "default";
    fetchDurationParams();
    // ATL compatibility policy — derive the per-layer flags.
    atlCompatMode = game.settings.get("dae", "atlCompatibility") ?? "legacy";
    atlRewriteAtPreWrite = atlCompatMode === "migrate" || atlCompatMode === "full";
    atlRewriteAtRuntime = atlCompatMode === "runtime" || atlCompatMode === "full";
    atlMigrateWorldData = atlCompatMode === "migrate" || atlCompatMode === "full";
    Hooks.callAll("dae.settingsChanged");
}
export function getTokenDocument(tokenRef) {
    if (!tokenRef)
        return undefined;
    let entity = tokenRef;
    if (typeof tokenRef === "string")
        entity = fromUuidSync(tokenRef);
    if (entity instanceof TokenDocument)
        return entity;
    if (entity instanceof foundry.canvas.placeables.Token)
        return entity.document;
    if (entity instanceof Actor) {
        if (entity.isToken)
            return entity.token ?? undefined;
        return entity.getActiveTokens(false, true)[0];
    }
    if (entity instanceof Item && entity.parent instanceof Actor)
        return getTokenDocument(entity.parent);
    if (entity instanceof ActiveEffect) {
        const parent = entity.parent;
        if (parent instanceof Actor)
            return getTokenDocument(parent);
        if (parent instanceof Item && parent.parent instanceof Actor)
            return getTokenDocument(parent.parent);
    }
    return undefined;
}
export function getToken(tokenRef) {
    return getTokenDocument(tokenRef)?.object ?? undefined;
}
export function actorFromUuid(uuid) {
    let doc = fromUuidSync(uuid);
    while (doc && !(doc instanceof CONFIG.Actor.documentClass)) {
        doc = doc.actor ?? doc.parent;
    }
    return doc ?? null;
}
// Allow limited recursion of the formula replace function for things like
// bonuses.heal.damage in spell formulas.
export function replaceFormulaData(wrapped, formula, data = {}, { missing, warn = false } = { missing: undefined, warn: false }) {
    let result = formula;
    const maxIterations = 3;
    data.Embed = "@Embed"; // Never replace these
    if (typeof formula !== "string")
        return formula;
    for (let i = 0; i < maxIterations; i++) {
        if (!result.includes("@"))
            break;
        try {
            result = wrapped(result, data, { missing, warn });
        }
        catch (err) {
            error(err, formula, data, missing, warn);
        }
    }
    return result;
}
export function tokensForActor(actorRef) {
    let actor;
    if (!actorRef)
        return undefined;
    if (typeof actorRef === "string")
        actor = fromUuidSync(actorRef);
    else
        actor = actorRef;
    if (actor.token)
        return [actor.token.object];
    if (!(actor instanceof Actor))
        return undefined;
    const tokens = actor.getActiveTokens();
    if (!tokens.length)
        return undefined;
    const controlled = tokens.filter(t => t.controlled);
    return controlled.length ? controlled : tokens;
}
export function tokenForActor(actor) {
    const tokens = tokensForActor(actor);
    if (!tokens)
        return undefined;
    return tokens[0];
}
export function effectIsTransfer(effect) {
    return effect.transfer === true;
}
export async function delay(interval) {
    await new Promise(resolve => setTimeout(resolve, interval));
}
export function safeGetGameSetting(moduleName, settingName) {
    // @ts-expect-error too generic to type
    if (game.settings.settings.get(`${moduleName}.${settingName}`))
        return game.settings.get(moduleName, settingName);
    else
        return undefined;
}
export function getApplicableEffects(actor, { includeEnchantments, includeExpired = false }) {
    if (!actor)
        return [];
    let effects = [];
    for (let effect of actor.allApplicableEffects()) {
        if (!includeExpired && effect.duration?.expired)
            continue;
        effects.push(effect);
    }
    if (includeEnchantments) {
        const enchantments = actor.items.contents.flatMap(i => i.effects.contents).filter(ae => {
            if (!ae.isAppliedEnchantment)
                return false;
            if (!includeExpired && ae.duration?.expired)
                return false;
            return true;
        });
        effects = effects.concat(enchantments);
    }
    return effects;
}
// This does not work since the hook is called after _preCreateEffect is called which leads to the update source firing too late
export async function toggleActorStatusEffectPossible(actor, statusId, { active = false, overlay = false, enableCondition = "", origin = "", flags = {} } = {}) {
    let preCreateActiveEffectHookId;
    try {
        const statusEffect = getStatusEffectsArray().find(e => e.id === statusId);
        preCreateActiveEffectHookId = Hooks.on("preCreateActiveEffect", (effect, data, options, userId) => {
            if (effect._id !== statusEffect?._id)
                return;
            if (origin)
                effect.updateSource({ origin });
            if (enableCondition?.length)
                effect.updateSource({ "flags.dae.enableCondition": enableCondition });
            if (overlay)
                effect.updateSource({ "flags.core.overlay": true });
            flags = foundry.utils.mergeObject(effect.flags ?? {}, flags ?? {}, { inplace: false });
            effect.updateSource({ flags });
        });
        return await actor.toggleStatusEffect(statusId, { active, overlay });
    }
    catch (err) {
        console.error("dae | toggleActorStatusEffect", err);
    }
    finally {
        if (preCreateActiveEffectHookId)
            Hooks.off("preCreateActiveEffect", preCreateActiveEffectHookId);
    }
}
// TODO can't use the core toggleActorStatusEffect, consider patching this to replace the core one
export async function toggleActorStatusEffect(actor, statusId, { active = false, overlay = false, enableCondition = "", origin = "", flags = {} } = {}) {
    if (debugEnabled > 0)
        warn("toggleActorStatusEffect", actor, statusId, active);
    const status = getStatusEffectsArray().find(e => e.id === statusId);
    if (!status)
        throw new Error(`Invalid status ID "${statusId}" provided to Actor#toggleStatusEffect`);
    let existing = [];
    // Find the effect with the static _id of the status effect
    if (status._id) {
        const effect = actor.effects.get(status._id);
        if (effect?.id)
            existing.push(effect);
    }
    // If no static _id, find all single-status effects that have actor status
    else {
        for (const effect of actor.effects) {
            const statuses = effect.statuses;
            if ((statuses.size === 1) && statuses.has(status.id))
                existing.push(effect);
        }
    }
    // Remove the existing effects unless the status effect is forced active
    if (existing.length) {
        if (active) {
            return true;
        }
        try {
            await actor.deleteEmbeddedDocuments("ActiveEffect", existing.map(e => e.id));
        }
        catch (err) {
            // Race condition: another concurrent call deleted this status effect first
            if (!String(err).includes("does not exist"))
                throw err;
        }
        return false;
    }
    // Create a new effect unless the status effect is forced inactive
    if (!active && active !== undefined)
        return false;
    const effect = await ActiveEffect.implementation.fromStatusEffect(statusId);
    if (origin)
        effect.updateSource({ origin });
    if (enableCondition?.length)
        effect.updateSource({ flags: { dae: { enableCondition: enableCondition } } });
    if (overlay)
        effect.updateSource({ flags: { core: { overlay: true } } });
    flags = foundry.utils.mergeObject(effect.flags ?? {}, flags ?? {}, { inplace: false });
    effect.updateSource({ flags });
    try {
        const returnEffect = await ActiveEffect.implementation.create(effect.toObject(), { parent: actor, keepId: true });
        return returnEffect ? [returnEffect] : false;
    }
    catch (err) {
        if (String(err).includes("already exists")) {
            // Race condition: another concurrent call created this status effect first
            return true;
        }
        throw err;
    }
}
export async function processConditionalEffects(actor, updates) {
    if (!game.users?.activeGM?.isSelf)
        return;
    if (!actor || !["character", "npc"].includes(actor.type))
        return;
    const tokenDocument = tokenForActor(actor)?.document;
    const token = tokenDocument?.object;
    // while (token?.animationContexts?.get(token.animationName)?.to) await delay(100);
    // @ts-expect-error missing in fvtt-types currently
    await token?.movementAnimationPromise;
    const rollData = actor.getRollData();
    const effectItem = game.items?.getName(i18n("dae.ConditionalEffectsItem"));
    if (effectItem) {
        for (let conditionalEffect of effectItem.effects) {
            let enableCondition = conditionalEffect.flags?.dae?.enableCondition;
            if (!enableCondition || conditionalEffect.disabled)
                continue;
            const ceData = conditionalEffect.toObject(false);
            const expression = Roll.replaceFormulaData(enableCondition, rollData);
            const result = daeSystemClass.safeEval(expression, rollData);
            if (!result)
                continue;
            let overlay = ceData.flags.core?.overlay ?? false;
            const statusEffects = new Set();
            // @ts-expect-error v14 system.changes on toObject() data
            for (let change of ceData.system.changes) {
                if (daeSystemClass.fieldMappings[change.key]) {
                    const mapping = daeSystemClass.fieldMappings[change.key];
                    if (typeof mapping === "string") {
                        change.key = mapping;
                    }
                    else {
                        change.key = mapping.key;
                        if (mapping.value !== undefined)
                            change.value = mapping.value;
                        if (mapping.type !== undefined)
                            change.type = mapping.type;
                        else if (mapping.mode !== undefined) {
                            // Legacy field mapping with numeric mode -- convert to v14 string type
                            const modeToType = { 0: "custom", 1: "multiply", 2: "add", 3: "downgrade", 4: "upgrade", 5: "override" };
                            change.type = modeToType[mapping.mode] ?? "custom";
                        }
                    }
                }
            }
            // @ts-expect-error v14 system.changes on toObject() data
            ceData.system.changes = ceData.system.changes
                .filter(change => change.key !== "StatusEffect" || change.value.startsWith("zce-"));
            for (let status of ceData.statuses) {
                statusEffects.add(status);
            }
            const existingEffect = actor.effects.find(ef => ef.origin === conditionalEffect.uuid);
            if (!existingEffect || ["countDeleteDecrement", "count", "multi"].includes(ceData.flags?.dae?.stackable ?? "")) {
                for (let statusEffect of statusEffects) {
                    await toggleActorStatusEffect(actor, statusEffect, { active: true, overlay, origin: conditionalEffect.uuid, enableCondition: enableCondition });
                }
                // @ts-expect-error v14 system.changes on toObject() data
                if (ceData.system.changes.length > 0 || statusEffects.size === 0) {
                    if (actor.effects.some(ef => ef.id === ceData._id))
                        continue;
                    ceData.origin = conditionalEffect.uuid;
                    if (debugEnabled > 0)
                        warn(`dae | creating conditional effect on ${actor.name} ${actor.uuid}`, ceData);
                    await actor.createEmbeddedDocuments("ActiveEffect", [ceData]);
                }
            }
        }
    }
    const idsToDelete = [];
    for (let effect of actor.effects) {
        let condition = effect?.flags?.dae?.enableCondition;
        if (condition) {
            // add other things to rollData
            rollData.combat = game.combat;
            rollData.time = game.time;
            rollData.effect = effect.toObject();
            const expression = Roll.replaceFormulaData(condition, rollData);
            const result = daeSystemClass.safeEval(expression, rollData);
            if (!result) {
                idsToDelete.push(effect.id);
            }
        }
    }
    if (idsToDelete.length > 0) {
        await actor.deleteEmbeddedDocuments("ActiveEffect", idsToDelete);
    }
    for (let effect of actor.allApplicableEffects()) {
        const disableCondition = foundry.utils.getProperty(effect, "flags.dae.disableCondition");
        if (typeof disableCondition === "string" && disableCondition.trim() !== "") {
            const rollData = (effect.parent?.getRollData() ?? {});
            rollData.effect = effect.toObject();
            let value = Roll.replaceFormulaData(disableCondition, rollData, { missing: "0", warn: false });
            try { // Roll parser no longer accepts some expressions it used to so we will try and avoid using it
                let disabled;
                if (value.includes("dae.eval(") || value.includes("dae.roll(")) {
                    disabled = daeSystemClass.safeEvalExpression(value, rollData);
                    disabled = daeSystemClass.safeEval(disabled, rollData);
                }
                else
                    disabled = daeSystemClass.safeEval(value, rollData);
                if (!!disabled !== effect.disabled) {
                    if (debugEnabled > 0)
                        warn("setting disabled effect", effect, disabled);
                    await effect.update({ disabled: !!disabled });
                }
            }
            catch (err) {
                warn("diabledCondition error", err);
            }
        }
    }
    await token?.drawEffects();
}
// TODO (Michael) type this for activities not just items
export function enumerateBaseValues(objectDataModels, logErrors = true) {
    const baseValues = {};
    //@ts-expect-error no dnd5e-types
    const dataModels = game.system.dataModels;
    const MappingField = dataModels.fields.MappingField;
    // TODO (Michael) once dnd5e-types in, ensure mapping field properly typed
    function processMappingField(key, mappingField, baseValues, logErrors = true) {
        const fields = mappingField.initialKeys;
        if (!fields)
            return;
        for (let fieldKey of Object.keys(fields)) {
            if (mappingField.model instanceof SchemaField) {
                processSchemaField(`${key}.${fieldKey}`, mappingField.model, baseValues, logErrors);
            }
            else if (mappingField.model instanceof MappingField) {
                processMappingField(`${key}.${fieldKey}`, mappingField.model, baseValues, logErrors);
            }
            else {
                // TODO come back and see how favorites might be supported.
                if (fieldKey.includes("favorites"))
                    return;
                // let initial = fields[fieldKey].initial ?? 0;;
                // if (typeof fields[fieldKey].initial === "function") { initial = fields[fieldKey].initial() ?? ""; }
                baseValues[`${key}.${fieldKey}`] = [fields[fieldKey], ""];
            }
        }
    }
    function processSchemaField(key, schemaField, baseValues, logErrors = true) {
        const fields = schemaField.fields;
        for (let fieldKey of Object.keys(fields)) {
            if (fields[fieldKey] instanceof SchemaField) {
                processSchemaField(`${key}.${fieldKey}`, fields[fieldKey], baseValues, logErrors);
            }
            else if (fields[fieldKey] instanceof MappingField) {
                processMappingField(`${key}.${fieldKey}`, fields[fieldKey], baseValues, logErrors);
            }
            else {
                if (fieldKey.includes("favorites"))
                    return; //TODO see above
                // let initial = fields[fieldKey].initial ?? 0;;
                // if (typeof fields[fieldKey].initial === "function") { initial = fields[fieldKey].initial() ?? ""; }
                baseValues[`${key}.${fieldKey}`] = [fields[fieldKey], ""];
            }
        }
    }
    for (let key of Object.keys(objectDataModels)) {
        const schema = objectDataModels[key].schema;
        baseValues[key] = {};
        if (schema instanceof SchemaField) {
            processSchemaField(`system`, schema, baseValues[key]);
        }
        else if (logErrors)
            console.error("Unexpected field ", key, schema);
    }
    return baseValues;
}
export function effectBaseName(effect) {
    if (!effect?.name)
        return "";
    if (!effect.flags.dae?.stacks)
        return effect.name;
    const returnName = effect.name.replace(/(.*) \([0-9]+\)?$/, "$1");
    return returnName;
}
export function busyWait(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}
export function getStaticID(id) {
    id = `dnd5e${id}`;
    if (id.length >= 16)
        return id.substring(0, 16);
    return id.padEnd(16, "0");
}
