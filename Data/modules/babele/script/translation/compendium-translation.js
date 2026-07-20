import {cloneData} from "../utils/data-clone.js";

/**
 * Loaded translation payload for one compendium collection.
 *
 * Multiple source files may contribute to the same collection; this object
 * owns the merge semantics for that payload instead of leaving them inside
 * bootstrap procedural code.
 */
export class CompendiumTranslation {

    constructor(collection, payload = null) {
        this.collection = collection;
        this.label = undefined;
        this.entries = undefined;
        this.mapping = undefined;
        this.folders = undefined;
        this.extends = undefined;
        this.reference = undefined;
        this.types = undefined;
        this.#loaded = false;

        if (payload) {
            this.merge(payload);
        }
    }

    #loaded;

    merge(payload = {}) {
        if (!payload) {
            return this;
        }

        if (!this.#loaded) {
            this.label = payload.label;
            this.entries = payload.entries ? {...payload.entries} : undefined;
            this.mapping = payload.mapping ? {...payload.mapping} : undefined;
            this.folders = payload.folders ? {...payload.folders} : undefined;
            this.extends = this.#normalizeExtends(payload.extends);
            this.reference = Array.isArray(payload.reference) ? [...payload.reference] : payload.reference;
            this.types = Array.isArray(payload.types) ? [...payload.types] : payload.types;
            this.#loaded = true;
            return this;
        }

        this.label = payload.label ?? this.label;
        this.extends = this.#normalizeExtends(payload.extends) ?? this.extends;

        if (payload.entries) {
            this.entries = {
                ...(this.entries ?? {}),
                ...payload.entries,
            };
        }

        if (payload.mapping) {
            this.mapping = {
                ...(this.mapping ?? {}),
                ...payload.mapping,
            };
        }

        if (payload.folders) {
            this.folders = {
                ...(this.folders ?? {}),
                ...payload.folders,
            };
        }

        return this;
    }

    /**
     * Merge one inherited parent payload beneath this translation.
     *
     * The parent establishes defaults; local payload data remains authoritative.
     *
     * @param {CompendiumTranslation|object|null} parent
     * @returns {CompendiumTranslation}
     */
    inherit(parent) {
        if (!parent) {
            return this;
        }

        this.label = this.label ?? parent.label;

        if (parent.entries) {
            this.entries = {
                ...parent.entries,
                ...(this.entries ?? {}),
            };
        }

        if (parent.mapping) {
            this.mapping = {
                ...parent.mapping,
                ...(this.mapping ?? {}),
            };
        }

        if (parent.folders) {
            this.folders = {
                ...parent.folders,
                ...(this.folders ?? {}),
            };
        }

        this.reference = this.reference ?? this.#clone(parent.reference);
        this.types = this.types ?? this.#clone(parent.types);

        return this;
    }

    clone() {
        return new CompendiumTranslation(this.collection, {
            label: this.label,
            entries: this.#clone(this.entries),
            mapping: this.#clone(this.mapping),
            folders: this.#clone(this.folders),
            extends: this.#clone(this.extends),
            reference: this.#clone(this.reference),
            types: this.#clone(this.types),
        });
    }

    loaded() {
        return this.#loaded;
    }

    #normalizeExtends(value) {
        if (typeof value === "undefined" || value === null) {
            return undefined;
        }

        return (Array.isArray(value) ? value : [value]).filter(Boolean);
    }

    #clone(value) {
        return cloneData(value);
    }
}
