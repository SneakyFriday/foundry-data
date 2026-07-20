import {DirectoryTranslationSource} from "./translation-source.js";

/**
 * Discovers effective translation and mapping files from registered sources.
 *
 * Discovery owns cache boundaries, file deduplication, mapping filename
 * normalization, and diagnostics. It does not register sources or load JSON.
 */
export class TranslationSourceDiscovery {

    static MAPPING_FILENAME = DirectoryTranslationSource.MAPPING_FILENAME;
    static LEGACY_MAPPING_FILENAME = DirectoryTranslationSource.LEGACY_MAPPING_FILENAME;

    constructor({
        sources,
    } = {}) {
        this.sources = sources;
        this._cache = new Map();
    }

    async discover(language = this.#language()) {
        await Promise.all([this.translationSources(language), this.mappingSources(language)]);
    }

    /**
     * Return effective translation files for one language.
     *
     * @param {string} [language]
     * @returns {Promise<object[]>}
     */
    async translationSources(language = this.#language()) {
        const snapshot = this.#snapshotFor(language);

        if (snapshot.translationSources) {
            this.#debug("using cached translation source discovery", {language});
            return snapshot.translationSources;
        }

        const rawSources = await this.#discoverFromActiveSources("translation", language);
        const uniqueSources = this.#dedupeSources(rawSources);

        snapshot.translationSources = uniqueSources;
        snapshot.translationDiagnostics = this.#buildDiagnostics("translation", rawSources, uniqueSources);
        return uniqueSources;
    }

    /**
     * Return effective mapping files for one language.
     *
     * @param {string} [language]
     * @returns {Promise<object[]>}
     */
    async mappingSources(language = this.#language()) {
        const snapshot = this.#snapshotFor(language);

        if (snapshot.mappingSources) {
            this.#debug("using cached mapping source discovery", {language});
            return snapshot.mappingSources;
        }

        const rawSources = await this.#discoverFromActiveSources("mapping", language);
        const uniqueSources = this.#normalizeMappingSources(this.#dedupeSources(rawSources));

        snapshot.mappingSources = uniqueSources;
        snapshot.mappingDiagnostics = this.#buildDiagnostics("mapping", rawSources, uniqueSources);
        return uniqueSources;
    }

    /**
     * Return effective translation files contributing to one collection.
     *
     * @param {string} collection
     * @param {string} [language]
     * @returns {Promise<object[]>}
     */
    async sourcesFor(collection, language = this.#language()) {
        return this.orderedSourcesFor(collection, (await this.translationSources(language))
            .filter((source) => source.baseName === encodeURI(`${collection}.json`)));
    }

    /**
     * Order files according to collection-specific source priority.
     *
     * @param {string} collection
     * @param {object[]} sources
     * @returns {object[]}
     */
    orderedSourcesFor(collection, sources = []) {
        const order = this.sources.sourceOrderFor(collection);
        if (order.length === 0 || sources.length < 2) {
            return [...sources];
        }

        const orderRank = new Map(order.map((source, index) => [source, index]));
        return sources
            .map((source, index) => ({source, index}))
            .sort((left, right) => {
                const leftRanked = orderRank.has(left.source.source);
                const rightRanked = orderRank.has(right.source.source);

                if (!leftRanked && !rightRanked) {
                    return left.index - right.index;
                }

                if (leftRanked !== rightRanked) {
                    return leftRanked ? 1 : -1;
                }

                return orderRank.get(left.source.source) - orderRank.get(right.source.source);
            })
            .map((entry) => entry.source);
    }

    /**
     * Materialize diagnostic snapshot for one language.
     *
     * @param {string} [language]
     * @returns {Promise<object>}
     */
    async diagnostics(language = this.#language()) {
        await this.discover(language);
        const snapshot = this.#snapshotFor(language);

        return {
            language,
            translation: {
                ...snapshot.translationDiagnostics,
                packs: this.#packDiagnostics(snapshot.translationSources),
                overlaps: this.#overlapDiagnostics(snapshot.translationSources),
            },
            mapping: snapshot.mappingDiagnostics,
        };
    }

    clear(reason = "manual") {
        this._cache.clear();
        this.#debug("cleared translation source discovery cache", {reason});
    }

