import {FieldMapping} from "./field-mapping.js";

/**
 * A reusable mapping block made of field mappings.
 *
 * MappingBlock owns the common behavior shared by document mappings and
 * structured-data mappings: build field mappings, prepare dynamic converters,
 * translate, extract, and inspect converter usage. It intentionally does not
 * own document identity or collection traversal.
 */
export class MappingBlock {

    /**
     * @param {object} [mapping]
     * @param {object} [options]
     * @param {import("../converter/converter-registry.js").ConverterRegistry} options.converterRegistry
     * @param {string} [options.owner]
     */
    constructor(mapping = {}, {converterRegistry, owner = "mapping block"} = {}) {
        this.owner = owner;
        this.converterRegistry = this.#required(converterRegistry, "converterRegistry");
        const normalized = this.#normalized(mapping);
        this.mapping = normalized.mapping;
        this.variants = normalized.variants;
        this.fields = Object.entries(this.mapping).map(
            ([field, definition]) => new FieldMapping(field, definition, this.converterRegistry),
        );
        this.variantFields = this.variants.map((variant) => ({
            when: variant.when,
            fields: Object.entries(variant.mapping).map(
                ([field, definition]) => new FieldMapping(field, definition, this.converterRegistry),
            ),
        }));
    }

    /**
     * Prepare all mapped fields before translation starts.
     *
     * @param {object} data
     * @param {object} translations
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     */
    prepare(data, translations, runtime = {}) {
        for (const field of this.#activeFields(data)) {
            field.prepare(data, translations, runtime);
        }
    }

    /**
     * Translate all mapped fields and return a mergeable payload.
     *
     * @param {object} data
     * @param {object} translations
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {object}
     */
    map(data, translations, runtime = {}) {
        return this.#activeFields(data).reduce(
            (mapped, field) => foundry.utils.mergeObject(mapped, field.map(data, translations, runtime)),
            {},
        );
    }

    /**
     * Translate one mapped field.
     *
     * @param {string} field
     * @param {object} data
     * @param {object} translations
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {*}
     */
    translateField(field, data, translations, runtime = {}) {
        return this.#field(field, data)?.translate(data, translations, runtime);
    }

    /**
     * Extract one mapped field.
     *
     * @param {string} field
     * @param {object} data
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {*}
     */
    extractField(field, data, runtime = {}) {
        return this.#field(field, data)?.extract(data, runtime)?.[field];
    }

    /**
     * Extract all mapped fields in translation-file shape.
     *
     * @param {object} data
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {object}
     */
    extract(data, runtime = {}) {
        return this.#activeFields(data).reduce((mapped, field) => {
            const extracted = field.extract(data, runtime);

            if (typeof extracted === "undefined") {
                return mapped;
            }

            const filtered = this.#withoutUndefined(extracted);
            if (Object.keys(filtered).length === 0) {
                return mapped;
            }

            return foundry.utils.mergeObject(mapped, filtered);
        }, {});
    }

    /**
     * Whether at least one field uses a named converter.
     *
     * @returns {boolean}
     */
    usesConverters() {
        return this.#allFields().some((field) => field.usesConverter());
    }

    #field(field, data) {
        return this.#activeFields(data).slice().reverse().find((mappedField) => mappedField.field === field);
    }

    #activeFields(data) {
        const fields = [
            ...this.fields,
            ...this.variantFields
                .filter((variant) => this.#matches(variant.when, data))
                .flatMap((variant) => variant.fields),
        ];
        const effective = new Map();
        for (const field of fields) {
            effective.delete(field.field);
            effective.set(field.field, field);
        }

        return Array.from(effective.values());
    }

    #allFields() {
        return [
            ...this.fields,
            ...this.variantFields.flatMap((variant) => variant.fields),
        ];
    }

    #withoutUndefined(extracted) {
        return Object.fromEntries(
            Object.entries(extracted).filter(([, value]) => typeof value !== "undefined"),
        );
    }

    #normalized(mapping = {}) {
        const definition = mapping ?? {};
        const {_variants, ...baseMapping} = definition;
        const variants = Array.isArray(_variants)
            ? _variants.map((variant) => this.#variant(variant)).filter((variant) => Object.keys(variant.mapping).length)
            : [];

        return {
            mapping: baseMapping,
            variants,
        };
    }

    #variant(variant = {}) {
        const {_when, ...mapping} = variant ?? {};
        return {
            when: _when ?? null,
            mapping,
        };
    }

    #matches(condition, data) {
        if (!condition) {
            return false;
        }

        if (Array.isArray(condition.all)) {
            return condition.all.every((child) => this.#matches(child, data));
        }

        if (Array.isArray(condition.any)) {
            return condition.any.some((child) => this.#matches(child, data));
        }

        if (typeof condition.path !== "string" || !condition.path.length) {
            return false;
        }

        const value = foundry.utils.getProperty(data, condition.path);
        const checks = [];
        if (Object.hasOwn(condition, "equals")) {
            checks.push(value === condition.equals);
        }
        if (Array.isArray(condition.in)) {
            checks.push(condition.in.includes(value));
        }
        if (Object.hasOwn(condition, "exists")) {
            checks.push((typeof value !== "undefined") === Boolean(condition.exists));
        }

        return checks.length > 0 && checks.every(Boolean);
    }

    #required(value, dependency) {
        if (!value) {
            throw new Error(`MappingBlock requires ${dependency} for '${this.owner}'.`);
        }

        return value;
    }
}
