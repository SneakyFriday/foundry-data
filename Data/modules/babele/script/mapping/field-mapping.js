import {PrimitiveConverter} from "../converter/primitive-converter.js";
import {converterContext} from "../converter/converter-context.js";
import {CompendiumRuntime} from "../compendium/compendium-runtime.js";

const warnedConverterFailures = new Set();
const warnedMissingConverters = new Set();

/**
 * Maps, translates and extracts a single field declared by a document mapping.
 *
 * FieldMapping acts as the stable context for one mapped field while delegating
 * the variable behavior to an internal field converter:
 * - static mappings use a primitive converter that reads and writes a value at the configured path
 * - converter mappings use an adapter around a named registered converter
 *
 * The constructor selects the appropriate field converter from the mapping shape:
 * a string path creates the primitive field converter, while an object mapping
 * creates an adapter around the named registered converter.
 *
 * Example:
 * new FieldMapping("desc", "data.description.value")
 */
export class FieldMapping {

    #converter;

    /**
 * @param {string} field Translation field key.
     * @param {string|object} mapping Field mapping definition.
     */
    constructor(field, mapping, converterRegistry = null) {
        this.field = field;
        this.mapping = mapping;
        if (typeof mapping === "object") {
            this.path = mapping["path"];
            this.#converter = new NamedFieldConverter(
                mapping["converter"],
                this._required(converterRegistry, "converterRegistry"),
            );
        } else {
            this.path = mapping;
            this.#converter = new PrimitiveConverter();
        }
    }

    /**
     * Translates this field and expands the translated value back to its full path.
     *
     * Returns an empty object when no translation should be applied. This includes
     * missing translations, missing source paths for static fields, invalid static
     * payloads and converter failures, all of which fail open.
     *
     * @param {object} data Original document source data.
     * @param {object} translations Static translations available for the current document.
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {object} An object with the expanded field path and translated value, or an empty object.
     */
    map(data, translations, runtime = {}) {
        const map = {};
        const value = this.translate(data, translations, runtime);
        if (typeof value !== "undefined" && value !== null) {
            this.path.split('.').reduce((a, f, i, r) => {
                a[f] = (i < r.length - 1) ? {} : value;
                return a[f];
            }, map);
        }
        return map;
    }

    /**
     * Prepare dynamic converter state before field translation starts.
     *
     * This hook allows converters to publish runtime-local compendiums or
     * cache prepared state without depending on field iteration order.
     *
     * @param {object} data
     * @param {object} translations
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {*}
     */
    prepare(data, translations, runtime = {}) {
        return this.#converter.prepare?.(this, data, translations, runtime);
    }

    /**
     * Resolves the translated value for this field.
     *
     * Static fields validate that the source path exists when a translation is
     * provided and reject structural or primitive type mismatches. Dynamic
     * fields delegate to their converter and fail open on missing converters or
     * converter errors.
     *
     * @param {object} data Original document source data.
     * @param {object} translations Static translations available for the current document.
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {*} The translated field value, or `undefined` when no value should be merged.
     */
    translate(data, translations, runtime = {}) {
        return this.#converter.translate(this, data, translations, runtime);
    }

    /**
     * Extracts the value corresponding to the field path configured within the passed data.
     *
     * ex:
     * const data = { "data": { "description": { "value": "bla bla" } } };
     * const value = new FieldMapping("desc", "data.description.value").extractValue(data);
     * console.log(value) // -> "bla bla"
     *
     * Returns `undefined` both when the path is missing and when the path exists
     * but currently stores `undefined`.
     *
     * @param {object} data Original document source data.
     * @returns {*} The value currently stored at the configured path.
     */
    extractValue(data) {
        return this._resolvedPathValue(data).value;
    }


    /**
     * Extracts the current field value in translation-file shape.
     *
     * ex:
     * const data = { "data": { "description": { "value": "bla bla" } } };
     * const value = new FieldMapping("desc", "data.description.value").extract(data);
     * console.log(value) // -> { "desc": "bla bla" }
     *
     * Static fields always return `{[field]: value}` even when the path is
     * currently missing. Dynamic fields may return `undefined` when extraction
     * is unsupported, the converter is missing or the converter fails.
     *
     * @param {object} data Original document source data.
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {object|undefined} The extracted translation fragment, or `undefined` when skipped.
     */
    extract(data, runtime = {}) {
        return this.#converter.extract(this, data, runtime);
    }

    /**
     * Resolves the configured path against the provided document source data.
     *
     * Unlike `extractValue`, this preserves whether the path exists at all so
     * static translation can distinguish a missing branch from an explicit
     * `undefined` value.
     *
     * @param {object} data
     * @returns {{exists: boolean, value: *}}
     * @private
     */
    _resolvedPathValue(data) {
        let current = data;

        for (const key of this.path.split('.')) {
            if (!this._hasOwn(current, key)) {
                return {exists: false, value: undefined};
            }

            current = current[key];
        }

        return {exists: true, value: current};
    }


    /**
     * Safe `hasOwnProperty` check for traversed source values.
     *
     * @param {*} target
     * @param {string} key
     * @returns {boolean}
     * @private
     */
    _hasOwn(target, key) {
        if (target === null || typeof target === "undefined") {
            return false;
        }

        const targetType = typeof target;
        if (targetType !== "object" && targetType !== "function") {
            return false;
        }

        return Object.prototype.hasOwnProperty.call(target, key);
    }


    /**
     * Whether this field mapping is backed by a registered converter rather
     * than by a plain primitive path mapping.
     *
     * @returns {boolean}
     */
    usesConverter() {
        return this.#converter instanceof NamedFieldConverter;
    }

    _required(value, dependency) {
        if (!value) {
            throw new Error(`FieldMapping requires ${dependency} for dynamic field '${this.field ?? "unknown"}'.`);
        }

        return value;
    }
}

