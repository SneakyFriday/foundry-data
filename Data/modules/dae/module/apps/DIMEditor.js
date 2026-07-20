import { debug } from "../../dae.js";
import { getItemMacroCommand } from "../dae.js";
var ApplicationV2 = foundry.applications.api.ApplicationV2;
var HandlebarsApplicationMixin = foundry.applications.api.HandlebarsApplicationMixin;
const WeirdIntermediate = HandlebarsApplicationMixin(ApplicationV2);
export class DIMEditor extends WeirdIntermediate {
    document; // could be an activity too
    initialCommand;
    editorName;
    editorImg;
    onSubmitCallback;
    onCancelCallback;
    submitted = false;
    static DEFAULT_OPTIONS = {
        classes: ["macro-config", "dimeditor"],
        tag: "form",
        window: {
            contentClasses: ["standard-form"],
            resizable: true
        },
        position: {
            width: 560,
            height: 480
        },
        form: {
            closeOnSubmit: true,
            handler: this.#processSubmitData
        }
    };
    static PARTS = {
        body: { template: "./modules/dae/templates/DIMEditor.hbs", root: true },
        footer: { template: "templates/generic/form-footer.hbs" }
    };
    constructor(options) {
        super(options);
        this.document = options.document;
        // Callback mode — operate on a value string instead of a document's flags.dae.macro.
        // When initialCommand is provided, getMacro returns a synthetic Macro and updateMacro
        // resolves via onSubmitCallback rather than writing to a document.
        this.initialCommand = options.initialCommand;
        this.editorName = options.name;
        this.editorImg = options.img;
        this.onSubmitCallback = options.onSubmit;
        this.onCancelCallback = options.onCancel;
    }
    _initializeApplicationOptions(options) {
        options = super._initializeApplicationOptions(options);
        const suffix = options.document?.uuid ?? options.uniqueIdSuffix ?? foundry.utils.randomID();
        options.uniqueId = `${this.constructor.name}-${suffix.replaceAll(".", "-")}`;
        return options;
    }
    async render(options) {
        Hooks.once("renderDIMEditor", (app, html, data, options) => {
            // Marked as any because technically they want an actual MacroConfig version of things
            Hooks.callAll("renderMacroConfig", app, html, data, options);
        });
        return super.render(options);
    }
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.editorLang = "javascript";
        context.macro = this.getMacro();
        context.macroSchema = Macro.schema;
        context.buttons = [{
                type: "submit", icon: "fa-solid fa-save", label: "MACRO.Save"
            }];
        return context;
    }
    static async #processSubmitData(_event, form) {
        const command = new foundry.applications.ux.FormDataExtended(form)?.get("command");
        await this.updateMacro(command);
    }
    async updateMacro(command) {
        if (this.onSubmitCallback) {
            this.submitted = true;
            this.onSubmitCallback(command);
            return;
        }
        let item = this.document;
        let macro = this.getMacro();
        debug("DIMEditor | updateMacro  | ", { command, item, macro });
        if (macro.command !== command) {
            await this.setMacro(new Macro({
                name: this.document.name,
                img: this.document.img,
                type: "script",
                scope: "global",
                command,
                author: game.user?.id,
                ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }
            }, {}));
        }
    }
    hasMacro() {
        if (this.initialCommand !== undefined)
            return !!this.initialCommand;
        return !!getItemMacroCommand(this.document);
    }
    getMacro() {
        if (this.initialCommand !== undefined) {
            return new Macro.implementation({
                name: this.editorName ?? "Macro",
                img: this.editorImg ?? "icons/svg/dice-target.svg",
                type: "script",
                scope: "global",
                command: this.initialCommand,
            }, {});
        }
        // @ts-expect-error `macroData` is on the Activity pseudo-document with midi installed
        if (globalThis.MidiQOL?.activityTypes && this.document?.macroData)
            return this.document.macro;
        let macroData = this.document.flags?.dae?.macro ?? this.document.flags?.itemacro?.macro;
        macroData = foundry.utils.mergeObject(macroData ?? {}, { img: this.document.img, name: this.document.name, scope: "global", type: "script" });
        debug("DIMEditor | getMacro | ", { macroData });
        return new Macro.implementation(macroData, {});
    }
    async setMacro(macro) {
        // @ts-expect-error `macroData` is on the Activity pseudo-document with midi installed
        if (this.document.macroData) {
            // @ts-expect-error `macroData` is on the Activity pseudo-document with midi installed
            await this.document.update({ "macroData.name": macro.name, "macroData.command": macro.command });
        }
        else if (macro instanceof Macro) {
            await this.document.setFlag?.("dae", "macro", macro.toObject());
        }
    }
    async _preClose(options) {
        await super._preClose(options);
        if (this.onCancelCallback && !this.submitted) {
            this.onCancelCallback();
        }
    }
}
