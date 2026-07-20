/**
 * ATL → token.* change-key migration.
 *
 * Shared transformer used by three layers:
 *   A) preCreate/preUpdate ActiveEffect hooks (pre-write normalisation)
 *   B) daeApplyActiveEffects runtime rewrite (in-memory)
 *   C) migrateEffectData one-shot bulk migration
 *
 * Layered behavior is gated by the world setting `dae.atlCompatibility`:
 *   - "legacy"  : nothing (current behavior — ATL.* keys go to the ATL module)
 *   - "runtime" : Layer B only (in-memory rewrite at apply time)
 *   - "migrate" : Layers A + C (one-shot world migration + pre-write normalisation)
 *   - "full"    : Layers A + B + C (everything — adds runtime fallback)
 *
 * Not migrated (target keys absent from TokenDocument._ACTIVE_EFFECT_TARGETABLE_KEYS, or
 * routed through TokenDocument._onOverrideSize which is unimplemented in core/dnd5e v14):
 *   ATL.elevation, ATL.hidden, ATL.rotation, ATL.width, ATL.height, ATL.depth, ATL.shape
 */
/** ATL → token 1:1 key mappings. Value transformations live in the per-case handlers. */
const ATL_TO_TOKEN_DIRECT = {
    "ATL.alpha": "token.alpha",
    // light
    "ATL.light.angle": "token.light.angle",
    "ATL.light.attenuation": "token.light.attenuation",
    "ATL.light.bright": "token.light.bright",
    "ATL.light.color": "token.light.color",
    "ATL.light.coloration": "token.light.coloration",
    "ATL.light.contrast": "token.light.contrast",
    "ATL.light.dim": "token.light.dim",
    "ATL.light.luminosity": "token.light.luminosity",
    "ATL.light.saturation": "token.light.saturation",
    "ATL.light.shadows": "token.light.shadows",
    "ATL.light.darkness.max": "token.light.darkness.max",
    "ATL.light.darkness.min": "token.light.darkness.min",
    // sight
    "ATL.sight.angle": "token.sight.angle",
    "ATL.sight.attenuation": "token.sight.attenuation",
    "ATL.sight.brightness": "token.sight.brightness",
    "ATL.sight.contrast": "token.sight.contrast",
    "ATL.sight.enabled": "token.sight.enabled",
    "ATL.sight.range": "token.sight.range",
    "ATL.sight.saturation": "token.sight.saturation",
    "ATL.sight.color": "token.sight.color",
};
/** Keys that cannot be migrated to native token.* — they require ATL or unimplemented core hooks. */
export const ATL_UNSUPPORTED_KEYS = new Set([
    "ATL.elevation",
    "ATL.hidden",
    "ATL.rotation",
    "ATL.width",
    "ATL.height",
    "ATL.depth",
    "ATL.shape",
]);
const _warnedUnsupported = new Set();
/**
 * Transform a single ATL change into zero or more token.* changes.
 *
 *  - returns []          when the key is unsupported (see ATL_UNSUPPORTED_KEYS)
 *  - returns [{...}]     for direct 1:1 mappings
 *  - returns [..., ...]  for 1:N expansions (visionMode defaults, animation JSON, detectionModes, preset)
 *  - returns null        if the change is not ATL.* (caller should leave it alone)
 *
 * Callers may pass `options.warnUnsupported = false` to silence the per-key console warning
 * (e.g. when iterating compendium content where the user can't act on it).
 */
