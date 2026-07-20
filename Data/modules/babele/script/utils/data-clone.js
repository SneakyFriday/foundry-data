/**
 * Clone JSON-like Foundry data without preserving object identity.
 *
 * Prefer Foundry's own deep clone when available; fall back to a small
 * recursive clone for test and headless contexts.
 *
 * @param {*} value
 * @returns {*}
 */
export function cloneData(value) {
    if (typeof value === "undefined" || value === null) {
        return value;
    }

    if (globalThis.foundry?.utils?.deepClone) {
        return foundry.utils.deepClone(value);
    }

    if (Array.isArray(value)) {
        return value.map((entry) => cloneData(entry));
    }

    if (typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, cloneData(entry)]),
        );
    }

    return value;
}
