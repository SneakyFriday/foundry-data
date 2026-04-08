// Import TypeScript modules
import { registerSettings } from './module/settings.js';
import { preloadTemplates } from './module/preloadTemplates.js';
import { daeSetupActions, daeInitActions, fetchParams } from "./module/dae.js";
import { daeReadyActions } from "./module/dae.js";
import { setupSocket } from './module/GMAction.js';
import { setupPatching, initPatching } from './module/patching.js';
import API from './module/API/api.js';
import { addAutoFields, BooleanFormulaField } from './module/apps/DAEActiveEffectConfig.js';
export let debugEnabled;
export let setDebugLevel = (debugText) => {
    debugEnabled = { "none": 0, "warn": 1, "debug": 2, "all": 3 }[debugText] || 0;
    // 0 = none, warnings = 1, debug = 2, all = 3
    if (debugEnabled >= 3)
        CONFIG.debug.hooks = true;
};
// 0 = none, warnings = 1, debug = 2, all = 3
export let debug = (...args) => { if (debugEnabled > 1)
    console.log("DEBUG: dae | ", ...args); };
export let log = (...args) => console.log("dae | ", ...args);
export let warn = (...args) => { if (debugEnabled > 0)
    console.warn("dae | ", ...args); };
export let error = (...args) => console.error("dae | ", ...args);
export let timelog = (...args) => warn("dae | ", Date.now(), ...args);
export function i18n(key) {
    return game.i18n?.localize(key) ?? key;
}
;
export function i18nFormat(key, data) {
    return game.i18n?.format(key, data) ?? key;
}
export let gameSystemCompatible = "maybe"; // no, yes, maybe
export let daeUntestedSystems;
export const MODULE_ID = "dae";
/* ------------------------------------ */
/* Initialize module					*/
/* ------------------------------------ */
Hooks.once('init', () => {
    // CONFIG.ActiveEffect.legacyTransferral = false;
    debug('Init setup actions');
    const systemDaeFlag = game.system.flags?.daeCompatible;
    if (["dnd5e"].includes(game.system.id) || systemDaeFlag === true)
        gameSystemCompatible = "yes";
    else if (["pf2e"].includes(game.system.id) || systemDaeFlag === false)
        gameSystemCompatible = "no";
    if (gameSystemCompatible === "no") {
        console.error(`DAE is not compatible with ${game.system.title} - module disabled`);
    }
    else {
        registerSettings();
        daeUntestedSystems = game.settings.get("dae", "DAEUntestedSystems") === true;
        if (gameSystemCompatible === "yes" || daeUntestedSystems) {
            if (gameSystemCompatible === "maybe")
                console.warn(`DAE compatibility warning for ${game.system.title}: not tested with DAE`);
            daeInitActions();
            initPatching();
            fetchParams();
            // Preload Handlebars templates - async but no use awaiting
            preloadTemplates();
        }
    }
    ;
    // Fire during init so modules can register typed auto-fields before initializeDocuments()
    // (which runs between init and setup and prepares actors).
    // addAutoFields only pushes to an array and has no game-state dependencies.
    const FormulaField = globalThis.dnd5e?.dataModels?.fields?.FormulaField;
    Hooks.callAll("dae.addAutoFields", addAutoFields, {
        BooleanFormulaField,
        FormulaField,
        NumberField: foundry.data.fields.NumberField,
        StringField: foundry.data.fields.StringField,
    });
});
export let daeSpecialDurations;
export let daeMacroRepeats;
Hooks.once('ready', () => {
    if (gameSystemCompatible !== "no" && (gameSystemCompatible === "yes" || daeUntestedSystems)) {
        if ("maybe" === gameSystemCompatible) {
            if (game.user?.isGM)
                ui.notifications?.warn(`DAE is has not been tested with ${game.system.title}. Disable DAE if there are problems`);
        }
        fetchParams();
        debug("ready setup actions");
        daeSpecialDurations = { "None": "" };
        if (game.modules.get("times-up")?.active && foundry.utils.isNewerVersion(game.modules.get("times-up")?.version ?? "0", "0.0.9")) {
            daeSpecialDurations["turnStart"] = i18n("dae.turnStart");
            daeSpecialDurations["turnEnd"] = i18n("dae.turnEnd");
            daeSpecialDurations["turnStartSource"] = i18n("dae.turnStartSource");
            daeSpecialDurations["turnEndSource"] = i18n("dae.turnEndSource");
            daeSpecialDurations["combatEnd"] = i18n("COMBAT.End");
            daeSpecialDurations["joinCombat"] = i18n("COMBAT.CombatantCreate");
            daeMacroRepeats = {
                "none": "",
                "startEveryTurn": i18n("dae.startEveryTurn"),
                "endEveryTurn": i18n("dae.endEveryTurn"),
                "startEndEveryTurn": i18n("dae.startEndEveryTurn"),
                "startEveryTurnAny": i18n("dae.startEveryTurnAny"),
                "endEveryTurnAny": i18n("dae.endEveryTurnAny"),
                "startEndEveryTurnAny": i18n("dae.startEndEveryTurnAny")
            };
        }
        daeReadyActions();
        createDAEMacros();
    }
    else if (gameSystemCompatible === "maybe" && !daeUntestedSystems) {
        ui.notifications?.error(`DAE is not certified compatible with ${game.system.id} - enable Untested Systems in DAE settings to enable`);
    }
    else {
        ui.notifications?.error(`DAE is not compatible with ${game.system.id} - module disabled`);
    }
    Hooks.callAll("dae.ready", API);
});
/* ------------------------------------ */
/* Setup module							*/
/* ------------------------------------ */
Hooks.once('setup', () => {
    if (gameSystemCompatible === "no" || (gameSystemCompatible === "maybe" && !daeUntestedSystems)) {
        ui.notifications?.warn(`DAE disabled for ${game.system.title} - to enable choose Allow Untested Systems from the DAE settings`);
    }
    else {
        // Do anything after initialization but before ready
        debug("setup actions");
        daeSetupActions();
        setupPatching();
        // Set API
        const data = game.modules.get("dae");
        data.api = API;
        globalThis.DAE = API;
        Hooks.on("macro-autocomplete.ready", ({ tree, objectToCompletions, mergeCompletions, rebuildSignatureMap }) => {
            if (!tree.DAE) {
                tree.DAE = { type: "object", detail: "object", info: "DAE's API" };
            }
            // objectToCompletions walks the runtime object; mergeCompletions overlays type enrichment
            mergeCompletions(tree.DAE, objectToCompletions(API, 3));
            rebuildSignatureMap();
        });
        setupSocket();
        if ("DAE.setupComplete" in Hooks.events) {
            foundry.utils.logCompatibilityWarning("The `DAE.setupComplete` hook has been deprecated and replaced with `dae.setupComplete`.", { since: "DAE 13.0.7", until: "DAE 14.0.0" });
            Hooks.callAll("DAE.setupComplete");
        }
        Hooks.callAll("dae.setupComplete", API);
    }
});
// TODO (Michael): Do we really need this? Very similar to just using `DialogV2.confirm`
// It's only here as a convenience to macro writers and I would not be surprised if it is not used at all
export async function confirmAction(toCheck, confirmFunction, title = i18n("dae.confirm")) {
    foundry.utils.logCompatibilityWarning("`confirmAction` is deprecated and will be removed in a future release. Please use `DialogV2.confirm` instead.", { since: "DAE 13.0.11", until: "DAE 13.1.0" });
    if (toCheck || await foundry.applications.api.DialogV2.confirm({
        window: { title },
        content: `<p>${i18n("dae.sure")}</p>`,
        rejectClose: false
    })) {
        return confirmFunction();
    }
}
// Revisit to find out how to set execute as GM
const DAEMacros = [
    {
        name: "DAE: Clear Scene DAE Passive Effects",
        checkVersion: true,
        version: "11.2.1",
        commandText: `await game.modules.get("dae").api.removeScenePassiveEffects()`
    },
    {
        name: "DAE: Clear All Actors DAE Passive Effects",
        checkVersion: true,
        version: "11.2.1",
        commandText: `await game.modules.get("dae").api.removeActorsPassiveEffects()`
    },
    {
        name: "DAE: Clear All Compendium DAE Passive Effects",
        checkVersion: true,
        version: "11.2.1",
        commandText: `await game.modules.get("dae").api.removeCompendiaPassiveEffects()`
    },
    {
        name: "DAE: Clear All Scenes DAE Passive Effects",
        checkVersion: true,
        version: "11.2.1",
        commandText: `await game.modules.get("dae").api.removeAllScenesPassiveEffects()`
    },
    {
        name: "DAE: Create Sample DAEConditionalEffects",
        checkVersion: true,
        version: "11.3.41",
        commandText: `itemData = await foundry.utils.fetchJsonWithTimeout('modules/dae/data/DAEConditionalEffects.json');
        CONFIG.Item.documentClass.create([itemData]);`
    }
];
// TODO (Michael) Is this necessary? If so, is this the ideal way of doing this?
// I'm open to suggestions
export async function createDAEMacros() {
    if (game.user?.isGM) {
        const daeVersion = "11.2.0";
        for (let macroSpec of DAEMacros) {
            try {
                let existingMacros = game.macros?.filter(m => m.name === macroSpec.name) ?? [];
                if (existingMacros.length > 0) {
                    for (let macro of existingMacros) {
                        if (macroSpec.checkVersion
                            && !foundry.utils.isNewerVersion(macroSpec.version, (macro.flags?.dae?.version ?? "0.0.0")))
                            continue; // already up to date
                        await macro.update({
                            command: macroSpec.commandText,
                            flags: {
                                dae: {
                                    version: macroSpec.version
                                }
                            }
                        });
                    }
                }
                else {
                    const macroData = {
                        _id: null,
                        name: macroSpec.name,
                        type: "script",
                        author: game.user.id,
                        img: 'icons/svg/dice-target.svg',
                        scope: 'global',
                        command: macroSpec.commandText,
                        folder: null,
                        sort: 0,
                        flags: {
                            dae: {
                                version: macroSpec.version ?? daeVersion
                            }
                        }
                    };
                    await Macro.createDocuments([macroData]);
                    log(`Macro ${macroData.name} created`);
                }
            }
            catch (err) {
                const message = `createDAEMacros | failed to create macro ${macroSpec.name}`;
                error(err, message);
            }
        }
    }
}
