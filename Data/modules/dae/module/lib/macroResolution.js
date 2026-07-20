import { warn } from "../../dae.js";
/** Resolve macro command text from an item or raw item data, checking dae and legacy itemacro flag paths. */
export function getItemMacroCommand(source) {
    const s = source;
    return s?.flags?.dae?.macro?.command
        ?? s?.flags?.itemacro?.macro?.command
        ?? s?.flags?.itemacro?.macro?.data?.command;
}
/**
 * Walk an effect's origin chain to find the originating Item.
 * Falls back to flags.dae.itemUuid, then flags.dae.itemData (constructing a temporary Item).
 */
export async function resolveItemFromEffect(effectData, actor) {
    // Follow the origin trail backwards through nested ActiveEffects
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
        console.warn("dae | resolveItemFromEffect | too many levels of origin", effectData);
    }
    else if (source instanceof Item)
        return source;
    else if (source?.parent instanceof Item)
        return source.parent;
    else if (source?.item instanceof Item)
        return source.item;
    // Fallback: flags.dae.itemUuid
    const itemUuid = effectData.flags?.dae?.itemUuid;
    if (itemUuid) {
        const item = fromUuidSync(itemUuid);
        if (item instanceof Item)
            return item;
    }
    // Fallback: flags.dae.itemData (construct temporary Item)
    const itemData = effectData.flags?.dae?.itemData;
    if (itemData && actor) {
        return new CONFIG.Item.documentClass(itemData, { parent: actor });
    }
    return null;
}
/** Create a synthetic script Macro from command text. */
export function createSyntheticMacro(command, name = "DAE-Item-Macro") {
    return new CONFIG.Macro.documentClass({
        name,
        type: "script",
        img: null,
        command,
        author: game.user?.id,
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
        flags: { dnd5e: { itemMacro: true } }
    });
}
/**
 * Create a synthetic script Macro that calls a global function.
 * Supports paths like "myModule.myFunction" or "myModule.myFunction("arg1", "arg2")".
 */
export function createFunctionMacro(functionPath) {
    return createSyntheticMacro(`return await ${functionPath}.bind(this)({ speaker, actor, token, character, item, args, scope })`, "DAE-Function-Macro");
}
/**
 * Resolve a world or compendium Macro by name or UUID.
 * If the UUID points to an Item, extracts the macro command from its flags.
 */
export async function resolveWorldMacro(nameOrUuid) {
    const macro = game.macros?.getName(nameOrUuid);
    if (macro)
        return macro;
    const doc = await fromUuid(nameOrUuid);
    if (doc instanceof Macro)
        return doc;
    if (doc instanceof Item) {
        const macroData = doc.flags?.dae?.macro ?? doc.flags?.itemacro?.macro;
        if (macroData) {
            macroData.flags = foundry.utils.mergeObject(macroData.flags ?? {}, { dnd5e: { itemMacro: true } });
            return new CONFIG.Macro.documentClass(macroData);
        }
    }
    return undefined;
}
/**
 * Resolve an ItemMacro's command text from multiple sources:
 * effect flags → item flags → DAE itemData fallback → origin chain → activity parent.
 */
export async function resolveItemMacroCommand(item, effectData, effectUuid) {
    // Try effect-level itemMacro flag
    let command = effectData?.flags?.dae?.itemMacro;
    if (command)
        return command;
    // Try resolving item from effectUuid if not provided
    if (!item && effectUuid) {
        const effect = fromUuidSync(effectUuid);
        if (effect instanceof ActiveEffect && effect.parent instanceof Item) {
            item = effect.parent;
        }
    }
    // Try item flags
    command = getItemMacroCommand(item);
    if (command)
        return command;
    // Try DAE itemData stored in effect flags
    const itemData = effectData?.flags?.dae?.itemData;
    if (itemData) {
        command = getItemMacroCommand(itemData);
        if (command)
            return command;
    }
    // Last ditch: resolve from origin chain
    if (!item && effectData?.origin) {
        warn("resolveItemMacroCommand: fetching item from effectData/origin", effectData.origin);
        const itemOrEffect = fromUuidSync(effectData.origin);
        if (itemOrEffect instanceof CONFIG.Item.documentClass) {
            item = itemOrEffect;
        }
        if (!item) {
            const activityUuid = effectData?.flags?.dae?.activity;
            if (activityUuid) {
                const activity = fromUuidSync(activityUuid);
                // @ts-expect-error no dnd5e-types for activity.item
                if (activity)
                    item = activity.item;
            }
        }
        command = getItemMacroCommand(item);
        if (command)
            return command;
    }
    // Check effect-level flag one more time (may have been set elsewhere)
    return effectData?.flags?.dae?.itemMacro;
}
/**
 * Resolve an ActivityMacro's command text from the activity UUID stored in effect flags.
 */
export async function resolveActivityMacroCommand(effectData) {
    const activityUuid = effectData?.flags?.dae?.activity;
    if (!activityUuid)
        return undefined;
    const activity = await fromUuid(activityUuid);
    return activity?.macro?.command;
}
/**
 * High-level macro resolver. Given a change key and name, resolves the appropriate Macro instance.
 * Handles macro.execute (world/compendium), macro.itemMacro (item flags), and macro.activityMacro (activity).
 */
export async function resolveMacro(changeKey, name, item, effectData, effectUuid) {
    if (changeKey.includes("macro.execute")) {
        return resolveWorldMacro(name);
    }
    let macroCommand;
    if (changeKey.startsWith("macro.activityMacro")) {
        macroCommand = await resolveActivityMacroCommand(effectData);
    }
    else if (changeKey.startsWith("macro.itemMacro")) {
        macroCommand = await resolveItemMacroCommand(item, effectData, effectUuid);
    }
    // Fallback: try resolving name as UUID to a Macro or Item
    if (!macroCommand) {
        const doc = await fromUuid(name);
        if (doc instanceof Macro)
            macroCommand = doc.command;
        if (doc instanceof Item)
            macroCommand = getItemMacroCommand(doc);
    }
    if (!macroCommand) {
        warn(`resolveMacro: No macro found for ${changeKey}, item ${item?.name}`);
        macroCommand = `if (!args || args[0] === "on") {ui.notifications.warn("${changeKey} | No macro found for item ${item?.name ?? "unknown"}");}`;
    }
    return createSyntheticMacro(macroCommand);
}
