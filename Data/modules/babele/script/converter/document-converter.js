import {EmbeddedCompendium} from "../compendium/embedded-compendium.js";
import {CompendiumRuntime} from "../compendium/compendium-runtime.js";
import {DocumentTranslationScope} from "../compendium/document-translation-scope.js";
import {converterContext} from "./converter-context.js";
import {ExportKeys} from "../identity/export-key-allocator.js";
import {DocumentTranslation} from "../translation/document-translation.js";
import {DocumentCollectionSort} from "./document-collection-sort.js";

/**
 * Built-in OO converter for document-valued fields.
 *
 * It resolves the effective embedded document mapping for the configured
 * `documentType`, optionally publishes an `EmbeddedCompendium` before
 * translation starts, and then translates or extracts the embedded documents
 * through that context.
 */
export class DocumentConverter {

    #resolveParams;

    /**
     * @param {object|function(object): object} [params]
     */
    constructor(params = {}) {
        this.#resolveParams = typeof params === "function" ? params : () => params;
    }

    /**
     * Prepare the runtime-local mapped compendium used by this embedded
     * document field before any sibling field translation begins.
     *
     * @param {object} context
     * @returns {{key: string, contextPack: EmbeddedCompendium}}
     */
    prepare(context) {
        const configuredContext = this._context(context);
        const descriptor = this._descriptor(configuredContext);
        const scope = DocumentTranslationScope.from(configuredContext.runtime);
        const key = this._scopeKey(configuredContext, descriptor);

        if (scope.prepared(key)) {
            return scope.prepared(key);
        }

        const contextPack = new EmbeddedCompendium(descriptor.documentType, {
            mapping: descriptor.mapping,
            translations: configuredContext.translation,
            translationStrategies: configuredContext.contextCompendium?.translationMatchStrategies?.(),
            documentMappings: configuredContext.contextCompendium?.documentMappings,
            runtime: scope.runtime(),
        });

        const prepared = {
            key,
            contextPack,
        };

        scope.remember(key, prepared);

        if (descriptor.expose === true) {
            scope.publish(key, contextPack);
        }

        return prepared;
    }

    /**
     * Translate one or many embedded documents through the prepared local
     * mapped compendium and the currently visible runtime packs.
     *
     * @param {object} context
     * @returns {*}
     */
    translate(context) {
        const configuredContext = this._context(context);
        const descriptor = this._descriptor(configuredContext);
        const prepared = this.prepare(configuredContext);
        const scope = DocumentTranslationScope.from(configuredContext.runtime);
        const values = this._documentValues(configuredContext.value, descriptor.cardinality);
        const translated = this._fromPack(values, prepared.contextPack, scope.runtime(), descriptor.fallbackPolicy);
        const sorted = DocumentCollectionSort
            .from(descriptor.sort, this._translationSortPolicy(configuredContext))
            .apply(translated);

        return this._documentOutput(sorted, descriptor.cardinality);
    }

    /**
     * Extract one or many embedded documents through the prepared local mapped
     * compendium.
     *
     * @param {object} context
     * @returns {*}
     */
    extract(context) {
        const configuredContext = this._context(context);
        const descriptor = this._descriptor(configuredContext);
        const prepared = this.prepare(configuredContext);
        const scope = DocumentTranslationScope.from(configuredContext.runtime);
        const values = this._documentValues(configuredContext.value, descriptor.cardinality);
        if (values.length === 0) {
            return undefined;
        }

        const extracted = this._extractEmbeddedCollection(values, prepared.contextPack, scope.runtime());

        if (descriptor.cardinality === "one") {
            return Object.values(extracted)[0];
        }

        return extracted;
    }

    /**
     * Merge constructor-level defaults with the call-site converter context.
     *
     * @param {object} context
     * @returns {object}
     */
    _context(context) {
        const defaultParams = this.#resolveParams(context) ?? {};
        const path = context.path ?? defaultParams.path ?? context.field;

        return converterContext({
            ...context,
            field: context.field ?? path,
            path,
            params: {
                ...defaultParams,
                ...(context.params ?? {}),
                converter: "document",
            },
        });
    }

