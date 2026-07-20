import {MappingBlock} from "./mapping-block.js";
import {DocumentIdentity} from "../identity/document-identity.js";

/**
 * Effective mapping definition for one concrete document shape.
 *
 * A DocumentMapping does not resolve subtype inheritance. It represents the
 * already-materialized field and identity definition used to translate or
 * extract a specific document form.
 */
export class DocumentMapping {

    /**
     * @param {string} documentType
     * @param {object} [definition]
     * @param {object} [options]
     * @param {import("../identity/identity-extractor-registry.js").IdentityExtractorRegistry} options.identityExtractors
     * @param {import("../converter/converter-registry.js").ConverterRegistry} options.converterRegistry
     */
    constructor(documentType, definition = {}, {identityExtractors, converterRegistry} = {}) {
        this.documentType = documentType;
        this._identityExtractors = this._required(identityExtractors, "identityExtractors");
        this._converterRegistry = this._required(converterRegistry, "converterRegistry");

        const normalized = this._normalizedDefinition(definition);
        this.identityDefinition = normalized.identity;
        this.mapping = normalized.mapping;
        this._block = new MappingBlock(this.mapping, {
            converterRegistry: this._converterRegistry,
            owner: this.documentType,
        });
        this.fields = this._block.fields;
        this._identity = new DocumentIdentity(this.identityDefinition, this._identityExtractors);
    }

    /**
     * Return the effective document identity.
     *
     * @returns {DocumentIdentity}
     */
    identity() {
        return this._identity;
    }

    /**
     * Return ordered export key candidates for a document.
     *
     * @param {object} data
     * @returns {string[]}
     */
    exportKeyCandidates(data = {}) {
        return this.identity().exportCandidates(data);
    }

    /**
     * Return ordered lookup key candidates for a document.
     *
     * @param {object} data
     * @returns {string[]}
     */
    matchKeyCandidates(data = {}) {
        return this.identity().matchCandidates(data);
    }

    /**
     * Translate all mapped fields for a document.
     *
     * @param {object} data
     * @param {object} translations
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {object}
     */
    map(data, translations, runtime = {}) {
        return this._block.map(data, translations, runtime);
    }

    /**
     * Prepare all mapped fields before translation or extraction starts.
     *
     * @param {object} data
     * @param {object} translations
     * @param {import("../compendium/document-translation-scope.js").DocumentTranslationScope|import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     */
    prepare(data, translations, runtime = {}) {
        this._block.prepare(data, translations, runtime);
    }

    /**
     * Translate one mapped field using the provided runtime visibility context.
     *
     * @param {string} field
     * @param {object} data
     * @param {object} translations
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {*}
     */
    translateField(field, data, translations, runtime = {}) {
        return this._block.translateField(field, data, translations, runtime);
    }

    /**
     * Extract one mapped field using the provided runtime visibility context.
     *
     * @param {string} field
     * @param {object} data
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {*}
     */
    extractField(field, data, runtime = {}) {
        return this._block.extractField(field, data, runtime);
    }

    /**
     * Extract all mapped fields for a document.
     *
     * @param {object} data
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {object}
     */
    extract(data, runtime = {}) {
        return this._block.extract(data, runtime);
    }

    /**
     * A document mapping uses converters when at least one field is backed by
     * a registered converter.
     *
     * @returns {boolean}
     */
    usesConverters() {
        return this._block.usesConverters();
    }

    _normalizedDefinition(definition = {}) {
        const mapping = {...definition};
        const identity = mapping._identity ?? {};
        delete mapping._identity;

        return {mapping, identity};
    }

    _required(value, dependency) {
        if (!value) {
            throw new Error(`DocumentMapping requires ${dependency} for '${this.documentType ?? "unknown"}'.`);
        }

        return value;
    }
}
