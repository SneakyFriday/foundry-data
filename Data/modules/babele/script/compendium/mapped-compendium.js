import {TranslationEntries} from "../translation/translation-entries.js";
import {DocumentTranslation} from "../translation/document-translation.js";
import {CompendiumRuntime} from "./compendium-runtime.js";
import {DocumentTranslationScope} from "./document-translation-scope.js";
import {cloneData} from "../utils/data-clone.js";

/**
 * Babele-managed view of a Foundry compendium.
 *
 * A MappedCompendium owns the metadata, mapping and translation entries used
 * to translate or extract a coherent document collection.
 *
 * The collection may come from a root Foundry compendium or from a runtime
 * local embedded-document scope. The model is the same; only the origin of the
 * data changes.
 */
export class MappedCompendium {

    static #warnedMissingReferences = new Set();
    static #warnedTranslationFailures = new Set();
    #indexTranslationCache = new Map();
    #runtimeFactory;

    /**
     * @param {object} metadata Foundry pack metadata or equivalent runtime-local metadata.
     * @param {object|null} translations Loaded Babele translation payload for the pack.
     * @param {object} [options]
     * @param {import("../translation/translation-entries.js").TranslationStrategy[]} [options.translationStrategies]
     * @param {import("../mapping/document-mappings.js").DocumentMappings} options.documentMappings
     * @param {string|null} [options.language]
     * @param {function(object=): import("./compendium-runtime.js").CompendiumRuntime|null} [options.runtimeFactory]
     */
    constructor(metadata, translations, {translationStrategies, documentMappings, language = null, runtimeFactory = null} = {}) {
        this.metadata = this.#clone(metadata);
        this.translation = this.#clone(translations);
        this.translated = false;
        this.language = typeof language === "string" && language.trim().length > 0 ? language.trim() : null;
        this.#runtimeFactory = typeof runtimeFactory === "function" ? runtimeFactory : null;
        this.customMapping = this.translation?.mapping ?? null;
        this.documentMappings = this.#documentMappings(documentMappings);
        this.documentMapping = this.documentMappings.mappingFor(metadata.type, this.customMapping);
        this.translationEntries = new TranslationEntries(this.translation?.entries, translationStrategies);

        if (this.translation) {
            if (this.translation.label) {
                this.metadata = foundry.utils.mergeObject(this.metadata, {label: this.translation.label});
            }

            this.translated = true;
            this.reference = null;

            if (this.translation.reference) {
                this.reference = Array.isArray(this.translation.reference) ? [...this.translation.reference] : [this.translation.reference];
            }

            if (this.translation.folders) {
                this.folders = this.#clone(this.translation.folders);
            }

            if (this.translation.types) {
                this.types = [...this.translation.types];
            }
        }
    }

    /**
     * Return the effective mapping for this compendium.
     * Conditional `_variants` are evaluated by the mapping itself against the
     * source document being translated or extracted.
     *
     * @returns {import("../mapping/document-mapping.js").DocumentMapping}
     */
    get mapping() {
        return this.documentMapping;
    }

    /**
     * Return the effective translation match strategies used by this
     * compendium.
     *
     * @returns {import("../translation/translation-entries.js").TranslationStrategy[]}
     */
    translationMatchStrategies() {
        return this.translationEntries.customStrategies();
    }

    get translations() {
        return this.translationEntries.snapshot();
    }