    cacheDiagnostics(language = this.#language()) {
        const snapshot = this._cache.get(language) ?? this.#emptySnapshot();
        const translationPacks = snapshot.translationSources ? this.#packDiagnostics(snapshot.translationSources) : [];
        const mappingSources = snapshot.mappingSources ?? [];

        return {
            boundary: "translation-source-discovery",
            language,
            cachedLanguages: [...this._cache.keys()],
            cachedLanguageCount: this._cache.size,
            translationSourcesCached: snapshot.translationSources !== null,
            mappingSourcesCached: snapshot.mappingSources !== null,
            translationDiagnosticsCached: snapshot.translationDiagnostics !== null,
            mappingDiagnosticsCached: snapshot.mappingDiagnostics !== null,
            translationFileCount: snapshot.translationSources?.length ?? 0,
            mappingFileCount: mappingSources.length,
            translatedCollectionCount: translationPacks.length,
            overlapCount: snapshot.translationSources ? this.#overlapDiagnostics(snapshot.translationSources).length : 0,
            translationFiles: snapshot.translationSources?.map((source) => source.file) ?? [],
            mappingFiles: mappingSources.map((source) => source.file),
            registeredSources: this.sources.registeredSources(),
        };
    }

    #debug(message, data = {}) {
        if (!globalThis.CONFIG?.debug?.babele) {
            return;
        }

        console.debug(`Babele | ${message}`, data);
    }

    #snapshotFor(language) {
        const currentLanguage = language ?? this.#language();
        if (!this._cache.has(currentLanguage)) {
            this._cache.set(currentLanguage, this.#emptySnapshot());
        }

        return this._cache.get(currentLanguage);
    }

    #emptySnapshot() {
        return {
            translationSources: null,
            mappingSources: null,
            translationDiagnostics: null,
            mappingDiagnostics: null,
        };
    }

    async #discoverFromActiveSources(kind, language) {
        const activeSources = this.sources.activeSources(language);
        const discovered = await Promise.all(
            activeSources.map((source) => kind === "translation"
                ? source.translationFiles(language)
                : source.mappingFiles(language)),
        );

        return discovered.flat();
    }

    #translationSourcesByCollection(sources) {
        const byCollection = new Map();

        for (const source of sources) {
            const collection = source.baseName.replace(/\.json$/u, "");
            const collectionSources = byCollection.get(collection) ?? [];
            collectionSources.push(source);
            byCollection.set(collection, collectionSources);
        }

        return byCollection;
    }

    #packDiagnostics(sources = []) {
        return [...this.#translationSourcesByCollection(sources).entries()].map(([collection, collectionSources]) => {
            const orderedSources = this.orderedSourcesFor(collection, collectionSources);
            return {
                collection,
                sourceCount: orderedSources.length,
                overlapping: orderedSources.length > 1,
                customPriority: this.sources.sourceOrderFor(collection).length > 0,
                sources: orderedSources.map((source) => source.source),
                files: orderedSources.map((source) => source.file),
            };
        });
    }

    #overlapDiagnostics(sources = []) {
        return this.#packDiagnostics(sources).filter((pack) => pack.overlapping);
    }

    #buildDiagnostics(kind, rawSources, uniqueSources) {
        return {
            kind,
            directories: [...new Set(rawSources.map((source) => source.directory))],
            rawFiles: rawSources.map((source) => source.file),
            uniqueFiles: uniqueSources.map((source) => source.file),
            duplicateFilesDiscarded: rawSources.length - uniqueSources.length,
            fromSettings: !this.sources.canIndexFiles(),
        };
    }

    #dedupeSources(sources) {
        const seen = new Set();
        return sources.filter((source) => {
            if (seen.has(source.file)) {
                return false;
            }

            seen.add(source.file);
            return true;
        });
    }

    #normalizeMappingSources(sources) {
        const byDirectory = new Map();

        for (const source of sources) {
            const entry = byDirectory.get(source.directory) ?? {};

            if (source.baseName === TranslationSourceDiscovery.MAPPING_FILENAME) {
                entry.canonical = source;
            } else if (source.baseName === TranslationSourceDiscovery.LEGACY_MAPPING_FILENAME) {
                entry.legacy = source;
            }

            byDirectory.set(source.directory, entry);
        }

        const normalized = [];
        for (const [directory, entry] of byDirectory.entries()) {
            if (entry.canonical) {
                if (entry.legacy) {
                    console.warn(`Babele | both '${TranslationSourceDiscovery.MAPPING_FILENAME}' and deprecated '${TranslationSourceDiscovery.LEGACY_MAPPING_FILENAME}' found in '${directory}'. Using '${TranslationSourceDiscovery.MAPPING_FILENAME}'.`);
                }
                normalized.push(entry.canonical);
                continue;
            }

            if (entry.legacy) {
                console.warn(`Babele | deprecated mapping filename '${TranslationSourceDiscovery.LEGACY_MAPPING_FILENAME}' found in '${directory}'. Please rename it to '${TranslationSourceDiscovery.MAPPING_FILENAME}'.`);
                normalized.push(entry.legacy);
            }
        }

        return normalized;
    }

    #language() {
        return game.settings.get("core", "language");
    }
}
