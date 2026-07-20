/**
 * @typedef {Object} TranslationStrategy
 * @property {string} name
 * @property {(data: Object, context?: Object) => (string|null|undefined)} [keyFor]
 * @property {(data: Object, key: string, entry: Object, context?: Object) => boolean} [matches]
 */

/**
 * @typedef {Object} TranslationEntriesContext
 * @property {string|null} [documentType]
 * @property {Object} [pack]
 * @property {Object} [metadata]
 * @property {string[]} [matchCandidates]
 */

/**
 * Result of matching a document against translation entries.
 */
export class TranslationMatch {

    constructor({matched, key = null, entry = null, strategy = null, candidates = []} = {}) {
        this.matched = matched === true;
        this.key = key;
        this.entry = entry;
        this.strategy = strategy;
        this.candidates = candidates;
    }

    get translation() {
        return this.entry;
    }
}

/**
 * Compendium translation entries normalized into a lookup-friendly object.
 *
 * The constructor accepts both supported payload shapes for `entries`:
 * - compatible/object format keyed directly by translation key
 * - legacy array format with `id` inside each translation entry
 */
export class TranslationEntries {

    #entries;
    #customStrategies;
    #strategies;

    constructor(entries = {}, strategies = []) {
        this.#entries = TranslationEntries.#normalize(entries);
        this.#customStrategies = [...(strategies ?? [])];
        this.#strategies = [
            ...this.#customStrategies,
            ...TranslationEntries.#defaultStrategies(),
        ];
    }

    at(key) {
        return key ? this.#entries[key] ?? null : null;
    }

    empty() {
        return Object.keys(this.#entries).length === 0;
    }

    keys() {
        return Object.keys(this.#entries);
    }

    values() {
        return Object.values(this.#entries);
    }

    entries() {
        return Object.entries(this.#entries);
    }

    snapshot() {
        return {...this.#entries};
    }

    customStrategies() {
        return [...this.#customStrategies];
    }

    candidateKeysFor(data, context = {}) {
        return this.#candidatesFor(data, context).map((candidate) => candidate.key);
    }

    matchFor(data, context = {}) {
        const candidates = this.#candidatesFor(data, context);
        const keys = candidates.map((candidate) => candidate.key);

        for (const key of keys) {
            const entry = this.at(key);

            if (!entry) {
                continue;
            }

            return new TranslationMatch({
                matched: true,
                key,
                entry,
                strategy: candidates.find((candidate) => candidate.key === key)?.strategy ?? "identity",
                candidates: keys,
            });
        }

        for (const strategy of this.#strategies) {
            const match = this.#matchFromStrategy(strategy, data, context, keys);

            if (match) {
                return match;
            }
        }

        return new TranslationMatch({
            matched: false,
            candidates: keys,
        });
    }

    hasEntryFor(data, context = {}) {
        return this.matchFor(data, context).matched;
    }

    diagnosticsFor(data, context = {}) {
        return this.matchFor(data, context);
    }

    #candidatesFor(data, context = {}) {
        if (Array.isArray(context.matchCandidates)) {
            return [...new Set(context.matchCandidates.filter(Boolean))].map((key) => ({
                key,
                strategy: "identity",
            }));
        }

        const candidates = [];

        for (const strategy of this.#strategies) {
            if (typeof strategy.keyFor !== "function") {
                continue;
            }

            const key = strategy.keyFor(data, context);

            if (!key || candidates.some((candidate) => candidate.key === key)) {
                continue;
            }

            candidates.push({
                key,
                strategy: strategy.name,
            });
        }

        return candidates;
    }

    #matchFromStrategy(strategy, data, context, keys) {
        if (typeof strategy.matches === "function") {
            const match = this.#matchFromEntries(strategy, data, context, keys);

            if (match) {
                return match;
            }
        }

        if (typeof strategy.keyFor !== "function") {
            return null;
        }

        const key = strategy.keyFor(data, context);
        const entry = this.at(key);

        if (!key || !entry) {
            return null;
        }

        return new TranslationMatch({
            matched: true,
            key,
            entry,
            strategy: strategy.name,
            candidates: keys.includes(key) ? keys : [...keys, key],
        });
    }

    #matchFromEntries(strategy, data, context, keys) {
        for (const [key, entry] of this.entries()) {
            if (!strategy.matches(data, key, entry, context)) {
                continue;
            }

            return new TranslationMatch({
                matched: true,
                key,
                entry,
                strategy: strategy.name,
                candidates: keys.includes(key) ? keys : [...keys, key],
            });
        }

        return null;
    }

    static #normalize(entries = {}) {
        if (!entries) {
            return {};
        }

        if (!Array.isArray(entries)) {
            return {...entries};
        }

        return entries.reduce((out, entry) => {
            if (entry?.id) {
                out[entry.id] = entry;
            }
            return out;
        }, {});
    }

    static #defaultStrategies() {
        return [
            {
                name: "_id",
                keyFor: (data) => data?._id,
            },
            {
                name: "name",
                keyFor: (data) => data?.name,
            },
            {
                name: "sourceId",
                keyFor: (data) => foundry.utils.parseUuid(data?.flags?.core?.sourceId || data?._stats?.compendiumSource)?.id,
            },
        ];
    }
}