    /**
     * Clear runtime caches owned by this mapped compendium.
     *
     * @param {string} [reason]
     * @returns {void}
     */
    invalidateCaches(reason = "manual") {
        this.#indexTranslationCache.clear();
        this.#debug("invalidated mapped compendium cache", {
            reason,
            collection: this.metadata?.id ?? this.metadata?.name ?? null,
        });
    }

    /**
     * Return a snapshot of cache boundaries owned by this mapped compendium.
     *
     * @returns {object}
     */
    cacheDiagnostics() {
        const cachedIndexEntries = this.#indexTranslationCache.size;

        return {
            boundary: "mapped-compendium",
            collection: this.metadata?.id ?? this.metadata?.name ?? null,
            documentType: this.metadata?.type ?? null,
            translated: this.translated,
            cachedIndexEntries,
            indexTranslationEntries: cachedIndexEntries,
        };
    }

    /**
     * Return the folder-translation payload owned by this compendium.
     *
     * Normal compendiums expose folder translations through the `folders`
     * property of their translation file. Synthetic `_packs-folders`
     * collections instead expose folder names through `entries`, because they
     * do not contain document entries at all.
     *
     * @returns {object}
     */
    folderTranslations() {
        if (this.metadata?.name === "_packs-folders") {
            return this.translations ?? {};
        }

        return this.folders ?? {};
    }

    /**
     * Determine whether this compendium can provide a translation for the
     * given document. This is narrower than the `translated` pack state: a
     * pack may be marked as translated and still have no matching entry for a
     * specific document.
     *
     * @param data
     * @param {string|null} [documentType]
     * @returns {boolean}
     */
    hasTranslation(data, documentType = this.metadata?.type ?? null, runtime) {
        if (!this.translated) {
            return false;
        }

        if (documentType && this.metadata?.type && this.metadata.type !== documentType) {
            return false;
        }

        if (this.types && !this.types.includes(data.type)) {
            return false;
        }

        const resolution = this.#resolutionFor(data, documentType);
        return resolution.matched || this.hasReferenceTranslations(data, runtime);
    }

    /**
     * Translate a compendium index in place and return it.
     *
     * @param {object[]} index
     * @returns {object[]}
     */
    translateIndex(index) {
        for (const entry of index) {
            foundry.utils.mergeObject(entry, this.#translatedIndexEntry(entry), {inplace: true});
        }

        return index;
    }

    /**
     * Return the raw translation entry matched for a document, or an empty
     * object when no entry exists.
     *
     * @param data
     * @returns {object}
     */
    translationsFor(data, documentType = this.metadata?.type ?? null) {
        return this.#resolutionFor(data, documentType).entry ?? {};
    }

    /**
     * Resolve the translation key used for a document.
     *
     * @param data
     * @returns {string|null}
     */
    translationKeyFor(data, documentType = this.metadata?.type ?? null) {
        return this.#resolutionFor(data, documentType).key;
    }

    /**
     * Determine whether a referenced translated pack can translate the same
     * document when this compendium has no direct entry.
     *
     * @param data
     * @returns {boolean}
     */
    hasReferenceTranslations(data, runtime) {
        return this.#hasReferenceTranslations(data, runtime);
    }

    /**
     * Extract the translatable payload for a document.
     *
     * @param data
     * @param {CompendiumRuntime|object} [runtime] Runtime context controlling
     * visible compendiums during extraction.
     * @returns {*}
     */
    extract(data, runtime) {
        const scope = this.#documentScope(data, {}, runtime);
        return this.mapping.extract(data, scope);
    }

    /**
     * Return the already extracted original translation payload for a source
     * document.
     *
     * @param data
     * @returns {object|null}
     */
    sourcePayload(data) {
        if (data == null) {
            return null;
        }

        return this.#sourcePayload(data);
    }

    /**
     * Extract a single mapped field from a document.
     *
     * @param {string} field
     * @param data
     * @param {CompendiumRuntime|object} [runtime]
     * @returns {*}
     */
    extractField(field, data, runtime) {
        const scope = this.#documentScope(data, {}, runtime);
        return this.mapping.extractField(field, data, scope);
    }

    /**
     * Translate a single mapped field for a document, falling back to the
     * original extracted field value on missing translations or converter
     * failures.
     *
     * @param {string} field
     * @param data
     * @param {CompendiumRuntime|object} [runtime]
     * @returns {*}
     */
    translateField(field, data, runtime) {
        if (data == null) {
            return data;
        }

        const resolution = this.#resolutionFor(data);
        const scope = this.#documentScope(data, resolution.entry ?? {}, runtime);
        const hasTranslation = resolution.matched;
        const mapping = this.mapping;

        if (!(hasTranslation || mapping.usesConverters())) {
            return this.extractField(field, data, scope);
        }

        if (data.translated) {
            return this.extractField(field, data, scope);
        }

        try {
            const translated = mapping.translateField(field, data, resolution.entry ?? {}, scope);
            return typeof translated === "undefined" ? this.extractField(field, data, scope) : translated;
        } catch (error) {
            this.#logTranslationFailure(data, error, {field, phase: "translateField"});
            return this.extractField(field, data, scope);
        }
    }

    /**
     * Translate a document using this compendium mapping and translation
     * entries.
     *
     * When `translationsOnly` is truthy, the method returns only the translated
     * payload without merging it into the original document shape.
     *
     * @param data
     * @param {boolean} [translationsOnly]
     * @param {CompendiumRuntime|object} [runtime] Runtime context used for
     * pack visibility. Decorated compendiums may enrich it with additional
     * scoped entries before delegating here.
     * @returns {*}
     */
    translate(data, translationsOnly = false, runtime) {
        if (data == null) {
            return data;
        }

        const resolution = this.#resolutionFor(data);
        const hasTranslation = resolution.matched;
        const mapping = this.mapping;

        if (!(hasTranslation || mapping.usesConverters())) {
            return data;
        }

        if (data.translated) {
            return data;
        }

        let translatedData = {};
        const scope = this.#documentScope(data, resolution.entry ?? {}, runtime);

        try {
            translatedData = mapping.map(data, resolution.entry ?? {}, scope);
            translatedData = this.#mergeReferenceTranslations(data, translatedData, scope);
            translatedData = this.#applyTranslationHooks(data, translatedData, {
                hasTranslation,
                translation: resolution.entry ?? {},
                runtime: scope,
            });
        } catch (error) {
            this.#logTranslationFailure(data, error, {phase: "translate"});
            return translationsOnly ? {} : data;
        }

        if (translationsOnly) {
            return translatedData;
        }

        return new DocumentTranslation({
            source: data,
            payload: translatedData,
            hasTranslation,
            originalPayload: this.#sourcePayload(data),
            language: this.language,
        }).apply();
    }

    #mergeReferenceTranslations(data, translatedData, runtime = {}) {
        if (!this.reference) {
            return translatedData;
        }

        let mergedTranslations = translatedData;

        for (const ref of this.reference) {
            const referencePack = this.#resolveReferencePack(ref, runtime);
            if (referencePack?.hasTranslation(data, undefined, runtime)) {
                const fromReference = referencePack.translate(data, true, runtime);
                mergedTranslations = foundry.utils.mergeObject(fromReference, mergedTranslations);
            }
        }

        return mergedTranslations;
    }

    #hasReferenceTranslations(data, runtime) {
        if (!this.reference) {
            return false;
        }

        for (const ref of this.reference) {
            const referencePack = this.#resolveReferencePack(ref, runtime);
            if (referencePack?.hasTranslation(data, undefined, runtime)) {
                return true;
            }
        }

        return false;
    }

    #resolveReferencePack(ref, runtime) {
        const referencePack = this.#normalizeRuntime(runtime).mappedCompendiumFor(ref);
        if (referencePack) {
            return referencePack;
        }

        const warningKey = `${this.metadata?.id ?? this.metadata?.name ?? "unknown"}::${ref}`;
        if (!MappedCompendium.#warnedMissingReferences.has(warningKey)) {
            MappedCompendium.#warnedMissingReferences.add(warningKey);
            console.warn(`Babele | invalid reference pack '${ref}' declared for '${this.metadata?.id ?? this.metadata?.name ?? "unknown"}'`);
        }

        return null;
    }

    #applyTranslationHooks(data, translatedData, context = {}) {
        if (!context.hasTranslation) {
            return translatedData;
        }

        const hookContext = {
            pack: this,
            metadata: this.metadata,
            source: data,
            translated: translatedData,
            translation: context.translation ?? {},
            runtime: context.runtime ?? null,
        };

        try {
            Hooks.callAll("babele.translateDocumentData", hookContext);
        } catch (error) {
            const pack = this.metadata?.id ?? this.metadata?.name ?? "unknown";
            console.error(`Babele | translateDocumentData hook failed for '${pack}'`, {
                pack,
                documentId: data?._id ?? null,
                documentName: data?.name ?? null,
                error: error?.message ?? String(error),
            });
            return translatedData;
        }

        return hookContext.translated ?? translatedData;
    }

    #sourcePayload(data) {
        try {
            return this.extract(data) ?? null;
        } catch (_error) {
            return null;
        }
    }

    #normalizeRuntime(runtime) {
        return (arguments.length === 0
            || runtime === undefined
            || runtime === null || (typeof runtime === "object" && true && Object.keys(runtime).length === 0))
            ? this.#rootRuntime()
            : CompendiumRuntime.from(runtime);
    }

    #rootRuntime() {
        return this.#runtimeFactory?.() ?? new CompendiumRuntime();
    }

    #resolutionFor(data, documentType = this.metadata?.type ?? null) {
        return this.translationEntries.matchFor(data, this.#resolverContextFor(data, documentType));
    }

    #resolverContext(documentType = this.metadata?.type ?? null) {
        return {
            documentType,
            pack: this,
            metadata: this.metadata,
        };
    }

    #resolverContextFor(data, documentType = this.metadata?.type ?? null) {
        return {
            ...this.#resolverContext(documentType),
            matchCandidates: this.mapping.matchKeyCandidates(data),
        };
    }

    #translatedIndexEntry(entry) {
        const translationsOnly = !!entry?.translated;
        if (translationsOnly) {
            return this.translate(entry, true);
        }

        const cacheKey = this.#indexCacheKey(entry);
        if (cacheKey && this.#indexTranslationCache.has(cacheKey)) {
            this.#debug("using cached translated index entry", {
                collection: this.metadata?.id ?? this.metadata?.name ?? null,
                documentId: entry?._id ?? entry?.id ?? null,
                documentName: entry?.name ?? null,
            });
            const cached = this.#indexTranslationCache.get(cacheKey);
            return cached ? foundry.utils.mergeObject({}, cached, {inplace: false}) : entry;
        }

        const translated = this.translate(entry, false);

        if (cacheKey) {
            this.#indexTranslationCache.set(
                cacheKey,
                translated === entry ? null : foundry.utils.mergeObject({}, translated, {inplace: false}),
            );
        }

        return translated;
    }

    #indexCacheKey(entry) {
        const candidates = this.translationEntries.candidateKeysFor(entry, this.#resolverContextFor(entry));
        const sourceId = foundry.utils.parseUuid(entry?.flags?.core?.sourceId || entry?._stats?.compendiumSource)?.id ?? null;

        return JSON.stringify([
            this.metadata?.id ?? this.metadata?.name ?? null,
            entry?._id ?? entry?.id ?? null,
            entry?.name ?? null,
            entry?.type ?? null,
            sourceId,
            candidates,
        ]);
    }

    #debug(message, data = {}) {
        if (!globalThis.CONFIG?.debug?.babele) {
            return;
        }

        console.debug(`Babele | ${message}`, data);
    }

    #activeRuntime(runtime) {
        const activeRuntime = this.#normalizeRuntime(runtime);
        return activeRuntime.currentCompendium() === this
            ? activeRuntime
            : activeRuntime.child({currentCompendium: this});
    }

    #documentScope(data, translations = {}, runtime) {
        const scope = DocumentTranslationScope.from(this.#activeRuntime(runtime));
        this.mapping.prepare(data, translations, scope);
        return scope;
    }

    #documentMappings(documentMappings) {
        if (!documentMappings) {
            throw new Error(`MappedCompendium requires documentMappings for '${this.metadata?.type ?? "unknown"}'.`);
        }

        return documentMappings;
    }

    #clone(value) {
        if (typeof value === "undefined" || value === null) {
            return value ?? null;
        }

        return cloneData(value);
    }

    #logTranslationFailure(data, error, context = {}) {
        const pack = this.metadata?.id ?? this.metadata?.name ?? "unknown";
        const errorMessage = error?.message ?? String(error);
        const warningKey = `${context.phase ?? "translate"}::${pack}::${context.field ?? "*"}::${data?._id ?? data?.name ?? "unknown"}::${errorMessage}`;

        if (MappedCompendium.#warnedTranslationFailures.has(warningKey)) {
            return;
        }

        MappedCompendium.#warnedTranslationFailures.add(warningKey);
        console.error(`Babele | translation failed for document in '${pack}'`, {
            pack,
            phase: context.phase ?? "translate",
            field: context.field ?? null,
            documentId: data?._id ?? null,
            documentName: data?.name ?? null,
            error: errorMessage,
        });
    }
}