    /**
     * Resolve the effective structural parameters for the current embedded
     * document field.
     *
     * When the field does not declare an inline `mapping`, the converter falls
     * back to the current compendium custom mapping block keyed by the field
     * path. This keeps Adventure embedded-document fields aligned with the same
     * mapping object shape used by root compendium definitions.
     *
     * @param {object} context
     * @returns {{documentType: string, cardinality: string, expose: boolean, fallbackPolicy: string|string[], mapping: object|null, sort: object|string|boolean|null}}
     */
    _descriptor(context) {
        return {
            documentType: context.params?.documentType,
            cardinality: context.params?.cardinality ?? "many",
            expose: context.params?.expose === true,
            fallbackPolicy: context.params?.fallbackPolicy ?? "source-first",
            sort: context.params?.sort ?? null,
            mapping: context.params?.mapping
                ?? context.contextCompendium?.customMapping?.[context.params?.path]
                ?? null,
        };
    }

    /**
     * Read the optional per-entry collection sort directive from the
     * translation payload.
     *
     * @param {object} context
     * @returns {object|string|boolean|null}
     */
    _translationSortPolicy(context) {
        return context.translation?.$sort ?? null;
    }

    /**
     * Build a stable scope key for the prepared embedded compendium of the
     * current field.
     *
     * @param {object} context
     * @param {{documentType: string}} descriptor
     * @returns {string}
     */
    _scopeKey(context, descriptor) {
        const parentPack = CompendiumRuntime.from(context.runtime).currentCompendium()
            ?? context.contextCompendium
            ?? null;
        const parentId = parentPack?.metadata?.id ?? parentPack?.metadata?.name ?? "runtime";
        const sourceId = context.source?._id ?? context.source?.id ?? context.field;
        return `${parentId}::${sourceId}::${context.field}::${descriptor.documentType}`;
    }

    /**
     * Normalize a document-valued field to an array form for translation or
     * extraction.
     *
     * @param {*} value
     * @param {string} [cardinality]
     * @returns {Array<*>}
     */
    _documentValues(value, cardinality = "many") {
        if (cardinality === "one") {
            return (typeof value === "undefined" || value === null) ? [] : [value];
        }

        if (!value) {
            return [];
        }

        if (Array.isArray(value)) {
            return value;
        }

        return value.contents ?? Array.from(value);
    }

    /**
     * Restore the original cardinality after translating or extracting in
     * array form.
     *
     * @param {Array<*>} values
     * @param {string} [cardinality]
     * @returns {*}
     */
    _documentOutput(values, cardinality = "many") {
        return cardinality === "one" ? (values[0] ?? null) : values;
    }

    /**
     * Ensure nested translation runs with the embedded mapped compendium as
     * current runtime compendium.
     *
     * @param {*} contextPack
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {import("../compendium/compendium-runtime.js").CompendiumRuntime}
     */
    _runtimeWithContextCompendium(contextPack, runtime = {}) {
        const activeRuntime = CompendiumRuntime.from(runtime);
        return activeRuntime.currentCompendium() === contextPack
            ? activeRuntime
            : activeRuntime.child({currentCompendium: contextPack});
    }

    /**
     * Extract an embedded collection through the prepared local mapped
     * compendium.
     *
     * @param {*} entities
     * @param {*} contextPack
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {object}
     */
    _extractEmbeddedCollection(entities, contextPack, runtime = {}) {
        const activeRuntime = this._runtimeWithContextCompendium(contextPack, runtime);
        const keys = new ExportKeys();

        return this._documentValues(entities).reduce((out, entity) => {
            const key = keys.keyFor(entity, "embedded", contextPack.mapping);
            out[key] = contextPack.extract(entity, activeRuntime);
            return out;
        }, {});
    }

