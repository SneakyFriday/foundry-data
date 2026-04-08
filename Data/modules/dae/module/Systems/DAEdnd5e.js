import { daeSpecialDurations, debug, debugEnabled, error, i18n, i18nFormat, warn } from "../../dae.js";
import { addAutoFields, isEnchantment } from "../apps/DAEActiveEffectConfig.js";
import { actionQueue, actorFromUuid, addEffectChange, applyDaeEffects, atlActive, effectIsTransfer, enumerateBaseValues, getSelfTarget, getStaticID, libWrapper, localizationMap, midiActive, noDupDamageMacro, removeEffectChange, timesUpActive, useDetermineSuppression } from "../dae.js";
import { DAESystem, ValidSpec, wildcardEffects } from "./DAESystem.js";
const { SchemaField, ArrayField, ObjectField, BooleanField, NumberField, StringField } = foundry.data.fields;
export class DAESystemDND5E extends CONFIG.DAE.systemClass {
    static traitList;
    static languageList;
    static conditionList;
    static bypassesList;
    static customDamageResistanceList;
    static armorClassCalcList;
    static toolProfList;
    static armorProfList;
    static weaponProfList;
    static get systemConfig() {
        return CONFIG.DND5E;
    }
    static getItemSpecs() {
        // const { AppliedEffectField } = globalThis.dnd5e.dataModels.activity.AppliedEffectField;
        // Setup Item Specs
        let itemSpecs = enumerateBaseValues(CONFIG.Item.dataModels);
        const activitySpecsRaw = enumerateBaseValues(globalThis.dnd5e.dataModels.activity, false);
        const activitySpecs = {};
        for (let k of Object.keys(activitySpecsRaw).filter(i => !i.endsWith("ActivityData"))) {
            delete activitySpecsRaw[k];
        }
        ;
        const overrideSuffixes = [
            ".ability",
            ".activation.type",
            ".duration.units",
            ".range.units",
            ".target.template.type",
            ".target.template.units",
            ".target.affects.type",
            ".attack.type.value",
            ".attack.type.classification",
            // TODO: THIS
            // ".dc.calculation",
            ".healing.scaling.mode",
            // ".damage.onSave",
            // ".summon.mode",
            "[transform].settings.preset"
        ];
        for (let rawActivityKey of Object.keys(activitySpecsRaw)) {
            const activityKey = rawActivityKey.replace("ActivityData", "").toLocaleLowerCase();
            let activityLabel = i18n(`DND5E.${activityKey.toUpperCase()}.Title.one`);
            if (activityLabel.startsWith("DND5E."))
                activityLabel = i18n(`DND5E.${activityKey.toUpperCase()}.Title`);
            for (let rawKey of Object.keys(activitySpecsRaw[rawActivityKey])) {
                const key = rawKey.replace("system.", "");
                if (["_id", "type"].includes(key))
                    continue;
                activitySpecs[`activities[${activityKey}].${key}`] = activitySpecsRaw[rawActivityKey][rawKey];
                // activitySpecs[`activities[${activityKey}].${key}`][0].label = `${activityLabel} ${i18n("DND5E.ACTIVITY.Title.other")} ${key}`;
                localizationMap[`activities[${activityKey}].${key}`] ??= {
                    name: i18n(`dae.genericSuffixes.${key}.name`),
                    description: i18n(`dae.genericSuffixes.${key}.description`)
                };
                if (overrideSuffixes.some(k => key.endsWith(k)))
                    activitySpecs[`activities[${activityKey}].${key}`][1] = CONST.ACTIVE_EFFECT_MODES.OVERRIDE;
            }
            if (game.modules.get("midi-qol")?.active) {
                activitySpecs[`activities[${activityKey}].useConditionText`] = [new StringField({ label: i18n("midi-qol.FIELDS.useConditionText.hint") }), -1];
                activitySpecs[`activities[${activityKey}].effectConditionText`] = [new StringField({ label: i18n("midi-qol.FIELDS.effectConditionText.hint") }), -1];
                activitySpecs[`activities[${activityKey}].macroData.name`] = [new StringField({ label: "Macro Name" }), -1];
                activitySpecs[`activities[${activityKey}].macroData.command`] = [new StringField({ label: "Macro Command" }), -1];
                activitySpecs[`activities[${activityKey}].midiProperties.ignoreTraits`] = [new ArrayField(new StringField(), { label: "Ignore Traits" }), -1];
                activitySpecs[`activities[${activityKey}].midiProperties.triggeredActivityId`] = [new StringField({ label: i18n("midi-qol.SHARED.FIELDS.midiProperties.triggeredActivityId.hint") }), -1];
                activitySpecs[`activities[${activityKey}].midiProperties.triggeredActivityConditionText`] = [new StringField({ label: i18n("midi-qol.SHARED.FIELDS.midiProperties.triggeredActivityConditionText.hint") }), -1];
                activitySpecs[`activities[${activityKey}].midiProperties.triggeredActivityTargets`] = [new StringField({ label: "Triggered Activity Targets" }), CONST.ACTIVE_EFFECT_MODES.OVERRIDE];
                activitySpecs[`activities[${activityKey}].midiProperties.triggeredActivityRollAs`] = [new StringField({ label: "Triggered Activity Roll As" }), CONST.ACTIVE_EFFECT_MODES.OVERRIDE];
                activitySpecs[`activities[${activityKey}].midiProperties.forceDialog`] = [new BooleanField({ label: i18n("midi-qol.SHARED.FIELDS.midiProperties.forceDialog.hint") }), -1];
                activitySpecs[`activities[${activityKey}].midiProperties.confirmTargets`] = [new StringField({ label: i18n("midi-qol.SHARED.FIELDS.midiProperties.confirmTargets.hint") }), -1];
                activitySpecs[`activities[${activityKey}].midiProperties.automationOnly`] = [new BooleanField({ label: i18n("midi-qol.SHARED.FIELDS.midiProperties.automationOnly.hint") }), -1];
                activitySpecs[`activities[${activityKey}].midiProperties.otherActivityCompatible`] = [new BooleanField({ label: "midi-qol.SHARED.FIELDS.midiProperties.otherActivityCompatible.hint" }), -1];
            }
            if (game.modules.get("midi-qol")?.active) {
                activitySpecs["activities[attack].attackMode"] = [new StringField({ label: "Attack Mode" }), -1];
            }
            delete activitySpecs[`activities[${activityKey}].effects`]; // = [new ObjectField(), -1];
        }
        for (let itemKey of Object.keys(itemSpecs)) {
            itemSpecs[itemKey] = foundry.utils.mergeObject(itemSpecs[itemKey], activitySpecs, { insertValues: true, insertKeys: true, inplace: false, overwrite: false });
        }
        const allSpecs = {};
        let unionSpecs = {};
        try {
            for (let k of ["weapon", /*"spell", "feat",*/ "consumable", "equipment", "loot", /*"class",*/ "tool", /*"vehicle",*/ "container"]) {
                unionSpecs = foundry.utils.mergeObject(unionSpecs, itemSpecs[k], { insertValues: true, insertKeys: true, inplace: false, overwrite: false });
            }
            itemSpecs["union"] = unionSpecs;
            for (let k of Object.keys(itemSpecs)) {
                const theSpecs = foundry.utils.flattenObject(itemSpecs[k]);
                theSpecs["name"] = [new StringField({ label: "Name" }), -1];
                theSpecs["img"] = [new StringField({ label: "Image" }), -1];
                theSpecs["flags.dae.macro.name"] = [new StringField({ label: "Macro Name" }), -1];
                theSpecs["flags.dae.macro.command"] = [new StringField({ label: "Macro Command" }), -1];
                theSpecs["flags.dae.macro.img"] = [new StringField({ label: "Macro Img" }), -1];
                theSpecs["flags.dae.macro.type"] = [new StringField({ label: "Macro Data" }), -1];
                theSpecs["flags.dae.macro.scope"] = [new StringField({ label: "Macro Scope" }), -1];
                if (game.modules.get("midi-qol")?.active && ["union", "spell", "feat", "consumable", "equipment", "spell", "weapon"].includes(k)) {
                    for (let [s, label] of [
                        ["itemCondition", "midi-qol.ItemActivationCondition.Name"],
                        ["reactionCondition", "midi-qol.ReactionActivationCondition.Name"],
                        ["otherCondition", "midi-qol.OtherActivationCondition.Name"],
                        ["effectCondition", "midi-qol.EffectActivationCondition.Name"]
                    ]) {
                        theSpecs[`flags.midi-qol.${s}`] = [new StringField({ label: i18n(label) }), -1];
                    }
                }
                // Add some not-in-datamodel keys
                theSpecs["system.damageBonus"] = [new StringField(), -1];
                // Add some legacy keys that still work. 
                // NOTE: Must keep an eye on the system and ensure this stays up to date
                theSpecs["system.ability"] = [new StringField(), CONST.ACTIVE_EFFECT_MODES.OVERRIDE];
                theSpecs["system.attack.bonus"] = [new StringField(), -1];
                theSpecs["system.attack.flat"] = [new StringField(), -1];
                theSpecs["system.damage.bonus"] = [new StringField(), -1];
                theSpecs["system.damage.parts"] = [new StringField(), -1];
                theSpecs["system.damage.types"] = [new StringField(), CONST.ACTIVE_EFFECT_MODES.OVERRIDE];
                // Remove some keys that shouldn't be there
                Object.keys(theSpecs).filter(k => k.includes("[consumptiontargetdata]")).forEach(k => delete theSpecs[k]);
                const finalSpecs = {};
                for (let k1 of Object.keys(theSpecs)) {
                    finalSpecs[k1] = new ValidSpec(k1, theSpecs[k1][0], theSpecs[k1][1], theSpecs[k1][0].label, theSpecs[k1][0].hint /*, theSpecs[k1][3] */);
                }
                for (let k1 of Object.keys(finalSpecs)) {
                    switch (k1) {
                        case "system.duration.units":
                            finalSpecs[k1].options = { "": "", ...this.systemConfig.timePeriods };
                            break;
                        case "system.target.type":
                            finalSpecs[k1].options = { "": "", ...this.systemConfig.targetTypes };
                            break;
                        case "system.actionType":
                            finalSpecs[k1].options = { "": "", ...this.systemConfig.itemActionTypes };
                            break;
                        case "system.uses.per":
                            finalSpecs[k1].options = { "": "", ...this.systemConfig.limitedUsePeriods };
                            break;
                        case "system.consume.type":
                            finalSpecs[k1].options = { "": "", ...this.systemConfig.abilityConsumptionTypes };
                            break;
                        case "system.attunement":
                            finalSpecs[k1].options = { "": "", ...this.systemConfig.attunementTypes };
                            break;
                    }
                }
                const derivedSpecsObj = {
                    "name": finalSpecs["name"],
                    "system.magicalBonus": finalSpecs["system.magicalBonus"],
                    "system.formula": finalSpecs["system.formula"],
                    "flags.midi-qol.itemCondition": finalSpecs["flags.midi-qol.itemCondition"],
                    "flags.midi-qol.reactionCondition": finalSpecs["flags.midi-qol.reactionCondition"],
                    "flags.midi-qol.otherCondition": finalSpecs["flags.midi-qol.otherCondition"],
                    "flags.midi-qol.effectCondition": finalSpecs["flags.midi-qol.effectCondition"],
                };
                const baseSpecsObj = {};
                for (let k1 of Object.keys(finalSpecs)) {
                    if (!derivedSpecsObj[k1])
                        baseSpecsObj[k1] = finalSpecs[k1];
                }
                allSpecs[k] = {
                    allSpecsObj: finalSpecs,
                    baseSpecsObj,
                    derivedSpecsObj,
                    allSpecs: Object.keys(finalSpecs).map(k => finalSpecs[k]).sort((a, b) => { return a._fieldSpec.toLocaleLowerCase() < b._fieldSpec.toLocaleLowerCase() ? -1 : 1; }),
                    baseSpecs: Object.keys(baseSpecsObj).map(k => baseSpecsObj[k]).sort((a, b) => { return a._fieldSpec.toLocaleLowerCase() < b._fieldSpec.toLocaleLowerCase() ? -1 : 1; }),
                    derivedSpecs: Object.keys(derivedSpecsObj).map(k => derivedSpecsObj[k]).sort((a, b) => { return a._fieldSpec.toLocaleLowerCase() < b._fieldSpec.toLocaleLowerCase() ? -1 : 1; }),
                    allSpecKeys: Object.keys(finalSpecs).sort(),
                    baseSpecKeys: Object.keys(baseSpecsObj).sort(),
                    derivedSpecKeys: Object.keys(derivedSpecsObj).sort()
                };
            }
            allSpecs["union"].excludeKeys = [
                "system.currency.cp",
                "system.currency.sp",
                "system.currency.ep",
                "system.currency.gp",
                "system.currency.pp",
                "system.currency.weight",
            ];
        }
        catch (err) {
            console.error("Error in getItemSpecs", err);
        }
        return allSpecs;
    }
    static modifyBaseValues(actorType, baseValues = {}, characterSpec) {
        super.modifyBaseValues(actorType, baseValues, characterSpec);
        if (debugEnabled > 0)
            warn("modifyBaseValues", actorType, baseValues, characterSpec);
        const modes = CONST.ACTIVE_EFFECT_MODES;
        //@ts-expect-error no dnd5e-types
        const dataModels = game.system.dataModels;
        const MappingField = dataModels.fields.MappingField;
        const actorDataModel = this.getActorDataModelFields(actorType);
        if (!actorDataModel) {
            console.warn("Could not find data model for actor type", actorType);
            return;
        }
        // TODO (Michael) once dnd5e-types in, ensure mapping field properly typed
        function processMappingField(key, mappingField) {
            const fields = mappingField.initialKeys;
            if (!fields)
                return;
            for (let fieldKey of Object.keys(fields)) {
                if (mappingField.model instanceof SchemaField) {
                    processSchemaField(`${key}.${fieldKey}`, mappingField.model);
                }
                else if (mappingField.model instanceof MappingField) {
                    processMappingField(`${key}.${fieldKey}`, mappingField.model);
                }
                else {
                    // TODO come back and see how favorites might be supported.
                    if (fieldKey.includes("favorites"))
                        return;
                    // let initial = fields[fieldKey].initial ?? 0;;
                    // if (typeof fields[fieldKey].initial === "function") { initial = fields[fieldKey].initial() ?? ""; }
                    // baseValues[`${key}.${fieldKey}`] = [initial, -1];
                    baseValues[`${key}.${fieldKey}`] = [fields[fieldKey], -1];
                    // console.error(`final field is ${key}.${fieldKey}`, mappingField.model);
                }
            }
        }
        function processSchemaField(key, schemaField) {
            const fields = schemaField.fields;
            for (let fieldKey of Object.keys(fields)) {
                if (fields[fieldKey] instanceof SchemaField) {
                    processSchemaField(`${key}.${fieldKey}`, fields[fieldKey]);
                }
                else if (fields[fieldKey] instanceof MappingField) {
                    processMappingField(`${key}.${fieldKey}`, fields[fieldKey]);
                }
                else {
                    if (fieldKey.includes("favorites"))
                        return; //TODO see above
                    // let initial = fields[fieldKey].initial ?? 0;;
                    // if (typeof fields[fieldKey].initial === "function") { initial = fields[fieldKey].initial() ?? ""; }
                    // baseValues[`${key}.${fieldKey}`] = [initial, -1];
                    baseValues[`${key}.${fieldKey}`] = [fields[fieldKey], -1];
                    // console.error(`final field is ${key}.${fieldKey}`, fields[fieldKey])
                }
            }
        }
        for (let key of Object.keys(actorDataModel)) {
            const modelField = actorDataModel[key];
            if (modelField instanceof SchemaField) {
                processSchemaField(`system.${key}`, modelField);
            }
            else if (modelField instanceof MappingField) {
                processMappingField(`system.${key}`, modelField);
            }
            else if ([ArrayField, ObjectField, BooleanField, NumberField, StringField].some(fieldType => modelField instanceof fieldType)) {
                baseValues[`system.${key}`] = [modelField, -1];
            }
            else
                console.error("Unexpected field ", key, modelField);
        }
        // Generate all repeated `system.abilities` fields
        for (const [key, { label: ability }] of Object.entries(this.systemConfig.abilities)) {
            const genericPrefix = `system.abilities.${key}.`;
            const genericKeys = Object.keys(baseValues).filter(k => k.startsWith(genericPrefix));
            for (const genericKey of genericKeys) {
                const innerPrefix = `dae.SystemAbilities.fieldData.${genericKey.slice(genericPrefix.length)}`;
                localizationMap[genericKey] ??= {
                    name: i18nFormat(`${innerPrefix}.name`, { ability }),
                    description: i18nFormat(`${innerPrefix}.description`, { ability })
                };
                if (localizationMap[genericKey].name === `${innerPrefix}.name`)
                    delete localizationMap[genericKey].name;
                if (localizationMap[genericKey].description === `${innerPrefix}.description`)
                    delete localizationMap[genericKey].description;
            }
        }
        // Generate all repeated `system.skills` fields
        for (const [key, { label: skill }] of Object.entries(this.systemConfig.skills)) {
            const genericPrefix = `system.skills.${key}.`;
            const genericKeys = Object.keys(baseValues).filter(k => k.startsWith(genericPrefix));
            for (const genericKey of genericKeys) {
                const innerPrefix = `dae.SystemSkills.fieldData.${genericKey.slice(genericPrefix.length)}`;
                localizationMap[genericKey] ??= {
                    name: i18nFormat(`${innerPrefix}.name`, { skill }),
                    description: i18nFormat(`${innerPrefix}.description`, { skill })
                };
                if (localizationMap[genericKey].name === `${innerPrefix}.name`)
                    delete localizationMap[genericKey].name;
                if (localizationMap[genericKey].description === `${innerPrefix}.description`)
                    delete localizationMap[genericKey].description;
            }
        }
        // Generate all repeated midi `system.traits.da` and system `dm` fields
        if (midiActive) {
            for (const [key, { label: damage }] of Object.entries(this.systemConfig.damageTypes).concat(Object.entries(this.systemConfig.healingTypes))) {
                const absorptionKey = `system.traits.da.${key}`;
                localizationMap[absorptionKey] ??= {
                    name: i18nFormat('dae.SystemTraits.fieldData.da.name', { damage }),
                    description: i18nFormat('dae.SystemTraits.fieldData.da.description', { damage })
                };
                const modKey = `system.traits.dm.amount.${key}`;
                localizationMap[modKey] ??= {
                    name: i18nFormat('dae.SystemTraits.fieldData.dm.amount.name', { damage }),
                    description: i18nFormat('dae.SystemTraits.fieldData.dm.amount.description', { damage })
                };
            }
        }
        if (!baseValues["system.attributes.prof"])
            baseValues["system.attributes.prof"] = [new NumberField(), -1];
        if (!baseValues["system.details.level"])
            baseValues["system.details.level"] = [new NumberField(), -1];
        if (!baseValues["system.attributes.ac.bonus"])
            baseValues["system.attributes.ac.bonus"] = [new StringField(), -1];
        // if (!baseValues["system.attributes.ac.base"])    baseValues["system.attributes.ac.base"]       = [new NumberField({ initial: 10 }), -1];
        if (!baseValues["system.attributes.ac.armor"])
            baseValues["system.attributes.ac.armor"] = [new NumberField(), -1];
        if (!baseValues["system.attributes.ac.shield"])
            baseValues["system.attributes.ac.shield"] = [new NumberField(), -1];
        if (!baseValues["system.attributes.ac.cover"])
            baseValues["system.attributes.ac.cover"] = [new NumberField(), -1];
        if (!baseValues["system.attributes.ac.min"])
            baseValues["system.attributes.ac.min"] = [new NumberField(), -1];
        // system.attributes.prof/system.details.level and system.attributes.hd are all calced in prepareBaseData
        if (!baseValues["system.bonuses.All-Attacks"])
            baseValues["system.bonuses.All-Attacks"] = [new StringField(), -1];
        if (!baseValues["system.bonuses.weapon.attack"])
            baseValues["system.bonuses.weapon.attack"] = [new StringField(), -1];
        if (!baseValues["system.bonuses.spell.attack"])
            baseValues["system.bonuses.spell.attack"] = [new StringField(), -1];
        if (!baseValues["system.bonuses.All-Damage"])
            baseValues["system.bonuses.All-Damage"] = [new StringField(), -1];
        if (!baseValues["system.bonuses.weapon.damage"])
            baseValues["system.bonuses.weapon.damage"] = [new StringField(), -1];
        if (!baseValues["system.bonuses.spell.damage"])
            baseValues["system.bonuses.spell.damage"] = [new StringField(), -1];
        if (!baseValues["system.bonuses.spell.all.damage"])
            baseValues["system.bonuses.spell.all.damage"] = [new StringField(), -1];
        // These are for item action types - works by accident.
        if (!baseValues["system.bonuses.heal.damage"])
            baseValues["system.bonuses.heal.damage"] = [new StringField(), -1];
        if (!baseValues["system.bonuses.save.damage"])
            baseValues["system.bonuses.save.damage"] = [new StringField(), -1];
        if (!baseValues["system.bonuses.check.damage"]) {
            // Only through midi can check activities deal damage
            if (midiActive)
                baseValues["system.bonuses.check.damage"] = [new StringField(), -1];
        }
        baseValues["system.attributes.hp.bonuses.overall"] = [new StringField(), -1];
        baseValues["system.attributes.hp.bonuses.level"] = [new StringField(), -1];
        // Don't do anything with system.attributes.hp.max - it will be set by parsing the actor schema
        if (!baseValues["system.attributes.hd.max"] && actorType === "npc")
            baseValues["system.attributes.hd.max"] = [new NumberField(), -1];
        const actorModelSchemaFields = this.getActorDataModelFields(actorType);
        delete baseValues["system.traits.toolProf.value"];
        delete baseValues["system.traits.toolProf.custom"];
        delete baseValues["system.traits.toolProf.all"];
        if (this.systemConfig.toolProficiencies && foundry.utils.getProperty(actorModelSchemaFields, "tools")) {
            const toolProfList = foundry.utils.duplicate(this.systemConfig.toolProficiencies);
            const ids = this.systemConfig.tools;
            if (ids !== undefined) {
                for (const key of Object.keys(ids)) {
                    // const item = await pack.getDocument(id);
                    toolProfList[key] = key;
                }
            }
            for (let key of Object.keys(toolProfList)) {
                baseValues[`system.tools.${key}.prof`] = [new NumberField(), CONST.ACTIVE_EFFECT_MODES.OVERRIDE];
                baseValues[`system.tools.${key}.ability`] = [new StringField(), CONST.ACTIVE_EFFECT_MODES.OVERRIDE];
                baseValues[`system.tools.${key}.bonuses.check`] = [new StringField(), -1];
            }
            for (let vehicleKey of Object.keys(this.systemConfig.vehicleTypes)) {
                baseValues[`system.tools.${vehicleKey}.value`] = [new NumberField(), CONST.ACTIVE_EFFECT_MODES.OVERRIDE];
            }
        }
        // move all the character flags to specials so that the can be custom effects only
        let charFlagKeys = Object.keys(this.systemConfig.characterFlags);
        charFlagKeys.forEach(key => {
            let theKey = `flags.${game.system.id}.${key}`;
            if ([
                `flags.${game.system.id}.weaponCriticalThreshold`,
                `flags.${game.system.id}.meleeCriticalDamageDice`,
                `flags.${game.system.id}.spellCriticalThreshold`
            ].includes(theKey)) {
                delete baseValues[theKey];
            }
            else if (this.systemConfig.characterFlags[key].type === Boolean)
                baseValues[theKey] = [new BooleanField(), -1];
            else if (this.systemConfig.characterFlags[key].type === Number)
                baseValues[theKey] = [new NumberField(), -1];
            else if (this.systemConfig.characterFlags[key].type === String)
                baseValues[theKey] = [new StringField(), -1];
        });
        delete baseValues[`flags.${game.system.id}.weaponCriticalThreshold`];
        delete baseValues[`flags.${game.system.id}.powerCriticalThreshold`];
        delete baseValues[`flags.${game.system.id}.meleeCriticalDamageDice`];
        delete baseValues[`flags.${game.system.id}.spellCriticalThreshold`];
        Object.keys(baseValues).forEach(key => {
            // can't modify many spell details.
            if (key.includes("system.spells")) {
                delete baseValues[key];
            }
        });
        if (foundry.utils.getProperty(actorModelSchemaFields, "spells")) {
            for (let spellSpec of (foundry.utils.getProperty(actorModelSchemaFields, "spells.initialKeys") ?? []))
                baseValues[`system.spells.${spellSpec}.override`] = [new NumberField(), -1];
        }
        // removed - required so that init.bonus can work (prepareInitiative called after derived effects
        // delete baseValues["system.attributes.init.total"];
        delete baseValues["system.attributes.init.mod"];
        // delete baseValues["system.attributes.init.bonus"];
        // leaving this in base values works because prepareInitiative is called after application of derived effects
        delete baseValues["flags"];
        // Misc non-working things that should be deleted
        delete baseValues["system.attributes.exhaustion"];
        delete baseValues["system.attributes.inspiration"];
        // Misc things to add/correct
        baseValues["system.attributes.ac.calc"] = [new StringField(), modes.OVERRIDE];
        baseValues["system.attributes.movement.units"] = [new StringField(), modes.OVERRIDE];
        baseValues["system.attributes.senses.units"] = [new StringField(), modes.OVERRIDE];
        baseValues["system.attributes.spellcasting"] = [new StringField(), modes.OVERRIDE];
        if (actorType === "npc") {
            baseValues["system.details.type.swarm"] = [new StringField(), modes.OVERRIDE];
            baseValues["system.details.type.value"] = [new StringField(), modes.OVERRIDE];
        }
        baseValues["system.traits.ci.all"] = [new BooleanField(), modes.CUSTOM];
        if (!baseValues["system.traits.ci.value"])
            baseValues["system.traits.ci.value"] = [new StringField(), -1];
        baseValues["system.traits.ci.custom"] = [new StringField(), modes.CUSTOM];
        if (baseValues["system.traits.weaponProf.value"]) {
            baseValues["system.traits.weaponProf.all"] = [new BooleanField(), modes.CUSTOM];
            //      baseValues["system.traits.weaponProf.value"] = [[], -1];
            baseValues["system.traits.weaponProf.custom"] = [new StringField(), modes.CUSTOM];
        }
        if (baseValues["system.traits.armorProf.value"]) {
            baseValues["system.traits.armorProf.all"] = [new BooleanField(), modes.CUSTOM];
            //      baseValues["system.traits.armorProf.value"] = [new StringField(), -1];
            baseValues["system.traits.armorProf.custom"] = [new StringField(), modes.CUSTOM];
            baseValues["system.attributes.hp.tempmax"] = [new NumberField(), -1];
        }
        baseValues["system.attributes.encumbrance.bonuses.encumbered"] = [new StringField(), -1];
        baseValues["system.attributes.encumbrance.bonuses.heavilyEncumbered"] = [new StringField(), -1];
        baseValues["system.attributes.encumbrance.bonuses.maximum"] = [new StringField(), -1];
        baseValues["system.attributes.encumbrance.bonuses.overall"] = [new StringField(), -1];
        baseValues["system.attributes.encumbrance.multipliers.encumbered"] = [new StringField(), -1];
        baseValues["system.attributes.encumbrance.multipliers.heavilyEncumbered"] = [new StringField(), -1];
        baseValues["system.attributes.encumbrance.multipliers.maximum"] = [new StringField(), -1];
        baseValues["system.attributes.encumbrance.multipliers.overall"] = [new StringField(), -1];
        baseValues["system.traits.size"] = [new StringField(), CONST.ACTIVE_EFFECT_MODES.OVERRIDE];
        if (this.systemConfig.languages) {
            baseValues["system.traits.languages.all"] = [new BooleanField(), -1];
        }
        // A dummy spec "system" is being created and must be removed to avoid errors
        if (baseValues.system)
            delete baseValues.system;
    }
    static modifySpecials(actorType, specials, characterSpec) {
        super.modifySpecials(actorType, specials, characterSpec);
        const actorModelSchemaFields = this.getActorDataModelFields(actorType);
        const ACTIVE_EFFECT_MODES = CONST.ACTIVE_EFFECT_MODES;
        if (actorType === "vehicle") {
            specials["system.attributes.ac.motionless"] = [new NumberField(), -1];
            specials["system.attributes.ac.flat"] = [new NumberField(), -1];
        }
        else {
            specials["system.attributes.ac.value"] = [new NumberField(), -1];
        }
        specials["macro.activityMacro"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["system.traits.di.all"] = [new BooleanField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["system.traits.di.value"] = [new StringField(), -1];
        specials["system.traits.di.custom"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["system.traits.di.bypasses"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["system.traits.dr.all"] = [new BooleanField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["system.traits.dr.value"] = [new StringField(), -1];
        specials["system.traits.dr.custom"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["system.traits.dr.bypasses"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["system.traits.dv.all"] = [new BooleanField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["system.traits.dv.value"] = [new StringField(), -1];
        specials["system.traits.dv.custom"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["system.traits.dv.bypasses"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        if (midiActive)
            specials["system.traits.da.bypasses"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["system.spells.pact.level"] = [new NumberField(), -1];
        specials["flags.dae"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["system.attributes.movement.all"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["system.attributes.movement.hover"] = [new BooleanField(), ACTIVE_EFFECT_MODES.CUSTOM];
        if (midiActive) {
            specials["system.attributes.ac.EC"] = [new NumberField(), -1];
            specials["system.attributes.ac.AR"] = [new NumberField(), -1];
        }
        if (foundry.utils.getProperty(actorModelSchemaFields, "resources")) {
            specials["system.resources.primary.max"] = [new NumberField(), -1];
            specials["system.resources.primary.label"] = [new StringField(), -1];
            specials["system.resources.secondary.max"] = [new NumberField(), -1];
            specials["system.resources.secondary.label"] = [new StringField(), -1];
            specials["system.resources.tertiary.max"] = [new NumberField(), -1];
            specials["system.resources.tertiary.label"] = [new StringField(), -1];
            specials["system.resources.legact.max"] = [new NumberField(), -1];
            specials["system.resources.legres.max"] = [new NumberField(), -1];
            if (game.modules.get("resourcesplus")?.active) {
                for (let res of ["fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"]) {
                    specials[`system.resources.${res}.max`] = [new NumberField(), -1];
                    specials[`system.resources.${res}.label`] = [new StringField(), -1];
                }
            }
        }
        if (foundry.utils.getProperty(actorModelSchemaFields, "spells")) {
            for (let spellSpec of (foundry.utils.getProperty(actorModelSchemaFields, "spells.initialKeys") ?? []))
                specials[`system.spells.${spellSpec}.max`] = [new NumberField(), -1];
        }
        if (["character", "npc"].includes(actorType)) {
            if (game.settings.get("dnd5e", "honorScore")) {
                specials[`system.abilities.hon.mod`] = [new NumberField(), -1];
                // specials[`system.abilities.hon.save`] = [new NumberField(), -1]; // No longer a thing
                // specials[`system.abilities.hon.min`] = [new NumberField(), -1]; There is no min attribute yet
                specials[`system.abilities.hon.max`] = [new NumberField(), -1];
            }
            if (game.settings.get("dnd5e", "sanityScore")) {
                specials[`system.abilities.san.mod`] = [new NumberField(), -1];
                // specials[`system.abilities.san.save`] = [new NumberField(), -1]; // No longer a thing
                // specials[`system.abilities.san.min`] = [new NumberField(), -1]; There is no min attribute yet
                specials[`system.abilities.san.max`] = [new NumberField(), -1];
            }
        }
        // specials[`flags.${game.system.id}.initiativeHalfProf`] = [new BooleanField(), ACTIVE_EFFECT_MODES.CUSTOM];
        // specials[`flags.${game.system.id}.initiativeDisadv`] = [new BooleanField(), ACTIVE_EFFECT_MODES.CUSTOM];
        if (game.modules.get("tidy5e-sheet")?.active)
            specials["system.details.maxPreparedSpells"] = [new NumberField(), -1];
        // change movement effects to be after prepareDerivedData
        // if (foundry.utils.getProperty(actorModelSchemaFields, "attributes.fields.movement")) {
        //  for (let key of Object.keys(this.systemConfig.movementTypes)) {
        //    specials[`system.attributes.movement.${key}`] = [new StringField(), -1];
        //  }
        // }
        // move all the character flags to specials so that they can be custom effects only
        let charFlagKeys = Object.keys(this.systemConfig.characterFlags);
        charFlagKeys.forEach(key => {
            let theKey = `flags.${game.system.id}.${key}`;
            if ([`flags.${game.system.id}.weaponCriticalThreshold`,
                `flags.${game.system.id}.powerCriticalThreshold`,
                `flags.${game.system.id}.meleeCriticalDamageDice`,
                `flags.${game.system.id}.spellCriticalThreshold`].includes(theKey)) {
                specials[theKey] = [new NumberField(), -1];
            }
        });
        // Do the system specific part
        // 1. abilities add mod and save to each;
        if (this.systemConfig.abilities && foundry.utils.getProperty(actorModelSchemaFields, "abilities"))
            Object.keys(this.systemConfig.abilities).forEach(ablKey => {
                specials[`system.abilities.${ablKey}.mod`] = [new NumberField(), -1];
                // specials[`system.abilities.${ablKey}.save`] = [new NumberField(), -1]; // No longer a thing
                // specials[`system.abilities.${ablKey}.min`] = [new NumberField(), -1]; There is no min attribute yet
                specials[`system.abilities.${ablKey}.max`] = [new NumberField(), -1];
            });
    }
    // public static modifyDerivedSpecs(actorType: string, derivedSpecs: ValidSpec[], characterSpec: any): void {
    //   super.modifyDerivedSpecs(actorType, derivedSpecs, characterSpec);
    //   const actorModelSchemaFields = DAESystem.getActorDataModelFields(actorType);
    //   const systemVersion = game.system.version;
    // }
    static modifyValidSpec(spec, validSpec) {
        const ACTIVE_EFFECT_MODES = CONST.ACTIVE_EFFECT_MODES;
        if ((spec.includes("system.skills") || spec.includes("system.attributes.concentration")) && spec.includes("ability")) {
            validSpec.forcedMode = ACTIVE_EFFECT_MODES.OVERRIDE;
        }
        if (spec.includes("system.bonuses.abilities")) {
            validSpec.forcedMode = -1;
        }
        return validSpec;
    }
    // Any actions to be called on init Hook 
    static initActions() {
        this.fieldMappings["StatusEffect"] = "macro.StatusEffect";
        Hooks.callAll("dae.addFieldMappings", this.fieldMappings);
        warn("system is ", game.system);
        if (game.modules.get("dnd5e-custom-skills")?.active) {
            wildcardEffects.push(/system\.skills\..*\.value/);
            wildcardEffects.push(/system\.skills\..*\.ability/);
            wildcardEffects.push(/system\.skills\..*\.bonuses/);
        }
        wildcardEffects.push(/system\.abilities\..*\.value/);
        wildcardEffects.push(/system\.scale\..*\.value/);
        libWrapper.register("dae", "CONFIG.ActiveEffect.documentClass.prototype.apply", daeApply, "WRAPPER");
        // We will call this in prepareData
        libWrapper.register("dae", "CONFIG.Actor.documentClass.prototype.applyActiveEffects", applyBaseEffects, "OVERRIDE");
        // Override prepareData so it can add the extra pass
        libWrapper.register("dae", "CONFIG.Actor.documentClass.prototype.prepareData", prepareData, "WRAPPER");
        // support other things that can suppress an effect, like condition immunity
        if (foundry.utils.isNewerVersion("5.1", game.system.version)) {
            libWrapper.register("dae", "CONFIG.ActiveEffect.documentClass.prototype.determineSuppression", determineSuppression, "WRAPPER");
        }
        else {
            libWrapper.register("dae", "CONFIG.ActiveEffect.documentClass.prototype.isSuppressed", isSuppressed, "WRAPPER");
        }
        // This supplies DAE custom effects - the main game
        // @ts-expect-error our custom stuff in the changes makes types mad
        Hooks.on("applyActiveEffect", this.daeCustomEffect.bind(this));
        // done here as it references some .system data
        Hooks.on("preUpdateItem", preUpdateItemHook);
        this.configureLists();
        const hookName = game.modules.get("babel")?.active ? "babel.ready" : "ready";
        Hooks.once(hookName, () => { this.configureLists(); });
        if (this.systemConfig.conditionEffects && this.systemConfig.conditionEffects["halfHealth"] && game.settings.get("dae", "DAEAddHalfHealthEffect")) {
            this.systemConfig.conditionEffects["halfHealth"].add("halfHealthEffect");
            Hooks.once(hookName, () => {
                CONFIG.statusEffects.push({
                    id: "halfHealthEffect",
                    _id: getStaticID("halfHealthEffect"),
                    name: i18n("dae.halfHealthEffectLabel"),
                    img: "modules/dae/icons/half-health.webp",
                    flags: { dnd5e: { halfHealth: true } }
                });
            });
        }
        // enchantments don't seem to get their world time set when applied to an item
        // times-up handles this if active, so skip to avoid duplicate processing
        Hooks.on("preCreateActiveEffect", (candidate, data, options, user) => {
            if (timesUpActive)
                return true;
            //@ts-expect-error no dnd5e types
            if (candidate.isAppliedEnchantment && (candidate.duration.seconds || candidate.duration.rounds || candidate.duration.turns)) {
                if (!candidate.duration.startTime && candidate.duration.seconds)
                    candidate.updateSource({ duration: { startTime: game.time.worldTime ?? 0 } });
                else if (!Number.isNumeric(candidate.duration.startRound) && !Number.isNumeric(candidate.duration.startTurn) && game.combat) {
                    candidate.updateSource({ duration: { startRound: game.combat?.round, startTurn: game.combat?.turn } });
                }
            }
            return true;
        });
        libWrapper.register("dae", "CONFIG.Item.documentClass.prototype.applyActiveEffects", _baseItemApplyEffects, "OVERRIDE");
    }
    static setupActions() {
    }
    static readyActions() {
        // checkArmorDisabled();
        // Modify armor attribution for DAE specific cases
        patchPrepareArmorClassAttribution();
        if (atlActive || game.modules.get("vision-5e")?.active) {
            const detectionModes = new Set();
            Object.keys(CONFIG.Canvas.detectionModes).forEach(dm => {
                if (CONFIG.Canvas.detectionModes[dm].tokenConfig) {
                    detectionModes.add(`ATL.detectionModes.${dm}.range`);
                }
            });
            if (game.modules.get("vision-5e")?.active) {
                Object.keys(CONFIG.Canvas.visionModes).forEach(vm => {
                    if (CONFIG.Canvas.visionModes[vm].tokenConfig) {
                        detectionModes.add(`ATL.detectionModes.${vm}.range`);
                    }
                });
            }
            const atlFields = Array.from(detectionModes);
            addAutoFields(atlFields);
        }
        Hooks.callAll("dae.addSpecialDurations", daeSpecialDurations);
        if (game.modules.get("midi-qol")?.active) {
            daeSpecialDurations["1Action"] = i18n("dae.1Action");
            daeSpecialDurations["Bonus Action"] = i18n("dae.Bonus Action");
            daeSpecialDurations["Reaction"] = i18n("dae.Reaction");
            daeSpecialDurations["Turn Action"] = i18n("dae.Turn Action");
            daeSpecialDurations["1Spell"] = i18n("dae.1Spell");
            daeSpecialDurations["1Attack"] = i18nFormat("dae.1Attack", { type: `${i18n("dae.spell")}/${i18n("dae.weapon")} ${i18n("dae.attack")}` });
            daeSpecialDurations["1Hit"] = i18nFormat("dae.1Hit", { type: `${i18n("dae.spell")}/${i18n("dae.weapon")}` });
            daeSpecialDurations["1Critical"] = i18n("dae.1Critical");
            daeSpecialDurations["1Fumble"] = i18n("dae.1Fumble");
            //    daeSpecialDurations["1Hit"] = i18n("dae.1Hit");
            daeSpecialDurations["1Reaction"] = i18n("dae.1Reaction");
            let attackTypes = ["mwak", "rwak", "msak", "rsak"];
            attackTypes.forEach(at => {
                daeSpecialDurations[`1Attack:${at}`] = `${this.systemConfig.itemActionTypes[at]}: ${i18nFormat("dae.1Attack", { type: this.systemConfig.itemActionTypes[at] })}`;
                daeSpecialDurations[`1Hit:${at}`] = `${this.systemConfig.itemActionTypes[at]}: ${i18nFormat("dae.1Hit", { type: this.systemConfig.itemActionTypes[at] })}`;
            });
            daeSpecialDurations["DamageDealt"] = i18n("dae.DamageDealt");
            daeSpecialDurations["isAttacked"] = i18n("dae.isAttacked");
            daeSpecialDurations["isDamaged"] = i18n("dae.isDamaged");
            daeSpecialDurations["isHealed"] = i18n("dae.isHealed");
            daeSpecialDurations["zeroHP"] = i18n("dae.ZeroHP");
            daeSpecialDurations["isHit"] = i18n("dae.isHit");
            daeSpecialDurations["isHitCritical"] = i18n("dae.isHitCritical");
            daeSpecialDurations["isSave"] = `${i18n("dae.isRollBase")} ${i18n("dae.isSaveDetail")}`;
            daeSpecialDurations["isSaveSuccess"] = `${i18n("dae.isRollBase")} ${i18n("dae.isSaveDetail")}: ${i18n("dae.success")}`;
            daeSpecialDurations["isSaveFailure"] = `${i18n("dae.isRollBase")} ${i18n("dae.isSaveDetail")}: ${i18n("dae.failure")}`;
            daeSpecialDurations["isConcentrationSave"] = i18n("dae.isConcentrationSave");
            daeSpecialDurations["isConcentrationSaveFail"] = `${i18n("dae.isConcentrationSave")}: ${i18n("dae.failure")}`;
            daeSpecialDurations["isConcentrationSaveSuccess"] = `${i18n("dae.isConcentrationSave")}: ${i18n("dae.success")}`;
            daeSpecialDurations["isCheck"] = `${i18n("dae.isRollBase")} ${i18n("dae.isCheckDetail")}`;
            daeSpecialDurations["isSkill"] = `${i18n("dae.isRollBase")} ${i18n("dae.isSkillDetail")}`;
            daeSpecialDurations["isInitiative"] = `${i18n("dae.isRollBase")} ${i18n("dae.isInitiativeDetail")}`;
            daeSpecialDurations["isMoved"] = i18n("dae.isMoved");
            daeSpecialDurations["longRest"] = i18n("DND5E.REST.Long.Label");
            daeSpecialDurations["shortRest"] = i18n("DND5E.REST.Short.Label");
            daeSpecialDurations["newDay"] = `${i18n("DND5E.REST.NewDay.Label")}`;
            Object.keys(this.systemConfig.abilities).forEach(abl => {
                let ablString = this.systemConfig.abilities[abl].label;
                daeSpecialDurations[`isSave.${abl}`] = `${i18n("dae.isRollBase")} ${ablString} ${i18n("dae.isSaveDetail")}`;
                daeSpecialDurations[`isSaveSuccess.${abl}`] = `${i18n("dae.isRollBase")} ${ablString} ${i18n("dae.isSaveDetail")}: ${i18n("dae.success")}`;
                daeSpecialDurations[`isSaveFailure.${abl}`] = `${i18n("dae.isRollBase")} ${ablString} ${i18n("dae.isSaveDetail")}: ${i18n("dae.failure")}`;
                daeSpecialDurations[`isCheck.${abl}`] = `${i18n("dae.isRollBase")} ${ablString} ${i18n("dae.isCheckDetail")}`;
            });
            Object.keys(this.systemConfig.damageTypes).forEach(key => {
                daeSpecialDurations[`isDamaged.${key}`] = `${i18n("dae.isDamaged")}: ${this.systemConfig.damageTypes[key].label}`;
            });
            daeSpecialDurations[`isDamaged.healing`] = `${i18n("dae.isDamaged")}: ${this.systemConfig.healingTypes["healing"].label}`;
            Object.keys(this.systemConfig.skills).forEach(skillId => {
                daeSpecialDurations[`isSkill.${skillId}`] = `${i18n("dae.isRollBase")} ${i18n("dae.isSkillDetail")} ${this.systemConfig.skills[skillId].label}`;
            });
        }
        // Rely on suppression Hooks.on("updateItem", updateItem); // deal with disabling effects for unequipped items
    }
    static initSystemData() {
        // Setup attack types and expansion change mappings
        this.spellAttacks = ["msak", "rsak"];
        this.weaponAttacks = ["mwak", "rwak"];
        this.attackTypes = this.weaponAttacks.concat(this.spellAttacks);
        this.bonusSelectors = {
            "system.bonuses.All-Attacks": { attacks: this.attackTypes, selector: "attack" },
            "system.bonuses.weapon.attack": { attacks: this.weaponAttacks, selector: "attack" },
            "system.bonuses.spell.attack": { attacks: this.spellAttacks, selector: "attack" },
            "system.bonuses.All-Damage": { attacks: this.attackTypes, selector: "damage" },
            "system.bonuses.weapon.damage": { attacks: this.weaponAttacks, selector: "damage" },
            "system.bonuses.spell.damage": { attacks: this.spellAttacks, selector: "damage" },
        };
        this.daeActionTypeKeys = Object.keys(this.systemConfig.itemActionTypes);
        /*
        daeSystemClass.systemConfig.characterFlags["DamageBonusMacro"] = {
          type: String,
          name: "Damage Bonus Macro",
          hint: "Macro to use for damage bonus",
          section: "Midi QOL"
        };
        // daeSystemClass.systemConfig.characterFlags["initiativeHalfProficiency"] = {
        //   type: Boolean,
        //   name: "Half Proficiency for Initiative",
        //   hint: "add 1/2 proficiency to initiative",
        //   section: "Midi QOL"
        // };
        daeSystemClass.systemConfig.characterFlags["initiativeDisadv"] = {
          type: Boolean,
          name: "Disadvantage on Initiative",
          hint: "Disadvantage on Initiative",
          section: "Midi QOL"
        };
        */
    }
    static effectDisabled(actor, effect, itemData = null) {
        if (useDetermineSuppression)
            effect.determineSuppression();
        const disabled = effect.disabled || effect.isSuppressed;
        return disabled;
    }
    static enumerateLanguages(systemLanguages) {
        const languages = { "ALL": "All" };
        Object.entries(systemLanguages).forEach(([key, language]) => {
            if (typeof language === "string") {
                languages[key] = i18n(language);
            }
            else if (language.label) {
                languages[key] = language.label;
            }
            if (language.children) {
                const subLanguages = this.enumerateLanguages(language.children);
                Object.keys(subLanguages).forEach(subLang => {
                    languages[subLang] = subLanguages[subLang];
                });
            }
        });
        return languages;
    }
    // For DAE Editor
    static configureLists() {
        this.traitList = Object.fromEntries(Object.entries(this.systemConfig.damageTypes).map(([key, { label }]) => [[key, label], [`-${key}`, `- ${label}`]]).flat(1));
        for (const [key, { label }] of Object.entries(this.systemConfig.healingTypes)) {
            this.traitList[key] = label;
            this.traitList[`-${key}`] = `- ${label}`;
        }
        this.bypassesList = Object.entries(this.systemConfig.itemProperties)
            .filter(([key, value]) => value.isPhysical)
            .reduce((acc, [key, value]) => {
            acc[key] = value.label;
            return acc;
        }, {});
        this.languageList = this.enumerateLanguages(this.systemConfig.languages);
        this.armorClassCalcList = {};
        for (let acCalc in this.systemConfig.armorClasses) {
            this.armorClassCalcList[acCalc] = this.systemConfig.armorClasses[acCalc].label;
        }
        this.conditionList = {};
        Object.entries(this.systemConfig.conditionTypes).forEach(([type, { name }]) => {
            this.conditionList[type] = name;
        });
        // Separate loop so that things are prettier (all normal, all `-` rather than alternating)
        Object.entries(this.systemConfig.conditionTypes).forEach(([type, { name }]) => {
            this.conditionList[`-${type}`] = `- ${name}`;
        });
        this.toolProfList = foundry.utils.duplicate(this.systemConfig.toolProficiencies);
        Object.entries(this.toolProfList).forEach(([type, label]) => {
            this.toolProfList[`-${type}`] = `- ${label}`;
        });
        this.armorProfList = foundry.utils.duplicate(this.systemConfig.armorProficiencies);
        Object.entries(this.armorProfList).forEach(([type, label]) => {
            this.armorProfList[`-${type}`] = `- ${label}`;
        });
        this.weaponProfList = foundry.utils.duplicate(this.systemConfig.weaponProficiencies);
        Object.entries(this.weaponProfList).forEach(([type, label]) => {
            this.weaponProfList[`-${type}`] = `- ${label}`;
        });
    }
    static getOptionsForSpec(spec) {
        const abilitiesList = Object.keys(this.systemConfig.abilities).reduce((obj, key) => { obj[key] = this.systemConfig.abilities[key].label; return obj; }, {});
        if (!spec?.key)
            return undefined;
        if (spec.key === "system.traits.languages.value")
            return this.languageList;
        if (spec.key === "system.traits.ci.value")
            return this.conditionList;
        // TODO: Maybe don't force these (| Add | 1 is perfectly valid here)
        if (spec.key.match(/system.tools..*prof/))
            return { 0: "Not Proficient", 0.5: "Half Proficiency", 1: "Proficient", 2: "Expertise" };
        if (spec.key.match(/system.abilities..*proficient/))
            return { 0: "Not Proficient", 0.5: "Half Proficiency", 1: "Proficient", 2: "Expertise" };
        if (spec.key.includes("system.skills") && spec.key.includes("value"))
            return { 0: "Not Proficient", 0.5: "Half Proficiency", 1: "Proficient", 2: "Expertise" };
        if (spec.key.match(/system.tools..*ability/))
            return abilitiesList;
        if (spec.key === "system.traits.armorProf.value")
            return this.armorProfList;
        if (spec.key === "system.traits.weaponProf.value")
            return this.weaponProfList;
        if (["system.traits.di.value", "system.traits.dr.value", "system.traits.dv.value",
            "system.traits.da.value",
            "system.traits.idi.value", "system.traits.idr.value", "system.traits.idv.value",
            "system.traits.ida.value", "system.traits.idm.value"].includes(spec.key))
            return this.traitList;
        if (["system.traits.di.custom", "system.traits.dr.custom", "system.traits.dv.custom", "system.traits.da.custom"].includes(spec.key)) {
            return this.systemConfig.customDamageResistanceTypes ?? {};
        }
        if (spec.key === "system.attributes.ac.calc") {
            return this.armorClassCalcList;
        }
        if (["system.traits.dm.bypasses", "system.traits.di.bypasses", "system.traits.dr.bypasses", "system.traits.dv.bypasses", "system.traits.da.bypasses"].includes(spec.key))
            return this.bypassesList;
        if (spec.key.includes("system.skills") && spec.key.includes("ability")) {
            return abilitiesList;
        }
        if (spec.key === "system.traits.size") {
            return Object.keys(this.systemConfig?.actorSizes).reduce((sizes, size) => {
                sizes[size] = this.systemConfig.actorSizes[size].label;
                return sizes;
            }, {});
        }
        function extractLabels(orig) {
            return Object.fromEntries(Object.entries(orig).map(([key, { label }]) => [key, i18n(label)]));
        }
        if (["system.attributes.movement.units", "system.attributes.senses.units"].includes(spec.key)) {
            return extractLabels(this.systemConfig.movementUnits);
        }
        if (spec.key === "system.attributes.spellcasting") {
            return abilitiesList;
        }
        if (spec.key === "system.details.type.swarm") {
            return Object.keys(this.systemConfig?.actorSizes).reduce((sizes, size) => {
                sizes[size] = this.systemConfig.actorSizes[size].label;
                return sizes;
            }, { '': '' });
        }
        if (spec.key === "system.details.type.value") {
            return extractLabels(this.systemConfig.creatureTypes);
        }
        // Enchant stuff
        if (spec.key === "system.ability") {
            return abilitiesList;
        }
        if (spec.key.includes("activities") && spec.key.endsWith(".ability")) {
            const abilitiesList = Object.keys(this.systemConfig.abilities).reduce((obj, key) => { obj[key] = this.systemConfig.abilities[key].label; return obj; }, { "": `item default` });
            return abilitiesList;
        }
        if (["system.damage.types", "system.damage.base.types"].includes(spec.key) || (spec.key.includes("activities") && spec.key.endsWith("damage.types"))) {
            return this.traitList;
        }
        if (spec.key.endsWith(".activation.type")) {
            return extractLabels(this.systemConfig.activityActivationTypes);
        }
        if (spec.key.endsWith(".duration.units")) {
            return extractLabels(this.systemConfig.timeUnits);
        }
        if (spec.key.endsWith(".range.units")) {
            return extractLabels(this.systemConfig.distanceUnits);
        }
        if (spec.key.endsWith(".target.template.type")) {
            return extractLabels(this.systemConfig.areaTargetTypes);
        }
        if (spec.key.endsWith(".target.template.units")) {
            return extractLabels(this.systemConfig.movementUnits);
        }
        if (spec.key.endsWith(".target.affects.type")) {
            return extractLabels(this.systemConfig.individualTargetTypes);
        }
        if (spec.key.endsWith(".attack.type.value")) {
            return extractLabels(this.systemConfig.attackTypes);
        }
        if (spec.key.endsWith(".attack.type.classification")) {
            return extractLabels(this.systemConfig.attackClassifications);
        }
        if (spec.key.endsWith(".healing.scaling.mode")) {
            return extractLabels(this.systemConfig.damageScalingModes);
        }
        if (spec.key.endsWith("[transform].settings.preset")) {
            return extractLabels(this.systemConfig.transformation.presets);
        }
        if (spec.key.endsWith("triggeredActivityTargets") && globalThis.MidiQOL) {
            return globalThis.MidiQOL.midiPropertiesOptions.triggeredActivityTargetOptions;
        }
        if (spec.key.endsWith("triggeredActivityRollAs") && globalThis.MidiQOL) {
            return globalThis.MidiQOL.midiPropertiesOptions.triggeredActivityRollAsOptions;
        }
        // TODO: dc.calculation
        // TODO: damage.onSave
        // TODO: summon.mode
        return super.getOptionsForSpec(spec);
    }
    static async editConfig() {
        try {
            const profs = [
                { type: "tool", list: this.toolProfList },
                { type: "armor", list: this.armorProfList },
                { type: "weapon", list: this.weaponProfList }
            ];
            for (let { type, list } of profs) {
                if (type === "tool") {
                    for (const [key, { ability, id }] of Object.entries(this.systemConfig[`${type}s`])) {
                        //@ts-expect-error no dnd5e-types
                        const item = game.system.documents.Trait.getBaseItem(id, { indexOnly: true });
                        list[key] = item.name;
                    }
                }
                else {
                    const ids = this.systemConfig[`${type}Ids`];
                    if (ids !== undefined) {
                        for (const [key, id] of Object.entries(ids)) {
                            //@ts-expect-error no dnd5e-types
                            const item = game.system.documents.Trait.getBaseItem(id, { indexOnly: true });
                            list[key] = item.name;
                        }
                    }
                }
            }
        }
        catch (err) { }
    }
    // Special case handling of (expr)dX
    static attackDamageBonusEval(bonusString, actor) {
        return bonusString;
    }
    /*
     * do custom effect applications
     * damage resistance/immunity/vulnerabilities
     * languages
     */
    static daeCustomEffect(actor, change, current, delta, changes) {
        if (!super.daeCustomEffect(actor, change))
            return;
        // const current = foundry.utils.getProperty(actor, change.key);
        let value;
        if (typeof change?.key !== "string")
            return true;
        const damageBonusMacroFlag = `flags.${game.system.id}.DamageBonusMacro`;
        if (change.key === damageBonusMacroFlag) {
            let macroRef = change.value;
            const macroItem = getActorItemForEffect(change.effect);
            if (change.value === "ItemMacro") { // rewrite the ItemMacro if there is an origin
                macroRef = `ItemMacro.${macroItem?.uuid}`;
                // @ts-expect-error no dnd5e-types
            }
            else if (change.value === "ActivityMacro" && change.effect.activity?.includes("Activity.")) {
                // @ts-expect-error no dnd5e-types
                macroRef = `ActivityMacro.${change.effect.activity}`;
            }
            else if (change.value === "ActivityMacro") {
                macroRef = `ActivityMacro.${macroItem?.uuid}`;
            }
            const current = foundry.utils.getProperty(actor, change.key);
            // includes wont work for macro names that are subsets of other macro names
            if (noDupDamageMacro && current?.split(",").some(macro => macro === macroRef))
                return true;
            foundry.utils.setProperty(actor, change.key, current ? `${current},${macroRef}` : macroRef);
            return true;
        }
        if (change.key.includes(`flags.${game.system.id}`) && this.systemConfig.characterFlags[change.key.split(".").pop()]) {
            if (change.key.includes(`flags.${game.system.id}`) && this.systemConfig.characterFlags[change.key.split(".").pop()]?.type !== String) {
                const type = this.systemConfig.characterFlags[change.key.split(".").pop()]?.type ?? Boolean;
                const rollData = actor.getRollData();
                const flagValue = foundry.utils.getProperty(rollData, change.key) || 0;
                // ensure the flag is not undefined when doing the roll, supports flagName @flags.dae.flagName + 1
                foundry.utils.setProperty(rollData, change.key, flagValue);
                let value = this.safeEval(this.safeEvalExpression(change.value, rollData), rollData);
                if (type === Boolean)
                    foundry.utils.setProperty(actor, change.key, value ? true : false);
                else
                    foundry.utils.setProperty(actor, change.key, value);
                return true;
            }
            if (change.key.includes(`flags.${game.system.id}`) && this.systemConfig.characterFlags[change.key.split(".").pop()]?.type !== Boolean) {
                return true;
            }
        }
        if (change.key.startsWith("system.skills.") && change.key.endsWith(".value")) {
            const currentProf = foundry.utils.getProperty(actor, change.key) || 0;
            const profValues = { "0.5": 0.5, "1": 1, "2": 2 };
            const upgrade = profValues[change.value];
            if (upgrade === undefined)
                return;
            let newProf = Number(currentProf) + upgrade;
            if (newProf > 1 && newProf < 2)
                newProf = 1;
            if (newProf > 2)
                newProf = 2;
            return foundry.utils.setProperty(actor, change.key, newProf);
        }
        if (change.key.startsWith("system.abilities") && (change.key.endsWith("bonuses.save") || change.key.endsWith("bonuses.check"))) {
            value = change.value;
            if (!current)
                return foundry.utils.setProperty(actor, change.key, value);
            value = current + ((change.value.startsWith("+") || change.value.startsWith("-")) ? change.value : "+" + change.value);
            return foundry.utils.setProperty(actor, change.key, value);
        }
        if (change.key.startsWith("system.tools")) {
            // @ts-expect-error no dnd5e-types
            current = actor.system.tools;
            if (change.key === "system.tools.all") {
                for (let prof in this.toolProfList) {
                    if (current[prof])
                        continue;
                    current[prof] = { value: 1, ability: "int", bonuses: { check: "" } };
                }
                return true;
            }
            const [_1, _2, tool, key] = change.key.split(".");
            current[tool] = foundry.utils.mergeObject({ value: 1, ability: "int", bonuses: { check: "" } }, current[tool] ?? {});
            if (key === "prof") {
                value = Number(change.value);
                current[tool].value = value;
            }
            if (key === "ability") {
                current[tool].ability = change.value;
            }
            if (key === "bonus") {
                foundry.utils.setProperty(current[tool], "bonuses.check", change.value);
            }
            return true;
        }
        switch (change.key) {
            case "system.attributes.movement.hover":
                foundry.utils.setProperty(actor, change.key, change.value ? true : false);
                return true;
            case "system.traits.di.all":
            case "system.traits.dr.all":
            case "system.traits.da.all":
            case "system.traits.dv.all":
            case "system.traits.sdi.all":
            case "system.traits.sdr.all":
            case "system.traits.sdv.all":
                const key = change.key.replace(".all", ".value");
                foundry.utils.setProperty(actor, key, new Set(Object.keys(this.systemConfig.damageTypes).filter(k => !["healing", "temphp"].includes(k))));
                return true;
            case "system.traits.di.value":
            case "system.traits.dr.value":
            case "system.traits.dv.value":
            case "system.traits.da.value":
            case "system.traits.sdi.value":
            case "system.traits.sdr.value":
            case "system.traits.sdv.value":
            case "system.traits.idi.value":
            case "system.traits.idr.value":
            case "system.traits.idv.value":
            case "system.traits.ida.value":
            case "system.traits.idm.value":
                return super.doCustomArrayValue(actor, current, change, Object.keys(this.systemConfig.damageTypes));
            case "system.traits.di.bypasses":
            case "system.traits.dr.bypasses":
            case "system.traits.dv.bypasses":
            case "system.traits.da.bypasses":
            case "system.traits.dm.bypasses":
                const validKeys = Object.keys(this.systemConfig.itemProperties)
                    .filter(key => this.systemConfig.itemProperties[key].isPhysical);
                return super.doCustomArrayValue(actor, current, change, validKeys);
            case "system.traits.da.custom":
            case "system.traits.di.custom":
            case "system.traits.dr.custom":
            case "system.traits.dv.custom":
            case "system.traits.sdi.custom":
            case "system.traits.sdr.custom":
            case "system.traits.sdv.custom":
            case "system.traits.ci.custom":
                value = (current ?? "").length > 0 ? current.trim().split(";").map(s => s.trim()) : [];
                const traitSet = new Set(value);
                traitSet.add(change.value);
                value = Array.from(traitSet).join("; ");
                foundry.utils.setProperty(actor, change.key, value);
                return true;
            case "system.traits.languages.custom":
            case "system.traits.armorProf.custom":
            case "system.traits.weaponProf.custom":
                value = (current ?? "").length > 0 ? current.trim().split(";").map(s => s.trim()) : [];
                const setValue = new Set(value);
                setValue.add(change.value);
                value = Array.from(setValue).join("; ");
                foundry.utils.setProperty(actor, change.key, value);
                return true;
            case "system.traits.languages.all":
                // @ts-expect-error no dnd5e-types
                if (actor.system.traits.languages.value instanceof Set)
                    foundry.utils.setProperty(actor, "system.traits.languages.value", new Set(Object.keys(DAESystemDND5E.enumerateLanguages(this.systemConfig.languages))));
                else
                    foundry.utils.setProperty(actor, "system.traits.languages.value", Object.keys(DAESystemDND5E.enumerateLanguages(this.systemConfig.languages)));
                return true;
            case "system.traits.languages.value":
                return super.doCustomArrayValue(actor, current, change, Object.keys(this.languageList));
            case "system.traits.ci.all":
                // @ts-expect-error no dnd5e-types
                if (actor.system.traits.ci.value instanceof Set)
                    foundry.utils.setProperty(actor, "system.traits.ci.value", new Set(Object.keys(this.systemConfig.conditionTypes)));
                else
                    foundry.utils.setProperty(actor, "system.traits.ci.value", Object.keys(this.systemConfig.conditionTypes));
                return true;
            case "system.traits.ci.value":
                return super.doCustomArrayValue(actor, current, change, Object.keys(this.systemConfig.conditionTypes));
            case "system.traits.armorProf.value":
                return super.doCustomArrayValue(actor, current, change, undefined);
            case "system.traits.armorProf.all":
                // @ts-expect-error no dnd5e-types
                if (actor.system.traits.armorProf?.value) {
                    // @ts-expect-error no dnd5e-types
                    if (actor.system.traits.armorProf?.value instanceof Set)
                        foundry.utils.setProperty(actor, "system.traits.armorProf.value", new Set(Object.keys(this.armorProfList).filter(k => !k.startsWith("-"))));
                    else
                        foundry.utils.setProperty(actor, "system.traits.armorProf.value", Object.keys(this.armorProfList).filter(k => !k.startsWith("-")));
                }
                return true;
            case "system.traits.weaponProf.value": // TODO v10 armor and weapon proficiencies
                return super.doCustomArrayValue(actor, current, change, undefined);
            case "system.traits.weaponProf.all":
                // @ts-expect-error no dnd5e-types
                if (actor.system.traits.weaponProf?.value) {
                    // @ts-expect-error no dnd5e-types
                    if (actor.system.traits.weaponProf.value instanceof Set)
                        foundry.utils.setProperty(actor, "system.traits.weaponProf.value", new Set(Object.keys(this.weaponProfList).filter(k => !k.startsWith("-"))));
                    else
                        foundry.utils.setProperty(actor, "system.traits.weaponProf.value", Object.keys(this.weaponProfList).filter(k => !k.startsWith("-")));
                }
                return true;
            case "system.bonuses.weapon.damage":
                value = this.attackDamageBonusEval(change.value, actor);
                if (current)
                    value = (change.value.startsWith("+") || change.value.startsWith("-")) ? value : "+" + value;
                // @ts-expect-error no dnd5e-types
                this.weaponAttacks.forEach(atType => actor.system.bonuses[atType].damage += value);
                return true;
            case "system.bonuses.spell.damage":
                value = this.attackDamageBonusEval(change.value, actor);
                if (current)
                    value = (change.value.startsWith("+") || change.value.startsWith("-")) ? value : "+" + value;
                // @ts-expect-error no dnd5e-types
                this.spellAttacks.forEach(atType => actor.system.bonuses[atType].damage += value);
                return true;
            case "system.bonuses.mwak.attack":
            case "system.bonuses.mwak.damage":
            case "system.bonuses.rwak.attack":
            case "system.bonuses.rwak.damage":
            case "system.bonuses.msak.attack":
            case "system.bonuses.msak.damage":
            case "system.bonuses.mpak.attack":
            case "system.bonuses.mpak.damage":
            case "system.bonuses.rpak.attack":
            case "system.bonuses.rpak.damage":
            case "system.bonuses.rsak.attack":
            case "system.bonuses.rsak.damage":
            case "system.bonuses.heal.attack":
            case "system.bonuses.heal.damage":
            case "system.bonuses.abilities.save":
            case "system.bonuses.abilities.check":
            case "system.bonuses.abilities.skill":
            case "system.bonuses.power.forceLightDC":
            case "system.bonuses.power.forceDarkDC":
            case "system.bonuses.power.forceUnivDC":
            case "system.bonuses.power.techDC":
                // TODO: remove if fixed in core
                let result = this.attackDamageBonusEval(change.value, actor);
                value = result;
                if (current)
                    value = (result.startsWith("+") || result.startsWith("-")) ? result : "+" + result;
                foundry.utils.setProperty(actor, change.key, (current || "") + value);
                return true;
            case "system.attributes.movement.all":
                // @ts-expect-error no dnd5e-types
                const movement = actor.system.attributes.movement;
                let op = "";
                if (typeof change.value === "string") {
                    change.value = change.value.trim();
                    if (["+", "-", "/", "*"].includes(change.value[0])) {
                        op = change.value[0];
                    }
                }
                for (let key of Object.keys(movement)) {
                    if (typeof movement[key] !== "number")
                        continue;
                    if (["units", "hover"].includes(key))
                        continue;
                    let valueString = change.value;
                    if (op !== "") {
                        if (!movement[key])
                            continue;
                        valueString = `${movement[key]} ${change.value}`;
                    }
                    try {
                        const roll = new Roll(valueString, actor.getRollData());
                        let result;
                        if (!roll.isDeterministic) {
                            error(`Error evaluating system.attributes.movement.all = ${valueString}. Roll is not deterministic for ${actor.name} ${actor.uuid} dice terms ignored`);
                        }
                        result = roll.evaluateSync({ strict: false }).total;
                        movement[key] = Math.floor(Math.max(0, result) + 0.5);
                    }
                    catch (err) {
                        console.warn(`dae | Error evaluating custom movement.all = ${valueString}`, key, err);
                    }
                }
                ;
                return true;
            case "system.attributes.powerForceLightDC":
            case "system.attributes.powerForceDarkDC":
            case "system.attributes.powerForceUnivDC":
            case "system.attributes.powerTechDC":
                if (Number.isNumeric(change.value)) {
                    value = parseInt(change.value);
                }
                else {
                    try {
                        const roll = new Roll(change.value, actor.getRollData());
                        if (!roll.isDeterministic) {
                            error(`Error evaluating ${change.key} = ${change.value}`, `Roll is not deterministic for ${actor.name} dice terms ignored`);
                        }
                        value = roll.evaluateSync({ strict: false }).total;
                    }
                    catch (err) { }
                    ;
                }
                if (value !== undefined) {
                    foundry.utils.setProperty(actor, change.key, Number(current) + value);
                }
                else
                    return;
                return true;
            case "flags.dae":
                let list = change.value.split(" ");
                const flagName = list[0];
                let formula = list.splice(1).join(" ");
                const rollData = actor.getRollData();
                // @ts-expect-error no dnd5e-types
                const flagValue = foundry.utils.getProperty(rollData.flags, `dae.${flagName}`) || 0;
                // ensure the flag is not undefined when doing the roll, supports flagName @flags.dae.flagName + 1
                foundry.utils.setProperty(rollData, `flags.dae.${flagName}`, flagValue);
                let roll = new Roll(formula, rollData);
                if (!roll.isDeterministic) {
                    error(`dae | Error evaluating flags.dae.${flagName} = ${formula}. Roll is not deterministic for ${actor.name} ${actor.uuid} dice terms ignored`);
                }
                value = roll.evaluateSync({ strict: false }).total;
                foundry.utils.setProperty(actor, `flags.dae.${flagName}`, value);
                return true;
        }
    }
    static getRollDataFunc() {
        return getRollData;
    }
}
// this function replaces applyActiveEffects in Actor
function applyBaseEffects() {
    // @ts-expect-error no dnd5e-types
    if (this._prepareScaleValues)
        this._prepareScaleValues();
    // @ts-expect-error no dnd5e-types
    if (this.system?.prepareEmbeddedData instanceof Function)
        this.system.prepareEmbeddedData();
    // The Active Effects do not have access to their parent at preparation time, so we wait until this stage to
    // Handle traits.ci specially
    // CI disable other effects so need to be processed before other effects
    const traitsCI = {};
    traitsCI["system.traits.ci.all"] = ValidSpec.actorSpecs[this.type].allSpecsObj["system.traits.ci.all"];
    traitsCI["system.traits.ci.value"] = ValidSpec.actorSpecs[this.type].allSpecsObj["system.traits.ci.value"];
    applyDaeEffects.bind(this)({ specList: traitsCI, excludeSpecs: {}, allowAllSpecs: false, wildCardsInclude: [], wildCardsExclude: [], doStatusEffects: false });
    applyDaeEffects.bind(this)({ specList: ValidSpec.actorSpecs[this.type].baseSpecsObj, excludeSpecs: ValidSpec.actorSpecs[this.type].derivedSpecsObj, allowAllSpecs: true, wildCardsInclude: wildcardEffects, wildCardsExclude: [], doStatusEffects: true });
}
function prepareData(wrapped) {
    if (!ValidSpec.actorSpecs) {
        ValidSpec.createValidMods();
    }
    try {
        this.statuses ??= new Set();
        // Identify which special statuses had been active
        const specialStatuses = new Map();
        for (const statusId of Object.values(CONFIG.specialStatusEffects)) {
            specialStatuses.set(statusId, this.statuses.has(statusId));
        }
        this.statuses.clear(); // need to do this here since core foundry does this in applyActiveEffects, but we do multiple calls to applyEffects
        // @ts-expect-error no dnd5e-types
        if (this.system.traits) {
            for (let key of ["da", "ida", "idr", "idv", "idi", "idm"]) {
                // @ts-expect-error no dnd5e-types
                if (!(this.system.traits[key]?.value instanceof Set)) {
                    // @ts-expect-error no dnd5e-types
                    this.system.traits[key] = { value: new Set(), bypasses: new Set(), custom: '' };
                }
            }
        }
        foundry.utils.setProperty(this, "flags.dae.onUpdateTarget", this._source.flags?.dae?.onUpdateTarget);
        this.overrides = {};
        // Call the original prepare data - with foundry's apply effects replaced by dae's
        wrapped();
        // @ts-expect-error no dnd5e-types
        const hasHeavy = this.items.some(i => i.system.equipped && i.system.properties.has("stealthDisadvantage"));
        if (hasHeavy)
            foundry.utils.setProperty(this, "flags.midi-qol.disadvantage.skill.ste", true);
        // Extra pass of applying effects after prepare data has run to support referencing derived data
        applyDaeEffects.bind(this)({ specList: ValidSpec.actorSpecs[this.type].derivedSpecsObj, excludeSpecs: {}, allowAllSpecs: false, wildCardsInclude: [], wildCardsExclude: wildcardEffects, doStatusEffects: true });
        // Allow for changes made by effects
        preparePassiveSkills.bind(this)();
        // @ts-expect-error no dnd5e-types
        const globalBonuses = this.system.bonuses?.abilities ?? {};
        const rollData = this.getRollData();
        const checkBonus = simplifyBonus(globalBonuses?.check, rollData);
        // @ts-expect-error no dnd5e-types
        if (this._prepareInitiative && this.system?.attributes)
            // @ts-expect-error no dnd5e-types
            this._prepareInitiative(rollData, checkBonus);
        // Apply special statuses that changed to active tokens
        let tokens;
        for (const [statusId, wasActive] of specialStatuses) {
            // @ts-expect-error no dnd5e-types
            const isActive = this.statuses.has(statusId) && !this.system.traits?.ci.value.has(statusId);
            if (isActive === wasActive)
                continue;
            if (!tokens)
                tokens = this.getActiveTokens();
            // @ts-expect-error protected
            for (const token of tokens)
                token._onApplyStatusEffect(statusId, isActive);
        }
        if (debugEnabled > 1)
            debug("prepare data: after passes", this);
        // Apply effects to items - moved after the rest of actor prepare data instead of default dnd5e behaviour
        for (let item of this.items) {
            _itemApplyActiveEffects.bind(item)();
        }
        // @ts-expect-error no dnd5e-types
        const conditionImmunities = this.system.traits?.ci?.value;
        if (conditionImmunities) {
            for (const condition of conditionImmunities)
                this.statuses.delete(condition);
        }
    }
    catch (err) {
        console.error("Could not prepare data ", this.name, err);
    }
}
const getTargetType = (field) => {
    // @ts-expect-error no dnd5e-types
    const FormulaField = game.system.dataModels.fields.FormulaField;
    // @ts-expect-error no dnd5e-types
    const ActiveEffect5eFormulaFields = CONFIG.ActiveEffect.documentClass.FORMULA_FIELDS;
    if ((field instanceof FormulaField) || ActiveEffect5eFormulaFields.has(field))
        return "formula";
    else if (field instanceof foundry.data.fields.ArrayField)
        return "Array";
    else if (field instanceof foundry.data.fields.ObjectField)
        return "Object";
    else if (field instanceof foundry.data.fields.BooleanField)
        return "boolean";
    else if (field instanceof foundry.data.fields.NumberField)
        return "number";
    else if (field instanceof foundry.data.fields.StringField)
        return "string";
};
function _baseItemApplyEffects() {
    // It seems that this is called with embedded preparation when first initialising and also when cloning.
    // Since we can't tell if it will later get called from prepareData the best we can do is apply all effects now
    return doItemApplyEffects.bind(this)(undefined, undefined, {});
    /*
    if (this.isOwned)
      return doItemApplyEffects.bind(this)(undefined, [...ValidSpec.itemSpecs["union"].derivedSpecKeys, ...ValidSpec.itemSpecs["union"].excludeKeys], {});
    else // item is a sidebar.compendium item so don't ignore anything
      return doItemApplyEffects.bind(this)(undefined, undefined, {});
    */
}
function _itemApplyActiveEffects() {
    // since baseItemApplyEffects will apply all effects we can't do it gain here
    return;
    // return doItemApplyEffects.bind(this)(ValidSpec.itemSpecs["union"].derivedSpecKeys, ValidSpec.itemSpecs["union"].excludeKeys, this.overrides ?? {});
}
function doItemApplyEffects(includeKeys, excludeKeys, overrides) {
    // @ts-expect-error no dnd5e-types
    if (this.actor?._embeddedPreparation) { // embedded preparation means this is only called once after actor preparation - so allow all effects to be applied 
        includeKeys = undefined;
        excludeKeys = undefined;
    }
    // Organize non-disabled changes by their application priority
    let changes = [];
    // @ts-expect-error no dnd5e-types
    for (const effect of this.allApplicableEffects()) {
        if (!effect.active)
            continue;
        let possibleChanges = effect.changes;
        if (includeKeys)
            possibleChanges = possibleChanges.filter(c => includeKeys?.includes(c.key));
        if (excludeKeys)
            possibleChanges = possibleChanges.filter(c => !excludeKeys?.includes(c.key));
        changes.push(...possibleChanges.map(change => {
            let field = change.key.startsWith("system.")
                // @ts-expect-error no dnd5e-types
                ? this.system.schema.getField(change.key.slice(7))
                : this.schema.getField(change.key);
            const targetType = getTargetType(field);
            const c = foundry.utils.deepClone(change);
            if (typeof c.value === "string" && this.actor?.items.has(this.id)) {
                const rollData = this.getRollData();
                // @ts-expect-error no dnd5e-types
                rollData.mod = rollData.abilities?.[this.abilityMod]?.mod ?? 0;
                if (targetType !== "formula" && targetType !== "string")
                    c.value = c.value.replaceAll("##", "@"); // can't defer this evaluation
                const unmapped = ["UUID", "uuid"];
                for (let unmap of unmapped) {
                    c.value = c.value.replaceAll(`@${unmap}`, `##${unmap}`);
                }
                if (!["Array", "Object", "formula", undefined].includes(targetType)) {
                    let expressionPre = Roll.replaceFormulaData(c.value, rollData, { missing: "0" });
                    const expression = DAESystemDND5E.safeEvalExpression(expressionPre, rollData);
                    let result = expression.replaceAll("##", "@");
                    if (targetType && ["boolean", "number"].includes(targetType)) {
                        result = DAESystemDND5E.safeEval(expression, rollData, expression) ?? expression;
                        if (typeof result === "string") {
                            c.value = result;
                        }
                        else if (targetType === "number") {
                            c.value = JSON.stringify(Number(result));
                        }
                        else if (targetType === "boolean") {
                            c.value = JSON.stringify(Boolean(result));
                        }
                    }
                    else
                        c.value = typeof result === "string" ? result : JSON.stringify(result);
                }
            }
            c.effect = effect;
            c.priority ??= c.mode * 10;
            return c;
        }));
    }
    changes.sort((a, b) => (a.priority ?? 10) - (b.priority ?? 10));
    // Apply all changes
    for (const change of changes) {
        if (!change.key)
            continue;
        // @ts-expect-error no dnd5e-types
        const changes = change.effect.apply(this, change);
        Object.assign(overrides, changes);
    }
    // Expand the set of final overrides
    // @ts-expect-error no dnd5e-types
    this.overrides = foundry.utils.expandObject(overrides);
}
function getRollData(wrapped, ...args) {
    // Can only have one getRollData wrapper so need call the parent one by hand
    const data = DAESystem.getRollDataFunc().bind(this)(wrapped, ...args);
    if (!data.flags) {
        data.flags = { ...this.flags };
    }
    data.effects = this.appliedEffects;
    data.actorId = this.id;
    data.actorUuid = this.uuid;
    data.statusesSet = this.statuses; //dnd5e now sets rollData.statuses to be an object indicating the count.
    // TODO see what config can be safely added without breaking item/actor sheets. data.config = CONFIG.DND5E;
    if (!data.token)
        Object.defineProperty(data, "token", {
            get() {
                if (!data._token) {
                    const actor = actorFromUuid(data.actorUuid ?? "");
                    const token = getSelfTarget(actor);
                    // If the return is a tokenDocument then we have no token on the scene
                    if (token instanceof foundry.canvas.placeables.Token)
                        data._token = token;
                }
                return data._token;
            },
            set(token) { data._token = token; }
        });
    if (!data.tokenUuid)
        Object.defineProperty(data, "tokenUuid", {
            get() {
                if (data._tokenUuid)
                    return data._tokenUuid;
                if (data.token instanceof foundry.canvas.placeables.Token)
                    return data.token?.document.uuid ?? "undefined";
                else
                    return data.token?.uuid ?? "undefined";
            },
            set(uuid) {
                data._tokenUuid = uuid;
            }
        });
    if (!data.tokenId)
        Object.defineProperty(data, "tokenId", {
            get() { return data._tokenId ?? data.token?.id ?? "undefined"; },
            set(tokenId) { data._tokenId = tokenId; }
        });
    return data;
}
async function preparePassiveSkills() {
    // @ts-expect-error no dnd5e-types
    const skills = this.system.skills;
    if (!skills)
        return;
    for (let skillId of Object.keys(skills)) {
        // @ts-expect-error no dnd5e-types
        const skill = this.system.skills[skillId];
        const abilityId = skill.ability;
        const advdisadv = procAdvantageSkill(this, abilityId, skillId);
        skill.passive = skill.passive + 5 * advdisadv;
    }
}
function simplifyBonus(bonus, data = {}) {
    if (!bonus)
        return 0;
    if (Number.isNumeric(bonus))
        return Number(bonus);
    try {
        const roll = new Roll(bonus, data);
        return roll.isDeterministic ? Roll.safeEval(roll.formula) : 0;
    }
    catch (error) {
        console.error(error);
        return 0;
    }
}
function procAdvantageSkill(actor, abilityId, skillId) {
    const midiFlags = actor.flags["midi-qol"] ?? {};
    const advantage = midiFlags.advantage ?? {};
    const disadvantage = midiFlags.disadvantage ?? {};
    let withAdvantage = advantage.all ?? false;
    let withDisadvantage = disadvantage.all ?? false;
    if (advantage.ability) {
        withAdvantage = withAdvantage || !!advantage.ability.all || !!advantage.ability.check?.all;
    }
    if (advantage.ability?.check) {
        withAdvantage = withAdvantage || advantage.ability.check[abilityId];
    }
    if (advantage.skill) {
        withAdvantage = withAdvantage || advantage.skill.all || advantage.skill[skillId];
    }
    if (disadvantage.ability) {
        withDisadvantage = withDisadvantage || !!disadvantage.ability.all || !!disadvantage.ability.check?.all;
    }
    if (disadvantage.ability?.check) {
        withDisadvantage = withDisadvantage || disadvantage.ability.check[abilityId];
    }
    if (disadvantage.skill) {
        withDisadvantage = withDisadvantage || disadvantage.skill.all || disadvantage.skill[skillId];
    }
    if ((withAdvantage && withDisadvantage) || (!withAdvantage && !withDisadvantage))
        return 0;
    else if (withAdvantage)
        return 1;
    else
        return -1;
}
async function _prepareActorArmorClassAttribution(wrapped, data) {
    let attributionHtml = await wrapped(data);
    const attributions = [];
    for (let effect of this.appliedEffects) {
        for (let change of effect.changes) {
            if ((change.key === "system.attributes.ac.value" || change.key === "system.attributes.ac.bonus" && !Number.isNumeric(change.value)) && !effect.disabled && !effect.isSuppressed) {
                attributions.push({
                    label: `${effect.name} (dae)`,
                    mode: change.mode,
                    value: change.value
                });
            }
        }
    }
    if (attributions.length > 0) {
        //@ts-expect-error no dnd5e-types
        const extraHtml = await new game.system.applications.PropertyAttribution(this, attributions, "attributes.ac", { title: "" }).renderTooltip();
        attributionHtml = attributionHtml = attributionHtml.replace(/<tr class="total">([\s\S]+?)<\/tbody>/, "</tbody>");
        attributionHtml += extraHtml;
    }
    return attributionHtml;
}
function patchPrepareArmorClassAttribution() {
    libWrapper.register("dae", "CONFIG.Actor.documentClass.prototype._prepareArmorClassAttribution", _prepareActorArmorClassAttribution, "WRAPPER");
}
export function getActorItemForEffect(effect) {
    if (effect.parent instanceof CONFIG.Item.documentClass && effect.parent.isEmbedded)
        return effect.parent;
    if (!effect.origin)
        return undefined;
    const parts = effect.origin?.split(".") ?? [];
    // e.g. `Actor.JUMlDngw2lHCQ1Bl.Item.Ra2Z1ujre76weR0i`
    const [parentType, parentId, documentType, documentId] = parts;
    let item;
    // Case 1: effect is a linked or sidebar actor - only if the actor ids match
    // During preparation effect.parent.id is undefined so we need to check for that
    if (parentType === "Actor" && documentType === "Item" && (!effect.parent?.id || parentId === effect.parent.id)) {
        item = effect.parent?.items.get(documentId);
    }
    // Case 2: effect is a synthetic actor on the scene - only if the token ids match
    else if (parentType === "Scene") {
        const itemUuid = effect.origin.replace(/\.ActiveEffect\..*$/, "");
        // e.g. `Scene.Ja8H26CItQOgMwAe.Token.XrkeZ1McpGkudBjA.Actor.o5nHP4ijq6K2OLJB.Item.fI8m07LnyCCdsSpn`
        const [_scene, _sceneId, _token, tokenId, _actor, _actorId, syntheticItem, syntheticItemId] = parts;
        if ((tokenId === effect.parent?.token?.id) && (syntheticItem === "Item"))
            item = effect.parent.items.get(syntheticItemId);
    }
    // Case 3: effect is a compendium item - only if the item id is present on the actor
    if (parentType === "Compendium") {
        let matches = effect.origin.match(/Compendium\.(.+)\.(.+?)Item\.(.+)/);
        if (matches && matches[3])
            item = effect.parent?.items.get(matches[3]);
    }
    return item;
}
// This can be removed (as well as all other `determineSuppression` stuff) once we hit a release which no longer
// supports 5.0.x
function determineSuppression(wrapped) {
    wrapped();
    // if (this.disabled) return; dnd5e does not do this check
    if (isEnchantment(this))
        return;
    // DND5e currently does not work with unlinked tokens and suppression determination so this is overridden
    // TODO make this a WRAPPER when dnd5e fixes the unlinked token bug
    let actor;
    if (this.parent instanceof CONFIG.Actor.documentClass)
        actor = this.parent;
    else if (this.parent instanceof CONFIG.Item.documentClass)
        actor = this.parent.parent;
    if (!actor)
        return;
    if (globalThis.MidiQOL && foundry.utils.getProperty(this, "flags.dae.disableIncapacitated")) {
        // if (actor) this.isSuppressed = actor.statuses.has("incapacitated");
        // @ts-expect-error old 5e weirdness
        this.isSuppressed = this.isSuppressed || globalThis.MidiQOL.checkIncapacitated(actor);
    }
    //TODO revisit when dnd5e is fixed. When can this actually happen? 
    // This is an actor effect and it's a transfer effect
    if (this.parent instanceof CONFIG.Actor.documentClass && effectIsTransfer(this)) {
        const item = getActorItemForEffect(this);
        // @ts-expect-error no dnd5e-types
        if (item)
            this.isSuppressed = this.isSuppressed || item.areEffectsSuppressed;
    }
    // @ts-expect-error no dnd5e-types
    if (actor.system.traits) {
        // @ts-expect-error no dnd5e-types
        let customStats = actor.system.traits.ci?.custom?.split(';').map(s => s.trim().toLocaleLowerCase());
        // @ts-expect-error no dnd5e-types
        const ci = new Set([...(actor.system.traits?.ci?.value ?? []), ...customStats]);
        const statusId = foundry.utils.duplicate(this.name ?? "no effect").toLocaleLowerCase();
        const capStatusId = foundry.utils.duplicate(statusId).replace(statusId[0], statusId[0].toUpperCase());
        const ciSuppressed = ci?.has(statusId) || ci?.has(`Convenient Effect: ${capStatusId}`);
        if (Boolean(ciSuppressed)) {
            // @ts-expect-error no dnd5e-types
            this.isSuppressed = true;
            // this.disabled = true;
        }
    }
}
function isSuppressed(wrapped) {
    let isSuppressed = wrapped();
    if (isSuppressed)
        return true;
    // If not on an actor, don't care to do more
    let actor;
    if (this.parent instanceof Actor)
        actor = this.parent;
    else if (this.parent instanceof Item)
        actor = this.parent.parent;
    if (!actor)
        return isSuppressed;
    // Check if actor incapacitated if effect should be suppressed for that
    if (globalThis.MidiQOL && this.flags?.dae?.disableIncapacitated) {
        isSuppressed ||= globalThis.MidiQOL.checkIncapacitated(actor);
    }
    // This is only relevant if legacyTransfer is true (not so for dnd5e) or legacy effects exist on the actor i.e. having hung around since before legacyTransfer got set to false in dnd
    // In the olden days transfer effects were created on the actor with dae setting a flag to indicate they are transfer effects
    if (this.parent instanceof Actor && effectIsTransfer(this)) {
        const item = getActorItemForEffect(this);
        // @ts-expect-error no dnd5e-types
        if (item)
            isSuppressed ||= item.areEffectsSuppressed;
    }
    // @ts-expect-error no dnd5e-types
    const ciTraits = actor.system.traits?.ci;
    // Suppress status conditions that the actor is immune to
    if (ciTraits) {
        const customStats = ciTraits.custom?.split(';').map(s => s.trim().toLocaleLowerCase());
        const ci = new Set([...(ciTraits.value ?? []), ...customStats]);
        const statusId = (this.name ?? "no effect").toLocaleLowerCase();
        isSuppressed ||= ci.has(statusId);
    }
    return isSuppressed;
}
function preUpdateItemHook(candidateItem, updates, context, userId) {
    if (!candidateItem.isOwned)
        return true;
    if (game.user?.id !== userId)
        return true;
    const actor = candidateItem.parent;
    if (!(actor instanceof Actor))
        return true;
    // @ts-expect-error no dnd5e-types
    if (updates.system?.equipped === undefined && updates.system?.attunement === undefined && updates.system?.attuned === undefined)
        return true;
    try {
        // @ts-expect-error no dnd5e-types
        const wasSuppressed = candidateItem.areEffectsSuppressed;
        const updatedItem = candidateItem.clone({
            // @ts-expect-error no dnd5e-types
            "system.equipped": updates.system?.equipped ?? candidateItem.system.equipped,
            // @ts-expect-error no dnd5e-types
            "system.attunement": updates.system?.attunement ?? candidateItem.system.attunement,
            // @ts-expect-error no dnd5e-types
            "system.attuned": updates.system?.attuned ?? candidateItem.system.attuned
        });
        // @ts-expect-error no dnd5e-types
        const isSuppressed = updatedItem.areEffectsSuppressed;
        if (wasSuppressed === isSuppressed)
            return true;
        const tokens = actor.getActiveTokens();
        if (CONFIG.ActiveEffect.legacyTransferral === false && candidateItem.isOwned && candidateItem.parent instanceof CONFIG.Actor.documentClass) {
            for (let effect of candidateItem.effects) {
                if (!effectIsTransfer(effect))
                    continue;
                const actor = candidateItem.parent;
                for (let change of effect.changes) {
                    if (isSuppressed) {
                        removeEffectChange(actor, tokens, effect, candidateItem, change, context);
                    }
                    else {
                        addEffectChange(actor, tokens, effect, candidateItem, change, context);
                    }
                }
            }
        }
        // For non-legacy transferral we need to update the actor effects
        for (let effect of actor.effects) {
            if (!effectIsTransfer(effect) || effect.origin !== candidateItem.uuid)
                continue;
            for (let change of effect.changes) {
                if (isSuppressed)
                    removeEffectChange(actor, tokens, effect, candidateItem, change, context);
                else
                    addEffectChange(actor, tokens, effect, candidateItem, change, context);
            }
            /*
            // Toggle macro.XX effects
            if (effect.changes.some(change => change.key.startsWith("macro.execute") || change.key.startsWith("macro.itemMacro") || change.key.startsWith("macro.actorUpdate")))
              foundry.utils.setProperty(effect, "flags.dae.itemUuid", candidateItem.uuid);
            */
            warn("action queue add suppressed ", actionQueue.remaining);
        }
    }
    catch (err) {
        console.warn("dae | preItemUpdate ", err);
    }
    finally {
        return true;
    }
}
if (!globalThis.daeSystems)
    globalThis.daeSystems = {};
foundry.utils.setProperty(globalThis.daeSystems, "dnd5e", DAESystemDND5E);
async function _onDropActiveEffect(event, data) {
    const effect = await ActiveEffect.implementation.fromDropData(data);
    if (!this.item.isOwner || !effect)
        return false;
    if ((this.item.uuid === effect.parent?.uuid) || (this.item.uuid === effect.origin))
        return false;
    return CONFIG.ActiveEffect.documentClass.create({
        ...effect.toObject(),
        origin: this.item.uuid
    }, { parent: this.item });
}
function daeApply(wrapped, actor, change) {
    try {
        const { key, value } = change;
        let originalReturn = wrapped(actor, change);
        // Intercept the dnd5e behaviour for custom mode flags.dnd5e boolean flags.
        if (change.mode !== 0 || !change.key.startsWith("flags.dnd5e."))
            return originalReturn;
        const data = DAESystemDND5E.systemConfig.characterFlags[key.replace("flags.dnd5e.", "")];
        if (data?.type !== Boolean)
            return originalReturn;
        // Need to avoid the dnd5e behaviour of "0" evaluating to true and forcing the change.value to a boolean
        change.value = value; // restore the original change value since dnd5e will have forced it to boolean.
        // ActiveEffect.apply will bypass the dnd5e apply
        return ActiveEffect.prototype.apply.bind(this)(actor, change);
    }
    catch (err) {
        console.error("dae | daeApply ", err, change, actor);
        throw err;
    }
}
