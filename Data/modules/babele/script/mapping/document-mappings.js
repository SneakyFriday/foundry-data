import {defaultMappings} from "./default-mappings.js";
import {DocumentMapping} from "./document-mapping.js";
import {mergeIdentityDefinition} from "../identity/document-identity.js";
import {cloneData} from "../utils/data-clone.js";

/**
 * Aggregate of effective document-mapping layers.
 *
 * Layers are merged in this order:
 * 1. built-in defaults
 * 2. mappings registered through the public API
 * 3. mappings loaded from discovered mapping files
 *
 * The aggregate owns precedence and materializes `DocumentMapping` instances
 * on demand for a specific document type and optional compendium-local override.
 */
export class DocumentMappings {

    static DEFAULT_MAPPINGS = cloneData(defaultMappings);

    /**
     * @param {object} [builtInMappings]
     * @param {object} [options]
     * @param {object[]} [options.registeredMappings]
     * @param {object[]} [options.loadedMappings]
     * @param {IdentityExtractorRegistry} [options.identityExtractors]
     * @param {ConverterRegistry} [options.converterRegistry]
     */
    constructor(builtInMappings = defaultMappings, {
        registeredMappings = [],
        loadedMappings = [],
        identityExtractors,
        converterRegistry,
    } = {}) {
        this.builtInMappings = this.#clone(builtInMappings);
        this.registeredMappings = registeredMappings.map((mapping) => this.#clone(mapping));
        this.loadedMappings = loadedMappings.map((mapping) => this.#clone(mapping));
        this.identityExtractors = this.#required(identityExtractors, "identityExtractors");
        this.converterRegistry = this.#required(converterRegistry, "converterRegistry");
        this.effectiveMappings = this.#rebuild();
    }

    /**
     * Return the effective mappings as a detached object.
     *
     * @returns {object}
     */
    current() {
        return this.#clone(this.effectiveMappings);
    }

    /**
     * Return the ordered mapping layers that compose the effective mapping
     * state.
     *
     * @returns {{kind: string, label: string, precedence: number, mapping: object}[]}
     */
    layers() {
        return this.#layers().map((layer) => ({
            ...layer,
            mapping: this.#clone(layer.mapping),
        }));
    }

    /**
     * Return a diagnostic view of the effective mapping for one document type
     * and optional document instance.
     *
     * Legacy subtype keys are reported as source contributions but normalized
     * into `_variants` in the effective mapping.
     *
     * @param {string} documentType
     * @param {object} [options]
     * @param {object} [options.data]
     * @param {object|null} [options.customMapping]
     * @returns {object}
     */
    inspect(documentType, {
        data = {},
        customMapping = null,
    } = {}) {
        const subtype = data?.type ?? null;
        const mapping = this.mappingFor(documentType, customMapping);

        return {
            documentType,
            subtype,
            keys: {
                base: documentType,
                subtype: subtype ? `${documentType}.${subtype}` : null,
            },
            precedence: [
                "built-in",
                "registered",
                "loaded",
                "compendium-local",
                "subtype",
            ],
            layers: this.#contributions(documentType, subtype, customMapping),
            effective: {
                mapping: this.#clone(mapping.mapping),
                identity: this.#clone(mapping.identityDefinition),
            },
        };
    }

    /**
     * Return a snapshot of mapping cache boundaries.
     *
     * @returns {object}
     */
    cacheDiagnostics() {
        const documentTypes = Object.keys(this.effectiveMappings);

        return {
            boundary: "document-mappings",
            strategy: "immutable-rebuild",
            builtInLayerCount: 1,
            registeredLayerCount: this.registeredMappings.length,
            loadedLayerCount: this.loadedMappings.length,
            effectiveDocumentTypes: documentTypes.length,
            documentTypes,
        };
    }

    /**
     * Determine whether the effective mapping layers define one exact
     * document-type mapping.
     *
     * This is intentionally an exact lookup: subtype mappings such as
     * `Item.weapon` do not imply support for some other unrelated type, while
     * root document types like `Item` or `ActiveEffect` are resolved by their
     * canonical mapping key.
     *
     * @param {string|null} documentType
     * @returns {boolean}
     */
    supports(documentType) {
        return typeof documentType === "string"
            && Object.prototype.hasOwnProperty.call(this.effectiveMappings, documentType);
    }

    /**
     * Materialize the effective mapping for one document type,
     * optionally enriching it with a compendium-local mapping layer.
     *
     * @param {string} documentType
     * @param {object|null} [customMapping]
     * @returns {DocumentMapping}
     */
    mappingFor(documentType, customMapping = null) {
        return new DocumentMapping(documentType, this.#definitionObject(this.#mergedNormalizedDefinition(
            this.#normalizedDefinition(this.effectiveMappings[documentType] ?? {}),
            this.#customDefinition(documentType, customMapping),
        )), {
            identityExtractors: this.identityExtractors,
            converterRegistry: this.converterRegistry,
        });
    }

    #layers() {
        return [
            {
                kind: "built-in",
                label: "built-in defaults",
                precedence: 0,
                mapping: this.builtInMappings,
            },
            ...this.registeredMappings.map((mapping, index) => ({
                kind: "registered",
                label: `registered mapping ${index + 1}`,
                precedence: 10 + index,
                mapping,
            })),
            ...this.loadedMappings.map((mapping, index) => ({
                kind: "loaded",
                label: `loaded mapping ${index + 1}`,
                precedence: 20 + index,
                mapping,
            })),
        ];
    }

    #contributions(documentType, subtype = null, customMapping = null) {
        const contributions = this.#layers().flatMap((layer) => this.#layerContributions(layer, documentType, subtype));

        if (customMapping) {
            contributions.push(...this.#customContributions(documentType, subtype, customMapping));
        }

        return contributions;
    }

    #layerContributions(layer, documentType, subtype = null) {
        return [
            this.#contribution(layer, "base", documentType),
            subtype ? this.#contribution(layer, "subtype", `${documentType}.${subtype}`) : null,
        ].filter(Boolean);
    }

    #contribution(layer, branch, key) {
        const definition = layer.mapping?.[key];
        if (!definition) {
            return null;
        }

        return {
            kind: layer.kind,
            label: layer.label,
            precedence: layer.precedence,
            branch,
            key,
            definition: this.#definitionSnapshot(definition),
        };
    }

    #customContributions(documentType, subtype = null, customMapping = {}) {
        const base = {};
        const subtypeDefinitions = {};
        const subtypePrefix = `${documentType}.`;

        for (const [key, value] of Object.entries(customMapping)) {
            if (key.startsWith(subtypePrefix)) {
                const customSubtype = key.slice(subtypePrefix.length);
                subtypeDefinitions[customSubtype] = value;
                continue;
            }

            base[key] = value;
        }

        const contributions = [];
        if (Object.keys(base).length > 0) {
            contributions.push({
                kind: "compendium-local",
                label: "compendium-local mapping",
                precedence: 30,
                branch: "base",
                key: documentType,
                definition: this.#definitionSnapshot(base),
            });
        }

        if (subtype && subtypeDefinitions[subtype]) {
            contributions.push({
                kind: "compendium-local",
                label: "compendium-local subtype mapping",
                precedence: 31,
                branch: "subtype",
                key: `${documentType}.${subtype}`,
                definition: this.#definitionSnapshot(subtypeDefinitions[subtype]),
            });
        }

        return contributions;
    }

    #definitionSnapshot(definition = {}) {
        const normalized = this.#normalizedDefinition(definition);

        return {
            mapping: this.#clone(normalized.mapping),
            identity: this.#clone(normalized.identity),
        };
    }

    #rebuild() {
        const effective = {};

        this.#mergeLayer(effective, this.builtInMappings);

        for (const mapping of this.registeredMappings) {
            this.#mergeLayer(effective, mapping);
        }

        for (const mapping of this.loadedMappings) {
            this.#mergeLayer(effective, mapping);
        }

        return effective;
    }

    #mergeLayer(target, mapping) {
        for (const [key, value] of Object.entries(this.#normalizedLayer(mapping))) {
            target[key] = this.#mergedDefinition(target[key] ?? {}, value);
        }
    }

    #normalizedLayer(mapping = {}) {
        const normalized = {};

        for (const [key, value] of Object.entries(mapping ?? {})) {
            const subtype = this.#legacySubtypeKey(key);
            if (subtype) {
                const current = normalized[subtype.documentType] ?? {};
                normalized[subtype.documentType] = this.#mergedDefinition(
                    current,
                    this.#legacySubtypeDefinition(subtype.subtype, value),
                );
                continue;
            }

            normalized[key] = this.#mergedDefinition(normalized[key] ?? {}, value);
        }

        return normalized;
    }

    #legacySubtypeKey(key) {
        const separator = String(key).indexOf(".");
        if (separator <= 0 || separator >= String(key).length - 1) {
            return null;
        }

        return {
            documentType: key.slice(0, separator),
            subtype: key.slice(separator + 1),
        };
    }

    #legacySubtypeDefinition(subtype, definition = {}) {
        const normalized = this.#normalizedDefinition(definition);
        const {_variants, ...mapping} = normalized.mapping;
        const subtypeCondition = {path: "type", equals: subtype};
        const variants = [];

        if (Object.keys(mapping).length) {
            variants.push({
                _when: subtypeCondition,
                ...mapping,
            });
        }

        if (Array.isArray(_variants)) {
            variants.push(..._variants.map((variant) => {
                const {_when, ...variantMapping} = variant ?? {};
                return {
                    _when: _when ? {all: [subtypeCondition, _when]} : subtypeCondition,
                    ...variantMapping,
                };
            }));
        }

        return variants.length ? {_variants: variants} : {};
    }

    #mergedDefinition(base = {}, override = {}) {
        const {_variants: baseVariants, ...baseMapping} = this.#clone(base ?? {});
        const {_variants: overrideVariants, ...overrideMapping} = this.#clone(override ?? {});
        const merged = foundry.utils.mergeObject(baseMapping, overrideMapping, {inplace: false});
        const variants = [
            ...(Array.isArray(baseVariants) ? baseVariants : []),
            ...(Array.isArray(overrideVariants) ? overrideVariants : []),
        ];

        if (variants.length) {
            merged._variants = variants;
        }

        return merged;
    }

    #mergedNormalizedDefinition(base = this.#normalizedDefinition({}), override = this.#normalizedDefinition({})) {
        const effectiveBase = this.#normalizedDefinition(base);
        const effectiveOverride = this.#normalizedDefinition(override);

        return {
            mapping: this.#mergedDefinition(effectiveBase.mapping ?? {}, effectiveOverride.mapping ?? {}),
            identity: mergeIdentityDefinition(effectiveBase.identity ?? {}, effectiveOverride.identity ?? {}),
        };
    }

    #definitionObject(definition = this.#normalizedDefinition({})) {
        return {
            ...definition.mapping,
            _identity: definition.identity,
        };
    }

    #customDefinition(documentType, customMapping = null) {
        const layer = this.#normalizedLayer(this.#customMappingLayer(documentType, customMapping));
        return this.#normalizedDefinition(layer[documentType] ?? {});
    }

    #customMappingLayer(documentType, customMapping = null) {
        if (!customMapping) {
            return {};
        }

        const layer = {};
        const subtypePrefix = `${documentType}.`;
        for (const [key, value] of Object.entries(customMapping)) {
            if (key.startsWith(subtypePrefix)) {
                layer[key] = value;
                continue;
            }

            layer[documentType] ??= {};
            layer[documentType][key] = value;
        }

        return layer;
    }

    #normalizedDefinition(definition = {}) {
        if (definition?.mapping || definition?.identity) {
            return {
                mapping: {...(definition.mapping ?? {})},
                identity: {...(definition.identity ?? {})},
            };
        }

        const mapping = {...(definition ?? {})};
        const identity = mapping._identity ?? {};
        delete mapping._identity;

        return {mapping, identity};
    }

    #clone(value) {
        return cloneData(value ?? {});
    }

    #required(value, dependency) {
        if (!value) {
            throw new Error(`DocumentMappings requires ${dependency}.`);
        }

        return value;
    }
}
