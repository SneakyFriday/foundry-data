import { MODULE_ID } from "../dae.js";
/**
 * Register lib-wrapper patches for ActiveEffect prototype methods.
 * Called during init after custom expiry events are registered.
 */
export function registerActiveEffectPatches() {
    const libWrapper = globalThis.libWrapper;
    // Patch isExpiryEvent:
    // 1. "updateWorldTime" expiry: expire whenever duration runs out, regardless of event
    // 2. Event-only effects (no duration value): don't let time advance satisfy combat expiry
    // source/target expiry values are converted to turnStart/turnEnd + start.combatant in
    // _preCreateActiveEffect, so core handles them natively.
    libWrapper.register(MODULE_ID, "CONFIG.ActiveEffect.documentClass.prototype.isExpiryEvent", function isExpiryEventWrapper(wrapped, event, context) {
        // @ts-expect-error v14 duration.expiry not in fvtt-types yet
        if (this.duration.expiry === "updateWorldTime")
            return true;
        // @ts-expect-error v14 _source.duration.value not in fvtt-types yet
        if (event === "updateWorldTime" && !Number.isFinite(this._source.duration.value))
            return false;
        return wrapped(event, context);
    }, "MIXED");
    // Patch _prepareDuration:
    // 1. Event-only effects (no duration value): core treats missing value as 0, making them
    //    expire immediately on time advance. A blank value should mean "no time-based expiry".
    // 2. "updateWorldTime" + turn-based duration: core's formula counts turns relative to the
    //    start combatant's position (only turns at or after startTurn in each round), which is
    //    correct for turnStart/turnEnd expiry but wrong for "time elapsed" where ALL turns
    //    should count.
    libWrapper.register(MODULE_ID, "CONFIG.ActiveEffect.documentClass.prototype._prepareDuration", function prepareDurationWrapper(wrapped, duration, context) {
        duration ??= this.duration;
        if (!Number.isFinite(duration.value) && duration.value !== Infinity && duration.expiry) {
            return Object.assign(duration, { remaining: Infinity, seconds: Infinity, label: game.i18n?.localize("COMMON.None") ?? "None" });
        }
        const result = wrapped(duration, context);
        // Fix "updateWorldTime" + turn-based duration: override remaining with total-turns-elapsed
        if ((duration.expiry === "updateWorldTime" || this._source?.duration?.expiry === "updateWorldTime")
            && duration.units === "turns" && Number.isFinite(duration.value)) {
            // @ts-expect-error v14 start schema not in fvtt-types yet
            const combat = game.combats?.get(this.start?.combat?.id) ?? game.combat;
            if (combat?.started && combat.turns.length) {
                // @ts-expect-error v14 start schema not in fvtt-types yet
                const startRound = this.start?.round ?? combat.round;
                // @ts-expect-error v14 start schema not in fvtt-types yet
                const startTurn = this.start?.turn ?? combat.turn;
                const currentRound = context?.round ?? combat.round;
                const currentTurn = context?.turn ?? combat.turn;
                const totalElapsed = (currentRound - startRound) * combat.turns.length + (currentTurn - startTurn);
                const remaining = duration.value - totalElapsed;
                // @ts-expect-error v14 pluralRules not in fvtt-types yet
                const pluralRule = game.i18n?.pluralRules?.select(Math.abs(remaining)) ?? "other";
                const locKey = remaining >= 0 ? "EFFECT.DURATION.TURNS" : "EFFECT.DURATION.TURNS_AGO";
                Object.assign(result, { remaining, label: game.i18n?.format(`${locKey}.${pluralRule}`, { turns: String(Math.abs(remaining)) }) ?? `${remaining} turns` });
            }
        }
        return result;
    }, "MIXED");
}
