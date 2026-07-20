import {cloneData} from "../utils/data-clone.js";

/**
 * Catalog of synthetic package-scoped `_packs-folders` translations.
 *
 * This is not a registry: it does not accept external registrations. It
 * materializes folder translation payloads from already loaded compendium
 * translations.
 */
export class PackFolderTranslationsCatalog {

    static FOLDER_TRANSLATION_NAME = "_packs-folders";

    constructor({
        translations = null,
        packs = null,
    } = {}) {
        this.translations = translations;
        this.packs = packs ?? new foundry.utils.Collection();
    }

    async load() {
        this.#materialize();
        return this;
    }

    get(collection) {
        return this.packs.get(collection) ?? null;
    }

    values() {
        return this.packs.values();
    }

    matching(predicate) {
        return [...this.values()].filter(predicate);
    }

    allTranslations() {
        return [...this.values()].reduce(
            (translations, pack) => Object.assign(translations, cloneData(pack.entries ?? {})),
            {},
        );
    }

    cacheDiagnostics() {
        const packs = [...this.values()];

        return {
            boundary: "pack-folder-translations",
            packCount: packs.length,
            entryCount: packs.reduce((total, pack) => total + Object.keys(pack.entries ?? {}).length, 0),
            packs: packs.map((pack) => ({
                collection: pack.collection,
                entryCount: Object.keys(pack.entries ?? {}).length,
            })),
        };
    }

    #materialize() {
        this.packs = new foundry.utils.Collection();

        for (const translation of this.translations?.values?.() ?? []) {
            if (!this.#isFolderTranslationCollection(translation.collection)) {
                continue;
            }

            this.packs.set(translation.collection, {
                collection: translation.collection,
                entries: cloneData(translation.entries ?? {}),
            });
        }
    }

    #isFolderTranslationCollection(collection) {
        return String(collection ?? "").endsWith(`.${PackFolderTranslationsCatalog.FOLDER_TRANSLATION_NAME}`);
    }
}
