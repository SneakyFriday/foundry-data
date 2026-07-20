const warnedInvalidLookupConfigurations = new Set();

/**
 * Built-in converter for declarative vocabulary-based scalar translations.
 *
 * LookupConverter reads an inline key/value table from the field converter
 * params and resolves the current scalar value against it. Missing keys fail
 * open and return the original source value unchanged.
 *
 * Lookup-driven fields are mapping-defined rather than translation-entry
 * defined, so extraction is intentionally unsupported and returns `undefined`.
 */
export class LookupConverter {

    prepare() {
        return undefined;
    }

    translate(context) {
        const {value, params = {}, runtime = {}, field, path} = context;

        if (typeof value === "undefined" || value === null || value === "") {
            return value;
        }

        const values = params?.values;
        if (!this._isLookupTable(values)) {
            this._warnInvalidConfiguration(field, path, runtime, values);
            return value;
        }

        const normalizedKey = this._normalize(value, params?.normalize);
        return this._lookup(values, normalizedKey, value);
    }

    extract() {
        return undefined;
    }

    _lookup(values, normalizedKey, originalValue) {
        if (Object.prototype.hasOwnProperty.call(values, normalizedKey)) {
            return values[normalizedKey];
        }

        return originalValue;
    }

    _normalize(value, strategy = "none") {
        const asString = String(value);

        switch (strategy ?? "none") {
            case "none":
                return asString;
            case "lowercase":
                return asString.toLowerCase();
            case "trim":
                return asString.trim();
            case "trim-lowercase":
                return asString.trim().toLowerCase();
            default:
                return asString;
        }
    }

    _isLookupTable(values) {
        return !!values && typeof values === "object" && !Array.isArray(values);
    }

    _warnInvalidConfiguration(field, path, runtime = {}, values) {
        const pack = runtime?.currentCompendium?.()?.metadata?.id
            ?? runtime?.currentCompendium?.()?.metadata?.name
            ?? "unknown";
        const reason = typeof values === "undefined" ? "missing_values" : "invalid_values";
        const warningKey = `${pack}::${field}::${path}::${reason}`;

        if (warnedInvalidLookupConfigurations.has(warningKey)) {
            return;
        }

        warnedInvalidLookupConfigurations.add(warningKey);
        console.warn(`Babele | invalid lookup configuration for field '${field}', field will fail open`, {
            pack,
            field,
            path,
            reason,
        });
    }
}
