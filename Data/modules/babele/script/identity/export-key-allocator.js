/**
 * Export-key scope for translated payload fragments.
 *
 * Keys prefer human-readable names, then document ids, then generated
 * fallbacks. Duplicates are avoided within the current export scope.
 */
export class ExportKeys {

    #usedKeys;

    constructor(usedKeys = new Set()) {
        this.#usedKeys = usedKeys;
    }

    /**
     * Return a stable key for the provided data object.
     *
     * @param {object} data
     * @param {string} [fallbackPrefix]
     * @param {object|null} [mapping]
     * @returns {string}
     */
    keyFor(data, fallbackPrefix = "entry", mapping = null) {
        const candidates = mapping?.exportKeyCandidates?.(data) ?? [data?.name, data?._id, data?.id].filter(Boolean);

        for (const key of candidates) {
            if (!this.#usedKeys.has(key)) {
                this.#usedKeys.add(key);
                return key;
            }
        }

        let index = this.#usedKeys.size;
        let fallback = `${fallbackPrefix}-${index}`;
        while (this.#usedKeys.has(fallback)) {
            index += 1;
            fallback = `${fallbackPrefix}-${index}`;
        }

        this.#usedKeys.add(fallback);
        return fallback;
    }
}