/**
 * Adapter around a named OO converter-backed field mapping.
 *
 * Babel normalizes function registrations at the boundary, so by the time
 * FieldMapping resolves a converter by name it expects an object exposing
 * `translate(context)` and optionally `prepare(context)` / `extract(context)`.
 * Named lookup should go through the effective `ConverterRegistry` owned by
 * the document mapping currently materializing this field.
 */
class NamedFieldConverter {

    constructor(converterName, registry) {
        this.converterName = converterName ?? null;
        this.registry = registry;
    }

    get converter() {
        return this.registry.named(this.converterName);
    }

    /**
     * @param {object} data
     * @param {object} translations
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {*}
     */
    translate(fieldMapping, data, translations, runtime = {}) {
        this._assertSupportedShape();
        if (!this.converter) {
            this._logMissingConverter(fieldMapping, "translate", data, runtime);
            return undefined;
        }

        const originalValue = fieldMapping.extractValue(data);
        if (typeof originalValue === "undefined" || originalValue === null) {
            return originalValue;
        }

        const translation = translations[fieldMapping.field];

        try {
            return this._translator()(
                this._context(
                    fieldMapping,
                    originalValue,
                    translation,
                    data,
                    runtime,
                    translations,
                ),
            );
        } catch (error) {
            this._logConverterFailure(fieldMapping, "translate", data, error, runtime, {
                value: originalValue,
                translation,
            });
            return undefined;
        }
    }

    /**
     * @param {object} data
     * @param {import("../compendium/compendium-runtime.js").CompendiumRuntime|object} [runtime]
     * @returns {object|undefined}
     */
    extract(fieldMapping, data, runtime = {}) {
        this._assertSupportedShape();
        const extractor = this._extractor();
        const originalValue = fieldMapping.extractValue(data);

        if (!this.converter && !extractor) {
            this._skipDynamicField(fieldMapping, runtime, "missing_converter");
            this._logMissingConverter(fieldMapping, "extract", data, runtime);
            return undefined;
        }

        if (!extractor) {
            this._skipDynamicField(fieldMapping, runtime, "missing_converter_extract");
            return undefined;
        }

        try {
            const extracted = extractor(
                this._context(
                    fieldMapping,
                    originalValue,
                    undefined,
                    data,
                    runtime,
                    {},
                ),
            );

            if (typeof extracted === "undefined") {
                return undefined;
            }

            return {[fieldMapping.field]: extracted};
        } catch (error) {
            this._logConverterFailure(fieldMapping, "extract", data, error, runtime, {
                value: originalValue,
            });
            return undefined;
        }
    }

