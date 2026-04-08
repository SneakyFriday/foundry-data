import { applyActiveEffects, socketlibSocket } from "./GMAction.js";
import { warn, error, debug, setDebugLevel, i18n, debugEnabled } from "../dae.js";
import { ActiveEffects } from "./apps/ActiveEffects.js";
import { macroActorUpdate } from "./daeMacros.js";
import { ValidSpec } from "./Systems/DAESystem.js";
import { DAESystemDND5E } from "./Systems/DAEdnd5e.js";
import { DIMEditor } from "./apps/DIMEditor.js";
import { isEnchantment, otherFieldsMap } from "./apps/DAEActiveEffectConfig.js";
const { SchemaField, ArrayField, ObjectField, BooleanField, NumberField, StringField } = foundry.data.fields;
let templates = {};
export let aboutTimeInstalled = false;
export let timesUpActive = false;
export let simpleCalendarInstalled = false;
export let atlActive = false;
export let itemacroActive = false;
export let midiActive = false;
export let useDetermineSuppression = false;
export let ceInterface;
export let localizationMap = {};
// export let useAbilitySave;
// export let expireRealTime
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
// Track actors with pending status reconciliation to avoid duplicate reconciliations
const reconciliationPending = new Set();
export let allMacroEffects = ["macro.execute", "macro.execute.local", "macro.execute.GM", "macro.itemMacro", "macro.itemMacro.local", "macro.itemMacro.GM", "macro.actorUpdate", "macro.activityMacro"];
export let macroDestination = {
    "macro.execute": "mixed",
    "macro.execute.local": "local",
    "macro.execute.GM": "GM",
    "macro.itemMacro": "mixed",
    "macro.itemMacro.local": "local",
    "macro.itemMacro.GM": "GM",
    "macro.actorUpdate": "mixed",
    "macro.activityMacro": "mixed"
};
export let daeSystemClass;
if (!globalThis.daeSystems)
    globalThis.daeSystems = {};
// export let showDeprecation = true;
export let showInline = false;
function flagChangeKeys(actor, change) {
    if (!(["dnd5e"].includes(game.system.id ?? "")))
        return;
    const hasSaveBonus = change.key.startsWith("data.abilities.") && change.key.endsWith(".save") && !change.key.endsWith(".bonuses.save");
    if (hasSaveBonus) {
        const saveBonus = change.key.match(/data.abilities.(\w\w\w).save/);
        const abl = saveBonus?.[1];
        console.error(`dae | deprecated change key ${change.key} found in ${actor.name} use system.abilities.${abl}.bonuses.save instead`);
        // change.key = `data.abilities.${abl}.bonuses.save`;
        return;
    }
    const hasCheckBonus = change.key.startsWith("data.abilities.") && change.key.endsWith(".mod");
    if (hasCheckBonus) {
        const checkBonus = change.key.match(/data.abilities.(\w\w\w).mod/);
        const abl = checkBonus?.[1];
        console.error(`dae | deprecated change key ${change.key} found in ${actor.name} use system.abilities.${abl}.bonuses.check instead`);
        // change.key = `data.abilities.${abl}.bonuses.check`;
        return;
    }
    const hasSkillMod = change.key.startsWith("data.skills") && change.key.endsWith(".mod");
    if (hasSkillMod) {
        const skillMod = change.key.match(/data.skills.(\w\w\w).mod/);
        const abl = skillMod?.[1];
        console.error(`dae | deprecated change key ${change.key} found in ${actor.name} use system.skills.${abl}.bonuses.check instead`);
        // change.key = `data.skills.${abl}.bonuses.check`;
        return;
    }
    const hasSkillPassive = change.key.startsWith("data.skills.") && !change.key.endsWith(".bonuses.passive") && change.key.endsWith(".passive");
    if (hasSkillPassive) {
        const skillPassive = change.key.match(/data.skills.(\w\w\w).passive/);
        const abl = skillPassive?.[1];
        console.error(`dae | deprecated change key ${change.key} found in ${actor.name} use system.skills.${abl}.bonuses.passive instead`);
        // change.key = `data.dkills.${abl}.bonuses.passive`;
        return;
    }
}
/*
 * Replace default applyAffects to do value lookups
 */
