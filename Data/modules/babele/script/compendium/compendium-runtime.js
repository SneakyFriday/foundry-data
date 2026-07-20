/**
 * Runtime visibility context for Babele compendiums.
 *
 * A CompendiumRuntime overlays a local set of compendiums on top of the global
 * registry so runtime-local compendiums can participate in lookups without
 * becoming globally visible.
 */
export class CompendiumRuntime {

    /**
     * Normalize any runtime-like value into a CompendiumRuntime.
     *
     * @param {CompendiumRuntime|object} [runtime]
     * @returns {CompendiumRuntime}
     */
    static from(runtime = {}) {
        if (runtime instanceof CompendiumRuntime) {
            return runtime;
        }

        if (typeof runtime?.runtime === "function") {
            return CompendiumRuntime.from(runtime.runtime());
        }

        if (runtime?.runtime instanceof CompendiumRuntime) {
            return runtime.runtime;
        }

        return new CompendiumRuntime({
            globalPacks: runtime?.globalPacks ?? new foundry.utils.Collection(),
            localPacks: runtime?.localPacks ?? new foundry.utils.Collection(),
            currentCompendium: runtime?.currentCompendium ?? null,
        });
    }

    /**
     * @param {object} [options]
     * @param {Map|object[]|null} [options.globalPacks]
     * @param {Map|object[]|null} [options.localPacks]
     * @param {*|null} [options.currentCompendium]
     */
    constructor({globalPacks = null, localPacks = null, currentCompendium = null} = {}) {
        this.globalPacks = globalPacks ?? new foundry.utils.Collection();
        this.localPacks = localPacks ?? new foundry.utils.Collection();
        this._currentCompendium = currentCompendium;
    }

    /**
     * Return a child runtime with additional local compendiums layered on top
     * of the current visibility rules.
     *
     * @param {Map|object[]|null|object} [optionsOrLocalPacks]
     * @returns {CompendiumRuntime}
     */
    child(optionsOrLocalPacks = null) {
        const options = this.#childOptions(optionsOrLocalPacks);
        const entries = [
            ...(this.localPacks?.entries?.() ? [...this.localPacks.entries()] : []),
            ...(options.localPacks?.entries?.() ? [...options.localPacks.entries()] : []),
        ];

        return new CompendiumRuntime({
            globalPacks: this.globalPacks,
            localPacks: new foundry.utils.Collection(entries),
            currentCompendium: Object.prototype.hasOwnProperty.call(options, "currentCompendium")
                ? options.currentCompendium
                : this._currentCompendium,
        });
    }

    /**
     * Return the mapped compendium currently being translated or extracted in
     * this runtime scope.
     *
     * @returns {*|null}
     */
    currentCompendium() {
        return this._currentCompendium ?? null;
    }

    /**
     * Resolve a mapped compendium by collection id, checking local entries
     * before the global registry.
     *
     * @param {string} collection
     * @returns {*|null}
     */
    mappedCompendiumFor(collection) {
        return this.localPacks?.get?.(collection)
            ?? this.globalPacks?.get?.(collection)
            ?? null;
    }

    /**
     * Resolve the runtime-scoped mapped compendium for a document type.
     *
     * This only considers local runtime overlays. It is used for contextual
     * lookups, such as Adventure entry embedded documents, where the scoped
     * pack must not leak into the global registry.
     *
     * @param {string|null} documentType
     * @returns {*|null}
     */
    localMappedCompendiumFor(documentType) {
        if (!documentType) {
            return null;
        }

        return this.#packFromRegistry(this.localPacks, (pack) => pack.metadata?.type === documentType);
    }

    /**
     * Find the first translated compendium in runtime that can translate the
     * provided document.
     *
     * @param {string|null} documentType
     * @param {object} data
     * @returns {*|null}
     */
    translatedPackFor(documentType, data, {predicate = null} = {}) {
        return this.#translatedPackForRegistry(this.localPacks, documentType, data, predicate)
            ?? this.#translatedPackForRegistry(this.globalPacks, documentType, data, predicate);
    }

    #childOptions(optionsOrLocalPacks) {
        if (!optionsOrLocalPacks) {
            return {};
        }

        if (
            Object.prototype.hasOwnProperty.call(optionsOrLocalPacks, "localPacks")
            || Object.prototype.hasOwnProperty.call(optionsOrLocalPacks, "currentCompendium")
        ) {
            return optionsOrLocalPacks;
        }

        return {localPacks: optionsOrLocalPacks};
    }

    #translatedPackForRegistry(registry, documentType, data, predicate = null) {
        return this.#packFromRegistry(registry, (pack) =>
            pack.translated
            && pack.hasTranslation(data, documentType)
            && (!predicate || predicate(pack)),
        );
    }

    #packFromRegistry(registry, predicate) {
        const packs = registry?.values?.() ? [...registry.values()] : [];
        for (let index = packs.length - 1; index >= 0; index -= 1) {
            if (predicate(packs[index])) {
                return packs[index];
            }
        }

        return null;
    }
}
