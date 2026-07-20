import {DocumentConverter} from "./document-converter.js";
import {converterContext} from "./converter-context.js";
import {StructuredDataConverter} from "./structured-data-converter.js";
import {ReferencedDocumentFieldConverter} from "./referenced-document-field-converter.js";

class FunctionalConverterFactory {

    #normalizeCollection;

    constructor({normalizeCollection} = {}) {
        this.#normalizeCollection = normalizeCollection ?? ((collection) => {
            if (!collection) {
                return [];
            }

            if (Array.isArray(collection)) {
                return collection;
            }

            return collection.contents ?? Array.from(collection);
        });
    }

    document(params = {}) {
        return new DocumentConverter(params);
    }

    currentCompendium(tc, runtime = {}) {
        return tc ?? runtime?.currentCompendium?.() ?? null;
    }

    functionalDocument(resolveParams) {
        const factory = this;
        const converter = new DocumentConverter((context) => resolveParams(context.contextCompendium));
        const invoke = (method, items, translations, data, tc, runtime = {}) => {
            const contextCompendium = factory.currentCompendium(tc, runtime);
            return converter[method](converterContext({
                value: items,
                translation: translations,
                source: data,
                field: undefined,
                path: undefined,
                params: {},
                allTranslations: translations ?? {},
                contextCompendium,
                runtime,
            }));
        };

        const fn = function (items, translations, data, tc, _allTranslations, runtime = {}) {
            const effectiveCompendium = factory.currentCompendium(tc, runtime);
            return invoke("translate", items, translations, data, effectiveCompendium, runtime);
        };

        fn.prepare = function (items, translations, data, tc, _allTranslations, runtime = {}) {
            const effectiveCompendium = factory.currentCompendium(tc, runtime);
            return invoke("prepare", items, translations, data, effectiveCompendium, runtime);
        };

        fn.extract = function (items, data, tc, context = {}) {
            const effectiveCompendium = factory.currentCompendium(tc, context.runtime);
            return invoke("extract", items, undefined, data, effectiveCompendium, context.runtime);
        };

        return fn;
    }

    fixedDocument(params) {
        return this.functionalDocument(() => params);
    }

    fromPack(mapping, documentType = "Item") {
        return this.fixedDocument({
            path: mapping?.path ?? documentType,
            converter: "document",
            documentType,
            cardinality: "many",
            mapping,
        });
    }

    fromDefaultMapping(documentType, mappingKey) {
        return this.functionalDocument((tc) => ({
            path: mappingKey,
            converter: "document",
            documentType,
            cardinality: "many",
            mapping: tc?.customMapping?.[mappingKey] ?? {},
        }));
    }

    mappedField(field) {
        return (_value, _translation, data, tc, _allTranslations, runtime = {}) => {
            const contextCompendium = this.currentCompendium(tc, runtime);
            return contextCompendium?.translateField(field, data, runtime);
        };
    }

    fieldCollection(field) {
        const normalizeCollection = this.#normalizeCollection;
        const fn = function (collection, translations) {
            if (!translations) {
                return collection;
            }

            return collection.map(data => {
                const translation = translations[data[field]];
                if (!translation) {
                    return data;
                }

                return foundry.utils.mergeObject(data, {[field]: translation, translated: true});
            });
        };

        fn.extract = function (collection) {
            return normalizeCollection(collection).reduce((out, data) => {
                const key = data?.[field];
                if (key) {
                    out[key] = key;
                }
                return out;
            }, {});
        };

        return fn;
    }

    pages() {
        return this.fixedDocument({
            path: "pages",
            converter: "document",
            documentType: "JournalEntryPage",
            cardinality: "many",
        });
    }

    tableResults() {
        return this.fixedDocument({
            path: "results",
            converter: "document",
            documentType: "TableResult",
            cardinality: "many",
        });
    }

    tableResultsCollection() {
        return this.fixedDocument({
            path: "tables",
            converter: "document",
            documentType: "RollTable",
            cardinality: "many",
        });
    }

    sceneRegions() {
        return this.fixedDocument({
            path: "regions",
            converter: "document",
            documentType: "Region",
            cardinality: "many",
        });
    }

    registrations() {
        return {
            fromPack: this.document((context) => ({
                path: context.path ?? context.field,
                documentType: context.params?.documentType ?? "Item",
                cardinality: context.params?.cardinality ?? "many",
                mapping: context.params?.mapping ?? null,
                expose: context.params?.expose,
                sort: context.params?.sort,
            })),
            name: this.mappedField("name"),
            nameCollection: this.fieldCollection("name"),
            textCollection: this.fieldCollection("text"),
            tableResults: this.tableResults(),
            tableResultsCollection: this.tableResultsCollection(),
            pages: this.pages(),
            sceneRegions: this.sceneRegions(),
        };
    }
}

