import {MappedCompendiums} from "../compendium/mapped-compendiums.js";
import {PackFolderTranslationsCatalog} from "./pack-folder-translations-catalog.js";
import {FolderTranslations} from "../compendium/folder-translations.js";
import {DocumentMappings} from "../mapping/document-mappings.js";

/**
 * Coherent Babele translation state for one language.
 *
 * A session is headless: it can translate, extract, resolve mapped
 * compendiums, and provide folder translations without applying anything to
 * the Foundry runtime by itself.
 */
export class TranslationSession {

    /**
     * Build one language-scoped translation session from registered sources.
     *
     * @param {object} options
     * @param {string} options.language
     * @param {import("./translation-sources.js").TranslationSources} options.sources
     * @param {object} [options.builtInMappings]
     * @param {object[]} [options.registeredMappings]
     * @param {import("../identity/identity-extractor-registry.js").IdentityExtractorRegistry} options.identityExtractors
     * @param {import("../converter/converter-registry.js").ConverterRegistry} options.converterRegistry
     * @param {import("./translation-entries.js").TranslationStrategy[]} [options.translationStrategies]
     * @returns {Promise<TranslationSession>}
     */
    static async load({
        language,
        sources,
        builtInMappings = undefined,
        registeredMappings = [],
        identityExtractors,
        converterRegistry,
        translationStrategies = [],
    }) {
        const documentMappings = new DocumentMappings(builtInMappings, {
            registeredMappings,
            loadedMappings: await sources.loadMappings(language),
            identityExtractors,
            converterRegistry,
        });
        const translations = await sources.loadTranslations(language);
        const mappedCompendiums = await new MappedCompendiums({
            documentMappings,
            translations,
            translationStrategies,
            language,
        }).load();
        const packFolderTranslations = await new PackFolderTranslationsCatalog({
            translations,
        }).load();

        return new TranslationSession({
            language,
            translations,
            documentMappings,
            mappedCompendiums,
            packFolderTranslations,
        });
    }

    constructor({
        language,
        translations,
        documentMappings,
        mappedCompendiums,
        packFolderTranslations,
    }) {
        this.language = language;
        this.translations = translations;
        this.documentMappings = documentMappings;
        this.mappedCompendiums = mappedCompendiums;
        this.packFolderTranslations = packFolderTranslations;
        this.folderTranslations = new FolderTranslations({
            mappedCompendiums,
            packFolderTranslations,
        });
    }

    /**
     * Resolve the managed compendium for one collection id.
     *
     * @param {string} collection
     * @returns {import("../compendium/mapped-compendium.js").MappedCompendium|null}
     */
    mappedCompendiumFor(collection) {
        return this.mappedCompendiums?.get?.(collection) ?? null;
    }

    /**
     * Resolve the translated managed compendium for one collection id.
     *
     * @param {string} collection
     * @returns {import("../compendium/mapped-compendium.js").MappedCompendium|null}
     */
    translatedCompendiumFor(collection) {
        return this.mappedCompendiums?.translated?.(collection) ?? null;
    }

    runtime(options = {}) {
        return this.mappedCompendiums?.runtime?.(options);
    }

    /**
     * Determine whether one collection has an active translation payload.
     *
     * @param {string} collection
     * @returns {boolean}
     */
    isTranslated(collection) {
        return !!this.translatedCompendiumFor(collection);
    }

    /**
     * Translate one compendium index in place.
     *
     * @param {object[]} index
     * @param {string} collection
     * @returns {object[]}
     */
    translateIndex(index, collection) {
        return this.mappedCompendiums?.translateIndex(index, collection) ?? index;
    }

    /**
     * Translate one compendium document payload.
     *
     * @param {string} collection
     * @param {*} data
     * @param {boolean} [translationsOnly]
     * @returns {*}
     */
    translate(collection, data, translationsOnly = false) {
        return this.mappedCompendiums?.translate(collection, data, translationsOnly) ?? data;
    }

    /**
     * Translate one mapped field from a compendium document.
     *
     * @param {string} field
     * @param {string} collection
     * @param {*} data
     * @returns {*}
     */
    translateField(field, collection, data) {
        return this.mappedCompendiums?.translateField(collection, field, data) ?? null;
    }

    /**
     * Extract the exportable translation payload for one compendium document.
     *
     * @param {string} collection
     * @param {*} data
     * @param {object} [options]
     * @returns {*}
     */
    extract(collection, data, options = {}) {
        return this.mappedCompendiums?.extract(collection, data, options);
    }

    /**
     * Extract one mapped field from a compendium document.
     *
     * @param {string} collection
     * @param {string} field
     * @param {*} data
     * @returns {*}
     */
    extractField(collection, field, data) {
        return this.mappedCompendiums?.extractField(collection, field, data);
    }

    /**
     * Resolve one effective document mapping.
     *
     * @param {string} documentType
     * @param {object|null} [customMapping]
     * @returns {import("../mapping/document-mapping.js").DocumentMapping}
     */
    mappingFor(documentType, customMapping = null) {
        return this.documentMappings.mappingFor(documentType, customMapping);
    }

    /**
     * Apply folder-name translations to one open compendium tree.
     *
     * @param {CompendiumCollection|object} pack
     * @returns {void}
     */
    translatePackFolders(pack) {
        this.folderTranslations.translatePackFolders(pack);
    }

    /**
     * Apply folder-name translations to one imported world folder.
     *
     * @param {Folder|object} folder
     * @returns {void}
     */
    translateImportedCompendiumFolder(folder) {
        this.folderTranslations.translateImportedCompendiumFolder(folder);
    }

    /**
     * Re-apply imported compendium folder translations to a folder collection.
     *
     * @param {Iterable<Folder>|object} [folders]
     * @returns {void}
     */
    translateImportedCompendiumFolders(folders = game.collections.get("Folder")) {
        this.folderTranslations.translateImportedCompendiumFolders(folders);
    }

    /**
     * Apply `_packs-folders` translations to top-level system/world folders.
     *
     * @returns {void}
     */
    translateSystemPackFolders() {
        this.folderTranslations.translateSystemPackFolders();
    }

    /**
     * Clear runtime caches owned by this session.
     *
     * @param {string} [reason]
     * @returns {void}
     */
    invalidateCaches(reason = "manual") {
        this.mappedCompendiums?.invalidateCaches?.(reason);
    }

    /**
     * Return a diagnostic snapshot for the session cache boundaries.
     *
     * @returns {object}
     */
    cacheDiagnostics() {
        return {
            boundary: "translation-session",
            language: this.language,
            documentMappings: this.documentMappings.cacheDiagnostics(),
            packFolderTranslations: this.packFolderTranslations?.cacheDiagnostics?.() ?? {
                boundary: "pack-folder-translations",
                packCount: 0,
                entryCount: 0,
                packs: [],
            },
            mappedCompendiums: this.mappedCompendiums?.cacheDiagnostics?.() ?? {
                boundary: "mapped-compendiums",
                packCount: 0,
                translatedPackCount: 0,
                untranslatedPackCount: 0,
                cachedIndexEntries: 0,
                indexTranslationEntries: 0,
                byDocumentType: {},
                packs: [],
            },
        };
    }

    /**
     * Release references and clear runtime caches owned by this session.
     *
     * @param {string} [reason]
     * @returns {void}
     */
    dispose(reason = "dispose") {
        this.invalidateCaches(reason);
        this.translations = null;
        this.documentMappings = null;
        this.mappedCompendiums = null;
        this.packFolderTranslations = null;
        this.folderTranslations = null;
    }

}
