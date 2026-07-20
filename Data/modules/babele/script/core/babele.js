import {Converters} from "../converter/converters.js";
import {DocumentConverter} from "../converter/document-converter.js";
import {StructuredDataConverter} from "../converter/structured-data-converter.js";
import {LookupConverter} from "../converter/lookup-converter.js";
import {ReferencedDocumentFieldConverter} from "../converter/referenced-document-field-converter.js";
import {TokenizedLookupConverter} from "../converter/tokenized-lookup-converter.js";
import {ConverterRegistry} from "../converter/converter-registry.js";
import {DocumentMappings} from "../mapping/document-mappings.js";
import {IdentityExtractorRegistry} from "../identity/identity-extractor-registry.js";
import {TranslationSources} from "../translation/translation-sources.js";
import {TranslationSession} from "../translation/translation-session.js";
import {cloneData} from "../utils/data-clone.js";

/**
 * Headless Babele translation framework.
 *
 * This class owns the configuration and registries needed to build
 * language-scoped translation sessions. It does not install hooks, mutate
 * Foundry runtime collections, or expose UI behavior.
 */
export class Babele {

    /**
     * Compatibility alias for older call sites still reading
     * `engine.translationRegistry`.
     *
     * @returns {TranslationSources}
     */
    get translationRegistry() {
        return this.translationSources;
    }

    /**
     * Build a default framework instance for the Foundry module runtime.
     *
     * @param {object} [options]
     * @returns {Babele}
     */
    static createFoundryDefault(options = {}) {
        return new Babele(options);
    }

    /**
     * Build a default framework instance.
     *
     * @param {object} [options]
     * @returns {Babele}
     */
    static create(options = {}) {
        return new Babele(options);
    }

    constructor({
        identityExtractors = new IdentityExtractorRegistry(IdentityExtractorRegistry.defaultExtractors()),
        converterRegistry = new ConverterRegistry(),
        builtInMappings = undefined,
        registeredMappings = [],
        translationSources = new TranslationSources(),
        translationMatchStrategies = [],
        registerConfiguredDirectory = true,
        registerDefaults = true,
    } = {}) {
        this.identityExtractors = identityExtractors;
        this.converterRegistry = converterRegistry;
        this.translationSources = translationSources;
        this.translationMatchStrategiesList = [...translationMatchStrategies];
        this.builtInMappings = cloneData(builtInMappings ?? undefined);
        this.registeredMappings = registeredMappings.map((mapping) => cloneData(mapping));

        if (registerDefaults) {
            this.registerDefaultIdentityExtractors();
            this.registerDefaultConverters();
        }

        if (registerConfiguredDirectory) {
            this.translationSources.registerConfiguredDirectory();
        }
    }

    /**
     * Register the built-in identity extractors exposed by Babele.
     *
     * @returns {Babele}
     */
    registerDefaultIdentityExtractors() {
        return this.registerIdentityExtractors({
            range: (document) => {
                const [start, end] = document?.range ?? [];
                return Number.isInteger(start) && Number.isInteger(end) ? `${start}-${end}` : null;
            },
        });
    }

    /**
     * Register the default converters shipped with Babele.
     *
     * @returns {Babele}
     */
    registerDefaultConverters() {
        return this.registerConverters({
            ...Converters.legacyRegistrations(),
            "document": new DocumentConverter(),
            "structured": new StructuredDataConverter(),
            "lookup": new LookupConverter(),
            "tokenizedLookup": new TokenizedLookupConverter(),
            "referencedDocumentField": new ReferencedDocumentFieldConverter(),
        });
    }

    /**
     * Register one module translation source.
     *
     * @param {{module: string, dir: string, lang?: string}} module
     * @returns {Babele}
     */
    register(module) {
        return this.registerModule(module);
    }

    /**
     * Register or replace one translation source by name.
     *
     * @param {{name?: string}} source
     * @returns {TranslationSources}
     */
    registerSource(source) {
        this.translationSources.register(source);
        return this;
    }

    /**
     * Register one module translation source.
     *
     * @param {{module: string, dir: string, lang?: string}} module
     * @returns {Babele}
     */
    registerModule(module) {
        this.translationSources.registerModule(module);
        return this;
    }

    /**
     * Register one named converter.
     *
     * @param {string} name
     * @param {Function|object} converter
     * @returns {Babele}
     */
    registerConverter(name, converter) {
        return this.registerConverters({[name]: converter});
    }

    /**
     * Register multiple named converters.
     *
     * @param {Record<string, Function|object>} converters
     * @returns {Babele}
     */
    registerConverters(converters) {
        this.converterRegistry.registerAll(converters);
        return this;
    }

    /**
     * Register one custom translation match strategy.
     *
     * @param {import("../translation/translation-entries.js").TranslationStrategy} strategy
     * @returns {Babele}
     */
    registerTranslationMatchStrategy(strategy) {
        return this.registerTranslationMatchStrategies([strategy]);
    }

    /**
     * Register multiple custom translation match strategies.
     *
     * @param {import("../translation/translation-entries.js").TranslationStrategy[]} strategies
     * @returns {Babele}
     */
    registerTranslationMatchStrategies(strategies = []) {
        this.translationMatchStrategiesList.push(...(strategies ?? []).filter(Boolean));
        return this;
    }

    /**
     * Register one named identity extractor.
     *
     * @param {string} name
     * @param {Function} extractor
     * @returns {Babele}
     */
    registerIdentityExtractor(name, extractor) {
        return this.registerIdentityExtractors({[name]: extractor});
    }

    /**
     * Register multiple named identity extractors.
     *
     * @param {Record<string, Function>} extractors
     * @returns {Babele}
     */
    registerIdentityExtractors(extractors = {}) {
        this.identityExtractors.registerAll(extractors);
        return this;
    }

