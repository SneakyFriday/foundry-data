import {CompendiumRuntime} from "./compendium-runtime.js";

/**
 * Per-document translation scope.
 *
 * It keeps the active runtime plus any converter-prepared state produced
 * before field translation begins, so sibling lookups do not depend on field
 * order.
 */
export class DocumentTranslationScope {

    /**
     * Normalize any runtime-like or scope-like value into a
     * DocumentTranslationScope.
     *
     * @param {DocumentTranslationScope|import("./compendium-runtime.js").CompendiumRuntime|object} [scopeOrRuntime]
     * @returns {DocumentTranslationScope}
     */
    static from(scopeOrRuntime = {}) {
        if (scopeOrRuntime instanceof DocumentTranslationScope) {
            return scopeOrRuntime;
        }

        return new DocumentTranslationScope(CompendiumRuntime.from(scopeOrRuntime));
    }

    constructor(runtime) {
        this._runtime = CompendiumRuntime.from(runtime);
        this._prepared = new Map();
    }

    /**
     * Return the effective runtime used by the current document translation.
     *
     * @returns {import("./compendium-runtime.js").CompendiumRuntime}
     */
    runtime() {
        return this._runtime;
    }

    /**
     * Return the mapped compendium currently active in this scope.
     *
     * @returns {*|null}
     */
    currentCompendium() {
        return this._runtime.currentCompendium();
    }

    /**
     * Return previously prepared converter state for a field-scoped key.
     *
     * @param {string} field
     * @returns {*}
     */
    prepared(field) {
        return this._prepared.get(field);
    }

    /**
     * Store prepared converter state for a field-scoped key.
     *
     * @param {string} field
     * @param {*} value
     * @returns {*}
     */
    remember(field, value) {
        this._prepared.set(field, value);
        return value;
    }

    /**
     * Publish a runtime-local mapped compendium so sibling fields can resolve
     * it independently from field iteration order.
     *
     * @param {string} key
     * @param {*} pack
     * @returns {*}
     */
    publish(key, pack) {
        this._runtime = this._runtime.child({
            localPacks: new foundry.utils.Collection([[key, pack]]),
        });
        return pack;
    }
}
