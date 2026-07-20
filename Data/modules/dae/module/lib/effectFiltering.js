/**
 * Pure functions for filtering effects by self-target flags.
 * Extracted from applyNonTransferEffects to reduce complexity.
 */
import { isEnchantment } from "../apps/DAEActiveEffectConfig.js";
/**
 * Filter an item's non-transfer effects based on self-target mode, converting to source data.
 */
export function filterEffectsForTargeting(effects, selfEffects) {
    const predicate = selfTargetPredicate(selfEffects);
    return [...effects]
        .filter(ae => ae.transfer !== true && !isEnchantment(ae) && predicate(ae))
        .map(ae => {
        const data = ae.toObject(false);
        foundry.utils.setProperty(data, "flags.core.sourceId", ae.parent?.uuid);
        return data;
    });
}
function selfTargetPredicate(mode) {
    switch (mode) {
        case "selfEffectsAlways":
            return ae => !!ae.flags?.dae?.selfTargetAlways;
        case "selfEffectsAll":
            return ae => !!(ae.flags?.dae?.selfTargetAlways || ae.flags?.dae?.selfTarget);
        case "none":
        default:
            return ae => !ae.flags?.dae?.selfTargetAlways && !ae.flags?.dae?.selfTarget;
    }
}