    /**
     * Return the live identity extractor registry.
     *
     * @returns {IdentityExtractorRegistry}
     */
    identityExtractorRegistry() {
        return this.identityExtractors;
    }

    /**
     * Return custom translation match strategies in precedence order.
     *
     * @returns {import("../translation/translation-entries.js").TranslationStrategy[]}
     */
    translationMatchStrategies() {
        return [...this.translationMatchStrategiesList];
    }

    /**
     * Register one global document mapping layer.
     *
     * @param {object} mapping
     * @returns {Babele}
     */
    registerMapping(mapping) {
        this.registeredMappings.push(cloneData(mapping));
        return this;
    }

    /**
     * Return a diagnostic view of the effective mapping for one document type.
     *
     * @param {string} documentType
     * @param {{data?: object, customMapping?: object|null}} [options]
     * @returns {object}
     */
    inspectMapping(documentType, options = {}) {
        return this.documentMappings().inspect(documentType, options);
    }

    /**
     * Return framework-level cache diagnostics.
     *
     * @returns {object}
     */
    cacheDiagnostics() {
        return {
            translationSources: this.translationSources.cacheDiagnostics(),
            documentMappings: this.documentMappings().cacheDiagnostics(),
        };
    }

    /**
     * Return translation-source diagnostics.
     *
     * @param {string} [language]
     * @returns {Promise<object>}
     */
    async sourceDiagnostics(language = undefined) {
        return this.translationSources.diagnostics(language);
    }

    /**
     * Return configured source priority.
     *
     * @returns {{global: string[], collections: Record<string, string[]>}}
     */
    sourcePriority() {
        return this.translationSources.sourcePriority();
    }

    /**
     * Persist source priority for one collection.
     *
     * @param {string} collection
     * @param {string[]} sources
     * @returns {Promise<void>}
     */
    async setSourcePriority(collection, sources = []) {
        await this.translationSources.setSourcePriority(collection, sources);
    }

    /**
     * Declare the system-level translations directory.
     *
     * @param {string|null} dir
     * @returns {Babele}
     */
    setSystemTranslationsDir(dir) {
        this.translationSources.registerSystemTranslations(dir);
        return this;
    }

    /**
     * Build a headless translation session for one language.
     *
     * @param {string|object} [languageOrOptions]
     * @param {string} [languageOrOptions.language]
     * @returns {Promise<TranslationSession>}
     */
    async session(languageOrOptions = {}) {
        const language = this.#sessionLanguage(languageOrOptions);

        return TranslationSession.load({
            language,
            sources: this.translationSources,
            builtInMappings: this.builtInMappings,
            registeredMappings: this.registeredMappings,
            identityExtractors: this.identityExtractors,
            converterRegistry: this.converterRegistry,
            translationStrategies: this.translationMatchStrategies(),
        });
    }

    /**
     * Materialize the mapping aggregate configured by API registrations only.
     *
     * Session-specific loaded mapping files are intentionally not included
     * here because they belong to a language-scoped `TranslationSession`.
     *
     * @returns {DocumentMappings}
     */
    documentMappings() {
        return new DocumentMappings(this.builtInMappings, {
            registeredMappings: this.registeredMappings,
            identityExtractors: this.identityExtractors,
            converterRegistry: this.converterRegistry,
        });
    }

    /**
     * Compatibility alias for callers that prefer the previous naming.
     *
     * @param {object} [options]
     * @param {string} [options.language]
     * @returns {Promise<TranslationSession>}
     */
    async sessionFor(options = {}) {
        return this.session(options);
    }

    /**
     * Restore the original mapped values of a translated document and strip
     * Babele translation markers from the materialized payload.
     *
     * Callers may provide session-scoped `documentMappings` and/or a
     * compendium-local `customMapping` when loaded mapping layers are needed
     * to rebuild the original document shape.
     *
     * @param {string} documentType
     * @param {object} data
     * @param {object} [options]
     * @param {import("../mapping/document-mappings.js").DocumentMappings|null} [options.documentMappings]
     * @param {object|null} [options.customMapping]
     * @param {object} [options.runtime]
     * @returns {object|null}
     */
    rollbackDocument(documentType, data, {
        documentMappings = null,
        customMapping = null,
        runtime = {},
    } = {}) {
        if (!data || typeof data !== "object") {
            return null;
        }

        const originalPayload = data?.flags?.babele?.originalPayload ?? null;
        let restored = foundry.utils.mergeObject({}, data, {inplace: false});

        if (originalPayload && typeof documentType === "string" && documentType.length > 0) {
            const mappings = documentMappings ?? this.documentMappings();
            const mapping = mappings.mappingFor(documentType, customMapping);
            mapping.prepare(data, originalPayload, runtime);
            const payload = mapping.map(data, originalPayload, runtime);
            restored = foundry.utils.mergeObject(restored, payload, {inplace: false});
        }

        return this.#withoutTranslationMarkers(restored);
    }

    #sessionLanguage(languageOrOptions) {
        if (typeof languageOrOptions === "string") {
            return languageOrOptions;
        }

        const language = languageOrOptions?.language;
        if (language) {
            return language;
        }

        if (globalThis.game?.settings) {
            return game.settings.get("core", "language");
        }

        throw new Error("Babele.session requires a language when Foundry settings are not available.");
    }

    #withoutTranslationMarkers(data) {
        const restored = foundry.utils.mergeObject({}, data ?? {}, {inplace: false});

        delete restored.originalName;
        delete restored.hasTranslation;
        delete restored.translated;

        if (restored.flags && typeof restored.flags === "object") {
            delete restored.flags.babele;
            if (Object.keys(restored.flags).length === 0) {
                delete restored.flags;
            }
        }

        return restored;
    }

}