/**
 * Built-in converter catalog exposed by Babele.
 *
 * The public surface remains stable, but the implementation is now centered on
 * a concrete object with a composed function-converter factory rather than a
 * static utility class.
 */
class BuiltInConverters {

    #functional;

    constructor() {
        this.#functional = new FunctionalConverterFactory({
            normalizeCollection: this.asArray.bind(this),
        });
    }

    /**
     * Normalize Foundry collections, arrays, and collection-like objects to a
     * plain array so converters can iterate uniformly.
     *
     * @param {*} collection
     * @returns {Array<*>}
     */
    asArray(collection) {
        if (!collection) {
            return [];
        }

        if (Array.isArray(collection)) {
            return collection;
        }

        return collection.contents ?? Array.from(collection);
    }

    legacyRegistrations() {
        return this.#functional.registrations();
    }

    /**
     * Build a converter for embedded document collections whose effective
     * mapping is provided directly by the converter declaration.
     *
     * Typical use case: fields like `Actor.items`, where Babele knows that the
     * field contains embedded documents and should translate each document
     * recursively, first using any inline overrides and then falling back to
     * visible translated packs in runtime.
     *
     * @param {object|null} mapping
     * @param {string} documentType
     * @returns {function(*, *=): *}
     */
    fromPack(mapping, documentType = 'Item') {
        return this.#functional.fromPack(mapping, documentType);
    }

    /**
     * Build a converter for Adventure embedded document collections whose
     * mapping is resolved from the parent Adventure mapping block.
     *
     * @param {string} documentType
     * @param {string} mappingKey
     * @returns {function(*, *=): *}
     */
    fromDefaultMapping(documentType, mappingKey) {
        return this.#functional.fromDefaultMapping(documentType, mappingKey);
    }

    /**
     * Build a simple dynamic converter that maps a field to another translated
     * field of the same document through the current compendium context.
     *
     * The active compendium should be read from `runtime.currentCompendium()`;
     * the `tc` callback parameter is retained only for backward compatibility.
     *
     * @param {string} field
     * @returns {function(*, *, *=, *): *|{translated}}
     */
    mappedField(field) {
        return this.#functional.mappedField(field);
    }

    /**
     * Build a converter for collections of plain objects keyed by one of their
     * fields rather than by document identity.
     *
     * @param {string} field
     * @returns {function(*, *=): *}
     */
    fieldCollection(field) {
        return this.#functional.fieldCollection(field);
    }

    tableResults() {
        return this.#functional.tableResults();
    }

    tableResultsCollection() {
        return this.#functional.tableResultsCollection();
    }

    pages() {
        return this.#functional.pages();
    }

    deckCards() {
        return this.#functional.fixedDocument({
            path: "cards",
            converter: "document",
            documentType: "Card",
            cardinality: "many",
        });
    }

    sceneRegions() {
        return this.#functional.sceneRegions();
    }
}

export const Converters = new BuiltInConverters();