    /**
     * Translate embedded documents by layering the visible translation sources
     * for the current runtime scope.
     *
     * The effective order is:
     * - base translation from the exact source compendium when a translated
     *   pack matching `_stats.compendiumSource` / `flags.core.sourceId` is
     *   visible
     * - otherwise base translation from the generic translated-pack fallback
     *   for the same document type
     * - local embedded translation payload from the current runtime scope as
     *   the final override layer
     *
     * @param {Array<object>} entities
     * @param {*} contextPack
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @param {string|string[]} [fallbackPolicy]
     * @returns {Array<object>}
     */
    _fromPack(entities, contextPack, runtime = {}, fallbackPolicy = "source-first") {
        const activeRuntime = this._runtimeWithContextCompendium(contextPack, runtime);
        const currentCompendium = activeRuntime.currentCompendium();

        return entities.map((data) => {
            const currentMapping = currentCompendium?.mapping;
            const documentType = currentCompendium?.metadata?.type ?? null;
            const hasCurrentTranslation = currentCompendium?.hasTranslation(data, documentType) === true;
            const fallback = this._fallbackTranslationSource(data, activeRuntime, currentCompendium, documentType, fallbackPolicy);
            const fallbackPack = fallback?.pack ?? null;
            const fallbackData = fallback?.data ?? data;
            const hasFallbackTranslation = fallbackPack?.hasTranslation(fallbackData, documentType) === true;
            const fallbackPayload = fallbackPack
                ? (fallbackPack.translate(fallbackData, true, activeRuntime) ?? {})
                : {};
            const shouldTranslateCurrent = hasCurrentTranslation
                || (!fallbackPack && currentMapping?.usesConverters?.() === true);
            const currentPayload = shouldTranslateCurrent
                ? this._pruneUnchangedPayload(currentCompendium.translate(data, true, activeRuntime) ?? {}, data)
                : {};

            const payload = foundry.utils.mergeObject(fallbackPayload, currentPayload, {inplace: false});
            const hasTranslation = hasCurrentTranslation || hasFallbackTranslation;
            const sourcePack = fallbackPack ?? currentCompendium;
            const sourceData = sourcePack === fallbackPack ? fallbackData : data;

            return new DocumentTranslation({
                source: data,
                payload,
                hasTranslation,
                originalPayload: this._sourcePayload(sourcePack, sourceData),
                requiresPayload: true,
                language: sourcePack?.language ?? currentCompendium?.language ?? null,
            }).apply();
        });
    }

    /**
     * Resolve the best fallback translation source for one embedded document.
     *
     * Built-in fallback policies:
     * - `source-first` (default): exact source pack, then generic translated
     *   pack lookup
     * - `owner-package-before-generic`: exact source pack, then translated
     *   packs from the owner package/module, then generic translated pack
     * - `owner-package-first`: owner package/module translated packs, then
     *   exact source pack, then generic translated pack
     *
     * @param {object} data
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime} runtime
     * @param {*} currentCompendium
     * @param {string|null} [documentType]
     * @param {string|string[]} [fallbackPolicy]
     * @returns {{pack: *, data: object}|null}
     */
    _fallbackTranslationSource(
        data,
        runtime,
        currentCompendium,
        documentType = currentCompendium?.metadata?.type ?? null,
        fallbackPolicy = "source-first",
    ) {
        for (const step of this._fallbackPolicySteps(fallbackPolicy)) {
            const resolved = this._fallbackTranslationSourceForStep(step, data, runtime, currentCompendium, documentType);
            if (resolved) {
                return resolved;
            }
        }

        return null;
    }

    _fallbackTranslationSourceForStep(step, data, runtime, currentCompendium, documentType) {
        switch (step) {
            case "owner-package":
                return this._ownerPackageTranslationSource(data, runtime, currentCompendium, documentType);
            case "generic":
                return this._genericTranslationSource(data, runtime, currentCompendium, documentType);
            case "exact-source":
            default:
                return this._exactSourceTranslationSource(data, runtime, currentCompendium, documentType);
        }
    }

