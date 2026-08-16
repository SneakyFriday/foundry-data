import { ceInterface, atlActive, daeSystemClass, getStatusEffectsArray, localizationMap } from "../dae.js";
import { i18n, daeSpecialDurations, daeMacroRepeats } from "../../dae.js";
import { ValidSpec } from "../Systems/DAESystem.js";
import { DAEFieldBrowser } from "./FieldBrowser.js";
export { BooleanFormulaField } from "./BooleanFormulaField.js";
export const otherFieldsMap = new Map();
export function addAutoFields(fields) {
    for (const field of fields) {
        const entry = typeof field === "string" ? { name: field } : field;
        if (!entry.name)
            continue;
        const existing = otherFieldsMap.get(entry.name);
        if (existing) {
            // Update type if a new type is provided for an existing entry
            if (entry.type !== undefined)
                existing.type = entry.type;
            continue;
        }
        otherFieldsMap.set(entry.name, entry);
    }
}
const fieldEditorRegistry = new Map();
export function registerFieldEditor(registration) {
    fieldEditorRegistry.set(registration.keyMatch, registration);
}
export function getFieldEditor(key) {
    // Exact match first
    if (fieldEditorRegistry.has(key))
        return fieldEditorRegistry.get(key);
    // Then prefix match — walk up the key segments
    const parts = key.split(".");
    while (parts.length > 1) {
        parts.pop();
        const prefix = parts.join(".") + ".";
        if (fieldEditorRegistry.has(prefix))
            return fieldEditorRegistry.get(prefix);
    }
    return undefined;
}
// Change keys whose values are always macro source / multi-line code. These render as a
// textarea regardless of the current value, so a freshly-imported multi-line macro is
// preserved even before it has a chance to be displayed.
const MULTILINE_CHANGE_KEYS = new Set([
    "flags.dae.macro.command",
    "flags.itemacro.macro.command",
    "flags.itemacro.macro.data.command",
]);
function isMultilineChangeValue(key, value) {
    if (MULTILINE_CHANGE_KEYS.has(key))
        return true;
    return typeof value === "string" && value.includes("\n");
}
const stackableOptions = {
    noneName: "dae.StackableOptions.noneName",
    noneNameOnly: "dae.StackableOptions.noneNameOnly",
    none: "dae.StackableOptions.none",
    multi: "dae.StackableOptions.multi",
    count: "dae.StackableOptions.count",
    countDeleteDecrement: "dae.StackableOptions.countDeleteDecrement"
};
export class DAEActiveEffectConfig extends foundry.applications.sheets.ActiveEffectConfig {
    ceEffectList = {};
    static #migratedEffects = new Set();
    constructor(options) {
        // @ts-expect-error v13 stubby
        super(options);
        this.tokenMagicEffects = {};
        if (globalThis.TokenMagic?.getPresets) {
            globalThis.TokenMagic.getPresets().forEach(preset => {
                this.tokenMagicEffects[preset.name] = preset.name;
            });
        }
        else
            this.tokenMagicEffects["invalid"] = "module not active";
        this.validSpecsToUse = ValidSpec.actorSpecs?.["union"];
        if (!this.validSpecsToUse) {
            ui.notifications?.error("DAE | No valid specs found");
            return;
        }
        daeSystemClass.configureLists();
        this.statusEffectList = {};
        getStatusEffectsArray()
            .filter(se => se.id)
            .map(se => ({ id: se.id, name: i18n(se.name) }))
            .toSorted((a, b) => a.name < b.name ? -1 : 1)
            .forEach(se => {
            this.statusEffectList[se.id] = se.name;
        });
        if (ceInterface) {
            ceInterface.findEffects().forEach(ceEffect => { this.ceEffectList[ceEffect.name] = ceEffect.name; });
        }
        if (atlActive && !isEnchantment(options.document)) {
            this.ATLPresets = {};
            game.settings.get("ATL", "presets").forEach(preset => this.ATLPresets[preset.name] = preset.name);
            Object.keys(CONFIG.Canvas.detectionModes).forEach(dm => {
                const name = `ATL.detectionModes.${dm}.range`;
                if (!otherFieldsMap.has(name)) {
                    otherFieldsMap.set(name, { name });
                }
            });
        }
        // visionMode picker — available for both ATL.sight.visionMode and the native token.sight.visionMode
        // regardless of ATL being installed. The token field is a plain StringField with no choices, so we
        // sourced the list from CONFIG.Canvas.visionModes (populated by Foundry core + system + modules).
        this.visionModeChoices = {};
        Object.values(CONFIG.Canvas.visionModes)
            .filter(f => f.tokenConfig)
            .forEach(f => this.visionModeChoices[f.id] = i18n(f.label));
        this.ATLVisionModes = this.visionModeChoices;
    }
    static DEFAULT_OPTIONS = {
        window: {
            resizable: true
        },
        position: {
            height: "auto",
            // The changes grid measures 968px at its minimum (400 key + 110 mode + 250 value + 96
            // phase + 60 priority + 16 controls, plus gaps and the header's scrollbar gutter), and the
            // window adds ~34px of chrome.
            width: 1010
        },
        classes: ["sheet", "active-effect-config", "window-app", "dae"],
        actions: {
            addSpecialDuration: DAEActiveEffectConfig.#onAddSpecialDuration,
            deleteSpecialDuration: DAEActiveEffectConfig.#onDeleteSpecialDuration,
            resetStartTime: DAEActiveEffectConfig.#onResetStartTime
        }
    };
    static PARTS = (() => {
        const parts = { ...super.PARTS };
        // Insert dae before footer so the tab renders above the submit button
        const footer = parts.footer;
        delete parts.footer;
        parts.dae = { template: "./modules/dae/templates/DAESheetConfig/DAE.hbs", scrollable: [""] };
        if (footer)
            parts.footer = footer;
        return parts;
    })();
    static TABS = {
        sheet: {
            tabs: [
                { id: "details", icon: "fa-solid fa-book", cssClass: "" },
                { id: "duration", icon: "fa-solid fa-clock", cssClass: "" },
                { id: "dae", icon: "fa-solid fa-wand-magic-sparkles", cssClass: "" },
                { id: "changes", icon: "fa-solid fa-gears", cssClass: "" }
            ],
            initial: "details",
            labelPrefix: "EFFECT.TABS"
        }
    };
    /* ----------------------------------------- */
    getOptionsForSpec(spec) {
        if (!spec?.key)
            return undefined;
        if (spec.key.includes("tokenMagic"))
            return this.tokenMagicEffects;
        if (spec.key === "macro.CE")
            return this.ceEffectList;
        if (spec.key === "macro.StatusEffect")
            return this.statusEffectList;
        if (spec.key === "StatusEffect")
            return this.statusEffectList;
        if (spec.key === "ATL.preset")
            return this.ATLPresets;
        if (spec.key === "ATL.sight.visionMode")
            return this.visionModeChoices;
        if (spec.key === "token.sight.visionMode")
            return this.visionModeChoices;
        return daeSystemClass.getOptionsForSpec(spec);
    }
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const document = this.document;
        if (document.parent instanceof CONFIG.Actor.documentClass || document instanceof CONFIG.Actor.documentClass) {
            this.validSpecsToUse = ValidSpec.actorSpecs[document.parent?.type ?? ""];
        }
        if (isEnchantment(document)) {
            document.transfer = false;
            // @ts-expect-error no dnd5e-types
            if (document.isAppliedEnchantment) {
                this.validSpecsToUse = ValidSpec.itemSpecs[document.parent?.type ?? ""] ?? ValidSpec.itemSpecs["union"];
            }
            else {
                let restrictionType = "union";
                if (document.parent instanceof CONFIG.Item.documentClass) {
                    // @ts-expect-error no dnd5e-types
                    const activity = document.parent.system.activities.find(a => a.type === "enchant" && a.effects.find(e => e.effect?.uuid === document?.uuid));
                    if (activity) {
                        restrictionType = activity.restrictions.type;
                    }
                    this.validSpecsToUse = ValidSpec.itemSpecs[restrictionType || "union"] ?? ValidSpec.itemSpecs["union"];
                }
            }
        }
        if (!this.validSpecsToUse) {
            ui.notifications?.error("DAE | No valid specs found");
            // Continue with an empty spec set so the sheet still renders - returning a half-built
            // context makes the details template part fail on the missing fields
            this.validSpecsToUse = { allSpecs: [], allSpecsObj: {} };
        }
        this.validFields = { "__": { name: "" } };
        this.validFields = this.validSpecsToUse.allSpecs
            .filter(e => e.fieldSpec.includes(""))
            .reduce((mods, em) => {
            mods[em.fieldSpec] = {
                name: localizationMap[em.fieldSpec]?.name ?? em.label,
                description: localizationMap[em.fieldSpec]?.description ?? em.description
            };
            return mods;
        }, this.validFields);
        if (!isEnchantment(document)) {
            for (let fieldName of [...otherFieldsMap.keys()].sort((a, b) => a.toLocaleLowerCase() < b.toLocaleLowerCase() ? -1 : 1)) {
                this.validFields[fieldName] = {
                    name: localizationMap[fieldName]?.name ?? fieldName,
                    description: localizationMap[fieldName]?.description || (localizationMap[fieldName]?.name ?? fieldName)
                };
            }
        }
        this.daeFieldBrowser = new DAEFieldBrowser(this.validFields, this);
        await this.daeFieldBrowser.init();
        if (document.flags?.dae?.specialDuration === undefined)
            foundry.utils.setProperty(document, "flags.dae.specialDuration", []);
        // One-time migrations — only run once per document per session
        if (!DAEActiveEffectConfig.#migratedEffects.has(document.uuid)) {
            DAEActiveEffectConfig.#migratedEffects.add(document.uuid);
            await this.#migrateDeprecatedData(document);
        }
        if (!document.flags?.dae?.stackable) {
            foundry.utils.setProperty(context, "effect.flags.dae.stackable", "multi");
        }
        await daeSystemClass.editConfig();
        // DAE-specific duration context:
        context.specialDuration = daeSpecialDurations;
        context.showSpecialDurations = Object.keys(daeSpecialDurations)?.length > 1;
        context.macroRepeats = daeMacroRepeats;
        context.stackableOptions = stackableOptions;
        context.expiryModeOptions = {
            "default": i18n("dae.expiryMode.default"),
            "delete": i18n("dae.expiryMode.delete"),
            "suppress": i18n("dae.expiryMode.suppress"),
        };
        if (document.parent) {
            context.isItemEffect = document.parent instanceof CONFIG.Item.documentClass;
            context.isActorEffect = document.parent instanceof CONFIG.Actor.documentClass;
        }
        context.submitText = "EFFECT.Submit";
        foundry.utils.setProperty(context.document, "flags.dae.durationExpression", document.flags?.dae?.durationExpression);
        if (!context.document.flags?.dae?.specialDuration)
            foundry.utils.setProperty(context.document.flags, "dae.specialDuration", []);
        context.sourceName = await document.sourceName;
        context.midiActive = globalThis.MidiQOL !== undefined;
        context.isEnchantment = isEnchantment(document);
        context.isConditionalActivationEffect = document.parent?.name === i18n("dae.ConditionalEffectsItem");
        context.transfer = document.transfer;
        if (context.isConditionalActivationEffect) {
            context.transfer = false;
            context.document.transfer = false;
        }
        return context;
    }
    async _preparePartContext(partId, context, options) {
        const partContext = await super._preparePartContext(partId, context, options);
        if (partId === "details") {
            if (partContext.isItemEffect && (isEnchantment(this.document) || this.document.parent?.name === i18n("dae.ConditionalEffectsItem")))
                partContext.isItemEffect = false;
        }
        return partContext;
    }
    async _renderChange(context) {
        const { change, index } = context;
        // Strip quotes that confuse DAE's selection process
        if (typeof change.value === "string") {
            change.value = change.value.replace(/^(["'])(.*)\1$/, "$2");
        }
        // Restrict change types if the spec has a forced mode
        const spec = this.validSpecsToUse?.allSpecsObj[change.key];
        if (spec?.forcedMode) {
            const numericToString = { 0: "custom", 1: "multiply", 2: "add", 3: "downgrade", 4: "upgrade", 5: "override" };
            const forcedMode = (typeof spec.forcedMode === "number" ? numericToString[spec.forcedMode] ?? "" : spec.forcedMode).toLowerCase();
            if (forcedMode) {
                const restrictedTypes = {};
                restrictedTypes[forcedMode] = context.changeTypes[forcedMode] ?? forcedMode;
                context.changeTypes = restrictedTypes;
                change.type = forcedMode;
            }
        }
        // Normalise change type to lowercase (v14 CHANGE_TYPES keys are lowercase)
        if (change.type && change.type !== change.type.toLowerCase())
            change.type = change.type.toLowerCase();
        // Replace value with a select if the spec provides options
        let options = spec?.options ?? this.getOptionsForSpec(change);
        // Set-backed if the spec's own field is a SetField (covers actor traits AND item/enchantment damage
        // types whose fields live on the item/activity schema), falling back to actor-schema resolution.
        const isSet = !!options && !spec?.forcedMode
            && ((spec?.fieldType instanceof foundry.data.fields.SetField) || isSetBackedKey(change.key, this.document));
        // Picker values: pin string fields to override (v14 default "add" would string-concat);
        // Set fields default to "add" with the type left unrestricted (override would wipe the Set).
        if (options && !spec?.forcedMode) {
            if (isSet) {
                if (!change.type)
                    change.type = "add";
            }
            else {
                change.type = "override";
                context.changeTypes = { override: context.changeTypes?.override ?? "override" };
            }
        }
        // traitList carries "-value" removal entries. Keep them for custom mode (DAE's doCustomArrayValue)
        // and for add mode: dnd5e's ActiveEffect.applyChange strips a leading "-" on Set traits and removes
        // the entry, and DAE delegates non-custom changes straight to it. Subtract (= Set difference) and
        // override (= replace) use bare values, so drop the "-value" entries there.
        if (isSet && options && change.type !== "custom" && change.type !== "add") {
            options = Object.fromEntries(Object.entries(options).filter(([v]) => !v.startsWith("-")));
        }
        // Get the base HTML from core
        // @ts-expect-error _renderChange not in fvtt-types yet
        const html = await super._renderChange(context);
        // Parse and inject DAE elements
        const template = document.createElement("template");
        template.innerHTML = html.trim();
        const li = template.content.firstElementChild;
        if (!li)
            return html;
        // Inject field info under the key input
        const keyDiv = li.querySelector("div.key");
        if (keyDiv) {
            const keyInput = keyDiv.querySelector("input");
            if (keyInput)
                keyInput.classList.add("dae-key-input");
            const fieldInfo = this.daeFieldBrowser?.getFieldInfo(change.key);
            const fieldName = fieldInfo?.name ?? change.key;
            const fieldDescription = fieldInfo?.description ?? "";
            const displayName = (fieldName === change.key && !change.key.startsWith("flags")) ? "<UNKNOWN>" : fieldName;
            const infoDiv = document.createElement("div");
            infoDiv.classList.add("dae-field-info");
            infoDiv.innerHTML = `<div class="dae-field-name">${displayName}</div><div class="dae-field-description">${fieldDescription}</div>`;
            keyDiv.appendChild(infoDiv);
        }
        // Replace value input with select if options exist
        const valueDiv = li.querySelector("div.value");
        if (valueDiv && options) {
            const existingInput = valueDiv.querySelector("input");
            if (existingInput) {
                const select = document.createElement("select");
                select.name = `system.changes.${index}.value`;
                select.dataset.dtype = "String";
                for (const [optValue, optLabel] of Object.entries(options)) {
                    const option = document.createElement("option");
                    option.value = optValue;
                    option.textContent = optLabel;
                    if (optValue === change.value)
                        option.setAttribute("selected", "selected");
                    select.appendChild(option);
                }
                existingInput.replaceWith(select);
            }
        }
        // Replace value <input> with a <textarea> for multi-line content. <input type="text">
        // strips newlines on render and on submit (per HTML spec), permanently corrupting
        // macro source on any sheet save. Triggered for known multi-line keys, or when the
        // current value already contains newlines.
        if (valueDiv && !options && isMultilineChangeValue(change.key, change.value)) {
            const existingInput = valueDiv.querySelector("input");
            if (existingInput) {
                const textarea = document.createElement("textarea");
                textarea.name = `system.changes.${index}.value`;
                textarea.dataset.dtype = "String";
                textarea.classList.add("dae-multiline-value");
                // Set textContent (not .value) — the rendered HTML is captured via outerHTML,
                // which serializes the textarea's child text node, not its .value property.
                textarea.textContent = change.value ?? "";
                existingInput.replaceWith(textarea);
            }
        }
        // Inject editor button next to value for keys that opted into a richer editor.
        if (valueDiv && !options) {
            const fieldEditor = getFieldEditor(change.key);
            if (fieldEditor) {
                const btn = document.createElement("a");
                btn.classList.add("dae-edit-value");
                btn.dataset.index = String(index);
                btn.dataset.tooltip = fieldEditor.tooltip ?? "Edit";
                btn.innerHTML = `<i class="${fieldEditor.icon ?? "fas fa-edit"}"></i>`;
                valueDiv.appendChild(btn);
            }
        }
        // Make the phase editable. Core renders it as a hidden input; replace it with a dropdown of the
        // valid phases (ActiveEffect.CHANGE_PHASES), defaulting to the ValidSpec phase for the key. The
        // chosen phase is written to change.phase and wins at runtime (see effectivePhase in dae.ts).
        const phaseInput = li.querySelector(`input[name="system.changes.${index}.phase"]`);
        if (phaseInput) {
            // @ts-expect-error CHANGE_PHASES not in fvtt-types yet
            const phases = CONFIG.ActiveEffect.documentClass.CHANGE_PHASES ?? {};
            // Until the effect is phase-stamped, change.phase is just the schema default ("initial"), so
            // default the dropdown to the ValidSpec phase. Once stamped, honor the authored change.phase.
            const stamped = !!this.document.flags?.dae?.phaseStamped;
            const selected = stamped ? (change.phase || spec?.phase || "initial")
                : (spec?.phase || change.phase || "initial");
            const entries = { ...phases };
            if (selected && !(selected in entries))
                entries[selected] = { label: selected }; // keep round-trippable
            const select = document.createElement("select");
            select.name = phaseInput.getAttribute("name");
            select.dataset.dtype = "String";
            for (const [val, info] of Object.entries(entries)) {
                const opt = document.createElement("option");
                opt.value = val;
                opt.textContent = info?.label ? i18n(info.label) : val;
                if (val === selected)
                    opt.setAttribute("selected", "selected");
                select.appendChild(opt);
            }
            const phaseDiv = document.createElement("div");
            phaseDiv.classList.add("phase");
            phaseDiv.dataset.tooltip = i18n("dae.Phase");
            phaseDiv.appendChild(select);
            phaseInput.replaceWith(phaseDiv);
        }
        return li.outerHTML;
    }
    updateFieldInfo() {
        // @ts-expect-error v14 system.changes
        const changes = this.document.system.changes;
        changes.forEach((change, index) => {
            const fieldInfo = this.daeFieldBrowser.getFieldInfo(change.key);
            const row = this.element?.querySelector(`li[data-index="${index}"]`);
            const fieldName = row?.querySelector(".dae-field-name");
            const fieldDescription = row?.querySelector(".dae-field-description");
            if (fieldName && fieldDescription) {
                fieldName.textContent = fieldInfo.name;
                fieldDescription.textContent = fieldInfo.description;
            }
        });
    }
    _onChangeForm(formConfig, event) {
        super._onChangeForm(formConfig, event);
        const target = event.target;
        // Re-render when a change's type flips so the value picker re-filters (e.g. "-value" removal
        // options are only offered in custom mode).
        if (target instanceof HTMLSelectElement && /^system\.changes\.\d+\.type$/.test(target.name)) {
            this.submit()?.then(() => this.render());
        }
    }
    async _onRender(context, options) {
        // @ts-expect-error wait 'til types de-stubs, then type this properly
        const currTabId = Object.values(context.tabs)?.find(i => i.active)?.id;
        if (currTabId !== "changes")
            this.position.height = this.element.offsetHeight ?? "auto";
        // Inject reset start time button into the core duration tab's start fieldset
        const startFieldset = this.element.querySelector('.tab[data-tab="duration"] fieldset.start-data');
        if (startFieldset) {
            const timeFields = startFieldset.querySelector(".form-fields");
            if (timeFields && !timeFields.querySelector('[data-action="resetStartTime"]')) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.classList.add("icon");
                btn.dataset.action = "resetStartTime";
                btn.dataset.tooltip = i18n("dae.resetStartTime");
                btn.innerHTML = '<i class="fas fa-clock-rotate-left"></i>';
                timeFields.appendChild(btn);
            }
        }
        // Add the Phase column header to the changes tab (each row gets a phase <select>; see _renderChange).
        // Inserted before .priority to match the row DOM order (key, type, value, phase, priority, controls).
        const changesHeader = this.element.querySelector('.tab[data-tab="changes"] header');
        if (changesHeader && !changesHeader.querySelector(".phase")) {
            const phaseHeader = document.createElement("div");
            phaseHeader.classList.add("phase");
            phaseHeader.textContent = i18n("dae.PhaseHeader");
            changesHeader.insertBefore(phaseHeader, changesHeader.querySelector(".priority"));
        }
        const keyInputs = Array.from(this.element.querySelectorAll(".dae-key-input"));
        for (const keyInput of keyInputs) {
            keyInput.addEventListener("click", this.#onKeyInputInteraction.bind(this));
            keyInput.addEventListener("input", this.#onKeyInputInteraction.bind(this));
        }
        const transferCheckBox = this.element.querySelector('input[name="transfer"]');
        transferCheckBox?.addEventListener("change", (event) => {
            this.submit()?.then(() => this.render());
        });
        new foundry.applications.ux.DragDrop.implementation({
            // dragSelector: ".dae-change-drag-handle",
            dropSelector: ".value",
            callbacks: {
                drop: this._onDrop.bind(this)
            }
        }).bind(this.element);
        // Pluggable editor buttons
        const editButtons = Array.from(this.element.querySelectorAll(".dae-edit-value"));
        for (const btn of editButtons) {
            btn.addEventListener("click", this.#onEditValue.bind(this));
        }
    }
    changeTab(tab, group, options) {
        if (tab === "changes") {
            // Keep the current height so the changes list can fill available space via flex
            super.changeTab(tab, group, options);
            return;
        }
        let autoPos = { ...this.position, height: "auto" };
        this.setPosition(autoPos);
        super.changeTab(tab, group, options);
        let newPos = { ...this.position, height: this.element.offsetHeight };
        this.setPosition(newPos);
    }
    #onKeyInputInteraction(event) {
        const input = event.currentTarget;
        this.daeFieldBrowser.setInput(input);
        if (event.type === "click") {
            this.daeFieldBrowser.updateBrowser();
        }
        else if (event.type === "input") {
            this.daeFieldBrowser.debouncedUpdateBrowser();
        }
    }
    onFieldSelected() {
        this.submit()?.then(() => this.render());
    }
    async #onEditValue(event) {
        const btn = event.currentTarget;
        const index = Number(btn.dataset.index);
        // @ts-expect-error v14 system.changes
        const change = this.document.system.changes[index];
        if (!change)
            return;
        const registration = getFieldEditor(change.key);
        if (!registration)
            return;
        // Read current value from the input (may have unsaved edits). Multi-line keys render
        // as a <textarea> instead of <input>.
        const valueInput = this.element.querySelector(`input[name="system.changes.${index}.value"], textarea[name="system.changes.${index}.value"]`);
        const currentValue = valueInput?.value ?? change.value ?? "";
        const result = await registration.editor(currentValue, {
            key: change.key,
            effect: this.document,
            parent: this.document.parent,
            changeIndex: index,
            app: this,
        });
        if (result !== null && result !== undefined) {
            if (valueInput)
                valueInput.value = result;
            this.submit()?.then(() => this.render());
        }
    }
    /* ----------------------------------------- */
    async _onDrop(ev) {
        ev.preventDefault();
        const data = foundry.applications.ux.TextEditor.getDragEventData(ev);
        const item = await fromUuid(data.uuid);
        const targetValue = ev.target?.value?.split(",")[1];
        if (data.uuid && ev.target) {
            ev.target.value = data.uuid + (targetValue ? `, ${targetValue}` : "");
            this.submit()?.then(() => this.render());
        }
        if (data.fieldName) {
            if (ev.target)
                ev.target.value = data.fieldName;
            this.daeFieldBrowser.debouncedUpdateBrowser();
        }
    }
    static #onAddSpecialDuration() {
        // @ts-expect-error v13 stubby
        const submitData = this._processFormData(null, this.form, new foundry.applications.ux.FormDataExtended(this.form));
        const specialDuration = Object.values(submitData.flags?.dae?.specialDuration ?? {});
        // @ts-expect-error v13 stubby
        return this.submit({
            updateData: {
                "flags.dae.specialDuration": specialDuration.concat("None")
            }
        });
    }
    static #onDeleteSpecialDuration(event) {
        // @ts-expect-error v13 stubby
        const submitData = this._processFormData(null, this.form, new foundry.applications.ux.FormDataExtended(this.form));
        const specialDuration = Object.values(submitData.flags?.dae?.specialDuration ?? {});
        const idx = Number(event.target.closest("li").dataset.index) || 0;
        specialDuration.splice(idx, 1);
        // @ts-expect-error v13 stubby
        return this.submit({
            updateData: {
                "flags.dae.specialDuration": specialDuration
            }
        });
    }
    static #onResetStartTime() {
        // @ts-expect-error v14 ActiveEffect.getEffectStart
        const start = ActiveEffect.getEffectStart(game.combat);
        // @ts-expect-error v13 stubby
        return this.submit({
            updateData: {
                start,
                "duration.expired": false
            }
        });
    }
    async _processSubmitData(event, form, submitData) {
        const document = this.document;
        if (!submitData.tint || submitData.tint === "")
            submitData.tint = null;
        // fixed for very old items
        if (document.origin?.includes("OwnedItem."))
            submitData.origin = document.origin.replace("OwnedItem.", "Item.");
        if (submitData.flags?.dae?.enableCondition?.length > 0)
            submitData.transfer = false;
        if (submitData.transfer && !isEnchantment(document))
            submitData.origin = document.parent?.uuid;
        else
            delete submitData.origin;
        if (isEnchantment(document))
            submitData.transfer = false;
        submitData.statuses ??= [];
        foundry.utils.setProperty(submitData, "flags.dae.specialDuration", Array.from(Object.values(submitData.flags?.dae?.specialDuration ?? {})));
        // Default the phase from the ValidSpec lookup when the change has no phase of its own, or when
        // the key was changed to a different field (adopt the new field's default phase — e.g. selecting a
        // derived key like system.abilities.cha.mod → "final"). A phase the author deliberately picked via
        // the dropdown for an unchanged key is preserved and wins at runtime (see effectivePhase in dae.ts).
        const changes = submitData.system?.changes;
        if (changes && this.validSpecsToUse?.allSpecsObj) {
            // @ts-expect-error v14 system.changes
            const oldChanges = this.document.system?.changes ?? [];
            // Only trust per-index key comparison when the row count is unchanged; add/delete re-indexes rows.
            const sameShape = Object.keys(changes).length === oldChanges.length;
            for (const [index, change] of Object.entries(changes)) {
                const spec = this.validSpecsToUse.allSpecsObj[change.key];
                if (!spec)
                    continue;
                const oldKey = sameShape ? oldChanges[index]?.key : undefined;
                const keyChanged = oldKey !== undefined && oldKey !== change.key;
                if (!change.phase || keyChanged)
                    change.phase = spec.phase;
            }
        }
        // Mark phases as authored: every change now carries an explicit phase (the phase dropdown), so
        // change.phase becomes authoritative at apply time — even a deliberate "initial" on a "final" key.
        foundry.utils.setProperty(submitData, "flags.dae.phaseStamped", true);
        await this.document.update(submitData);
    }
    /* ----------------------------------------- */
    async _preClose(options) {
        await super._preClose(options);
        if (this.daeFieldBrowser && this.daeFieldBrowser.browserElement) {
            this.daeFieldBrowser.browserElement.remove();
            this.daeFieldBrowser.browserElement = null;
        }
    }
    async #migrateDeprecatedData(document) {
        // Migrate deprecated special durations to v14 duration.expiry. dnd5e 6.0+ understands the same
        // source/target expiry names DAE uses (< 6.0), so one map serves both versions.
        const deprecatedSpecialDurMap = {
            "turnStart": "targetStart",
            "turnEnd": "targetEnd",
            "turnStartSource": "sourceStart",
            "turnEndSource": "sourceEnd",
            "combatEnd": "combatEnd"
        };
        const specialDurs = document.flags?.dae?.specialDuration ?? [];
        const deprecatedDurs = specialDurs.filter(sd => sd in deprecatedSpecialDurMap);
        const updateData = {};
        if (deprecatedDurs.length > 0) {
            const expiry = deprecatedSpecialDurMap[deprecatedDurs[0]];
            const remaining = specialDurs.filter(sd => !(sd in deprecatedSpecialDurMap));
            ui.notifications?.warn(`DAE | Effect "${document.name}": special duration "${deprecatedDurs.join(", ")}" is deprecated. Migrating to expiry: ${expiry}.`);
            updateData["flags.dae.specialDuration"] = remaining;
            updateData["duration.expiry"] = expiry;
        }
        // Migrate deprecated flags.dae.showIcon to native showIcon field
        if (document.flags?.dae?.showIcon) {
            foundry.utils.logCompatibilityWarning(`dae | Effect "${document.name}": flags.dae.showIcon is deprecated, auto-migrated to ActiveEffect.showIcon.`, { once: true, stack: false });
            updateData["showIcon"] = 2;
            updateData["flags.dae.-=showIcon"] = null;
        }
        if (Object.keys(updateData).length > 0) {
            await document.update(updateData);
        }
    }
}
export function geti18nTranslations() {
    let translations = game.i18n?.translations["dae"];
    // if (!translations) translations = game.i18n._fallback["dae"];
    return translations ?? {};
}
Hooks.once("setup", () => {
    foundry.applications.apps.DocumentSheetConfig.registerSheet(CONFIG.ActiveEffect.documentClass, "core", DAEActiveEffectConfig, {
        label: i18n("dae.EffectSheetLabel"),
        makeDefault: true,
        canBeDefault: true,
        canConfigure: true
    });
});
export function isEnchantment(effect) {
    //@ts-expect-error no dnd5e-types
    return effect.type === "enchantment";
}
// True if `key` resolves to a SetField on the real data model. DAE models these as StringField
// in its spec, so resolve from the actual model (preferring the effect's actor subtype).
function isSetBackedKey(key, doc) {
    if (!key.startsWith("system."))
        return false;
    const path = key.slice(7);
    const SetField = foundry.data.fields.SetField;
    const fieldFor = (type) => type ? CONFIG.Actor.dataModels[type]?.schema?.getField?.(path) : undefined;
    const parent = doc?.parent;
    const preferred = parent instanceof CONFIG.Actor.documentClass ? parent.type
        : parent instanceof CONFIG.Item.documentClass ? parent.actor?.type : undefined;
    let field = fieldFor(preferred);
    if (!field)
        for (const type of Object.keys(CONFIG.Actor.dataModels)) {
            field = fieldFor(type);
            if (field)
                break;
        }
    return field instanceof SetField;
}
