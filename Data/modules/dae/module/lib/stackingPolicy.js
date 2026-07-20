/**
 * Effect stacking policy — determines how duplicate effects are handled on creation.
 * Extracted from _preCreateActiveEffectRemoveExisting and _preCreateActiveEffectIncrement.
 */
import { warn, debugEnabled } from "../../dae.js";
import { getStatusEffectsArray, busyWait, effectBaseName } from "../dae.js";
/**
 * Check for existing effects that conflict with the new one and handle removal/toggling.
 * Returns true if the new effect should proceed with creation, false to abort.
 */
export async function handleExistingEffects(effect, options) {
    const parent = effect.parent;
    // @ts-expect-error Can this happen?
    if (options.isUndo)
        return true;
    if (!(parent instanceof CONFIG.Actor.documentClass))
        return true;
    const stackable = (effect.flags?.dae?.stackable ?? "");
    if (!["noneName", "none", "noneNameOnly"].includes(stackable))
        return true;
    if (!parent)
        return true;
    const hasExisting = parent.effects.filter(ef => {
        const efOrigin = ef.origin;
        switch (stackable) {
            case "noneName":
                return !!(effect.origin && efOrigin === effect.origin && ef.name === effect.name);
            case "count":
            case "countDeleteDecrement":
                // @ts-expect-error toggle option
                if (options.toggleEffect)
                    return !!(effect.origin && efOrigin === effect.origin && ef.name === effect.name);
                break;
            case "noneNameOnly":
                return ef.name === effect.name;
            case "none":
                return !!(effect.origin && efOrigin === effect.origin);
        }
        return false;
    });
    if (hasExisting.length === 0)
        return true;
    // @ts-expect-error toggle option
    if (options.toggleEffect) {
        const updates = hasExisting.map(ef => ({ _id: ef.id, disabled: !ef.disabled }));
        await parent.updateEmbeddedDocuments("ActiveEffect", updates, options);
        return false;
    }
    if (debugEnabled > 0)
        warn("deleting existing effects", parent.name, parent, hasExisting);
    options["existing"] = "effect-stacking";
    await parent.deleteEmbeddedDocuments("ActiveEffect", hasExisting.map(ef => ef.id ?? ""), options);
    // Wait for dependent effects to be cleaned up
    let count = 0;
    // @ts-expect-error no dnd5e-types
    while (hasExisting.some(ef => ef.getDependents().length > 0) && count < 100) {
        count += 1;
        await busyWait(0.05);
    }
    return true;
}
/**
 * Handle count-based stacking: increment existing effect's stack count instead of creating a new one.
 * Returns true if the new effect should proceed with creation, false to abort (stack incremented).
 */
export async function handleStackIncrement(effect, data, options) {
    const parent = effect.parent;
    // @ts-expect-error Can this happen?
    if (options.isUndo)
        return true;
    if (!(parent instanceof CONFIG.Actor.documentClass))
        return true;
    const stackable = (effect.flags?.dae?.stackable ?? "");
    if (!["count", "countDeleteDecrement"].includes(stackable))
        return true;
    let existingEffect;
    if (getStatusEffectsArray().find(se => se._id === effect.id)) {
        existingEffect = parent.effects.find(ef => ef.id === effect.id);
    }
    else {
        existingEffect = parent.effects.find(ef => ef.origin === effect.origin && effectBaseName(ef) === effectBaseName(effect));
    }
    if (!existingEffect)
        return true;
    const stacks = (existingEffect.flags?.dae?.stacks ?? 1) + 1;
    await existingEffect.update({
        // @ts-expect-error flags.dae.stacks not in fvtt-types
        "flags.dae.stacks": stacks,
        name: `${effectBaseName(existingEffect)} (${stacks})`
    });
    // @ts-expect-error getDependents not in fvtt-types (dnd5e method)
    if (existingEffect.getDependents && existingEffect.getDependents().length > 0) {
        // @ts-expect-error getDependents not in fvtt-types (dnd5e method)
        const deps = existingEffect.getDependents().filter((ef) => ["count", "countDeleteDecrement"].includes(ef.flags?.dae?.stackable ?? ""));
        await parent.createEmbeddedDocuments("ActiveEffect", deps.map((ef) => ef.toObject()), { keepId: true });
    }
    return false;
}
