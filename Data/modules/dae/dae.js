// Import TypeScript modules
import { registerSettings } from './module/settings.js';
import { preloadTemplates } from './module/preloadTemplates.js';
import { daeSetupActions, daeInitActions, fetchParams } from "./module/dae.js";
import { daeReadyActions } from "./module/dae.js";
import { shouldAutoMigrate, migrateWorld as runMigration } from "./module/migration.js";
import { setupSocket } from './module/GMAction.js';
import API from './module/API/api.js';
import { addAutoFields, BooleanFormulaField } from './module/apps/DAEActiveEffectConfig.js';
import { registerActiveEffectPatches } from './module/patching.js';
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
export let daeManagesTurnExpiry = false; // true when dnd5e < 6.0.0 (dnd5e 6.0+ handles source/target turn expiry natively)
export const MODULE_ID = "dae";
/* ------------------------------------ */
/* Initialize module					*/
/* ------------------------------------ */
Hooks.once('init', () => {
    debug('Init setup actions');
    // Register custom expiry events:
    // - "updateWorldTime" (Time Elapsed): expire purely on duration, not combat events
    // @ts-expect-error v14 CONFIG.ActiveEffect.expiryEvents not in fvtt-types yet
    CONFIG.ActiveEffect.expiryEvents.updateWorldTime = "dae.expiryEvent.updateWorldTime";
    // source/target turn expiry: dnd5e 6.0+ handles this natively, so only register when < 6.0.0
    daeManagesTurnExpiry = game.system.id !== "dnd5e" || !foundry.utils.isNewerVersion(game.system.version, "5.99.99");
    if (daeManagesTurnExpiry) {
        // @ts-expect-error v14 CONFIG.ActiveEffect.expiryEvents not in fvtt-types yet
        CONFIG.ActiveEffect.expiryEvents.sourceStart = "dae.expiryEvent.sourceStart";
        // @ts-expect-error v14 CONFIG.ActiveEffect.expiryEvents not in fvtt-types yet
        CONFIG.ActiveEffect.expiryEvents.sourceEnd = "dae.expiryEvent.sourceEnd";
        // @ts-expect-error v14 CONFIG.ActiveEffect.expiryEvents not in fvtt-types yet
        CONFIG.ActiveEffect.expiryEvents.targetStart = "dae.expiryEvent.targetStart";
        // @ts-expect-error v14 CONFIG.ActiveEffect.expiryEvents not in fvtt-types yet
        CONFIG.ActiveEffect.expiryEvents.targetEnd = "dae.expiryEvent.targetEnd";
    }
    // Register lib-wrapper patches for isExpiryEvent and _prepareDuration
    registerActiveEffectPatches();
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
        // turnStart, turnEnd, turnStartSource, turnEndSource, combatEnd removed —
        // now handled by v14 core duration.expiry + DAE source/target expiry events
        daeSpecialDurations["joinCombat"] = i18n("dae.joinCombat");
        daeMacroRepeats = {
            "none": "",
            "startEveryTurn": i18n("dae.startEveryTurn"),
            "endEveryTurn": i18n("dae.endEveryTurn"),
            "startEndEveryTurn": i18n("dae.startEndEveryTurn"),
            "startEveryTurnAny": i18n("dae.startEveryTurnAny"),
            "endEveryTurnAny": i18n("dae.endEveryTurnAny"),
            "startEndEveryTurnAny": i18n("dae.startEndEveryTurnAny")
        };
        // Apply the core expiry action override from DAE settings
        const coreExpiryAction = game.settings.get("dae", "coreExpiryAction");
        // @ts-expect-error v14 CONFIG.ActiveEffect.expiryAction not in fvtt-types yet
        CONFIG.ActiveEffect.expiryAction = coreExpiryAction === "none" ? null : coreExpiryAction;
        // Per-effect expiry mode: wrap registry.refresh() to intercept via pre-hooks.
        // modifyBatch fires preDelete/preUpdate hooks (via dryRun pass), so we set a flag
        // during refresh and use pre-hooks to redirect effects whose flags.dae.expiryMode
        // differs from the global CONFIG.ActiveEffect.expiryAction.
        // @ts-expect-error v14 ActiveEffect.registry not in fvtt-types yet
        const registry = foundry.documents.ActiveEffect.registry;
        const origRefresh = registry.refresh;
        const expiryRedirects = [];
        let registryRefreshActive = false;
        let registryRefreshEvent = "";
        function expiryReason(event, effect) {
            const expiry = effect.duration?.expiry;
            return `duration-expired:${expiry ?? event}`;
        }
        registry.refresh = async function (event, context) {
            registryRefreshActive = true;
            registryRefreshEvent = event;
            expiryRedirects.length = 0;
            try {
                await origRefresh.call(this, event, context);
            }
            catch (err) {
                console.error("dae | registry.refresh", err);
            }
            finally {
                registryRefreshActive = false;
                registryRefreshEvent = "";
            }
            // Process any redirected operations (effects whose per-effect mode differs from global)
            for (const { effect, targetAction } of expiryRedirects) {
                const reason = { "expiry-reason": expiryReason(event, effect) };
                if (targetAction === "delete")
                    await effect.delete(reason);
                // @ts-expect-error v14 duration.expired not in fvtt-types yet
                else
                    await effect.update({ "duration.expired": true }, reason);
            }
            expiryRedirects.length = 0;
        };
        // Intercept registry expiry: inject expiry-reason into options for core duration expiry,
        // and redirect effects whose per-effect expiryMode differs from the global setting.
        Hooks.on("preDeleteActiveEffect", (effect, options) => {
            if (!registryRefreshActive)
                return true;
            if (!options["expiry-reason"])
                options["expiry-reason"] = expiryReason(registryRefreshEvent, effect);
            const mode = effect.getFlag("dae", "expiryMode");
            if (mode === "suppress") {
                expiryRedirects.push({ effect, targetAction: "update" });
                return false;
            }
            return true;
        });
        // Intercept registry expiry: inject expiry-reason into options for core duration expiry,
        // and redirect effects whose per-effect expiryMode differs from the global setting.
        Hooks.on("preUpdateActiveEffect", (effect, update, options) => {
            if (!registryRefreshActive)
                return true;
            if (!foundry.utils.hasProperty(update, "duration.expired"))
                return true;
            if (!options["expiry-reason"])
                options["expiry-reason"] = expiryReason(registryRefreshEvent, effect);
            const mode = effect.getFlag("dae", "expiryMode");
            if (mode === "delete") {
                expiryRedirects.push({ effect, targetAction: "delete" });
                return false;
            }
            return true;
        });
        daeReadyActions();
        createDAEMacros();
        if (shouldAutoMigrate())
            runMigration();
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
        Hooks.callAll("dae.setupComplete", API);
    }
});
// Revisit to find out how to set execute as GM
const DAEMacros = [
    {
        name: "DAE: Create Sample DAEConditionalEffects",
        checkVersion: true,
        version: "14.0.5",
        commandText: `const itemData = await foundry.utils.fetchJsonWithTimeout('modules/dae/data/DAEConditionalEffects.json');
        await CONFIG.Item.documentClass.create([itemData]);`
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