    _fallbackPolicySteps(fallbackPolicy = "source-first") {
        if (Array.isArray(fallbackPolicy)) {
            return fallbackPolicy.length > 0 ? [...fallbackPolicy] : ["exact-source", "generic"];
        }

        switch (fallbackPolicy) {
            case "owner-package-first":
                return ["owner-package", "exact-source", "generic"];
            case "owner-package-before-generic":
                return ["exact-source", "owner-package", "generic"];
            case "source-first":
            default:
                return ["exact-source", "generic"];
        }
    }

    _genericTranslationSource(data, runtime, currentCompendium, documentType = currentCompendium?.metadata?.type ?? null) {
        const sourceAwareData = this._sourceAwareData(data);
        const genericPack = runtime.translatedPackFor(documentType, sourceAwareData)
            ?? (sourceAwareData !== data ? runtime.translatedPackFor(documentType, data) : null);

        if (!genericPack || genericPack === currentCompendium) {
            return null;
        }

        return {
            pack: genericPack,
            data: sourceAwareData,
        };
    }

    _ownerPackageTranslationSource(data, runtime, currentCompendium, documentType = currentCompendium?.metadata?.type ?? null) {
        const ownerPackageName = currentCompendium?.metadata?.ownerPackageName ?? currentCompendium?.metadata?.packageName ?? null;
        const ownerPackageType = currentCompendium?.metadata?.ownerPackageType ?? currentCompendium?.metadata?.packageType ?? null;
        if (!ownerPackageName) {
            return null;
        }

        const matchesOwnerPackage = (pack) =>
            pack !== currentCompendium
            && pack.metadata?.packageName === ownerPackageName
            && (!ownerPackageType || pack.metadata?.packageType === ownerPackageType);

        const sourceAwareData = this._sourceAwareData(data);
        const ownerPack = runtime.translatedPackFor(documentType, data, {predicate: matchesOwnerPackage})
            ?? (sourceAwareData !== data
                ? runtime.translatedPackFor(documentType, sourceAwareData, {predicate: matchesOwnerPackage})
                : null);

        if (!ownerPack) {
            return null;
        }

        return {
            pack: ownerPack,
            data: ownerPack.hasTranslation(data, documentType) ? data : sourceAwareData,
        };
    }

    /**
     * Resolve the translated pack explicitly referenced by the embedded
     * document source metadata, if any.
     *
     * The returned data may be a detached copy whose `name` has been restored
     * from the original source document so name-keyed translations in the
     * source compendium can still match imported embedded documents.
     *
     * @param {object} data
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime} runtime
     * @param {*} currentCompendium
     * @param {string|null} [documentType]
     * @returns {{pack: *, data: object}|null}
     */
    _exactSourceTranslationSource(data, runtime, currentCompendium, documentType = currentCompendium?.metadata?.type ?? null) {
        const collection = this._sourceCollection(data);
        if (!collection) {
            return null;
        }

        const pack = runtime.mappedCompendiumFor(collection);
        if (!pack || pack === currentCompendium || pack.translated !== true) {
            return null;
        }

        const sourceAwareData = this._sourceAwareData(data, pack);
        const hasTranslation = pack.hasTranslation(sourceAwareData, documentType);
        if (!hasTranslation) {
            return null;
        }

        return {
            pack,
            data: sourceAwareData,
        };
    }

    /**
     * Return a detached source-aware copy when the original source document
     * exposes a different canonical name than the current embedded payload.
     *
     * @param {object} data
     * @returns {object}
     */
    _sourceAwareData(data, sourcePack = null) {
        const sourceName = this._sourceDocumentName(data, sourcePack);
        if (!sourceName || sourceName === data?.name) {
            return data;
        }

        return foundry.utils.mergeObject(data, {name: sourceName}, {inplace: false});
    }