    prepare(fieldMapping, data, translations, runtime = {}) {
        this._assertSupportedShape();

        if (!this.converter || typeof this.converter.prepare !== "function") {
            return undefined;
        }

        return this.converter.prepare(
            this._context(
                fieldMapping,
                fieldMapping.extractValue(data),
                translations[fieldMapping.field],
                data,
                runtime,
                translations,
            ),
        );
    }

    _extractor() {
        if (typeof this.converter?.extract === "function") {
            return this.converter.extract.bind(this.converter);
        }

        return null;
    }

    _translator() {
        if (typeof this.converter?.translate === "function") {
            return this.converter.translate.bind(this.converter);
        }

        return () => undefined;
    }

    _assertSupportedShape() {
        if (!this.converter) {
            return;
        }

        if (typeof this.converter.translate === "function") {
            return;
        }

        throw new Error(
            `Converter '${this.converterName}' is not a supported OO converter. ` +
            `Register converters through the Foundry facade with game.babele.registerConverter().`,
        );
    }

    _contextCompendium(runtime = {}) {
        return CompendiumRuntime.from(runtime).currentCompendium();
    }

    _context(fieldMapping, value, translation, source, runtime = {}, allTranslations = {}) {
        return converterContext({
            value,
            translation,
            source,
            field: fieldMapping.field,
            path: fieldMapping.path,
            params: fieldMapping.mapping,
            allTranslations,
            contextCompendium: this._contextCompendium(runtime),
            runtime,
            sourceKey: runtime?.sourceKey ?? null,
        });
    }

    _logConverterFailure(fieldMapping, phase, data, error, runtime = {}, {value, translation} = {}) {
        const pack = this._pack(runtime);
        const converter = this.converterName ?? "anonymous";
        const errorMessage = error?.message ?? String(error);
        const warningKey = `${phase}::${pack}::${fieldMapping.field}::${converter}::${errorMessage}`;

        if (warnedConverterFailures.has(warningKey)) {
            return;
        }

        warnedConverterFailures.add(warningKey);
        console.error(`Babele | converter '${converter}' failed during ${phase}`, {
            pack,
            field: fieldMapping.field,
            path: fieldMapping.path,
            converter,
            phase,
            documentId: data?._id ?? null,
            documentName: data?.name ?? null,
            error: errorMessage,
            valueType: this._valueType(value),
            valuePreview: this._valuePreview(value),
            translationType: this._valueType(translation),
            translationPreview: this._valuePreview(translation),
        });
    }

    _logMissingConverter(fieldMapping, phase, data, runtime = {}) {
        const pack = this._pack(runtime);
        const converter = this.converterName ?? "anonymous";
        const warningKey = `${phase}::${pack}::${fieldMapping.field}::${converter}`;

        if (warnedMissingConverters.has(warningKey)) {
            return;
        }

        warnedMissingConverters.add(warningKey);
        console.warn(`Babele | missing converter '${converter}' for dynamic field '${fieldMapping.field}', field skipped during ${phase}`, {
            pack,
            field: fieldMapping.field,
            path: fieldMapping.path,
            converter,
            phase,
            documentId: data?._id ?? null,
            documentName: data?.name ?? null,
        });
    }

    _skipDynamicField(fieldMapping, runtime = {}, reason) {
        runtime.onSkippedDynamicField?.({
            field: fieldMapping.field,
            path: fieldMapping.path,
            mapping: fieldMapping.mapping,
            reason,
        });
    }

    _pack(runtime = {}) {
        const compendium = this._contextCompendium(runtime);
        return compendium?.metadata?.id ?? compendium?.metadata?.name ?? "unknown";
    }

    _valueType(value) {
        if (Array.isArray(value)) {
            return "array";
        }

        if (value === null) {
            return "null";
        }

        return typeof value;
    }

    _valuePreview(value) {
        if (Array.isArray(value)) {
            return {
                length: value.length,
                firstItemType: this._valueType(value[0]),
                firstItemKeys: this._objectKeys(value[0]),
            };
        }

        if (value && typeof value === "object") {
            return {
                keys: this._objectKeys(value),
            };
        }

        return value;
    }

    _objectKeys(value) {
        if (!value || typeof value !== "object") {
            return [];
        }

        return Object.keys(value).slice(0, 10);
    }
}
