import {CompendiumTranslation} from "./compendium-translation.js";
import {CompendiumTranslations} from "./compendium-translations.js";

/**
 * Loads and composes translation and mapping payloads from discovered files.
 */
export class TranslationLoader {

    constructor({
        discovery,
        jsonLoader = null,
    } = {}) {
        this.discovery = discovery;
        this._jsonLoader = jsonLoader;
    }

    /**
     * Load and merge all effective translation payloads for one language.
     *
     * @param {string} [language]
     * @returns {Promise<CompendiumTranslations>}
     */
    async loadTranslations(language = this.#language()) {
        const translationSources = await this.discovery.translationSources(language);
        const translations = new CompendiumTranslations();

        if (translationSources.length === 0) {
            console.log(`Babele | no compendium translation files found for ${language} language.`);
            return translations;
        }

        for (const [collection, sources] of this.#translationSourcesByCollection(translationSources).entries()) {
            const orderedSources = this.discovery.orderedSourcesFor(collection, sources);
            const files = orderedSources.map((source) => source.file);
            const payload = (
                await Promise.all(
                    files.map((file) => this.#loadJsonFile(file, {
                        kind: "translation",
                        collection,
                    })),
                )
            ).reduce(
                (merged, entry) => (entry ? merged.merge(entry) : merged),
                new CompendiumTranslation(collection),
            );

            if (!payload.loaded()) {
                continue;
            }

            if (files.length > 1) {
                console.log(`Babele | translation for ${collection} pack successfully loaded from ${files.length} source file(s)`, files);
            } else {
                console.log(`Babele | translation for ${collection} pack successfully loaded from ${files[0]}`);
            }

            translations.add(payload);
        }

        return translations.resolveInheritance();
    }

    /**
     * Load and merge all global mapping payloads for one language.
     *
     * @param {string} [language]
     * @returns {Promise<object[]>}
     */
    async loadMappings(language = this.#language()) {
        const mappingFiles = (await this.discovery.mappingSources(language)).map((source) => source.file);

        if (mappingFiles.length === 0) {
            return [];
        }

        console.log("Babele | global mapping files found, defaults will be enriched/overwritten...", mappingFiles);

        const mappings = await Promise.all(
            mappingFiles.map((file) => this.#loadJsonFile(file, {
                kind: "mapping",
                phase: "global defaults enrichment",
            })),
        );

        return mappings.filter(Boolean);
    }

    async #loadJsonFile(file, context = {}) {
        try {
            return this._jsonLoader
                ? await this._jsonLoader(file, context)
                : await this.#fetchJson(file);
        } catch (error) {
            this.#logJsonLoadFailure(file, context, error);
            return null;
        }
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

    #language() {
        return game.settings.get("core", "language");
    }

    async #fetchJson(file) {
        const response = await fetch(file);

        if (response?.ok === false) {
            const status = response.status ?? "unknown";
            const statusText = response.statusText ? ` ${response.statusText}` : "";
            throw new Error(`HTTP ${status}${statusText}`);
        }

        return response.json();
    }

    #logJsonLoadFailure(file, context, error) {
        const details = {
            file,
            error: error?.message ?? String(error),
        };

        if (context.kind) {
            details.kind = context.kind;
        }

        if (context.collection) {
            details.collection = context.collection;
        }

        if (context.phase) {
            details.phase = context.phase;
        }

        console.error(`Babele | failed to load ${context.kind ?? "JSON"} file '${file}'`, details);
    }
}