    /**
     * Resolve the canonical name of the original source document referenced by
     * this embedded payload.
     *
     * @param {object} data
     * @returns {string|null}
     */
    _sourceDocumentName(data, sourcePack = null) {
        const sourceDocument = this._sourceDocument(data);
        return sourceDocument?.flags?.babele?.originalName
            ?? sourceDocument?.name
            ?? this._sourceIndexName(data, sourcePack)
            ?? null;
    }

    /**
     * Resolve the original source document referenced by this embedded
     * payload, if Foundry can synchronously resolve the UUID.
     *
     * @param {object} data
     * @returns {object|null}
     */
    _sourceDocument(data) {
        const sourceUuid = this._sourceUuid(data);
        if (!sourceUuid || typeof fromUuidSync !== "function") {
            return null;
        }

        try {
            return fromUuidSync(sourceUuid, {strict: false}) ?? null;
        } catch (_error) {
            return null;
        }
    }

    /**
     * Resolve the original source document name from the source pack index
     * when the full source document is not synchronously available.
     *
     * This keeps exact source-pack fallback working for embedded documents
     * whose `sourceId` points to a compendium entry not currently cached by
     * Foundry.
     *
     * @param {object} data
     * @param {*} sourcePack
     * @returns {string|null}
     */
    _sourceIndexName(data, sourcePack = null) {
        const sourceId = foundry.utils.parseUuid(this._sourceUuid(data))?.id ?? null;
        if (!sourceId || !sourcePack?.index?.get) {
            return null;
        }

        return sourcePack.index.get(sourceId)?.name ?? null;
    }

    /**
     * Extract the `package.collection` identifier from the embedded source
     * UUID so runtime can look up the exact mapped compendium.
     *
     * @param {object} data
     * @returns {string|null}
     */
    _sourceCollection(data) {
        return String(this._sourceUuid(data) ?? "").match(/^Compendium\.([^.]+\.[^.]+)\./)?.[1] ?? null;
    }

    /**
     * Return the source UUID reference exported by Foundry for imported
     * embedded documents.
     *
     * @param {object} data
     * @returns {string|null}
     */
    _sourceUuid(data) {
        return data?.flags?.core?.sourceId ?? data?._stats?.compendiumSource ?? null;
    }

    /**
     * Remove entries from a local translated payload that are identical to the
     * source payload.
     *
     * This keeps local derived fields from reapplying untranslated source
     * values on top of a real fallback translation.
     *
     * @param {*} payload
     * @param {*} sourcePayload
     * @returns {*}
     */
    _pruneUnchangedPayload(payload, sourcePayload) {
        if (!this._isPlainObject(payload)) {
            return this._sameValue(payload, sourcePayload) ? undefined : payload;
        }

        const pruned = {};
        for (const [key, value] of Object.entries(payload)) {
            const filtered = this._pruneUnchangedPayload(value, sourcePayload?.[key]);
            if (typeof filtered !== "undefined") {
                pruned[key] = filtered;
            }
        }

        return Object.keys(pruned).length > 0 ? pruned : undefined;
    }

    _sourcePayload(pack, data) {
        try {
            return pack?.sourcePayload?.(data) ?? pack?.extract?.(data) ?? null;
        } catch (_error) {
            return null;
        }
    }

    /**
     * Deep structural equality used to detect no-op translated payloads.
     *
     * @param {*} left
     * @param {*} right
     * @returns {boolean}
     */
    _sameValue(left, right) {
        if (left === right) {
            return true;
        }

        if (Array.isArray(left) || Array.isArray(right)) {
            if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
                return false;
            }

            return left.every((value, index) => this._sameValue(value, right[index]));
        }

        if (!this._isPlainObject(left) || !this._isPlainObject(right)) {
            return false;
        }

        const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
        for (const key of keys) {
            if (!this._sameValue(left[key], right[key])) {
                return false;
            }
        }

        return true;
    }

    /**
     * Narrow the value to a plain object for recursive payload comparisons.
     *
     * @param {*} value
     * @returns {boolean}
     */
    _isPlainObject(value) {
        return !!value && typeof value === "object" && !Array.isArray(value);
    }

}
