import {IdentityExtractorRegistry} from "./identity-extractor-registry.js";

const DEFAULT_IDENTITY_DEFINITION = Object.freeze({
    export: ["name", "_id", "id"],
    match: ["_id", "name", "sourceId"],
});

/**
 * Value object describing the translation identity of a document type.
 */
export class DocumentIdentity {

    #definition;
    #registry;

    constructor(definition = {}, registry = new IdentityExtractorRegistry(IdentityExtractorRegistry.defaultExtractors())) {
        this.#definition = {
            export: [...(definition.export ?? DEFAULT_IDENTITY_DEFINITION.export)],
            match: [...(definition.match ?? DEFAULT_IDENTITY_DEFINITION.match)],
        };
        this.#registry = registry;
    }

    exportCandidates(document) {
        return this.#candidates(document, this.#definition.export);
    }

    matchCandidates(document) {
        return this.#candidates(document, this.#definition.match);
    }

    #candidates(document, tokens = []) {
        const candidates = [];

        for (const token of tokens) {
            for (const key of this.#registry.extract(document, token)) {
                if (!candidates.includes(key)) {
                    candidates.push(key);
                }
            }
        }

        return candidates;
    }
}

export function mergeIdentityDefinition(base = {}, override = {}) {
    return {
        export: override.export ?? base.export,
        match: override.match ?? base.match,
    };
}
