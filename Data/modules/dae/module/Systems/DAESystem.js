import { debug, debugEnabled, error, i18n, warn } from "../../dae.js";
import { applyDaeEffects, daeSystemClass, libWrapper, getToken, DAEReadyComplete, ceInterface } from "../dae.js";
const { ArrayField, BooleanField, NumberField, StringField } = foundry.data.fields;
export let wildcardEffects = [];
// TODO (Michael): Can this be removed entirely?
export let _characterSpec = { data: {}, flags: {} };
export class ValidSpec {
    //  static specs: {allSpecs: ValidSpec[], allSpecsObj: {}, baseSpecs: ValidSpec[], baseSpecsObj: {}, derivedSpecsObj: {}, derivedSpecs: ValidSpec[]}; 
    static actorSpecs;
    static itemSpecs;
    _fieldSpec;
    get fieldSpec() { return this._fieldSpec; }
    ;
    set fieldSpec(spec) { this._fieldSpec = spec; }
    _fieldType;
    get fieldType() { return this._fieldType; }
    set fieldType(value) { this._fieldType = value; }
    _label;
    get label() { return this._label; }
    set label(label) { this._label = label; }
    _description;
    get description() { return this._description; }
    set description(description) { this._description = description; }
    _forcedMode;
    get forcedMode() { return this._forcedMode; }
    set forcedMode(mode) { this._forcedMode = mode; }
    _options;
    get options() { return this._options; }
    set options(options) { this._options = options; }
    constructor(fs, sv, forcedMode = -1, label, description, options) {
        this._fieldSpec = fs;
        this._fieldType = sv;
        this._label = label ?? fs;
        this._description = description ?? "";
        this._forcedMode = forcedMode;
        this._options = options;
    }
    static createValidMods() {
        this.actorSpecs = {};
        const ACTIVE_EFFECT_MODES = CONST.ACTIVE_EFFECT_MODES;
        for (let specKey of Object.keys(CONFIG.Actor.dataModels)) {
            this.actorSpecs[specKey] = { allSpecs: [], allSpecsObj: {}, baseSpecs: [], baseSpecsObj: {}, derivedSpecsObj: {}, derivedSpecs: [] };
            _characterSpec["system"] = game.model ? foundry.utils.duplicate(game.model.Actor[specKey] ?? {}) : {};
            let baseValues = foundry.utils.flattenObject(_characterSpec);
            for (let prop in baseValues) {
                baseValues[prop] = [baseValues[prop], -1];
            }
            daeSystemClass.modifyBaseValues(specKey, baseValues, _characterSpec);
            Hooks.callAll("dae.modifyBaseValues", specKey, baseValues, _characterSpec);
            for (let key of Object.keys(baseValues)) {
                const baseValue = baseValues[key];
                if (typeof baseValue[0] === "string") {
                    console.warn("wrong baseValue", key, baseValue[0]);
                    baseValue[0] = new StringField({ initial: baseValue[0] });
                }
                if (typeof baseValue[0] === "number") {
                    console.warn("wrong baseValue", key, baseValue[0]);
                    baseValue[0] = new NumberField({ initial: baseValue[0] });
                }
                if (typeof baseValue[0] === "boolean") {
                    console.warn("wrong baseValue", key, baseValue[0]);
                    baseValue[0] = new BooleanField({ initial: baseValue[0] });
                }
            }
            // baseValues["items"] = ""; // TODO one day work this out.
            if (game.modules.get("gm-notes")?.active) {
                baseValues["flags.gm-notes.notes"] = [new StringField(), -1];
                baseValues["name"] = [new StringField(), -1];
                baseValues["system.att"];
            }
            let specials = {};
            if (ceInterface)
                specials["macro.CE"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
            specials["macro.StatusEffect"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
            specials["StatusEffect"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
            //specials["StatusEffectLabel"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
            //specials["StatusEffectName"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
            daeSystemClass.modifySpecials(specKey, specials, _characterSpec);
            Hooks.callAll("dae.modifySpecials", specKey, specials, _characterSpec);
            for (let key of Object.keys(specials)) {
                const special = specials[key];
                if (typeof special[0] === "string") {
                    console.warn("wrong special", key, special[0]);
                    special[0] = new StringField({ initial: special[0] });
                }
                if (typeof special[0] === "number") {
                    console.warn("wrong special", key, special[0]);
                    special[0] = new NumberField({ initial: special[0] });
                }
                if (typeof special[0] === "boolean") {
                    console.warn("wrong special", key, special[0]);
                    special[0] = new BooleanField({ initial: special[0] });
                }
            }
            specials["flags.dae.onUpdateTarget"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
            specials["flags.dae.onUpdateSource"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
            Object.keys(specials).forEach(key => {
                if (debugEnabled > 0 && baseValues[key])
                    console.log(`DAE | specials ${key} is already defined in baseValues - removing from baseValues`);
                delete baseValues[key];
            });
            // baseSpecs are all those fields defined in template.json game.model and are things the user can directly change
            this.actorSpecs[specKey].baseSpecs = Object.keys(baseValues).map(spec => {
                let validSpec = new ValidSpec(spec, baseValues[spec][0] ?? baseValues[spec], baseValues[spec][1], baseValues[spec][0]?.label, baseValues[spec][0]?.hint);
                validSpec = daeSystemClass.modifyValidSpec(spec, validSpec); // System specific modifations
                this.actorSpecs[specKey].baseSpecsObj[spec] = validSpec;
                return validSpec;
            });
            if (game.modules.get("tokenmagic")?.active) {
                specials["macro.tokenMagic"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
            }
            daeSystemClass.modifyDerivedSpecs(specKey, this.actorSpecs[specKey].derivedSpecs, _characterSpec);
            Hooks.callAll("dae.modifyDerivedSpecs", specKey, this.actorSpecs[specKey].derivedSpecs, _characterSpec);
            Object.entries(specials).forEach(special => {
                let validSpec = new ValidSpec(special[0], special[1][0], special[1][1], special[1][0].label, special[1][0].hint);
                this.actorSpecs[specKey].derivedSpecs.push(validSpec);
            });
            this.actorSpecs[specKey].baseSpecs = this.actorSpecs[specKey].baseSpecs.filter(m => m._fieldSpec !== "system");
            this.actorSpecs[specKey].allSpecs = this.actorSpecs[specKey].baseSpecs.concat(this.actorSpecs[specKey].derivedSpecs);
            // TODO come back and clean this up
            if (["dnd5e"].includes(game.system.id ?? "")) {
                // Special case for armor/hp which can depend on derived attributes - like dexterity mod or constitution mod
                // and initiative bonus depends on advantage on initiative
                this.actorSpecs[specKey].allSpecs.forEach(m => {
                    if (["attributes.hp", "attributes.ac"].includes(m._fieldSpec)) {
                        m._fieldType = 0;
                    }
                });
            }
            this.actorSpecs[specKey].allSpecs.sort((a, b) => { return a._fieldSpec.toLocaleLowerCase() < b._fieldSpec.toLocaleLowerCase() ? -1 : 1; });
            this.actorSpecs[specKey].baseSpecs.sort((a, b) => { return a._fieldSpec.toLocaleLowerCase() < b._fieldSpec.toLocaleLowerCase() ? -1 : 1; });
            this.actorSpecs[specKey].derivedSpecs.sort((a, b) => { return a._fieldSpec.toLocaleLowerCase() < b._fieldSpec.toLocaleLowerCase() ? -1 : 1; });
            this.actorSpecs[specKey].allSpecs.forEach(ms => this.actorSpecs[specKey].allSpecsObj[ms._fieldSpec] = ms);
            this.actorSpecs[specKey].baseSpecs.forEach(ms => this.actorSpecs[specKey].baseSpecsObj[ms._fieldSpec] = ms);
            this.actorSpecs[specKey].derivedSpecs.forEach(ms => this.actorSpecs[specKey].derivedSpecsObj[ms._fieldSpec] = ms);
            if (this.actorSpecs[specKey].allSpecsObj.system)
                delete this.actorSpecs[specKey].allSpecsObj.system;
        }
        let allSpecsObj = {};
        let baseSpecsObj = {};
        let derivedSpecsObj = {};
        for (let specKey of Object.keys(CONFIG.Actor.dataModels)) {
            Object.keys(this.actorSpecs[specKey].allSpecsObj).forEach(key => allSpecsObj[key] = this.actorSpecs[specKey].allSpecsObj[key]);
            Object.keys(this.actorSpecs[specKey].baseSpecsObj).forEach(key => baseSpecsObj[key] = this.actorSpecs[specKey].baseSpecsObj[key]);
            Object.keys(this.actorSpecs[specKey].derivedSpecsObj).forEach(key => derivedSpecsObj[key] = this.actorSpecs[specKey].derivedSpecsObj[key]);
        }
        this.actorSpecs["union"] = { allSpecs: [], allSpecsObj: {}, baseSpecs: [], baseSpecsObj: {}, derivedSpecsObj: {}, derivedSpecs: [] };
        this.actorSpecs["union"].allSpecsObj = allSpecsObj;
        this.actorSpecs["union"].baseSpecsObj = baseSpecsObj;
        this.actorSpecs["union"].derivedSpecsObj = derivedSpecsObj;
        this.actorSpecs["union"].allSpecs = Object.keys(this.actorSpecs["union"].allSpecsObj).map(k => this.actorSpecs["union"].allSpecsObj[k]);
        this.actorSpecs["union"].baseSpecs = Object.keys(this.actorSpecs["union"].baseSpecsObj).map(k => this.actorSpecs["union"].baseSpecsObj[k]);
        this.actorSpecs["union"].derivedSpecs = Object.keys(this.actorSpecs["union"].derivedSpecsObj).map(k => this.actorSpecs["union"].derivedSpecsObj[k]);
        this.actorSpecs["union"].allSpecs.sort((a, b) => { return a._fieldSpec.toLocaleLowerCase() < b._fieldSpec.toLocaleLowerCase() ? -1 : 1; });
        this.actorSpecs["union"].baseSpecs.sort((a, b) => { return a._fieldSpec.toLocaleLowerCase() < b._fieldSpec.toLocaleLowerCase() ? -1 : 1; });
        this.actorSpecs["union"].derivedSpecs.sort((a, b) => { return a._fieldSpec.toLocaleLowerCase() < b._fieldSpec.toLocaleLowerCase() ? -1 : 1; });
        this.itemSpecs = "getItemSpecs" in daeSystemClass ? daeSystemClass?.getItemSpecs() : {};
    }
    static localizeSpecs() {
        if (!ValidSpec.actorSpecs) {
            ValidSpec.createValidMods();
        }
        ;
        if (!ValidSpec.actorSpecs) {
            ui.notifications?.error("DAE | Initialisation failed - no specs defined");
            return;
        }
        for (let specKey of Object.keys(CONFIG.Actor.dataModels)) {
            if (!this.actorSpecs[specKey])
                continue; // not all of the actor types are defined in the system
            const fieldStart = `flags.${game.system.id}.`;
            this.actorSpecs[specKey].allSpecs = this.actorSpecs[specKey].allSpecs.map(m => {
                // Turns out the dnd5e field labels are not all that good.
                // if (false && (m.fieldType?.label ?? "") !== "") m._label = i18n(m.fieldType.label);
                // else {
                m._label = m._label.replace("data.", "").replace("system.", "").replace(`{game.system.id}.`, "").replace(".value", "").split(".").map(str => i18n(`dae.${str}`).replaceAll("dae.", "")).join(" ");
                if (m.fieldSpec.includes(`flags.${game.system.id}`)) {
                    const fieldId = m.fieldSpec.replace(fieldStart, "");
                    //@ts-expect-error no dnd5e-types
                    const characterFlags = game.system.config?.characterFlags ?? {};
                    const localizedString = i18n(characterFlags[fieldId]?.name) ?? i18n(`dae.${fieldId}`);
                    m._label = `Flags ${localizedString}`;
                }
                // }
                const saveBonus = m._fieldSpec.match(/^system.abilities.(\w\w\w).save$/);
                const checkBonus = m._fieldSpec.match(/^system.abilities.(\w\w\w).mod$/);
                const skillMod = m._fieldSpec.match(/^system.skills.(\w\w\w).mod$/);
                const skillPassive = m._fieldSpec.match(/^system.skills.(\w\w\w).passive$/);
                if (saveBonus)
                    m._label = `${m._label} (Deprecated)`;
                else if (checkBonus)
                    m._label = `${m._label} (Deprecated)`;
                else if (skillMod)
                    m._label = `${m._label} (Deprecated)`;
                else if (skillPassive)
                    m._label = `${m._label} (Deprecated)`;
                else if (m._fieldSpec === "StatusEffectLabel")
                    m._label = `${m._label} (Deprecated)`;
                else if (m._fieldSpec === "system.attributes.ac.value")
                    m._label = `${m._label} (Deprecated)`;
                else if (this.actorSpecs[specKey].derivedSpecsObj[m._fieldSpec])
                    m._label = `${m._label ? m._label : m._fieldSpec} (*)`;
                return m;
            });
        }
        for (let specKey of Object.keys(this.itemSpecs)) {
            for (let m of this.itemSpecs[specKey].allSpecs) {
                const fieldStart = `flags.${game.system.id}.`;
                // Turns out the dnd5e field labels are not all that good.
                if (m.fieldType instanceof foundry.data.fields.DataField && (m.fieldType?.label ?? "") !== "")
                    m.label = i18n(m.fieldType.label);
                else {
                    m.label = m.label.replace("data.", "").replace("system.", "").replace(`{game.system.id}.`, "").replace(".value", "").split(".").map(str => i18n(`dae.${str}`).replaceAll("dae.", "")).join(" ");
                    if (m.fieldSpec.includes(`flags.${game.system.id}`)) {
                        const fieldId = m.fieldSpec.replace(fieldStart, "");
                        // @ts-expect-error no dnd5e-types
                        const characterFlags = game.system.config?.characterFlags ?? {};
                        const localizedString = i18n(characterFlags[fieldId]?.name) ?? i18n(`dae.${fieldId}`);
                        m.label = `Flags ${localizedString}`;
                    }
                }
                const saveBonus = m.fieldSpec.match(/^system.abilities.(\w\w\w).save$/);
                const checkBonus = m.fieldSpec.match(/^system.abilities.(\w\w\w).mod$/);
                const skillMod = m.fieldSpec.match(/^system.skills.(\w\w\w).mod$/);
                const skillPassive = m.fieldSpec.match(/^system.skills.(\w\w\w).passive$/);
                if (saveBonus)
                    m.label = `${m.label} (Deprecated)`;
                else if (checkBonus)
                    m.label = `${m.label} (Deprecated)`;
                else if (skillMod)
                    m.label = `${m.label} (Deprecated)`;
                else if (skillPassive)
                    m.label = `${m.label} (Deprecated)`;
                else if (m.fieldSpec === "StatusEffectLabel")
                    m.label = `${m.label} (Deprecated)`;
                else if (m.fieldSpec === "system.attributes.ac.value")
                    m.label = `${m.label} (Deprecated)`;
                else if (this.itemSpecs[specKey].derivedSpecsObj[m.fieldSpec])
                    m.label = `${m.label} (*)`;
                let newOptions = m.options;
                // @ts-expect-error TODO (Michael): is this actually possible?
                if (!newOptions && typeof m.options === "string")
                    newOptions = i18n(m.options);
                m.options = newOptions;
                m.label = i18n(m.label ?? "");
            }
        }
    }
}
function getRollData(wrapped, ...args) {
    // need to be careful - default foundry getRollData() returns the "live" actor.system
    return wrapped(...args);
}
export class DAESystem {
    static spellAttacks;
    static weaponAttacks;
    static attackTypes;
    static bonusSelectors;
    static daeActionTypeKeys;
    static detectionModeList;
    static fieldMappings = {};
    static get systemConfig() {
        //@ts-expect-error no dnd5e-types
        return game.system.config;
    }
    static getActorDataModelFields(actorType) {
        return CONFIG.Actor.dataModels[actorType]?.schema?.fields;
    }
    static getRollDataFunc() {
        return getRollData;
    }
    /**
     * accepts a string field specification, e.g. system.traits.languages.value. Used extensively in ConfigPanel.ts
     * return an object or false.
     * Keys are valid options for the field specification and the value is the user facing text for that option
     * e.g. {common: "Common"}
     * */
    static getOptionsForSpec(specification) {
        if (!specification?.key)
            return undefined;
        if (specification?.key === "ATE.detectionMode") {
            return this.detectionModeList;
        }
        return undefined;
    }
    // Configure any lookup lists that might be required by getOptionsForSpec.
    static configureLists() {
        this.detectionModeList = {};
        Object.values(CONFIG.Canvas.detectionModes).forEach(dm => {
            this.detectionModeList[dm.id] = i18n(`${dm.label}`);
        });
    }
    static async editConfig() {
        return;
    }
    static modifyBaseValues(actorType, baseValues, characterSpec) {
    }
    ;
    static modifySpecials(actorType, specials, characterSpec) {
        const ACTIVE_EFFECT_MODES = CONST.ACTIVE_EFFECT_MODES;
        specials["macro.execute"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["macro.execute.local"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["macro.execute.GM"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["macro.itemMacro"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["macro.itemMacro.local"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["macro.itemMacro.GM"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["macro.actorUpdate"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["macro.createItem"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["macro.createItemRunMacro"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        // specials["macro.createToken"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
    }
    ;
    static modifyDerivedSpecs(actorType, derivedSpecs, characterSpec) {
    }
    static effectDisabled(actor, effect, itemData = null) {
        return effect.disabled;
    }
    static modifyValidSpec(spec, validSpec) {
        return validSpec;
    }
    // TODO (Michael): Is this used anywhere?
    static doCustomValue(actor, current, change, validValues) {
        if ((current || []).includes(change.value))
            return true;
        if (!validValues.includes(change.value))
            return true;
        foundry.utils.setProperty(actor, change.key, current.concat([change.value]));
        return true;
    }
    static doCustomArrayValue(actor, current, change, validValues) {
        if (current instanceof Array) {
            if (foundry.utils.getType(change.value) === "string" && change.value[0] === "-") {
                const checkValue = change.value.slice(1);
                const currentIndex = (current ?? []).indexOf(checkValue);
                if (currentIndex === -1)
                    return true;
                if (!validValues?.includes(checkValue))
                    return true;
                const returnValue = foundry.utils.duplicate(current);
                returnValue.splice(currentIndex, 1);
                foundry.utils.setProperty(actor, change.key, returnValue);
            }
            else {
                if ((current ?? []).includes(change.value))
                    return true;
                if (!validValues?.includes(change.value))
                    return true;
                foundry.utils.setProperty(actor, change.key, current.concat([change.value]));
            }
        }
        else if (current instanceof Set) {
            if (foundry.utils.getType(change.value) === "string" && change.value[0] === "-") {
                const checkValue = change.value.slice(1);
                if (!current.has(checkValue))
                    return true;
                if (validValues && !validValues.includes(checkValue))
                    return true;
                const returnValue = foundry.utils.deepClone(current);
                returnValue.delete(checkValue);
                foundry.utils.setProperty(actor, change.key, returnValue);
            }
            else {
                // if ((current ?? new Set()).has(change.value)) return true;
                let returnValue = new Set(current ?? []);
                // Avoid problem with current custom changes setting return value to undefined if no changes made
                // if (validValues && !validValues.includes(change.value)) return true;
                returnValue.add(change.value);
                foundry.utils.setProperty(actor, change.key, returnValue);
            }
        }
        return true;
    }
    static initSystemData() {
        this.spellAttacks = [];
        this.weaponAttacks = [];
        this.attackTypes = [];
        this.bonusSelectors = {};
        this.daeActionTypeKeys = [];
    }
    static addDAEMetaData(activeEffectData, item, options) {
        if (!fromUuidSync(item.uuid))
            foundry.utils.setProperty(activeEffectData, "flags.dae.itemData", item.toObject(false));
        foundry.utils.setProperty(activeEffectData, "flags.dae.transfer", false);
        if (options.metaData)
            foundry.utils.mergeObject(activeEffectData, options.metaData);
    }
    static getAttributeValue(documentRef, attribute) {
        let actor;
        // TODO: Type this better
        let value = "";
        if (typeof (documentRef) == 'string') {
            function getActor(doc, nesting = 0, maxDepth = 3) {
                nesting++;
                if (nesting > maxDepth)
                    return undefined;
                if (doc instanceof Actor)
                    return doc;
                else if ((doc instanceof foundry.canvas.placeables.Token || doc instanceof Item) && doc.actor)
                    return doc.actor;
                else if ((doc instanceof ActiveEffect) && doc.parent)
                    return getActor(doc.parent, nesting);
                else
                    return undefined;
            }
            const doc = fromUuidSync(documentRef);
            actor = getActor(doc);
            if (actor)
                value = foundry.utils.getProperty(actor, `${attribute}`) ?? null;
        }
        return value;
    }
    static safeEval(expression, sandbox, onErrorReturn = undefined) {
        let result;
        const preSetupError = "MidiQOL or fromUuidSync used before setup complete";
        try {
            const src = 'with (sandbox) { return ' + expression + '}';
            const evl = new Function('sandbox', src);
            sandbox = foundry.utils.mergeObject(sandbox, { Roll });
            sandbox = foundry.utils.mergeObject(sandbox, { fromUuidSync, getToken, getAttributeValue: this.getAttributeValue, MidiQOL: globalThis.MidiDAEEval ?? {} });
            if (!DAEReadyComplete && typeof expression === "string" && (expression.includes("fromUuidSync") || expression.includes("MidiQOL"))) {
                throw new Error(preSetupError);
            }
            const sandboxProxy = new Proxy(sandbox, {
                has: () => true, // Include everything
                get: (t, k) => k === Symbol.unscopables ? undefined : (t[k] ?? Math[k]),
                set: () => false && console.error("You may not set properties of the sandbox environment") // No-op
            });
            result = evl(sandboxProxy);
        }
        catch (err) {
            const message = `dae | safeEval | expression evaluation failed ${expression}`;
            if (err.message === preSetupError) {
                console.warn(message, err);
                warn(message, preSetupError);
            }
            else {
                console.warn(message, err);
                console.warn(`Actor: ${sandbox.name} ${sandbox.actorUuid}`);
                if (sandbox.item)
                    console.warn(`Item: ${sandbox.item.name} ${sandbox.item.itemUuid}`);
            }
            result = onErrorReturn;
        }
        if (Number.isNumeric(result))
            return Number(result);
        if (Number.isNaN(result))
            result = onErrorReturn;
        return result;
    }
    static safeEvalExpression(input, context, depth = 0) {
        if (typeof input !== "string")
            return input;
        input = Roll.replaceFormulaData(input, context);
        let validFunctionName = /^[a-zA-Z_$][0-9a-zA-Z_$.?]*$/; // regex for valid JS function name
        if (depth > 20) {
            console.error("It's turtles all the way down....");
            return input;
        }
        let stack = [];
        let output = '';
        let temp;
        let functionStack = []; // additional stack for function name
        for (let char of input) {
            if (char === '(') {
                let funcName = '';
                while (stack.length > 0 && /[a-zA-Z_$0-9.?]/.test(stack[stack.length - 1])) {
                    funcName = stack.pop() + funcName;
                }
                // if (Math[funcName]) funcName = funcName = `Math.${funcName}`; - the proxy will look in Math if not found elsewhere
                if (!validFunctionName.test(funcName) && funcName.length > 0) {
                    throw new Error(`Invalid function name: ${funcName}`);
                }
                functionStack.push(funcName);
                stack.push('(');
            }
            else if (char === ')') {
                temp = '';
                let poppedChar;
                // Pop elements from the stack until we find the matching opening parenthesis
                while ((poppedChar = stack.pop()) !== '(') {
                    temp = poppedChar + temp;
                }
                // Pop the function name
                let funcName = functionStack.pop();
                // Evaluate the function call
                if (funcName === "dae.eval")
                    stack.push(`${this.safeEval(this.safeEvalExpression(temp, context, depth + 1), context)}`);
                else if (funcName === "dae.roll") {
                    try {
                        error(`%c dae.roll in ${input} is not supported in expression ${input} in foundry version 12 and has been discarded`, "color: red", context.name, context.actorUuid);
                        stack.push(this.safeEval("0", context)); // v12 does not support synchronous dice rolling)
                    }
                    catch (err) {
                        console.warn(`dae | dae.roll bad dice expression ${temp}`, err);
                        stack.push(0);
                    }
                }
                else if (depth) {
                    const expression = `${funcName}(${this.safeEvalExpression(temp, context, depth + 1)})`;
                    stack.push(`${this.safeEval(expression, context)}`);
                }
                else
                    stack.push(`${funcName}(${temp})`);
            }
            else {
                stack.push(char);
            }
        }
        output = stack.join('');
        return output; // depth ? this.safeEval(output, context) : output;
    }
    static daeCustomEffect(actor, change, _current, _delta, _changes) {
        if (typeof change.value === "string" && (change.value?.includes("dae.eval(") || change.value?.includes("dae.roll("))) {
            const context = actor.getRollData();
            context.actor = actor;
            change.value = this.safeEvalExpression(change.value, context, 0);
            foundry.utils.setProperty(actor, change.key, change.value);
        }
        if (change.key === "flags.dae.onUpdateTarget" && change.value?.includes(",")) {
            const values = change.value.split(",").map(str => str.trim());
            if (values.length < 5) {
                error("custom effect flags.dae.onUpdateTarget details incomplete", values);
                return;
            }
            const origin = values[0];
            const targetTokenUuid = values[1];
            const sourceTokenUuid = values[2];
            const sourceActorUuid = values[3];
            const flagName = values[4];
            const macroName = ["none", ""].includes(values[5] ?? "") ? "" : values[5];
            const filter = ["none", ""].includes(values[6] ?? "") ? "system" : values[6];
            ;
            const args = values.slice(7);
            let flagValue = actor.flags?.dae?.onUpdateTarget ?? [];
            flagValue.push({ flagName, macroName, origin, sourceTokenUuid, args, targetTokenUuid, filter, sourceActorUuid });
            foundry.utils.setProperty(actor, "flags.dae.onUpdateTarget", flagValue);
        }
        return true;
    }
    /*
    * replace the default actor prepareData
    * call applyDaeEffects
    * add an additional pass after derivfed data
    */
    static initActions() {
        Hooks.callAll("dae.addFieldMappings", this.fieldMappings);
        // We will call this in prepareData
        libWrapper.register("dae", "CONFIG.Actor.documentClass.prototype.applyActiveEffects", applyBaseActiveEffects, "OVERRIDE");
        // Might have to be tailored to other systems.
        libWrapper.register("dae", "CONFIG.Actor.documentClass.prototype.prepareData", prepareData, "WRAPPER");
        // This supplies DAE custom effects
        // @ts-expect-error our custom stuff in the change data makes types angry
        Hooks.on("applyActiveEffect", daeSystemClass.daeCustomEffect.bind(daeSystemClass));
    }
    static readyActions() {
    }
    static setupActions() {
    }
}
// this function replaces applyActiveEffects in Actor
function applyBaseActiveEffects() {
    applyDaeEffects.bind(this)({ specList: ValidSpec.actorSpecs[this.type].baseSpecsObj, excludeSpecs: ValidSpec.actorSpecs[this.type].derivedSpecsObj, allowAllSpecs: true, wildCardsInclude: wildcardEffects, wildCardsExclude: [], doStatusEffects: true });
}
/*
* replace the default actor prepareData
* call applyDaeEffects
* add an additional pass after derivfed data
*/
function prepareData(wrapped) {
    if (!ValidSpec.actorSpecs) {
        ValidSpec.createValidMods();
    }
    this.statuses ??= new Set();
    // Identify which special statuses had been active
    const specialStatuses = new Map();
    for (const statusId of Object.values(CONFIG.specialStatusEffects)) {
        specialStatuses.set(statusId, this.statuses.has(statusId));
    }
    this.statuses.clear(); // need to do this here since core foundry does this in applyActiveEffects, but we do multiple calls to applyEffects
    foundry.utils.setProperty(this, "flags.dae.onUpdateTarget", foundry.utils.getProperty(this._source, "flags.dae.onUpdateTarget"));
    debug("prepare data: before passes", this.name, this._source);
    this.overrides = {};
    wrapped();
    // Add an extra pass after prepareData has completed for "specials" to be applied
    applyDaeEffects.bind(this)({ specList: ValidSpec.actorSpecs[this.type].derivedSpecsObj, excludeSpecs: ValidSpec.actorSpecs[this.type].baseSpecsObj, allowAllSpecs: true, wildCardsInclude: [], wildCardsExclude: wildcardEffects, doStatusEffects: true });
    let tokens;
    for (const [statusId, wasActive] of specialStatuses) {
        const isActive = this.statuses.has(statusId);
        if (isActive === wasActive)
            continue;
        if (!tokens)
            tokens = this.getActiveTokens();
        // @ts-expect-error protected - do we need this?
        for (const token of tokens)
            token._onApplyStatusEffect(statusId, isActive);
    }
    //TODO find another way to tdo this
    // this._prepareOwnedItems(this.items)
    debug("prepare data: after passes", this);
}
foundry.utils.setProperty(globalThis, "CONFIG.DAE.systemClass", DAESystem);
Hooks.on("dae.modifySpecials", (specKey, specials, characterSpec) => {
    const ACTIVE_EFFECT_MODES = CONST.ACTIVE_EFFECT_MODES;
    if (game.modules.get("ATL")?.active) {
        for (let label of ["dimSight", "brightSight"]) {
            specials[`ATL.${label}`] = [new NumberField(), -1];
        }
        specials["ATL.alpha"] = [new NumberField(), -1];
        specials["ATL.elevation"] = [new NumberField(), -1];
        specials["ATL.height"] = [new NumberField(), -1];
        specials["ATL.width"] = [new NumberField(), -1];
        specials["ATL.hidden"] = [new BooleanField(), -1];
        specials["ATL.rotation"] = [new NumberField(), -1];
        specials["ATL.light.animation"] = [new StringField(), -1]; //{intensity: 1:10, reverse: true/false, speed: 1:10, type: "X"}	Light Animation settings, see below for Animation Types
        specials["ATL.light.alpha"] = [new NumberField(), -1];
        specials["ATL.light.angle"] = [new NumberField(), -1];
        specials["ATL.light.attenuation"] = [new NumberField(), -1];
        specials["ATL.light.bright"] = [new NumberField(), -1];
        specials["ATL.light.color"] = [new NumberField(), -1];
        specials["ATL.light.coloration"] = [new NumberField(), -1];
        specials["ATL.light.contrast"] = [new NumberField(), -1];
        specials["ATL.light.dim"] = [new NumberField(), -1];
        specials["ATL.light.luminosity"] = [new NumberField(), -1];
        specials["ATL.light.saturation"] = [new NumberField(), -1];
        specials["ATL.light.shadows"] = [new NumberField(), -1];
        specials["ATL.light.darkness.max"] = [new NumberField(), -1];
        specials["ATL.light.darkness.min"] = [new NumberField(), -1];
        // detection modes are set in "ready" hook to allow for detection mode configuration
        specials["ATL.sight.visionMode"] = [new StringField(), 0]; // selection list
        specials["ATL.light.animation"] = [new StringField(), -1]; // json string
        specials["ATL.preset"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
        specials["ATL.sight.angle"] = [new NumberField(), -1];
        specials["ATL.sight.attenuation"] = [new NumberField(), -1];
        specials["ATL.sight.brightness"] = [new NumberField(), -1];
        specials["ATL.sight.contrast"] = [new NumberField(), -1];
        specials["ATL.sight.enabled"] = [new NumberField(), -1];
        specials["ATL.sight.range"] = [new NumberField(), -1];
        specials["ATL.sight.saturation"] = [new NumberField(), -1];
        specials["ATL.sight.color"] = [new StringField(), 0 - 1];
        specials["ATL.preset"] = [new StringField(), ACTIVE_EFFECT_MODES.CUSTOM];
    }
});
