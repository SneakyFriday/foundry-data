/**
 * Registry of named document identity extractors.
 *
 * Identity extractors transform a Foundry document into one or more candidate
 * external keys used by Babele for translation lookup and export.
 */
export class IdentityExtractorRegistry {

    #extractors;

    constructor(extractors = {}) {
        this.#extractors = new Map(Object.entries(extractors));
    }

    static defaultExtractors() {
        return {
            _id: (document) => document?._id,
            id: (document) => document?.id,
            name: (document) => document?.name,
            sourceId: (document) => foundry.utils.parseUuid(
                document?.flags?.core?.sourceId || document?._stats?.compendiumSource,
            )?.id,
        };
    }

    register(name, extractor) {
        if (!name || typeof extractor !== "function") {
            throw new Error("Identity extractors require a name and a function.");
        }

        this.#extractors.set(name, extractor);
    }

    registerAll(extractors = {}) {
        for (const [name, extractor] of Object.entries(extractors)) {
            this.register(name, extractor);
        }
    }

    extractor(name) {
        return this.#extractors.get(name) ?? null;
    }

    extract(document, name) {
        const extractor = this.extractor(name);
        if (!extractor) {
            return [];
        }

        const value = extractor(document);
        if (Array.isArray(value)) {
            return value.filter(Boolean);
        }

        return value ? [value] : [];
    }

    snapshot() {
        return Object.fromEntries(this.#extractors.entries());
    }
}