export function applyDaeEffects({ specList = {}, excludeSpecs = {}, allowAllSpecs = false, wildCardsInclude = [], wildCardsExclude = [], doStatusEffects = false }) {
    if (disableEffects)
        return;
    const overrides = {};
    debug("prepare data: before passes", this.name, this._source);
    for (let effect of this.allApplicableEffects())
        // @ts-expect-error no dnd5e-types
        if (useDetermineSuppression)
            effect.determineSuppression();
    const effects = this.appliedEffects.filter(ef => !ef.disabled && !ef.isSuppressed);
    if (!effects || effects.length === 0)
        return this.overrides ?? {};
    const changes = effects.reduce((changes, effect) => {
        if (doStatusEffects) {
            for (const statusId of effect.statuses) {
                this.statuses.add(statusId);
            }
        }
        // TODO find a solution for flags.? perhaps just a generic specList
        return changes.concat(expandEffectChanges(foundry.utils.duplicate(effect.changes))
            .filter(c => {
            if (daeSystemClass.fieldMappings[c.key]) {
                const mappedField = daeSystemClass.fieldMappings[c.key];
                foundry.utils.logCompatibilityWarning(`dae | Actor ${this.name} ${c.key} deprecated use ${daeSystemClass.fieldMappings[c.key]} instead.`, { once: true, stack: false });
                if (mappedField.startsWith("system.traits.da") && mappedField.endsWith(".value")) {
                    const damageType = c.key.split(".").slice(-1)[0];
                    c.key = mappedField;
                    c.value = damageType;
                    if (c.mode === CONST.ACTIVE_EFFECT_MODES.CUSTOM)
                        c.mode = CONST.ACTIVE_EFFECT_MODES.ADD;
                }
                else {
                    if (c.key.includes("DR") && c.value?.length > 0)
                        c.value = `-(${c.value})`;
                    if (debugEnabled > 0)
                        warn("Doing field mapping mapping ", c.key, daeSystemClass.fieldMappings[c.key]);
                    c.key = daeSystemClass.fieldMappings[c.key];
                }
            }
            return !excludeSpecs[c.key]
                && (allowAllSpecs || specList[c.key] !== undefined || wildCardsInclude.some(re => c.key.match(re) !== null))
                && (!wildCardsExclude.some(re => c.key.match(re) !== null))
                && !c.key.startsWith("ATL.");
        })
            .map(c => {
            c = foundry.utils.duplicate(c);
            c.count = effect.flags?.dae?.stacks || 1;
            flagChangeKeys(this, c);
            if (c.key.startsWith("flags.midi-qol.optional")) { // patch for optional effects
                const parts = c.key.split(".");
                if (["save", "check", "skill", "damage", "attack"].includes(parts[parts.length - 1])) {
                    console.error(`dae/midi-qol | deprecation error ${c.key} should be ${c.key}.all on actor ${this.name}`);
                    c.key = `${c.key}.all`;
                }
            }
            if (c.key === "flags.midi-qol.OverTime")
                c.key = `flags.midi-qol.OverTime.${foundry.utils.randomID()}`;
            c.effect = effect;
            if (["system.traits.ci.value", "system.traits.ci.all", "system.traits.ci.custom"].includes(c.key))
                c.priority = 0;
            else
                c.priority = c.priority ?? (c.mode * 10);
            return c;
        }));
    }, []);
    // Organize non-disabled effects by their application priority
    changes.sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));
    if (changes.length > 0 && debugEnabled > 0)
        warn("Applying effect ", this.name, changes);
    // Apply all changes
    for (let c of changes) {
        if (!c.key || !c.count)
            continue;
        for (let i = 0; i < c.count; i++) {
            //TODO remove @data sometime
            if (typeof c.value === "string" && c.value.includes("@data.")) {
                const parentInfo = c.effect?.parent ? ` on ${c.effect.parent.name} (${c.effect.parent.id})` : '';
                console.warn(`dae | @data.key is deprecated, use @key instead (${c.effect?.name} (${c.effect?.id})${parentInfo} has value ${c.value})`);
                c.value = c.value.replace(/@data./g, "@");
            }
            const stackCount = c.effect?.flags?.dae?.stacks ?? 1;
            if (c.value.includes("dae.eval(") || c.value.includes("dae.roll(")) {
                const conditionData = this.getRollData();
                foundry.utils.mergeObject(conditionData, { stackCount, effect: c.effect?.toObject() });
                c.value = daeSystemClass.safeEvalExpression(c.value, conditionData);
            }
            let field = c.key.startsWith("system.")
                // @ts-expect-error no dnd5e-types
                ? this.system.schema.getField(c.key.slice(7))
                : this.schema.getField(c.key);
            if (field === undefined) {
                field = foundry.utils.getProperty(this, c.key) ?? ValidSpec.actorSpecs[this.type].allSpecsObj[c.key]?.fieldType;
            }
            if (!(field instanceof NumberField))
                c.value = c.value.replace("@stackCount", String(stackCount));
            const getTargetType = field => {
                //@ts-expect-error no dnd5e-types
                if ((field instanceof game.system.dataModels.fields.FormulaField))
                    return "formula";
                else if (field instanceof ArrayField)
                    return "Array";
                else if (field instanceof ObjectField)
                    return "Object";
                else if (field instanceof BooleanField)
                    return "boolean";
                else if (field instanceof NumberField)
                    return "number";
                else if (field instanceof StringField)
                    return "string";
            };
            if (c.mode !== CONST.ACTIVE_EFFECT_MODES.CUSTOM) {
                //      if ((fieldType === "number" || fieldType === "boolean") && typeof c.value === "string") {
                const fieldType = getTargetType(field) ?? "none";
                if (["number", "boolean"].includes(fieldType) && typeof c.value === "string") {
                    const rollData = this.getRollData();
                    rollData.stackCount = stackCount;
                    c.value = c.value.replace("@item.level", "@itemLevel");
                    let value = Roll.replaceFormulaData(c.value, rollData, { missing: "0", warn: false });
                    debug("applyDaeEffects: after replaceFormulaData ", c, value, c.value);
                    try { // Roll parser no longer accepts some expressions it used to so we will try and avoid using it
                        c.value = `${daeSystemClass.safeEval(value, rollData)}`;
                    }
                    catch (err) { // safeEval failed try a roll
                        try {
                            let roll = new Roll(c.value, rollData);
                            if (!roll.isDeterministic) {
                                console.error(`%c dae | you are using dice expressions in a numeric field which is not supported in ${game.version} dice terms ignored`, "color: red;");
                                console.error(`Actor ${this.name} ${this.uuid} Change is ${c.key}: ${c.value}`);
                            }
                            c.value = `${new Roll(value).evaluateSync({ strict: false }).total}`;
                        }
                        catch (err) {
                            console.warn("dae | change value calculation failed for", err, this, c);
                        }
                    }
                }
            }
            // DataField class dispatch: use the field's own change methods (e.g. BooleanFormulaField)
            const autoFieldType = otherFieldsMap.get(c.key)?.type;
            if (typeof autoFieldType === "function" && autoFieldType.prototype instanceof foundry.data.fields.DataField) {
                const fieldInstance = autoFieldType._daeInstance ??= new autoFieldType();
                const currentValue = foundry.utils.getProperty(this, c.key) ?? "";
                let newValue;
                switch (c.mode) {
                    case CONST.ACTIVE_EFFECT_MODES.ADD:
                        newValue = fieldInstance._applyChangeAdd(currentValue, c.value, this, c);
                        break;
                    case CONST.ACTIVE_EFFECT_MODES.MULTIPLY:
                        newValue = fieldInstance._applyChangeMultiply(currentValue, c.value, this, c);
                        break;
                    case CONST.ACTIVE_EFFECT_MODES.UPGRADE:
                        newValue = fieldInstance._applyChangeUpgrade(currentValue, c.value, this, c);
                        break;
                    case CONST.ACTIVE_EFFECT_MODES.DOWNGRADE:
                        newValue = fieldInstance._applyChangeDowngrade(currentValue, c.value, this, c);
                        break;
                }
                if (newValue !== undefined) {
                    foundry.utils.setProperty(this, c.key, newValue);
                    overrides[c.key] = newValue;
                    continue;
                }
            }
            const currentValue = foundry.utils.getProperty(this, c.key);
            if (ValidSpec.actorSpecs[this.type].allSpecsObj[c.key]?.fieldType === "number" && typeof currentValue !== "number") {
                foundry.utils.setProperty(this, c.key, 0);
            }
            const result = c.effect?.apply(this, c);
            Object.assign(overrides, result);
        }
    }
    // Expand the set of final overrides + merge
    this.overrides = foundry.utils.mergeObject(this.overrides || {}, foundry.utils.expandObject(overrides) || {}, { inplace: true, overwrite: true });
}
function expandEffectChanges(changes) {
    let returnChanges = changes.reduce((list, change) => {
        if (!daeSystemClass.bonusSelectors[change.key]) {
            list.push(change);
        }
        else {
            if (daeSystemClass.bonusSelectors[change.key].replaceList) {
                daeSystemClass.bonusSelectors[change.key].replaceList?.forEach(replace => {
                    const c = foundry.utils.duplicate(change);
                    c.key = replace;
                    list.push(c);
                });
            }
            else {
                const attacks = daeSystemClass.bonusSelectors[change.key].attacks;
                const selector = daeSystemClass.bonusSelectors[change.key].selector;
                attacks.forEach(at => {
                    const c = foundry.utils.duplicate(change);
                    c.key = `system.bonuses.${at}.${selector}`;
                    list.push(c);
                });
            }
        }
        return list;
    }, []);
    return returnChanges;
}
export async function addCreateItemChange(change, actor, effect, context) {
    let itemDetails = change.value;
    if (itemDetails.startsWith("@")) {
        itemDetails = Roll.replaceFormulaData(change.value, actor.getRollData(), { missing: "", warn: false });
    }
    await actionQueue.add(socketlibSocket.executeAsGM.bind(socketlibSocket), "createActorItem", { uuid: actor.uuid, itemDetails, effectUuid: effect.uuid, callItemMacro: change.key === "macro.createItemRunMacro" });
}
export async function removeCreateItemChange(itemId, actor, effect, context = {}) {
    if (itemId.startsWith("@")) {
        itemId = Roll.replaceFormulaData(itemId, actor.getRollData(), { missing: "", warn: false });
    }
    let [uuid, option] = itemId.split(",").map(s => s.trim());
    if (option === "permanent")
        return; // don't delete permanent items
    if ((effect.flags?.dae?.itemsToDelete ?? []).length === 0)
        return;
    if (!(context.effectDeleted || context.itemDeleted))
        await effect.setFlag("dae", "itemsToDelete", []);
    await actionQueue.add(socketlibSocket.executeAsGM.bind(socketlibSocket), "removeActorItem", { uuid: actor.uuid, itemUuid: itemId, itemUuids: effect.flags?.dae?.itemsToDelete, context });
}
export async function addTokenMagicChange(actor, change, tokens) {
    const tokenMagic = globalThis.TokenMagic;
    if (!tokenMagic)
        return;
    for (let token of tokens) {
        if (token instanceof foundry.canvas.placeables.Token)
            token = token.document;
        const tokenUuid = token?.uuid;
        // Put this back if TMFX does awaited calls
        // await actionQueue.add(tokenMagic.addFilters, token, change.value); - see if gm execute solve problem
        await actionQueue.add(socketlibSocket.executeAsGM.bind(socketlibSocket), "applyTokenMagic", { tokenUuid, effectId: change.value });
    }
}
export async function removeTokenMagicChange(actor, change, tokens, context = {}) {
    const tokenMagic = globalThis.TokenMagic;
    if (!tokenMagic)
        return;
    for (let token of tokens) {
        if (token instanceof foundry.canvas.placeables.Token)
            token = token.document;
        // put this back if TMFX does awaited calls
        // await actionQueue.add(tokenMagic.deleteFilters, token, change.value);
        const tokenUuid = token?.uuid;
        await actionQueue.add(socketlibSocket.executeAsGM.bind(socketlibSocket), "removeTokenMagic", { tokenUuid, effectId: change.value });
    }
}
async function myRemoveCEEffect(effectName, uuid, origin, isToken) {
    let interval = 1;
    await delay(interval); // let all of the stuff settle down
    return await ceInterface?.removeEffect({ effectName, uuid, origin });
}
export async function removeConvenientEffectsChange(effectName, uuid, origin, isToken) {
    if (isToken)
        await delay(1); // let all of the stuff settle down
    const returnValue = await actionQueue.add(myRemoveCEEffect, effectName, uuid, origin, isToken);
    return returnValue;
}
async function myAddCEEffectWith(effectData, uuid, origin, overlay, isToken) {
    if (!ceInterface)
        return;
    let interval = 1;
    if (interval)
        await delay(interval);
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
    return await actionQueue.add(myAddCEEffectWith, effectData, uuid, origin, false, isToken);
}
export async function addConditionChange(actor, change, token, effect) {
    // This is from macro.statusEffect
    const condition = CONFIG.statusEffects.find(se => se.id === change.value);
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
    const effects = await toggleActorStatusEffect(actor, condition.id, { active: true, origin: effect.uuid, flags: { dnd5e: { dependentOn: effect.uuid } } });
    if (game.system.id !== "dnd5e" || foundry.utils.isNewerVersion("5.1.99", game.system.version)) {
        // @ts-expect-error no dnd5e-types
        if (effect.addDependent && effects instanceof Array)
            effect.addDependent(...effects);
    }
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
        let statusEffect = CONFIG.statusEffects.find(se => se.id === change.value);
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
        await actionQueue.add(actor.deleteEmbeddedDocuments.bind(actor), "ActiveEffect", effectsToRemove, context);
}
export async function expireEffects(actor, effects, context) {
    if (!effects)
        return {};
    const actorEffectsToDelete = [];
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
            actorEffectsToDelete.push(effect.id);
        else if (effect.parent instanceof Item) // this should be enchantments
            effectsToDelete.push(effect);
    }
    if (actorEffectsToDelete.length > 0)
        await actor.deleteEmbeddedDocuments("ActiveEffect", actorEffectsToDelete, context);
    if (effectsToDisable.length > 0) {
        for (let effect of effectsToDisable) {
            await effect.update({ "disabled": true });
        }
    }
    if (effectsToDelete.length > 0) {
        for (let effect of effectsToDelete)
            await effect.delete();
    }
    return { deleted: actorEffectsToDelete, disabled: effectsToDisable, itemEffects: effectsToDelete };
}
function createActiveEffectHook(effect, options, userId) {
    if (userId !== game.user?.id)
        return true;
    // @ts-expect-error Can this happen?
    if (options.isUndo)
        return true;
    if (!effect.parent || (CONFIG.ActiveEffect.legacyTransferral === true && !(effect.parent instanceof CONFIG.Actor.documentClass)))
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
    // @ts-expect-error no dnd5e-types
    if (useDetermineSuppression)
        effect.determineSuppression();
    if (effect.changes && effect.active) {
        let changeLoop = async () => {
            try {
                const selfAuraChange = foundry.utils.getProperty(effect, "flags.ActiveAuras.isAura") === true
                    && foundry.utils.getProperty(effect, "flags.ActiveAuras.ignoreSelf") === true
                    && effect.origin?.startsWith(actor.uuid);
                // don't apply macro or macro like effects if active aura and not targeting self
                if (selfAuraChange)
                    return;
                for (let change of effect.changes) {
                    if (ceInterface && change.key === "macro.CE") {
                        await addConvenientEffectsChange(change.value, actor.uuid, effect.origin, options, actor.isToken);
                    }
                    if (["macro.createItem", "macro.createItemRunMacro"].includes(change.key)) {
                        await addCreateItemChange(change, actor, effect, options);
                    }
                    if (change.key === "macro.StatusEffect" || change.key === "StatusEffect") {
                        await addConditionChange(actor, change, token, effect);
                    }
                    const tokenMagic = globalThis.TokenMagic;
                    if (tokenMagic && change.key === "macro.tokenMagic" && token)
                        await addTokenMagicChange(actor, change, tokens); //TODO check disabled
                }
                if (effect.changes.some(change => change.key.startsWith("macro.execute") || change.key.startsWith("macro.itemMacro") || change.key.startsWith("macro.actorUpdate") || change.key.startsWith("macro.activityMacro"))) {
                    await actionQueue.add(daeMacro, "on", actor, effect.toObject(false), { effectUuid: effect.uuid }); // TODO revisit to see if passing the effect is ok
                }
            }
            catch (err) {
                const message = "dae | createActiveEffectHook | create effect error";
                if (globalThis.MidiQOL?.TroubleShooter) {
                    globalThis.MidiQOL.TroubleShooter.recordError(err, message);
                }
                console.warn(message, err);
            }
            finally {
                return true;
            }
        };
        changeLoop();
    }
    return true;
}
async function _preCreateActiveEffectRemoveExisting(effectData, options, user) {
    if (debugEnabled > 0)
        warn("preCreateActiveEffectRemoveExisting", effectData, options, user);
    let result = true;
    try {
        // @ts-expect-error Can this happen?
        if (options.isUndo)
            return;
        const parent = this.parent;
        // @ts-expect-error Can this happen?
        options.deleted = false;
        if (!(parent instanceof CONFIG.Actor.documentClass))
            return;
        // if (!foundry.utils.getProperty(this, "flags.dae.stackable")) { // Check whether this should be multi by default?
        //  this.updateSource({ "flags.dae.stackable": "multi" })
        //}
        const stackable = this.flags?.dae?.stackable ?? "";
        if (["noneName", "none", "noneNameOnly"].includes(stackable)) {
            if (!parent)
                return result = true;
            const hasExisting = parent.effects.filter(ef => {
                const efOrigin = ef.origin;
                switch (stackable) {
                    case "noneName":
                        // Effects with no origin are ignored
                        return !!(this.origin && efOrigin === this.origin && ef.name === this.name);
                    case "count":
                    case "countDeleteDecrement":
                        // @ts-expect-error Can this happen?
                        if (options.toggleEffect)
                            return !!(this.origin && efOrigin === this.origin && ef.name === this.name);
                        break;
                    case "noneNameOnly":
                        return ef.name === this.name;
                    case "none":
                        return !!(this.origin && efOrigin === this.origin);
                }
                return false;
            });
            if (hasExisting.length === 0)
                return result = true;
            // @ts-expect-error Can this happen?
            if (options.toggleEffect) {
                const updates = hasExisting.map(ef => ({ _id: ef.id, disabled: !ef.disabled }));
                await parent.updateEmbeddedDocuments("ActiveEffect", updates, options);
                return result = false;
            }
            if (debugEnabled > 0)
                warn("deleting existing effects ", parent.name, parent, hasExisting);
            options["existing"] = "effect-stacking";
            await parent.deleteEmbeddedDocuments("ActiveEffect", hasExisting.map(ef => ef.id ?? ""), options);
            // We need to wait for the chain of dependents to be deleted before allowing things to continue.
            let count = 0;
            // @ts-expect-error no dnd5e-types
            while (hasExisting.some(ef => ef.getDependents().length > 0) && count < 100) {
                count += 1;
                await busyWait(0.05);
            }
        }
    }
    catch (err) {
        error("removeExistingEffects ", err);
        result = true;
    }
    finally {
        return result;
    }
}
async function _preCreateEnchantmentEffect(data, options, user) {
    // There will be something needed here eventuall.
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
        if (!(parent instanceof CONFIG.Actor.documentClass) /*|| actor.isToken*/)
            return result = true;
        // Check if we are trying to create an existing effect - not quite sure how that might happen
        if (parent.effects?.find(ef => ef.id === data._id && false)) {
            if (debugEnabled > 0)
                warn("Blocking creation of duplicate effect", this, parent.effects?.find(ef => ef.id === data._id));
            return result = false;
        }
        if (!this.flags?.dae?.specialDuration) {
            this.updateSource({ "flags.dae.specialDuration": [] });
            foundry.utils.setProperty(data, "flags.dae.specialDuration", []);
        }
        if (parent instanceof Actor) {
            let existingEffect;
            if (CONFIG.statusEffects.find(se => se._id === this.id))
                existingEffect = parent.effects.find(ef => ef.id === this.id);
            else {
                existingEffect = parent.effects.find(ef => ef.origin === this.origin && effectBaseName(ef) === effectBaseName(this));
            }
            if (["count", "countDeleteDecrement"].includes(this.flags?.dae?.stackable)) {
                if (existingEffect) {
                    const stacks = (existingEffect.flags.dae.stacks ?? 1) + 1;
                    // const counter = globalThis.EffectCounter?.findCounter(getTokenDocument(this.parent), this.img ?? this.icon);
                    // await counter?.setValue(stacks);
                    await existingEffect.update({ "flags.dae.stacks": stacks, name: `${effectBaseName(existingEffect)} (${stacks})` });
                    if (existingEffect.getDependents && existingEffect.getDependents().length > 0) {
                        const deps = existingEffect.getDependents().filter(ef => ["count", "countDeleteDecrement"].includes(ef.flags?.dae?.stackable));
                        await parent.createEmbeddedDocuments("ActiveEffect", deps.map(ef => ef.toObject()), { keepId: true });
                    }
                    return result = false;
                }
            }
            else if (CONFIG.statusEffects.find(se => se._id === this.id) && parent.effects.find(ef => ef.id === this._id)) {
                console.warn(`dae | Attempting to add ${this.id} when already presnt - ignoring`);
                return result = false;
            }
            let updates = {};
            if (CONFIG.ActiveEffect.legacyTransferral) {
                foundry.utils.setProperty(updates, "flags.dae.transfer", data.transfer === true ? true : false);
            }
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
                const inCombat = game.combat?.turns?.some(turnData => turnData.actor?.uuid === parent.uuid);
                if (inCombat) {
                    updates["duration.rounds"] = Math.floor(theDuration.total / CONFIG.time.roundTime + 0.5);
                    updates["duration.seconds"] = null;
                }
                else
                    updates["duration.seconds"] = theDuration.total;
            }
            let changesChanged = false;
            let newChanges = [];
            for (let change of this.changes) {
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
                    console.warn("ActiveEffect | StatusEffect is not supported in v12 and above");
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
                        let macroCommand = foundry.utils.getProperty(item, "flags.dae.macro.command") ?? foundry.utils.getProperty(item, "flags.itemacro.macro.command") ?? foundry.utils.getProperty(item, "flags.itemacro.macro.data.command");
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
                updates["changes"] = newChanges;
            this.updateSource(updates);
        }
    }
    catch (err) {
        console.warn("dae | _preCreateActiveEffect", err);
    }
    finally {
        return result;
    }
}
async function evalInline(expression, actor, effect, silent) {
    try {
        warn("Doing inlinve eval", expression);
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
export function preDeleteCombatHook(combat, options, user) {
    // This could cause race conditions....
    if (user !== game.user?.id)
        return;
    for (let combatant of combat.combatants) {
        const actor = combatant.actor;
        if (!actor)
            continue;
        const effects = getApplicableEffects(actor, { includeEnchantments: true }).filter(ef => ef.flags?.dae?.specialDuration?.includes("combatEnd"));
        actionQueue.add(expireEffects, actor, effects, { "expiry-reason": "combat-end" });
    }
}
export function preCreateCombatantHook(combatant, data, options, user) {
    const actor = combatant.actor;
    if (!actor)
        return;
    const effects = getApplicableEffects(actor, { includeEnchantments: true }).filter(ef => ef.flags?.dae?.specialDuration?.includes("joinCombat"));
    actionQueue.add(expireEffects, actor, effects, { "expiry-reason": "join-combat" });
}
function recordDisabledSuppressedHook(effect, updates, options, userId) {
    foundry.utils.setProperty(options, "dae.active", { wasDisabled: effect.disabled, wasSuppressed: effect.isSuppressed, oldChanges: foundry.utils.duplicate(effect.changes) });
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
    if (!CONFIG.ActiveEffect.legacyTransferral && parent instanceof CONFIG.Item.documentClass) {
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
                for (let change of effect.changes) {
                    removeEffectChange(actor, [], effect, item, change, options);
                }
            }
            else if (becameEnabled) {
                for (let change of effect.changes) {
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
    let changeLoop = async () => {
        try {
            if (!actor)
                return;
            // const item = await fromUuid(effect.origin);
            const tokens = actor.isToken ? [actor.token?.object] : actor.getActiveTokens();
            const token = tokens[0];
            if (!(token instanceof foundry.canvas.placeables.Token))
                return;
            // @ts-expect-error no dnd5e-types
            if (useDetermineSuppression)
                effect.determineSuppression();
            // Just deal with equipped etc
            warn("add active effect actions", actor, updates);
            const tokenMagic = globalThis.TokenMagic;
            let addedChanges = [];
            let removedChanges = [];
            let existingChanges = [];
            let oldChanges = [];
            let newChanges = [];
            if (updates.changes) {
                // const removedChanges = (context.dae?.active?.oldChanges ?? []).filter(change => !effect.changes.some(c => c.key === change.key)); 
                oldChanges = (foundry.utils.getProperty(options, "dae.active.oldChanges") ?? []).sort((a, b) => a.key < b.key ? -1 : 1);
                newChanges = effect.changes.filter(c => c.key && c.key !== "").sort((a, b) => a.key < b.key ? -1 : 1);
                removedChanges = oldChanges.filter(change => !newChanges.some(c => c.key === change.key && c.mode === change.mode && c.value === change.value));
                existingChanges = oldChanges.filter(change => newChanges.some(c => c.key === change.key && c.mode === change.mode && c.value === change.value));
                addedChanges = newChanges.filter(change => !oldChanges.some(c => c.key === change.key && c.mode === change.mode && c.value === change.value));
                if (debugEnabled > 0) {
                    warn("updateActiveEffect hook | old changes", oldChanges);
                    warn("updateActiveEffect hook | new changes", newChanges);
                    warn("updateActiveEffect hook | removed Changes ", removedChanges);
                    warn("updateActiveEffect hook | added changes ", addedChanges);
                    warn("updateActiveEffect hook | existing changes", existingChanges);
                }
            }
            else
                existingChanges = effect.changes;
            const wasDisabled = options.dae?.active?.wasDisabled ?? false;
            const wasSuppressed = options.dae?.active?.wasSuppressed ?? false;
            const becameDisabled = effect.disabled && !(options.dae?.active?.wasDisabled ?? false);
            const becameSuppressed = effect.isSuppressed && !(options.dae?.active?.wasSuppressed ?? false);
            // TODO Come back and make this use addEffectChange and removeEffectChange instead of the below
            if (becameSuppressed || becameDisabled || removedChanges.length > 0) {
                let changesToDisable = [];
                if (becameSuppressed || becameDisabled) {
                    // newly disabled disable everything
                    changesToDisable = existingChanges.concat(removedChanges);
                }
                else if (!wasDisabled && !wasSuppressed) {
                    // changes being removed were enabled so disable them
                    changesToDisable = removedChanges;
                }
                for (let change of changesToDisable) {
                    if (ceInterface && change.key === "macro.CE") {
                        await removeConvenientEffectsChange(change.value, actor.uuid, undefined, actor.isToken);
                    }
                    if (token && tokenMagic && change.key === "macro.tokenMagic")
                        removeTokenMagicChange(actor, change, tokens, options);
                    if (["macro.createItem", "macro.createItemRunMacro"].includes(change.key)) {
                        await removeCreateItemChange(change.value, actor, effect, options);
                    }
                    if (change.key === "macro.StatusEffect" || change.key === "StatusEffect") {
                        await removeConditionChange(actor, change, token, effect, options);
                    }
                }
                if (changesToDisable.some(change => change.key.startsWith("macro.execute") || change.key.startsWith("macro.itemMacro") || change.key.startsWith("macro.actorUpdate") || change.key.startsWith("macro.activityMacro"))) {
                    warn("dae add macro off", actionQueue.remaining);
                    const effectData = effect.toObject(false);
                    if (updates.changes)
                        effectData.changes = oldChanges;
                    if (becameDisabled)
                        options["expiry-reason"] = "effect-disabled";
                    else if (becameSuppressed)
                        options["expiry-reason"] = { "expiry-reason": "effect-suppressed" };
                    else
                        options["expiry-reason"] = { "expiry-reason": "change-deleted" };
                    options.effectUuid = effect.uuid;
                    await actionQueue.add(daeMacro, "off", actor, effectData, options);
                }
            }
            const becameEnabled = (options.dae?.active?.wasDisabled ?? false) && !(effect.disabled ?? false);
            const becameUnsuppressed = (options.dae?.active?.wasSuppressed ?? false) && !(effect.isSuppressed ?? false);
            if (becameEnabled || becameUnsuppressed || addedChanges.length > 0) {
                let changesToEnable = [];
                if (becameEnabled || becameUnsuppressed) {
                    // newly enabled enable everything
                    changesToEnable = existingChanges.concat(addedChanges);
                }
                else if (!effect.disabled && !effect.isSuppressed) {
                    // changes being added need to be enabled
                    changesToEnable = addedChanges;
                }
                for (let change of changesToEnable) {
                    if (ceInterface && change.key === "macro.CE") {
                        await addConvenientEffectsChange(change.value, actor.uuid, undefined, undefined, actor.isToken);
                    }
                    if (token && tokenMagic && change.key === "macro.tokenMagic")
                        addTokenMagicChange(actor, change, tokens);
                    if (["macro.createItem", "macro.createItemRunMacro"].includes(change.key)) {
                        await addCreateItemChange(change, actor, effect, options);
                    }
                    if (change.key === "macro.StatusEffect" || change.key === "StatusEffect") {
                        await addConditionChange(actor, change, token, effect);
                    }
                }
                if (changesToEnable.some(change => change.key.startsWith("macro.execute") || change.key.startsWith("macro.itemMacro") || change.key.startsWith("macro.actorUpdate") || change.key.startsWith("macro.activityMacro"))) {
                    warn("action queue add dae macro on ", actionQueue.remaining);
                    await actionQueue.add(daeMacro, "on", actor, effect.toObject(false), { effectUuid: effect.uuid });
                }
            }
            // @ts-expect-error no dnd5e-types
            for (let dependent of effect.getDependents()) {
                if (dependent.disabled !== undefined && (dependent.disabled !== effect.disabled || dependent.isSuppressed !== effect.isSuppressed)) {
                    await dependent.update({ "disabled": effect.disabled || effect.isSuppressed });
                }
            }
        }
        catch (err) {
            console.warn("dae | updating active effect error", err);
        }
        finally {
            return result;
        }
    };
    changeLoop();
    return result = true;
}
export function preUpdateActiveEffectEvalInlineHook(candidate, updates, options, userId) {
    const parent = candidate.parent;
    // @ts-expect-error Can this happen?
    if (options.isUndo)
        return true;
    if (!parent)
        return true;
    if (CONFIG.ActiveEffect.legacyTransferral && !(parent instanceof CONFIG.Actor.documentClass))
        return true;
    let actor;
    if (parent instanceof CONFIG.Actor.documentClass)
        actor = parent;
    else if (parent instanceof CONFIG.Item.documentClass && effectIsTransfer(candidate))
        actor = parent.parent;
    if (!actor)
        return true;
    try {
        // const rgx = /\[\[(\/[a-zA-Z]+\s)?(.*?)([\]]{2,3})(?:{([^}]+)})?/gi;
        for (let change of candidate.changes ?? []) {
            let silentInline = typeof change.value === "string" && change.value.includes("[[[");
            let inline = typeof change.value === "string" && change.value.includes("[[");
            if (inline || silentInline) {
                const rgx = /[\[]{2,3}(\/[a-zA-Z]+\s)?(.*?)([\]]{2,3})(?:{([^}]+)})?/gi;
                let newChangeValue = foundry.utils.duplicate(change.value);
                for (let match of change.value.matchAll(rgx)) {
                    if (!match[1]) {
                        const newValue = evalInline(match[2], actor, candidate, silentInline);
                        newChangeValue = newChangeValue.replace(match[0], `${newValue}`);
                    }
                }
                change.value = newChangeValue;
            }
            ;
        }
    }
    catch (err) {
        console.warn(`dae | update active effect Actor ${actor.name}, Effect ${candidate.name}`, updates, err);
    }
    finally {
        return true;
    }
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
// async function _preDeleteActiveEffectBeta(wrapped, ...args) {
//   let [options, userId] = args;
//   if (options.forceDelete || !(this.parent instanceof Actor) || !["countDeleteDecrement", "count"].includes(this.flags.dae?.stackable))
//     return wrapped(...args);
//   const stacks = this.flags.dae.stacks;
//   if (stacks === 1) {
//     options.removeStacks = 1;
//     return wrapped(...args);
//   }
//   if (this.flags.dae.stackable === "count") options.removeStacks = stacks;
//   else options.removeStacks = 1;
//   foundry.utils.setProperty(this, "flags.dae.stacks", stacks - 1);
//   await this.update({ "flags.dae.stacks": stacks - 1, name: `${effectBaseName(this)} (${stacks - 1})` });
//   // const counter = globalThis.EffectCounter?.findCounter(getTokenDocument(this.parent), this.img ?? this.icon);
//   // await counter?.setValue(stacks - 1);
//   debug("decrementing complete", this.name, stacks);
//   if (this.getDependents()) for (let dependent of this.getDependents()) {
//     if (fromUuidSync(dependent.uuid))
//       await dependent.delete(...args);
//   }
//   return false;
// }
export function deleteActiveEffectHook(effect, options, userId) {
    if (game.user?.id !== userId)
        return true;
    // @ts-expect-error Can this happen?
    if (options.isUndo)
        return true;
    if (!effect.parent)
        return true;
    let actor;
    if (CONFIG.ActiveEffect.legacyTransferral && !(effect.parent instanceof CONFIG.Actor.documentClass))
        return true;
    if (effect.parent instanceof CONFIG.Actor.documentClass)
        actor = effect.parent;
    else if (effect.parent instanceof CONFIG.Item.documentClass && effect.transfer)
        actor = effect.parent.parent;
    if (!actor)
        return true;
    let changesLoop = async () => {
        if (!actor)
            return;
        const tokens = actor.token ? [actor.token.object] : actor.getActiveTokens();
        const token = tokens[0];
        const tokenMagic = globalThis.TokenMagic;
        /// if (actor.isToken) await delay(1);
        let entityToDelete;
        if (effect.changes) {
            for (let change of effect.changes) {
                try {
                    if (token && tokenMagic && change.key === "macro.tokenMagic")
                        await removeTokenMagicChange(actor, change, tokens);
                    if (["macro.createItem", "macro.createItemRunMacro"].includes(change.key)) {
                        // @ts-expect-error Is this okay?
                        options.effectDeleted = true;
                        await removeCreateItemChange(change.value, actor, effect, options);
                    }
                    if (change.key === "macro.StatusEffect" || change.key === "StatusEffect") {
                        await removeConditionChange(actor, change, token, effect, options); // TODO this is not right
                    }
                    if (ceInterface && change.key === "macro.CE") {
                        await removeConvenientEffectsChange(change.value, actor.uuid, effect.origin, actor.isToken);
                    }
                    if (change.key === "flags.dae.deleteUuid" && change.value) {
                        await socketlibSocket.executeAsGM("deleteUuid", { uuid: change.value });
                    }
                    if (change.key === "flags.dae.suspendActiveEffect" && change.value) {
                        await socketlibSocket.executeAsGM("suspendActiveEffect", { uuid: change.value });
                    }
                    if (change.key === "flags.dae.deleteOrigin")
                        entityToDelete = effect.origin;
                    if (!foundry.utils.getProperty(options, "expiry-reason"))
                        foundry.utils.setProperty(options, "expiry-reason", "effect-deleted");
                    if (effect.changes.some(change => change.key.startsWith("macro.execute") || change.key.startsWith("macro.itemMacro") || change.key.startsWith("macro.actorUpdate") || change.key.startsWith("macro.activityMacro"))) {
                        // @ts-expect-error Is this okay?
                        options.effectUuid = effect.uuid;
                        warn("action queue dae macro add off ", actionQueue.remaining);
                        await actionQueue.add(daeMacro, "off", actor, effect.toObject(false), options);
                    }
                    if (entityToDelete)
                        await socketlibSocket.executeAsGM("deleteUuid", { uuid: entityToDelete });
                }
                catch (err) {
                    console.warn("dae | error deleting active effect ", effect, err);
                }
            }
            if (effect.origin) {
                let origin = await fromUuid(effect.origin);
                // Remove the associated animation if the origin points to the actor or if the items actor is the effects actor
                // Covers the spirit guardian case where all the aura's point back to the source item.
                if (globalThis.Sequencer && (origin === actor || origin?.parent === actor))
                    globalThis.Sequencer.EffectManager.endEffects({ origin: effect.origin });
            }
        }
    };
    changesLoop();
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
    if (!effectData.changes)
        return effectData;
    if (effectData instanceof ActiveEffect) {
        if (effectData.transfer && effectData.parent instanceof Item)
            theItem = effectData.parent;
        effectData = effectData.toObject(false);
    }
    if (lastArgOptions.item)
        theItem = lastArgOptions.item;
    if (!theItem) { // follow the origin trail backwards
        let source = effectData.origin ? await fromUuid(effectData.origin) : undefined;
        let count;
        for (count = 0; count < 10 && source instanceof ActiveEffect && !(source.parent instanceof Item); count++) {
            const newSource = await fromUuid(source.origin);
            if (!newSource)
                source = source.parent;
            else
                source = newSource;
        }
        if (count === 10) {
            console.warn("dae | daeMacro | too many levels of origin", effectData);
        }
        else if (source instanceof Item)
            theItem = source;
        else if (source?.parent instanceof Item)
            theItem = source.parent;
        else if (source?.item instanceof Item)
            theItem = source.item;
    }
    if (!theItem && effectData.flags?.dae?.itemUuid) {
        theItem = fromUuidSync(effectData.flags.dae.itemUuid);
    }
    if (!theItem && effectData.flags?.dae?.itemData) {
        theItem = new CONFIG.Item.documentClass(effectData.flags.dae.itemData, { parent: actor });
    }
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
    for (let change of (effectData.changes ?? [])) {
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
                    macro = new CONFIG.Macro.documentClass({
                        name: "DAE-Item-Macro",
                        type: "script",
                        img: null,
                        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
                        author: game.user?.id,
                        command: `return await ${functionMatch}.bind(this)({ speaker, actor, token, character, item, args, scope })`,
                    });
                    // TODO (Michael) `theItem` is treated as mandatory in `getMacro`, but here isn't guaranteed - or is it?
                }
                else
                    macro = await getMacro({ change, name: args[0] }, theItem, effectData);
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
                return await macro?.execute(scope);
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
            if (globalThis.MidiQOL?.TroubleShooter)
                globalThis.MidiQOL.TroubleShooter.recordError(err, message);
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
export async function getMacro({ change, name }, item, effectData) {
    if (change.key.includes("macro.execute")) {
        let macro = game.macros?.getName(name);
        if (macro)
            return macro;
        let itemOrMacro;
        itemOrMacro = await fromUuid(name);
        if (itemOrMacro) {
            if (itemOrMacro instanceof Item) {
                const macroData = itemOrMacro.flags?.dae?.macro ?? itemOrMacro.flags?.itemacro?.macro;
                macroData.flags = foundry.utils.mergeObject(macroData.flags ?? {}, { dnd5e: { itemMacro: true } });
                return new CONFIG.Macro.documentClass(macroData);
            }
            else if (itemOrMacro instanceof Macro) {
                return itemOrMacro;
            }
            // Other uuids are not valid
            return undefined;
        }
    }
    else if (change.key.startsWith("macro.activityMacro") || change.key.startsWith("macro.itemMacro")) {
        let macroCommand;
        if (change.key.startsWith("macro.activityMacro")) {
            let activityUuid = effectData?.flags?.dae?.activity;
            if (activityUuid) {
                const activity = await fromUuid(activityUuid);
                macroCommand = activity?.macro?.command;
            }
        }
        else if (change.key.startsWith("macro.itemMacro")) {
            macroCommand = effectData?.flags?.dae?.itemMacro
                ?? item.flags?.dae?.macro?.command
                ?? item.flags?.itemacro?.macro?.command;
            const itemData = effectData?.flags?.dae?.itemData;
            if (!macroCommand && itemData)
                macroCommand = itemData.flags?.dae?.macro?.command;
            if (!macroCommand && itemData)
                macroCommand = itemData.flags?.itemacro?.macro?.command;
            if (!macroCommand && !item) { // we never got an item do a last ditch attempt
                warn("eval args: fetching item from effectData/origin ", effectData?.origin);
                const itemOrEffect = fromUuidSync(effectData?.origin);
                if (itemOrEffect instanceof CONFIG.Item.documentClass)
                    item = itemOrEffect;
                if (!item) {
                    const activity = fromUuidSync(effectData?.flags?.dae?.activity);
                    // @ts-expect-error no dnd5e-types
                    if (activity)
                        item = activity.item;
                }
                macroCommand = item.flags?.dae?.macro?.command ?? item.flags?.itemacro?.macro?.command;
            }
        }
        if (!macroCommand) {
            const itemOrMacro = await fromUuid(name);
            if (itemOrMacro instanceof Macro)
                macroCommand = itemOrMacro.command;
            if (itemOrMacro instanceof Item) {
                const macro = itemOrMacro.flags?.dae?.macro ?? itemOrMacro.flags?.itemacro?.macro;
                macroCommand = macro?.command;
            }
        }
        if (!macroCommand) {
            macroCommand = effectData?.flags?.dae?.itemMacro;
        }
        if (!macroCommand) {
            macroCommand = `if (!args || args[0] === "on") {ui.notifications.warn("macro.itemMacro | No macro found for item ${item?.name}");}`;
            warn(`No macro found for item ${item?.name}`);
        }
        return new CONFIG.Macro.documentClass({
            name: "DAE-Item-Macro",
            type: "script",
            img: null,
            command: macroCommand,
            author: game.user?.id,
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
            // TODO see if this should change.
            flags: { dnd5e: { itemMacro: true } }
        });
    }
    else if (change.key === "actorUpdate") {
        console.error("Should not be trying to lookup the macro for actorUpdate");
    }
    return undefined;
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
        for (let [changeIndex, change] of activeEffectData.changes.entries()) {
            const doRolls = allMacroEffects.includes(change.key);
            if (doRolls) {
                if (macroDestination[change.key] === "local" && macroLocation !== "GM") {
                    macroLocation = "local";
                }
                else if (macroDestination[change.key] === "GM")
                    macroLocation = "GM";
            }
            // eval args before calling GMAction so macro arguments are evaled in the casting context.
            // Any @fields for macros are looked up in actor context and left unchanged otherwise
            rollData.stackCount = activeEffectData.flags?.dae?.stacks ?? 1;
            const evalArgsOptions = foundry.utils.mergeObject(options, {
                effectData: activeEffectData,
                change,
                doRolls
            });
            evalArgsOptions.context = foundry.utils.mergeObject(rollData, options.context ?? {}, { recursive: false });
            evalArgsOptions.item = activity.item;
            if (activity.actor)
                evalArgsOptions.actor = activity.actor;
            let newChange = await evalArgs(evalArgsOptions);
            activeEffectData.changes[changeIndex] = newChange;
        }
        ;
        // @ts-expect-error Thinks `uuid` shouldn't exist
        activeEffectData.origin = options.origin ?? activityEffects[aeIndex].uuid;
        activeEffectData.duration.startTime = game.time.worldTime;
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
    let appliedEffects = [];
    switch (options.selfEffects) {
        case "selfEffectsAlways":
            appliedEffects = item.effects.filter(ae => ae.transfer !== true && !isEnchantment(ae) && !!ae.flags?.dae?.selfTargetAlways).map(ae => {
                const data = ae.toObject(false);
                foundry.utils.setProperty(data, "flags.core.sourceId", ae.parent?.uuid);
                return data;
            });
            break;
        case "selfEffectsAll":
            appliedEffects = item.effects.filter(ae => ae.transfer !== true && !isEnchantment(ae) && !!(ae.flags?.dae?.selfTargetAlways || ae.flags?.dae?.selfTarget)).map(ae => {
                const data = ae.toObject(false);
                foundry.utils.setProperty(data, "flags.core.sourceId", ae.parent?.uuid);
                return data;
            });
            break;
        case "none":
        default:
            appliedEffects = item.effects.filter(ae => ae.transfer !== true && !isEnchantment(ae) && !ae.flags?.dae?.selfTargetAlways && !ae.flags?.dae?.selfTarget).map(ae => {
                const data = ae.toObject(false);
                foundry.utils.setProperty(data, "flags.core.sourceId", ae.parent?.uuid);
                return data;
            });
    }
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
        for (let [changeIndex, change] of activeEffectData.changes.entries()) {
            const doRolls = allMacroEffects.includes(change.key);
            if (doRolls) {
                if (macroDestination[change.key] === "local" && macroLocation !== "GM") {
                    macroLocation = "local";
                }
                else if (macroDestination[change.key] === "GM")
                    macroLocation = "GM";
            }
            // eval args before calling GMAction so macro arguments are evaluated in the casting context.
            // Any @fields for macros are looked up in actor context and left unchanged otherwise
            rollData.stackCount = activeEffectData.flags?.dae?.stacks ?? 1;
            const evalArgsOptions = foundry.utils.mergeObject(options, {
                effectData: activeEffectData,
                change,
                doRolls
            });
            evalArgsOptions.context = foundry.utils.mergeObject(rollData, options.context ?? {}, { recursive: false });
            evalArgsOptions.item = item;
            if (item.actor)
                evalArgsOptions.actor = item.actor;
            let newChange = await evalArgs(evalArgsOptions);
            activeEffectData.changes[changeIndex] = newChange;
        }
        ;
        activeEffectData.origin = options.origin ?? item.uuid;
        activeEffectData.duration.startTime = game.time.worldTime;
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
function preUpdateItemHook(candidate, updates, options, userId) {
    return true;
}
export function addEffectChange(actor, tokens, effectToApply, item, change, context) {
    if (debugEnabled > 0)
        warn("addEffectChange ", actor, change, tokens, effectToApply);
    const token = tokens[0];
    switch (change.key) {
        case "macro.CE":
            addConvenientEffectsChange(change.value, actor.uuid, effectToApply.origin, {}, actor.isToken);
            break;
        case "macro.StatusEffect":
        case "StatusEffect":
            if (CONFIG.ActiveEffect.legacyTransferral === false)
                addConditionChange(actor, change, token, effectToApply);
            break;
        case "macro.tokenMagic":
            addTokenMagicChange(actor, change, tokens);
            break;
        case "macro.createItem":
        case "macro.createItemRunMacro":
            if (!CONFIG.ActiveEffect.legacyTransferral) {
                addCreateItemChange(change, actor, effectToApply, context);
            }
            else {
                for (let effect of actor.allApplicableEffects()) {
                    if (effect.origin === item.uuid && effectIsTransfer(effect)) {
                        addCreateItemChange(change, actor, effect, context);
                    }
                }
            }
            break;
        default:
            if (change.key.startsWith("macro.execute") || change.key.startsWith("macro.itemMacro") || change.key.startsWith("macro.actorUpdate") || change.key.startsWith("macro.activityMacro")) {
                if (debugEnabled > 0)
                    warn("action queue add dae macro on ", actionQueue.remaining);
                actionQueue.add(daeMacro, "on", actor, effectToApply.toObject(false), { item, effectUuid: effectToApply.uuid });
                break;
            }
    }
}
export function removeEffectChange(actor, tokens, effectToApply, item, change, context) {
    let token = tokens[0];
    if (!token) {
        token = getToken(actor);
        tokens = token ? [token] : [];
    }
    switch (change.key) {
        case "macro.CE":
            removeConvenientEffectsChange(change.value, actor.uuid, effectToApply.origin, actor.isToken);
            break;
        case "macro.tokenMagic":
            removeTokenMagicChange(actor, change, tokens, context);
            break;
        case "macro.createItem":
        case "macro.createItemRunMacro":
            if (CONFIG.ActiveEffect.legacyTransferral === false) {
                // for non legacy transferral the only effect is the one on the actor
                removeCreateItemChange(change.value, actor, effectToApply, context);
            }
            else {
                for (let effect of actor.allApplicableEffects()) {
                    if ((effect.origin === item.uuid || effect.parent?.uuid === item.uuid) && effectIsTransfer(effect)) {
                        removeCreateItemChange(change.value, actor, effect, context);
                    }
                }
            }
            break;
        case "macro.StatusEffect":
        case "StatusEffect":
            if (CONFIG.ActiveEffect.legacyTransferral === false)
                removeConditionChange(actor, change, tokens[0], effectToApply, context);
            break;
        default:
            if (change.key.startsWith("macro.execute") || change.key.startsWith("macro.itemMacro") || change.key.startsWith("macro.actorUpdate") || change.key.startsWith("macro.activityMacro")) {
                if (debugEnabled > 0)
                    warn("dae add macro off", actionQueue.remaining);
                actionQueue.add(daeMacro, "off", actor, effectToApply.toObject(false), { item, origin: item.uuid, effectUuid: effectToApply.uuid, "expiry-reason": context["expiry-reason"] });
            }
            break;
    }
}
// Update the actor active effects when editing an owned item
function updateItemEffects(candidate, updates, options, userId) {
    if (!candidate.isOwned)
        return true;
    if (userId !== game.user?.id)
        return true;
    if (CONFIG.ActiveEffect.legacyTransferral === false) {
        return true;
    }
    // @ts-expect-error Can this happen?
    if (options.isUndo)
        return true;
    // if (updates.system?.equipped !== undefined || updates.system?.attuned !== undefined || updates.system?.attunement !== undefined) {
    // // equipped / attuned updated.
    // const isEnabled = (updates.system.equipped ?? candidate.system.equipped) && ((updates.system.attuned ?? candidate.system.attuned) || (updates.system?.attunment ?? candidate.system.attunment) !== "");
    // const effects = candidate.effects.filter(ef => !!(ef.transfer || ef.flags?.dae?.transfer))
    // }
    // @ts-expect-error Can this happen?
    if (options.isAdvancement) {
        console.warn(`dae | Skipping effect re-creation for class advancement ${candidate.parent?.name ?? ""} item ${candidate.name}`);
        return;
    }
    if (updates.effects) { // item effects have changed - update transferred effects
        const itemUuid = candidate.uuid;
        // delete all actor effects for the given item
        let deletions = [];
        for (let aef of (candidate.parent?.effects ?? [])) { // remove all transferred effects for the item
            const isTransfer = aef.flags.dae?.transfer;
            if (isTransfer && (aef.origin === itemUuid))
                deletions.push(aef.id);
        }
        ;
        // Now get all the item transfer effects
        let additions = candidate.effects.filter(aef => {
            const isTransfer = aef.transfer;
            foundry.utils.setProperty(aef, "flags.dae.transfer", isTransfer);
            return isTransfer;
        }).map(ef => ef.toObject(false));
        additions.forEach(efData => {
            efData.origin = itemUuid;
        });
        if (candidate.parent) {
            if (deletions.length > 0) {
                actionQueue.add(candidate.parent.deleteEmbeddedDocuments.bind(candidate.parent), "ActiveEffect", deletions);
            }
            if (additions.length > 0) {
                actionQueue.add(candidate.parent.createEmbeddedDocuments.bind(candidate.parent), "ActiveEffect", additions);
            }
        }
    }
    return true;
}
// Update the actor active effects when changing a transfer effect on an item
function updateTransferEffectsHook(candidate, updates, options, userId) {
    if (userId !== game.user?.id)
        return true;
    if (CONFIG.ActiveEffect.legacyTransferral === false) { // if not legacy transfer do nothing
        // TODO consider rewriting the origin for the effect
        return true;
    }
    // @ts-expect-error Can this happen?
    if (options.isUndo)
        return true;
    if (!(candidate.parent instanceof CONFIG.Item.documentClass))
        return true;
    const item = candidate.parent;
    if (!item.isOwned)
        return true;
    const actor = item.parent;
    // @ts-expect-error Can this happen?
    if (options.isAdvancement) {
        console.warn(`dae | Skipping effect re-creation for class advancement ${candidate.parent?.name ?? ""} item ${candidate.name}`);
        return;
    }
    const itemUuid = item.uuid;
    // delete all actor effects for the given item
    let deletions = [];
    for (let aef of (actor?.effects ?? [])) { // remove all transferred effects for the item
        const isTransfer = aef.flags.dae?.transfer;
        if (isTransfer && (aef.origin === itemUuid))
            deletions.push(aef.id);
    }
    ;
    // Now get all the item transfer effects
    let additions = item.effects.filter(aef => {
        const isTransfer = aef.transfer;
        foundry.utils.setProperty(aef, "flags.dae.transfer", isTransfer);
        return isTransfer;
    }).map(ef => ef.toObject(false));
    additions.forEach(efData => {
        efData.origin = itemUuid;
    });
    if (actor) {
        if (deletions.length > 0) {
            actionQueue.add(actor.deleteEmbeddedDocuments.bind(actor), "ActiveEffect", deletions);
        }
        if (additions.length > 0) {
            actionQueue.add(actor.createEmbeddedDocuments.bind(actor), "ActiveEffect", additions);
        }
    }
    return true;
}
// When an item is created any effects have a source that points to the original item
// Need to update to refer to the created item
// THe id in the this is not the final _id
// export function preCreateItemHook(candidate: Item.Implementation, data: Item.CreateData, options: Item.Database.PreCreateOptions, userId: string) {
//   if (options.isUndo) return true;
//   return true;
// }
export async function deleteItemHook(candidateItem, options, userId) {
    if (userId !== game.user?.id)
        return;
    // @ts-expect-error Can this happen?
    if (options.isUndo)
        return;
    if (CONFIG.ActiveEffect.legacyTransferral)
        return;
    const actor = candidateItem.parent;
    if (!(actor instanceof Actor))
        return;
    const token = tokenForActor(actor);
    for (let effect of candidateItem.effects) {
        if (!effect.transfer)
            continue;
        if (effect.disabled || effect.isSuppressed)
            continue;
        try {
            const selfAuraChange = foundry.utils.getProperty(effect, "flags.ActiveAuras.isAura") === true
                && foundry.utils.getProperty(effect, "flags.ActiveAuras.ignoreSelf") === true
                && effect.origin?.startsWith(actor.uuid);
            // don't apply macro or macro like effects if active aura and not targeting self
            if (selfAuraChange)
                return;
            for (let change of effect.changes) {
                // @ts-expect-error Is this okay?
                options.itemDeleted = true;
                removeEffectChange(actor, token ? [token] : [], effect, candidateItem, change, options);
            }
        }
        catch (err) {
            console.warn("dae | error creating delete item hook", err);
        }
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
    if (CONFIG.ActiveEffect.legacyTransferral)
        return;
    const token = tokenForActor(actor);
    for (let effect of item.effects) {
        if (!effect.transfer)
            continue;
        if (effect.disabled || effect.isSuppressed)
            continue;
        try {
            const selfAuraChange = foundry.utils.getProperty(effect, "flags.ActiveAuras.isAura") === true
                && foundry.utils.getProperty(effect, "flags.ActiveAuras.ignoreSelf") === true
                && effect.origin?.startsWith(actor.uuid);
            // don't apply macro or macro like effects if active aura and not targeting self
            if (selfAuraChange)
                return;
            for (let change of effect.changes) {
                addEffectChange(actor, [token], effect, item, change, options);
            }
        }
        catch (err) {
            console.warn("dae | error creating active effect ", err);
        }
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
                    macroText = originItem?.flags?.dae?.macro?.command ?? originItem?.flags?.itemacro?.macro?.command;
                }
                else if (onUpdate.macroName.startsWith("ItemMacro.")) {
                    let macroObject = sourceActor?.items.getName(onUpdate.macroName.split(".")[1]);
                    const originActor = originObject?.parent instanceof Actor ? originObject.parent : originObject?.parent?.parent;
                    if (!macroObject)
                        macroObject = originActor?.items.getName(onUpdate.macroName.split(".")[1]);
                    if (macroObject)
                        macroText = macroObject.flags?.dae?.macro?.command ?? macroObject.flags?.itemacro?.macro?.command;
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
        console.warn("dae | error in onUpdateTarget ", err);
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
    aboutTimeInstalled = game.modules.get("about-time")?.active ?? false;
    simpleCalendarInstalled = game.modules.get("foundryvtt-simple-calendar")?.active ?? false;
    timesUpActive = game.modules.get("times-up")?.active ?? false;
    if (itemacroActive) {
        Hooks.on("preUpdateItem", DIMEditor.preUpdateItemHook);
    }
}
export function localDeleteFilters(tokenId, filterName) {
    let tokenMagic = globalThis.TokenMagic;
    let token = canvas?.tokens?.get(tokenId);
    if (token)
        tokenMagic?.deleteFilters(token, filterName);
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
    itemacroActive = game.modules.get("itemacro")?.active ?? false;
    midiActive = game.modules.get("midi-qol")?.active ?? false;
    useDetermineSuppression = game.system.id === "dnd5e" && foundry.utils.isNewerVersion("5.1", game.system.version);
    // Default system class is setup, this overrides with system specific class
    const dnd5System = DAESystemDND5E; // force reference so they are installed?
    libWrapper = globalThis.libWrapper;
    daeSystemClass = foundry.utils.getProperty(globalThis.daeSystems, game.system.id ?? "");
    daeSystemClass ??= CONFIG.DAE.systemClass;
    daeSystemClass.initActions();
    daeSystemClass.initSystemData();
    if (game.settings.get("dae", "disableEffects")) {
        ui.notifications?.warn("DAE effects disabled no DAE effect processing");
        console.warn("dae | All active effects disabled.");
        return;
    }
    // Augment actor get rollData with actorUuid, actorId, tokenId, tokenUuid
    libWrapper.register("dae", "CONFIG.Actor.documentClass.prototype.getRollData", daeSystemClass.getRollDataFunc(), "MIXED");
    // libWrapper.register("dae", "CONFIG.Token.objectClass.prototype.drawEffects", drawEffects, "WRAPPER")
    // libWrapper.register("dae", "CONFIG.Actor.documentClass.prototype.applyActiveEffects", applyBaseActiveEffects, "OVERRIDE");
    // If updating item effects recreate actor effects for updated item.
    Hooks.on("updateItem", updateItemEffects);
    Hooks.on("preUpdateItem", preUpdateItemHook);
    Hooks.on("createItem", createItemHook);
    Hooks.on("deleteItem", deleteItemHook);
    // libWrapper.register("dae", "CONFIG.Actor.documentClass.prototype._preUpdate", preUpdateActor, "WRAPPER");
    // libWrapper.register("dae", "CONFIG.Item.documentClass.prototype._preCreate", _preCreateItem, "WRAPPER");
    // process onUpdateTarget flags
    Hooks.on("preUpdateActor", preUpdateActorHook);
    // Hooks for conditional effects
    Hooks.on("updateActor", processConditionalEffects);
    Hooks.on("updateToken", (tokenDocument, updates) => {
        if (updates.x || updates.y)
            processConditionalEffects(tokenDocument.actor, updates);
    });
    Hooks.on("updateItem", (item, updates) => {
        if (item.parent instanceof Actor)
            processConditionalEffects(item.parent, updates);
    });
    Hooks.on("createActiveEffect", (effect, options, userId) => {
        if (game.user !== game.users?.activeGM)
            return;
        if (effect.parent instanceof Actor) {
            processConditionalEffects(effect.parent, {});
        }
        else if (effect.transfer) {
            const item = effect.parent;
            const actor = item?.parent;
            if (actor)
                processConditionalEffects(actor, {});
        }
    });
    Hooks.on("updateActiveEffect", (effect, updates) => {
        if (game.user !== game.users?.activeGM)
            return;
        if (effect.parent instanceof Actor) {
            processConditionalEffects(effect.parent, updates);
        }
        else if (effect.transfer) {
            const item = effect.parent;
            const actor = item?.parent;
            if (actor)
                processConditionalEffects(actor, updates);
        }
    });
    Hooks.on("deleteActiveEffect", (effect) => {
        if (game.user !== game.users?.activeGM)
            return;
        if (effect.parent instanceof Actor) {
            processConditionalEffects(effect.parent, {});
        }
        else if (effect.transfer) {
            const item = effect.parent;
            const actor = item?.parent;
            if (actor)
                processConditionalEffects(actor, {});
        }
    });
    libWrapper.register("dae", "CONFIG.ActiveEffect.documentClass.prototype._preCreate", _preCreateActiveEffect, "MIXED");
    async function _preCreateActiveEffect(wrapped, data, context, user) {
        let result = await _preCreateActiveEffectRemoveExisting.bind(this)(data, context, user);
        if (result)
            result = await _preCreateActiveEffectIncrement.bind(this)(data, context, user);
        await _preCreateEnchantmentEffect.bind(this)(data, context, user);
        // @ts-expect-error no dnd5e-types
        if (this.active && this.type !== "enchantment" && dependentConditions /* && !this.flags?.dae?.autoCreated */) {
            if (this.parent instanceof Actor) { // create the rider conditions before the main effect triggers its _onCreate
                // @ts-expect-error no dnd5e-types
                await this.createRiderConditions();
            }
            if (debugEnabled > 0)
                warn("_preCreateActiveEffect", this, context);
            // Status effect reconciliation now handled via queueStatusReconciliation hook
        }
        if (result)
            result = await wrapped(data, context, user);
        return result;
    }
    // The below seems to work, but may just be good luck since the timing is "random"
    // Hooks.on("createActiveEffect", applyRequiredStatusEffectsHook);
    libWrapper.register("dae", "CONFIG.ActiveEffect.documentClass.prototype._preDelete", _preDeleteActiveEffect, "MIXED");
    async function _preDeleteActiveEffect(wrapped, options, user) {
        let result = await _preDeleteActiveEffectDecrement.bind(this)(options, user);
        if (this.active && dependentConditions && result) { // took this out 12.0.22 && !this.flags?.dae?.autoCreated)
            if (debugEnabled > 0)
                warn("_preDeleteActiveEffect", this, options);
            // Status effect reconciliation now handled via queueStatusReconciliation hook
        }
        if (result)
            result = wrapped(options, user);
        return result;
    }
    libWrapper.register("dae", "CONFIG.ActiveEffect.documentClass.prototype._preUpdate", _preUpdateActiveEffect, "MIXED");
    async function _preUpdateActiveEffect(wrapped, ...args) {
        const [changed, options, userId] = args;
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
        return wrapped(...args);
    }
    Hooks.on("createActiveEffect", createActiveEffectHook);
    Hooks.on("preUpdateItem", (item, data, options, userId) => preUpdateStatusEffects(item, options, userId));
    Hooks.on("preDeleteItem", (item, options, userId) => preUpdateStatusEffects(item, options, userId));
    Hooks.on("preCreateItem", (item, data, options, userId) => preUpdateStatusEffects(item, options, userId));
    Hooks.on("updateItem", (item, data, options, userId) => updateStatusEffects(item, options, userId));
    Hooks.on("deleteItem", (item, options, userId) => updateStatusEffects(item, options, userId));
    Hooks.on("createItem", (item, options, userId) => updateStatusEffects(item, options, userId));
    Hooks.on("deleteActiveEffect", deleteActiveEffectHook);
    //  Hooks.on("preDeleteActiveEffect", preDeleteActiveEffectHook); - moved wrapper to avoid race conditions
    Hooks.on("preUpdateActiveEffect", preUpdateActiveEffectEvalInlineHook);
    Hooks.on("preUpdateActiveEffect", recordDisabledSuppressedHook);
    Hooks.on("updateActiveEffect", updateActiveEffectHook);
    Hooks.on("updateActiveEffect", updateTransferEffectsHook);
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
    Hooks.on("preDeleteCombat", preDeleteCombatHook);
    Hooks.on("preCreateCombatant", preCreateCombatantHook);
    //@ts-expect-error no typings for this (can we maybe ditch in favor of our own tokenization?)
    tokenizer = new DETokenizeThis({
        shouldTokenize: ['(', ')', ',', '*', '/', '%', '+', '===', '==', '!=', '!', '<', '> ', '<=', '>=', '^']
    });
    actionQueue = new foundry.utils.Semaphore();
}
function preUpdateStatusEffects(doc, options, userId) {
    if (!dependentConditions)
        return true;
    let actor = doc;
    if (doc instanceof Item || doc instanceof ActiveEffect) {
        actor = doc.parent;
    }
    if (actor instanceof Item) {
        actor = actor.parent;
    }
    if (!actor)
        return true;
    options["dae"] = foundry.utils.mergeObject(options.dae ?? {}, { currentStatuses: Array.from(actor.statuses) });
    return true;
}
async function updateStatusEffects(doc, options, userId) {
    if (!dependentConditions)
        return;
    if (userId !== game.user?.id)
        return;
    let actor = doc;
    if (doc instanceof Item || doc instanceof ActiveEffect) {
        actor = doc.parent;
    }
    if (actor instanceof Item) {
        actor = actor.parent;
    }
    if (!actor)
        return;
    if (doc instanceof ActiveEffect && doc.flags?.dae?.autoCreated)
        return;
    // let newStatuses: Set<string> = new Set();
    if (!options.dae?.currentStatuses)
        return;
    let currentStatuses = new Set(options.dae?.currentStatuses);
    let newStatuses = new Set; // actor.statuses;
    for (let effect of actor.allApplicableEffects()) {
        if (effect.flags?.dae?.autoCreated) { // even if disabled auto created effects should be included in current statuses
            currentStatuses = currentStatuses.union(effect.statuses);
            continue;
        }
        if (effect.transfer && doc instanceof Item && useDetermineSuppression)
            effect.determineSuppression();
        if (!effect.active)
            continue;
        if (effect.flags?.["dfreds-convenient-effects"])
            continue;
        newStatuses = newStatuses.union(effect.statuses);
    }
    await applyStatusEffectChanges(actor, undefined, currentStatuses, newStatuses, true);
}
// Not used
async function applyRequiredStatusEffectsHook(effect, options, userId) {
    if (game.user !== game.users?.activeGM)
        return;
    if (effect.id === getStaticID("prone"))
        return;
    const myid = foundry.utils.randomID();
    try {
        //  if (effect.flags?.dae?.autoCreated) return;
        if (!dependentConditions)
            return;
        if (effect.flags?.["condition-lab-triggler"])
            return;
        let actor = effect.parent;
        if (actor instanceof Item) {
            actor = actor.parent;
        }
        await busyWait(0.05); // Hopefully this will allow the rest of the updates to complete
        const requiredStatuses = new Set(actor.statuses);
        let appliedStatuses = actorAppliedStatues(actor);
        if (CONFIG.statusEffects.find(se => se._id === effect._id))
            appliedStatuses.add(CONFIG.statusEffects.find(se => se._id === effect._id)?.id ?? "");
        // appliedStatuses = appliedStatuses.union(effect.statuses);
        warn("applyRequiredStatusEffectsHook", myid, effect.name, effect._id, actor.name, requiredStatuses, appliedStatuses);
        for (let status of requiredStatuses) {
            if (debugEnabled > 0)
                warn("applyRequiredStatusEffectHook | checking status", myid, status);
            if (["concentrating", "bonusaction", "reaction", "encumbered", "heavilyEncumbered", "exceedingCarryingCapacity"].includes(status))
                continue;
            if (!appliedStatuses.has(status)) {
                await toggleActorStatusEffect(actor, status, { active: true, flags: { dae: { autoCreated: true } } });
                appliedStatuses = actorAppliedStatues(actor);
                if (CONFIG.statusEffects.find(se => se._id === effect._id))
                    appliedStatuses.add(CONFIG.statusEffects.find(se => se._id === effect._id)?.id ?? "");
                appliedStatuses = appliedStatuses.union(effect.statuses);
            }
        }
        for (let status of appliedStatuses) {
            if (!requiredStatuses.has(status))
                await toggleActorStatusEffect(actor, status, { active: false });
        }
    }
    finally {
        if (debugEnabled > 0)
            warn("applyRequiredStatusEffects", myid, "done");
    }
}
function actorAppliedStatues(actor) {
    let appliedStatuses = new Set();
    for (let effect of actor.allApplicableEffects()) {
        if (useDetermineSuppression)
            effect.determineSuppression();
        if (!effect.active)
            continue;
        if (effect.flags?.["dfreds-convenient-effects"])
            continue;
        if (CONFIG.statusEffects.find(se => se._id === effect._id))
            appliedStatuses.add(CONFIG.statusEffects.find(se => se._id === effect._id)?.id ?? "");
    }
    return appliedStatuses;
}
// Not used 12.0.22
async function applyRequiredStatusEffects(wrapped, data, options, userId) {
    const myid = foundry.utils.randomID();
    await wrapped(data, options, userId);
    try {
        if (this.flags?.dae?.autoCreated)
            return;
        if (!dependentConditions)
            return;
        if (this.flags?.["condition-lab-triggler"])
            return;
        let actor = this.parent;
        if (actor instanceof Item) {
            actor = actor.parent;
        }
        const requiredStatuses = new Set(actor.statuses);
        let appliedStatuses = new Set();
        for (let effect of actor.allApplicableEffects()) {
            if (useDetermineSuppression)
                effect.determineSuppression();
            if (!effect.active)
                continue;
            if (effect.flags?.["dfreds-convenient-effects"])
                continue;
            if (CONFIG.statusEffects.find(se => se._id === effect._id))
                appliedStatuses.add(CONFIG.statusEffects.find(se => se._id === effect._id)?.id ?? "");
        }
        if (CONFIG.statusEffects.find(se => se._id === this._id))
            appliedStatuses.add(CONFIG.statusEffects.find(se => se._id === this._id)?.id ?? "");
        warn("applyRequiredStatusEffects", myid, this.name, this._id, actor, requiredStatuses, appliedStatuses);
        for (let status of requiredStatuses) {
            warn("checking status", myid, status);
            if (["concentrating", "bonusaction", "reaction", "encumbered", "heavilyEncumbered", "exceedingCarryingCapacity"].includes(status))
                continue;
            if (!appliedStatuses.has(status))
                await toggleActorStatusEffect(actor, status, { active: true, flags: { dae: { autoCreated: true } } });
        }
        for (let status of appliedStatuses) {
            if (!requiredStatuses.has(status))
                await toggleActorStatusEffect(actor, status, { active: false });
        }
    }
    finally {
        warn("applyRequiredStatusEffects", myid, "done");
    }
}
async function applyStatusEffects(theEffect, includeEffect, context = {}) {
    if (!dependentConditions)
        return true;
    if (theEffect.flags?.["condition-lab-triggler"])
        return;
    let actor = theEffect.parent;
    if (actor instanceof Item) {
        actor = actor.parent;
    }
    if (!actor)
        return true;
    let newStatuses = new Set();
    let currentStatuses = foundry.utils.deepClone(actor.statuses);
    for (let effect of actor.allApplicableEffects()) {
        if (effect.flags?.dae?.autoCreated) { // even if disabled auto created effects should be included in current statuses
            currentStatuses = currentStatuses.union(effect.statuses);
            continue;
        }
        if (effect.transfer && effect.parent instanceof Item && useDetermineSuppression)
            effect.determineSuppression();
        if (!effect.active)
            continue;
        if (effect.flags?.["dfreds-convenient-effects"])
            continue;
        if (effect.uuid === theEffect.uuid)
            continue; // skip existing effect it will be added in if needed
        newStatuses = newStatuses.union(effect.statuses);
    }
    if (includeEffect && theEffect instanceof ActiveEffect) {
        const docStatuses = context.statuses ?? theEffect.statuses;
        newStatuses = newStatuses.union(docStatuses);
    }
    const doc_id = theEffect._id;
    if (!includeEffect && theEffect instanceof ActiveEffect && newStatuses.has(doc_id)) {
        newStatuses.delete(doc_id);
        currentStatuses.delete(doc_id);
    }
    if (debugEnabled > 0)
        warn("applyStatusEffects", actor.name, currentStatuses, newStatuses, includeEffect);
    await applyStatusEffectChanges(actor, theEffect, currentStatuses, newStatuses, includeEffect);
}
async function applyStatusEffectChanges(actor, effect, currentStatuses, newStatuses, includeEffect) {
    if (currentStatuses.size === 0 && newStatuses.size === 0)
        return;
    if (debugEnabled > 0)
        warn("applyStatusEffectChanges", actor.name, currentStatuses, newStatuses, currentStatuses.difference(newStatuses), newStatuses.difference(currentStatuses), includeEffect);
    for (let status of newStatuses.difference(currentStatuses)) {
        if (["concentrating", "bonusaction", "reaction", "encumbered", "heavilyEncumbered", "exceedingCarryingCapacity"].includes(status))
            continue;
        const statusEffect = CONFIG.statusEffects.find(se => se.id === status);
        if (!statusEffect)
            continue;
        if (!statusEffect._id)
            continue; // status effects should have a fixed _id
        if (statusEffect.statuses?.includes(status))
            continue; // Self referential statuses cause problems
        if (!statusEffect || (statusEffect._id === effect?._id && includeEffect))
            continue; // includeEffect true means the status effect is being added so don't double up
        if (!effect?.statuses.has(status))
            continue; // Only deal with statuses that are on the effect
        // statuses not present on the actor that should be
        await toggleActorStatusEffect(actor, status, { active: true, flags: { dae: { autoCreated: true } } });
    }
    for (let status of currentStatuses.difference(newStatuses)) {
        if (["concentrating", "bonusaction", "reaction", "encumbered", "heavilyEncumbered", "exceedingCarryingCapacity"].includes(status))
            continue;
        const statusEffect = CONFIG.statusEffects.find(se => se.id === status);
        if (!statusEffect)
            continue;
        if (!statusEffect._id)
            continue; // status effects should have a fixed _id
        if (statusEffect.statuses?.includes(status))
            continue; // Self referential statuses cause problems
        if (!statusEffect || (statusEffect._id === effect?._id && !includeEffect))
            continue; // includeEffect being false means the effect is being removed so don't double up
        if (!effect?.statuses.has(status))
            continue; // Only deal with statuses that are on the effect
        // statuses present on the actor that should not be
        await toggleActorStatusEffect(actor, status, { active: false });
    }
}
/**
 * Queue a status reconciliation for an actor after effect changes complete.
 * Uses the actionQueue semaphore to serialize reconciliations and avoid race conditions.
 */
function queueStatusesReconciliation(effect, userId) {
    if (!dependentConditions)
        return;
    if (userId !== game.user?.id)
        return;
    if (!effect.statuses?.size)
        return; // No statuses, nothing to reconcile
    const actor = effect.parent instanceof Actor ? effect.parent : effect.parent?.parent;
    if (!(actor instanceof Actor))
        return;
    if (!reconciliationPending.has(actor.uuid)) {
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
}
/**
 * Reconcile the status effects on an actor based on all active effects.
 * This calculates what statuses SHOULD exist based on current effects,
 * then adds missing statuses and removes extra ones.
 */
async function reconcileActorStatuses(actor) {
    if (!dependentConditions)
        return;
    if (debugEnabled > 0)
        warn("reconcileActorStatuses", actor.name);
    const excludedStatuses = ["concentrating", "bonusaction", "reaction", "encumbered", "heavilyEncumbered", "exceedingCarryingCapacity"];
    // Calculate expected statuses from all active effects
    // EXCLUDE auto-created effects (those are the output, not the input)
    let expectedStatuses = new Set();
    const existingAutoCreatedStatusIds = new Set(); // Track which auto-created status effect documents exist
    for (let effect of actor.allApplicableEffects()) {
        if (effect.flags?.["dfreds-convenient-effects"])
            continue;
        // @ts-expect-error determineSuppression may not exist
        if (effect.transfer && effect.parent instanceof Item && useDetermineSuppression)
            effect.determineSuppression?.();
        if (!effect.active)
            continue;
        // Check if this is an auto-created status effect document
        if (effect.flags?.dae?.autoCreated) {
            // Track the primary status ID so we don't try to recreate it
            const configStatusEffect = CONFIG.statusEffects.find(se => se._id === effect.id);
            if (configStatusEffect) {
                existingAutoCreatedStatusIds.add(configStatusEffect.id);
                // Add its statuses EXCEPT its own primary status - those are dependencies that need creating
                // But don't add its own status, otherwise it would never get removed
                for (const status of effect.statuses) {
                    if (status !== configStatusEffect.id) {
                        expectedStatuses.add(status);
                    }
                }
            }
            continue; // Don't add all statuses via the union below
        }
        expectedStatuses = expectedStatuses.union(effect.statuses);
    }
    // Filter out statuses we don't manage
    for (const status of excludedStatuses) {
        expectedStatuses.delete(status);
    }
    // For each expected status, we need an auto-created status effect document to exist
    // Add status effect documents that don't exist yet
    for (let status of expectedStatuses) {
        if (existingAutoCreatedStatusIds.has(status))
            continue;
        const statusEffect = CONFIG.statusEffects.find(se => se.id === status);
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
            if (!String(err).includes("does not exist")) {
                console.warn("dae | Error adding status effect:", status, err);
            }
        }
    }
    // Remove auto-created status effect documents for statuses that are no longer expected
    for (let statusEffectId of existingAutoCreatedStatusIds) {
        if (expectedStatuses.has(statusEffectId)) {
            continue;
        }
        const statusEffect = CONFIG.statusEffects.find(se => se.id === statusEffectId);
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
    /* enable this when available
    api.registerActivityHeaderControls?.({
      controls: [
        {
          icon: 'fas fa-file-pen',
          label: "DIME",
          async onClickAction() {
            new DIMEditor({ document: this.document }).render({ force: true });
          }
        }
      ]
    });
    */
});
function appendDocumentSheetHeaderControls(app, controls) {
    const daeTitle = i18n("dae.ActiveEffectName");
    const DIMETitle = i18n("dae.DIMEditor.Name");
    if (daeTitleBar) {
        controls.push({
            label: daeTitle,
            icon: "fa-solid fa-wrench",
            onClick: () => new ActiveEffects({ document: app.document }).render({ force: true })
        });
    }
    if (DIMETitleBar && app.document instanceof Item) {
        controls.push({
            label: DIMETitle,
            icon: "fa-solid fa-file-pen",
            onClick: () => new DIMEditor({ document: app.document }).render({ force: true })
        });
    }
    ;
    // I hate this but can see no way around it
    setTimeout(() => {
        const contextItems = document.querySelectorAll("nav#context-menu .context-item");
        const daeIcon = Array.from(contextItems).find(i => i.innerText.includes(daeTitle))?.querySelector("i");
        const DIMEIcon = Array.from(contextItems).find(i => i.innerText.includes(DIMETitle))?.querySelector("i");
        let hasEffects = false;
        if (app.document instanceof Actor)
            hasEffects = app.document.allApplicableEffects().next().value !== undefined;
        else
            hasEffects = app.document.effects?.size > 0;
        if (daeIcon && hasEffects) {
            daeIcon.style.color = "#36ba36";
        }
        const validMacroFlags = ["flags.dae.macro.command", "flags.itemacro.macro.command", "flags.itemacro.macro.data.command"];
        if (DIMEIcon && validMacroFlags.some(f => foundry.utils.getProperty(app.document, f))) {
            DIMEIcon.style.color = "#36ba36";
        }
    }, 50);
}
function updateSheetHeaderButton(app, [elem], options) {
    if (!daeColorTitleBar || !daeTitleBar)
        return;
    if (elem?.querySelector('.dae-config-actorsheet') || elem?.querySelector('.dae-config-itemsheet')) {
        const daeActorSheetButton = elem.closest('.window-app').querySelector('.dae-config-actorsheet');
        const daeItemSheetButton = elem.closest('.window-app').querySelector('.dae-config-itemsheet');
        let hasEffects;
        if (app.document instanceof CONFIG.Actor.documentClass)
            hasEffects = app.document.allApplicableEffects().next().value !== undefined;
        else
            hasEffects = app.document.effects?.size > 0;
        if (!!hasEffects) {
            const sheetButtonToUpdate = !!daeActorSheetButton ? daeActorSheetButton : daeItemSheetButton;
            sheetButtonToUpdate.style.color = '#36ba36'; //that could be added in another setting
        }
    }
    if (elem?.querySelector('.dae-dimeditor')) {
        const daeSheetButton = elem.closest('.window-app').querySelector('.dae-dimeditor');
        const hasMacro = !!(foundry.utils.getProperty(app.object, "flags.dae.macro.command") ?? foundry.utils.getProperty(app.object, "flags.itemacro.macro.command") ?? foundry.utils.getProperty(app.object, "flags.itemacro.macro.data.command"));
        if (hasMacro)
            daeSheetButton.style.color = '#36ba36'; //that could be added in another setting
    }
}
export function daeSetupActions() {
    daeSystemClass.setupActions();
}
export let maxShortDuration;
export function fetchParams() {
    setDebugLevel(game.settings.get("dae", "ZZDebug"));
    // useAbilitySave = game.settings.get("dae", "useAbilitySave") disabled as of 0.8.74
    noDupDamageMacro = game.settings.get("dae", "noDupDamageMacro");
    disableEffects = game.settings.get("dae", "disableEffects");
    daeTitleBar = game.settings.get("dae", "DAETitleBar");
    DIMETitleBar = game.settings.get("dae", "DIMETitleBar");
    daeColorTitleBar = game.settings.get("dae", "DAEColorTitleBar");
    daeNoTitleText = game.settings.get("dae", "DAENoTitleText");
    // expireRealTime = game.settings.get("dae", "expireRealTime");
    // showDeprecation = game.settings.get("dae", "showDeprecation") ?? true;
    showInline = game.settings.get("dae", "showInline") ?? false;
    dependentConditions = game.settings.get("dae", "DependentConditions") ?? false;
    maxShortDuration = game.settings.get("dae", "maxShortDuration") ?? 600;
    Hooks.callAll("dae.settingsChanged");
}
export function getTokenDocument(tokenRef) {
    if (typeof tokenRef === "string") {
        const entity = fromUuidSync(tokenRef);
        if (entity instanceof TokenDocument)
            return entity;
        if (entity instanceof foundry.canvas.placeables.Token)
            return entity.document;
        if (entity instanceof Actor) {
            if (entity.isToken)
                return entity.token ?? undefined;
            else
                return entity.getActiveTokens(false, true)[0];
        }
        return undefined;
    }
    if (tokenRef instanceof TokenDocument)
        return tokenRef;
    if (tokenRef instanceof foundry.canvas.placeables.Token)
        return tokenRef.document;
    if (tokenRef instanceof Actor) {
        // actor.token returns a token document
        if (tokenRef.isToken)
            return tokenRef.token ?? undefined;
        else
            return tokenRef.getActiveTokens(false, true)[0];
    }
}
export function getToken(tokenRef) {
    if (!tokenRef)
        return undefined;
    if (tokenRef instanceof foundry.canvas.placeables.Token)
        return tokenRef;
    if (tokenRef instanceof TokenDocument)
        return tokenRef.object ?? undefined;
    let entity = tokenRef;
    if (typeof tokenRef === "string") {
        entity = fromUuidSync(tokenRef);
    }
    if (entity instanceof foundry.canvas.placeables.Token)
        return entity;
    if (entity instanceof TokenDocument)
        return entity.object ?? undefined;
    if (entity instanceof Actor)
        return tokenForActor(entity);
    if (entity instanceof Item && entity.parent instanceof Actor)
        return tokenForActor(entity.parent);
    if (entity instanceof ActiveEffect && entity.parent instanceof Actor)
        return tokenForActor(entity.parent);
    if (entity instanceof ActiveEffect && entity.parent instanceof Item)
        return tokenForActor(entity.parent?.parent);
    return undefined;
}
export function actorFromUuid(uuid) {
    let doc = fromUuidSync(uuid);
    if (doc instanceof CONFIG.Token.documentClass)
        doc = doc.actor;
    if (doc instanceof CONFIG.Actor.documentClass)
        return doc;
    if (doc instanceof CONFIG.Item.documentClass)
        return doc.parent;
    return null;
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
    if (CONFIG.ActiveEffect.legacyTransferral === false)
        return effect.transfer === true;
    if (effect.flags.dae?.transfer !== undefined)
        return effect.flags.dae.transfer;
    if (effect.transfer !== undefined)
        return effect.transfer;
    return false;
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
export function getApplicableEffects(actor, { includeEnchantments }) {
    if (!actor)
        return [];
    let effects = [];
    for (let effect of actor.allApplicableEffects())
        effects.push(effect);
    if (includeEnchantments) {
        const enchantments = actor.items.contents.flatMap(i => i.effects.contents).filter(ae => ae.isAppliedEnchantment);
        effects = effects.concat(enchantments);
    }
    return effects;
}
// This does not work since the hook is called after _preCreateEffect is called which leads to the update source firing too late
export async function toggleActorStatusEffectPossible(actor, statusId, { active = false, overlay = false, enableCondition = "", origin = "", flags = {} } = {}) {
    let preCreateActiveEffectHookId;
    try {
        const statusEffect = CONFIG.statusEffects.find(e => e.id === statusId);
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
    finally {
        if (preCreateActiveEffectHookId)
            Hooks.off("preCreateActiveEffect", preCreateActiveEffectHookId);
    }
}
// TODO can't use the core toggleActorStatusEffect, consider patching this to replace the core one
export async function toggleActorStatusEffect(actor, statusId, { active = false, overlay = false, enableCondition = "", origin = "", flags = {} } = {}) {
    if (debugEnabled > 0)
        warn("toggleActorStatusEffect", actor, statusId, active);
    const status = CONFIG.statusEffects.find(e => e.id === statusId);
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
        await actor.deleteEmbeddedDocuments("ActiveEffect", existing.map(e => e.id));
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
    const returnEffect = await ActiveEffect.implementation.create(effect.toObject(), { parent: actor, keepId: true });
    return returnEffect ? [returnEffect] : false;
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
            for (let change of ceData.changes) {
                if (daeSystemClass.fieldMappings[change.key])
                    change.key = daeSystemClass.fieldMappings[change.key];
            }
            ceData.changes = ceData.changes
                .filter(change => change.key !== "StatusEffect" || change.value.startsWith("zce-"));
            for (let status of ceData.statuses) {
                statusEffects.add(status);
            }
            const existingEffect = actor.effects.find(ef => ef.origin === conditionalEffect.uuid);
            if (!existingEffect || ["countDeleteDecrement", "count", "multi"].includes(ceData.flags?.dae?.stackable ?? "")) {
                for (let statusEffect of statusEffects) {
                    // Once v12 only change to actor.toggleStatusEffect
                    await toggleActorStatusEffect(actor, statusEffect, { active: true, overlay, origin: conditionalEffect.uuid, enableCondition: enableCondition });
                }
                if (ceData.changes.length > 0 || statusEffects.size === 0) {
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
    for (let effect of actor.effects) {
        let condition = effect?.flags?.dae?.enableCondition;
        if (condition) {
            // add other things to rollData
            rollData.combat = game.combat;
            rollData.time = game.time;
            rollData.effect = effect.toObject();
            const expression = Roll.replaceFormulaData(condition, rollData);
            // rollData.origin = fromUuidSync(effect.origin);
            const result = daeSystemClass.safeEval(expression, rollData);
            if (!result) {
                await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
            }
        }
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
                baseValues[`${key}.${fieldKey}`] = [fields[fieldKey], -1];
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
                baseValues[`${key}.${fieldKey}`] = [fields[fieldKey], -1];
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
function busyWait(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}
export function getStaticID(id) {
    id = `dnd5e${id}`;
    if (id.length >= 16)
        return id.substring(0, 16);
    return id.padEnd(16, "0");
}