export function atlChangeToTokenChanges(change, options = {}) {
    if (!change?.key || !change.key.startsWith("ATL."))
        return null;
    // Unsupported — log once per key, drop.
    if (ATL_UNSUPPORTED_KEYS.has(change.key)) {
        if (options.warnUnsupported !== false && !_warnedUnsupported.has(change.key)) {
            _warnedUnsupported.add(change.key);
            console.warn(`dae | ATL key "${change.key}" cannot be migrated to native v14 token.* — `
                + `either keep ATL installed or wait for core/dnd5e to implement TokenDocument._onOverrideSize.`);
        }
        return [];
    }
    // Legacy ATL.dimSight / ATL.brightSight (kept for back-compat — ATL itself migrates these to sight.range/brightness).
    if (change.key === "ATL.dimSight" || change.key === "ATL.brightSight") {
        return [
            { ...change, key: "token.sight.range", value: change.value },
            ...(change.key === "ATL.brightSight" ? [{
                    ...change, key: "token.sight.brightness", value: "1", type: "override",
                }] : []),
        ];
    }
    // ATL.preset — look up the named preset, flatten, emit one change per non-empty value.
    if (change.key === "ATL.preset") {
        return _expandAtlPreset(change);
    }
    // ATL.light.animation — JSON string in ATL world; v14 wants individual sub-fields.
    if (change.key === "ATL.light.animation") {
        return _expandLightAnimation(change);
    }
    // ATL.light.alpha — ATL squares the value at apply time. Pre-square here to preserve behavior.
    if (change.key === "ATL.light.alpha") {
        const squared = _squareValue(change.value);
        return [{ ...change, key: "token.light.alpha", value: squared }];
    }
    // ATL.sight.visionMode — ATL applies CONFIG.Canvas.visionModes[X].vision.defaults; native does not.
    if (change.key === "ATL.sight.visionMode") {
        return _expandVisionMode(change);
    }
    // ATL.detectionModes.<id>.range — pair with token.detectionModes.<id>.enabled = true so the
    // TypedObjectField entry materialises with both required fields.
    if (change.key.startsWith("ATL.detectionModes.")) {
        return _expandDetectionMode(change);
    }
    // Direct 1:1 mapping.
    const mapped = ATL_TO_TOKEN_DIRECT[change.key];
    if (mapped)
        return [{ ...change, key: mapped }];
    // Anything else starting with ATL. — pass-through unchanged so it can be picked up by ATL.
    // (Conservative: don't silently rewrite unknown ATL keys to token.*.)
    return null;
}
/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function _squareValue(value) {
    // Effect values are typed as string in v14 (per the AnyField shim). Parse, square, restringify.
    const n = Number(value);
    if (Number.isNaN(n))
        return String(value);
    return String(n * n);
}
function _expandLightAnimation(change) {
    const raw = String(change.value ?? "").trim();
    if (!raw)
        return [];
    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        // Apply the same regex-based "JSON fixer" that ATL uses for known-malformed user input.
        try {
            const fixed = raw
                .replace(/:\s*"([^"]*)"/g, (_m, p1) => ': "' + p1.replace(/:/g, "@colon@") + '"')
                .replace(/:\s*'([^']*)'/g, (_m, p1) => ': "' + p1.replace(/:/g, "@colon@") + '"')
                .replace(/(['"])?([a-z0-9A-Z_]+)(['"])?\s*:/g, '"$2": ')
                .replace(/:\s*(['"])?([a-z0-9A-Z_]+)(['"])?/g, ':"$2"')
                .replace(/@colon@/g, ":");
            parsed = JSON.parse(fixed);
        }
        catch (err) {
            console.warn(`dae | ATL.light.animation: could not parse "${raw}" — skipping. ${err.message}`);
            return [];
        }
    }
    if (!parsed || typeof parsed !== "object")
        return [];
    const result = [];
    for (const [k, v] of Object.entries(parsed)) {
        if (v === undefined || v === null || v === "")
            continue;
        result.push({ ...change, key: `token.light.animation.${k}`, value: String(v) });
    }
    return result;
}
function _expandVisionMode(change) {
    const mode = String(change.value ?? "");
    const result = [{ ...change, key: "token.sight.visionMode", value: mode, type: "override" }];
    // Expand vision-mode defaults so the migrated effect matches ATL's runtime behavior.
    const modeConfig = globalThis.CONFIG?.Canvas?.visionModes?.[mode];
    const defaults = modeConfig?.vision?.defaults ?? {};
    for (const [k, v] of Object.entries(defaults)) {
        if (v === undefined || v === null)
            continue;
        result.push({ ...change, key: `token.sight.${k}`, value: String(v), type: "override" });
    }
    return result;
}
function _expandDetectionMode(change) {
    // ATL.detectionModes.<id>.<key>  →  token.detectionModes.<id>.{enabled,key}
    const suffix = change.key.slice("ATL.detectionModes.".length); // <id>.<key>
    const dot = suffix.indexOf(".");
    if (dot <= 0)
        return [];
    const id = suffix.slice(0, dot);
    const field = suffix.slice(dot + 1);
    return [
        { ...change, key: `token.detectionModes.${id}.enabled`, value: "true", type: "override",
            priority: (change.priority ?? 0) - 1 },
        { ...change, key: `token.detectionModes.${id}.${field}`, value: change.value },
    ];
}
function _expandAtlPreset(change) {
    const presets = game.settings?.get?.("ATL", "presets") ?? [];
    const preset = presets.find?.((p) => p?.name === change.value);
    if (!preset) {
        console.warn(`dae | ATL.preset: no preset named "${change.value}" — skipping.`);
        return [];
    }
    const flat = foundry.utils.flattenObject(preset);
    const result = [];
    for (const [k, v] of Object.entries(flat)) {
        if (v === undefined || v === null || v === "")
            continue;
        if (k === "id" || k === "name")
            continue;
        // Mirror ATL's apply-time alpha-squaring for the preset path.
        let value = v;
        if (k === "light.alpha")
            value = _squareValue(v);
        result.push({ ...change, key: `token.${k}`, value: String(value), type: change.type ?? "override" });
    }
    return result;
}
/* ------------------------------------------------------------------ */
/*  Bulk-mutate helper for a changes array                              */
/* ------------------------------------------------------------------ */
/**
 * Walk an array of changes and return a new array with all ATL keys rewritten.
 * Returns the input array (same reference) if nothing was rewritten — callers can
 * use referential equality to short-circuit writes.
 */
export function rewriteAtlChanges(changes, options = {}) {
    if (!Array.isArray(changes) || changes.length === 0)
        return changes;
    let anyRewritten = false;
    const out = [];
    for (const c of changes) {
        const rewrite = atlChangeToTokenChanges(c, options);
        if (rewrite === null) {
            out.push(c);
            continue;
        }
        anyRewritten = true;
        out.push(...rewrite);
    }
    return anyRewritten ? out : changes;
}
/** Keys whose value is picker-constrained — only "override" is meaningful. v14's default
 * change type "add" concatenates strings, silently breaking the field. */
export const OVERRIDE_ONLY_KEYS = new Set([
    "token.sight.visionMode",
]);
/** Coerce picker-only change keys to type "override". Returns the same array reference when
 * nothing changed so callers can short-circuit writes. */
export function coerceOverrideOnlyChangeTypes(changes) {
    if (!Array.isArray(changes) || changes.length === 0)
        return changes;
    let any = false;
    const out = changes.map(c => {
        if (OVERRIDE_ONLY_KEYS.has(c.key) && c.type !== "override") {
            any = true;
            return { ...c, type: "override" };
        }
        return c;
    });
    return any ? out : changes;
}
