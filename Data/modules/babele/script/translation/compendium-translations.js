import {CompendiumTranslation} from "./compendium-translation.js";

/**
 * Loaded translation payloads indexed by compendium collection.
 *
 * This object is the plural aggregate over `CompendiumTranslation`:
 * it keeps deterministic lookup by collection while still allowing iteration
 * in insertion order when callers need the whole loaded set.
 */
export class CompendiumTranslations {

    #byCollection;

    constructor({
        translations = [],
    } = {}) {
        this.#byCollection = new Map();

        for (const translation of translations) {
            this.add(translation);
        }
    }

    add(translation) {
        if (!translation) {
            return this;
        }

        const payload = translation instanceof CompendiumTranslation
            ? translation
            : new CompendiumTranslation(translation.collection, translation);

        this.#byCollection.set(payload.collection, payload);
        return this;
    }

    for(collection) {
        return this.#byCollection.get(collection) ?? null;
    }

    has(collection) {
        return this.#byCollection.has(collection);
    }

    values() {
        return [...this.#byCollection.values()];
    }

    empty() {
        return this.#byCollection.size === 0;
    }

    /**
     * Resolve `extends` declarations across loaded translation payloads.
     *
     * Parent payloads are applied first, child payloads last. Missing parents
     * and inheritance cycles fail open with diagnostics.
     *
     * @returns {CompendiumTranslations}
     */
    resolveInheritance() {
        const resolved = new Map();
        const resolving = new Set();

        for (const collection of this.#byCollection.keys()) {
            this.#resolve(collection, {resolved, resolving});
        }

        this.#byCollection = new Map(resolved);
        return this;
    }

    get size() {
        return this.#byCollection.size;
    }

    [Symbol.iterator]() {
        return this.#byCollection.values();
    }

    #resolve(collection, {resolved, resolving}) {
        if (resolved.has(collection)) {
            return resolved.get(collection);
        }

        const translation = this.for(collection);
        if (!translation) {
            return null;
        }

        if (resolving.has(collection)) {
            this.#warnCycle(collection, [...resolving, collection]);
            return translation.clone();
        }

        resolving.add(collection);

        const effective = translation.clone();
        for (const parentCollection of effective.extends ?? []) {
            const parent = this.for(parentCollection);
            if (!parent) {
                this.#warnMissingParent(collection, parentCollection);
                continue;
            }

            const inherited = this.#resolve(parentCollection, {resolved, resolving});
            effective.inherit(inherited);
        }

        effective.extends = translation.extends ? [...translation.extends] : undefined;
        resolving.delete(collection);
        resolved.set(collection, effective);
        return effective;
    }

    #warnMissingParent(collection, parentCollection) {
        console.warn(
            `Babele | translation payload '${collection}' extends missing parent '${parentCollection}', parent ignored.`,
        );
    }

    #warnCycle(collection, chain) {
        console.warn(
            `Babele | translation payload inheritance cycle detected for '${collection}': ${chain.join(" -> ")}. Falling back to local payload.`,
        );
    }
}
