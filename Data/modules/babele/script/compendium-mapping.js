import {FieldMapping} from "./field-mapping.js";
import {Babel} from "./babele.js";

/**
 *
 */
export class CompendiumMapping {

    constructor(entityType, mapping, tc) {
        this.entityType = entityType;
        this.tc = tc;

        // Separate subtype-specific entries (e.g. "Actor.hero") from base field mappings.
        this._subtypeCustomMappings = {};
        const baseCustomMapping = {};

        if (mapping) {
            const subtypePrefix = `${entityType}.`;
            for (const [key, value] of Object.entries(mapping)) {
                if (key.startsWith(subtypePrefix)) {
                    this._subtypeCustomMappings[key.slice(subtypePrefix.length)] = value;
                } else {
                    baseCustomMapping[key] = value;
                }
            }
        }

        this.mapping = foundry.utils.mergeObject(Babel.DEFAULT_MAPPINGS[entityType] || {}, baseCustomMapping, { inplace: false });
        this.fields = Object.keys(this.mapping).map(key => new FieldMapping(key, this.mapping[key], tc));
        this._subtypeFieldsCache = {};
    }

    /**
     * Returns the effective FieldMapping array for a given document subtype.
     * The resolution order is: base mapping ← DEFAULT_MAPPINGS subtype ← translation-file subtype.
     * Results are cached so FieldMapping objects are not recreated on every call.
     *
     * @param {string|undefined} subtype  The document's `type` field (e.g. "hero", "spell").
     * @returns {FieldMapping[]}
     */
    _getFieldsForType(subtype) {
        if (!subtype) {
            return this.fields;
        }

        if (this._subtypeFieldsCache[subtype] !== undefined) {
            return this._subtypeFieldsCache[subtype];
        }

        const defaultSubtypeMapping = Babel.DEFAULT_MAPPINGS[`${this.entityType}.${subtype}`];
        const customSubtypeMapping = this._subtypeCustomMappings[subtype];

        if (!defaultSubtypeMapping && !customSubtypeMapping) {
            this._subtypeFieldsCache[subtype] = this.fields;

            return this.fields;
        }

        const subtypeOverride = foundry.utils.mergeObject(
            defaultSubtypeMapping || {},
            customSubtypeMapping || {},
            { inplace: false },
        );
        const merged = foundry.utils.mergeObject(this.mapping, subtypeOverride, { inplace: false });
        const fields = Object.keys(merged).map(key => new FieldMapping(key, merged[key], this.tc));
        this._subtypeFieldsCache[subtype] = fields;

        return fields;
    }

    /**
     *
     * @param data original data to translate
     * @returns {*} an object with expanded mapped fields path and a translated value.
     */
    map(data, translations) {
        return this._getFieldsForType(data.type).reduce((m, f) => foundry.utils.mergeObject(m, f.map(data, translations)), {});
    }

    /**
     *
     */
    translateField(field, data, translations) {
        return this._getFieldsForType(data.type).find(f => f.field === field)?.translate(data, translations);
    }

    /**
     *
     */
    extractField(field, data) {
        return this._getFieldsForType(data.type).find(f => f.field === field)?.extractValue(field, data);
    }

    /**
     *
     * @param data
     * @returns {*}
     */
    extract(data) {
        return this._getFieldsForType(data.type)
            .filter(f => !f.isDynamic())
            .reduce((m, f) => foundry.utils.mergeObject(m, f.extract(data)), {});
    }

    /**
     * If almost one of the mapped field is dynamic, the compendium is considered dynamic.
     * Also checks all registered subtype mappings so that a pack with dynamic subtype fields
     * is correctly treated as dynamic even when the base mapping has no converters.
     */
    isDynamic() {
        if (this.fields.some(f => f.isDynamic())) {
            return true;
        }

        const prefix = `${this.entityType}.`;
        const subtypes = new Set([
            ...Object.keys(this._subtypeCustomMappings),
            ...Object.keys(Babel.DEFAULT_MAPPINGS)
                .filter(key => key.startsWith(prefix))
                .map(key => key.slice(prefix.length))
        ]);

        return [...subtypes].some(subtype => this._getFieldsForType(subtype).some(f => f.isDynamic()));
    }

}
