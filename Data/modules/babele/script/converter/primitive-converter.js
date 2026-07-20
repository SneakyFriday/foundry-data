const warnedMissingPaths = new Set();
const warnedInvalidStaticTranslations = new Set();

function missingPathWarningsEnabled() {
    try {
        return game.settings.get("babele", "warnMissingPaths") === true;
    } catch {
        return false;
    }
}

/**
 * Built-in converter for plain path-based primitive field mappings.
 *
 * Static mappings validate the source path and translated payload before
 * returning the translated value to merge.
 */
export class PrimitiveConverter {

    prepare() {
        return undefined;
    }

    translate(fieldMapping, data, translations, runtime = {}) {
        const translatedValue = translations[fieldMapping.field];
        const original = fieldMapping._resolvedPathValue(data);
        if (!original.exists) {
            if (fieldMapping._hasOwn(translations, fieldMapping.field)) {
                this._logMissingPath(fieldMapping, "translate", data, runtime);
            }
            return undefined;
        }

        const originalValue = original.value;
        if (typeof originalValue === "undefined" || originalValue === null) {
            return originalValue;
        }

        const invalidReason = this._invalidStaticTranslation(originalValue, translatedValue);
        if (invalidReason) {
            this._logInvalidStaticTranslation(fieldMapping, data, originalValue, translatedValue, invalidReason, runtime);
            return undefined;
        }

        return translatedValue;
    }

    extract(fieldMapping, data) {
        return {[fieldMapping.field]: fieldMapping.extractValue(data)};
    }

    _logMissingPath(fieldMapping, phase, data, runtime = {}) {
        if (!missingPathWarningsEnabled()) {
            return;
        }

        const pack = this._pack(runtime);
        const warningKey = `${phase}::${pack}::${fieldMapping.field}::${fieldMapping.path}`;

        if (warnedMissingPaths.has(warningKey)) {
            return;
        }

        warnedMissingPaths.add(warningKey);
        console.warn(`Babele | missing source path for field '${fieldMapping.field}', field skipped during ${phase}`, {
            pack,
            field: fieldMapping.field,
            path: fieldMapping.path,
            phase,
            documentId: data?._id ?? null,
            documentName: data?.name ?? null,
        });
    }

    _invalidStaticTranslation(originalValue, translatedValue) {
        if (Array.isArray(translatedValue) || this._isPlainObject(translatedValue)) {
            return "structural";
        }

        if (!this._isPrimitiveTypeGuarded(originalValue)) {
            return null;
        }

        if (typeof translatedValue === "undefined" || translatedValue === null) {
            return null;
        }

        return typeof originalValue === typeof translatedValue ? null : "type_mismatch";
    }

    _isPlainObject(value) {
        return !!value && typeof value === "object" && !Array.isArray(value);
    }

    _isPrimitiveTypeGuarded(value) {
        const type = typeof value;
        return type === "string" || type === "number" || type === "boolean";
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

    _logInvalidStaticTranslation(fieldMapping, data, originalValue, translatedValue, reason, runtime = {}) {
        const pack = this._pack(runtime);
        const originalType = this._valueType(originalValue);
        const translatedType = this._valueType(translatedValue);
        const warningKey = `${pack}::${fieldMapping.field}::${fieldMapping.path}::${reason}::${originalType}::${translatedType}`;

        if (warnedInvalidStaticTranslations.has(warningKey)) {
            return;
        }

        warnedInvalidStaticTranslations.add(warningKey);
        console.warn(`Babele | invalid translation payload for static field '${fieldMapping.field}', field skipped`, {
            pack,
            field: fieldMapping.field,
            path: fieldMapping.path,
            documentId: data?._id ?? null,
            documentName: data?.name ?? null,
            reason,
            originalType,
            translatedType,
        });
    }

    _pack(runtime = {}) {
        const compendium = runtime?.currentCompendium?.() ?? null;
        return compendium?.metadata?.id ?? compendium?.metadata?.name ?? "unknown";
    }
}
