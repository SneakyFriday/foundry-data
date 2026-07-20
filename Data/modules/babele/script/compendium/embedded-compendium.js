import {MappedCompendium} from "./mapped-compendium.js";
import {CompendiumRuntime} from "./compendium-runtime.js";
import {TranslationEntries} from "../translation/translation-entries.js";

/**
 * Runtime-local mapped compendium representing embedded documents translated
 * within the scope of a parent document.
 *
 * It merges:
 * - any already visible runtime-local mapped compendium of the same document type
 * - inline translations provided by the current converter field
 * - the effective mapping resolved for the current embedded document field
 */
export class EmbeddedCompendium {

    #delegate;

    constructor(documentType, {
        mapping = null,
        translations = null,
        translationStrategies = null,
        documentMappings = null,
        runtime = {},
    } = {}) {
        const activeRuntime = CompendiumRuntime.from(runtime);
        const scopedPack = activeRuntime.localMappedCompendiumFor(documentType);
        const currentCompendium = activeRuntime.currentCompendium();
        const payload = {};
        const entries = {
            ...new TranslationEntries(scopedPack?.translations).snapshot(),
            ...new TranslationEntries(translations).snapshot(),
        };
        const effectiveMapping = mapping ?? scopedPack?.customMapping ?? null;
        const effectiveStrategies = translationStrategies
            ?? scopedPack?.translationMatchStrategies?.()
            ?? currentCompendium?.translationMatchStrategies?.()
            ?? [];
        const effectiveDocumentMappings = documentMappings
            ?? scopedPack?.documentMappings
            ?? currentCompendium?.documentMappings;

        if (!effectiveDocumentMappings) {
            throw new Error(`EmbeddedCompendium requires documentMappings for '${documentType}'.`);
        }

        if (effectiveMapping !== null) {
            payload.mapping = effectiveMapping;
        }

        if (Object.keys(entries).length > 0) {
            payload.entries = entries;
        }

        if (scopedPack?.reference?.length) {
            payload.reference = [...scopedPack.reference];
        }

        if (scopedPack?.types?.length) {
            payload.types = [...scopedPack.types];
        }

        this.#delegate = new MappedCompendium(
            scopedPack?.metadata
                ? {
                    ...scopedPack.metadata,
                    ownerPackageName: scopedPack.metadata.ownerPackageName ?? currentCompendium?.metadata?.packageName ?? null,
                    ownerPackageType: scopedPack.metadata.ownerPackageType ?? currentCompendium?.metadata?.packageType ?? null,
                }
                : {
                    type: documentType,
                    ownerPackageName: currentCompendium?.metadata?.packageName ?? null,
                    ownerPackageType: currentCompendium?.metadata?.packageType ?? null,
                },
            Object.keys(payload).length > 0 ? payload : null,
            {
                translationStrategies: effectiveStrategies,
                documentMappings: effectiveDocumentMappings,
                runtimeFactory: (options = {}) => {
                    const root = activeRuntime;
                    return options?.currentCompendium || options?.localPacks
                        ? root.child({
                            currentCompendium: options.currentCompendium ?? undefined,
                            localPacks: options.localPacks ?? undefined,
                        })
                        : root;
                },
            },
        );
    }

    get metadata() {
        return this.#delegate.metadata;
    }

    get translations() {
        return this.#delegate.translations;
    }

    get translated() {
        return this.#delegate.translated;
    }

    get customMapping() {
        return this.#delegate.customMapping;
    }

    get mapping() {
        return this.#delegate.mapping;
    }

    get reference() {
        return this.#delegate.reference;
    }

    get types() {
        return this.#delegate.types;
    }

    translationMatchStrategies() {
        return this.#delegate.translationMatchStrategies();
    }

    hasTranslation(data, documentType = this.metadata?.type ?? null, runtime) {
        return this.#delegate.hasTranslation(data, documentType, runtime);
    }

    translationsFor(data, documentType = this.metadata?.type ?? null) {
        return this.#delegate.translationsFor(data, documentType);
    }

    translationKeyFor(data, documentType = this.metadata?.type ?? null) {
        return this.#delegate.translationKeyFor(data, documentType);
    }

    hasReferenceTranslations(data, runtime) {
        return this.#delegate.hasReferenceTranslations(data, runtime);
    }

    translateIndex(index) {
        return this.#delegate.translateIndex(index);
    }

    extract(data, runtime) {
        return this.#delegate.extract(data, runtime);
    }

    extractField(field, data, runtime) {
        return this.#delegate.extractField(field, data, runtime);
    }

    translateField(field, data, runtime) {
        return this.#delegate.translateField(field, data, runtime);
    }

    translate(data, translationsOnly = false, runtime) {
        return this.#delegate.translate(data, translationsOnly, runtime);
    }
}
