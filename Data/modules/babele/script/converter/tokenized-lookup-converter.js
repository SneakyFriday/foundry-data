import {LookupConverter} from "./lookup-converter.js";

const warnedInvalidTokenizedLookupConfigurations = new Set();

/**
 * Built-in converter for delimited string translations through an inline
 * vocabulary.
 *
 * TokenizedLookupConverter splits one scalar string into tokens, translates
 * each token independently through the same inline `values` table used by
 * `lookup`, then joins the translated tokens again.
 *
 * Like `lookup`, this converter is mapping-driven and intentionally omitted
 * from translation JSON export.
 */
export class TokenizedLookupConverter {

    #lookup;

    constructor() {
        this.#lookup = new LookupConverter();
    }

    prepare() {
        return undefined;
    }

    translate(context) {
        const {value, params = {}, runtime = {}, field, path} = context;

        if (typeof value === "undefined" || value === null || value === "") {
            return value;
        }

        if (typeof value !== "string") {
            return value;
        }

        const values = params?.values;
        if (!this._isLookupTable(values)) {
            this._warnInvalidConfiguration(field, path, runtime, "invalid_values");
            return value;
        }

        const delimiters = this._delimiters(params);
        if (!delimiters.length) {
            this._warnInvalidConfiguration(field, path, runtime, "missing_delimiter");
            return value;
        }

        const separator = this._separator(params, delimiters);
        const tokens = this._tokens(value, delimiters);

        return tokens
            .map((token) => this.#lookup.translate({
                ...context,
                value: token,
                params: {
                    values,
                    normalize: params?.normalize,
                },
            }))
            .join(separator);
    }

    extract() {
        return undefined;
    }

    _delimiters(params = {}) {
        if (typeof params?.delimiter === "string" && params.delimiter.length) {
            return [params.delimiter];
        }

        if (Array.isArray(params?.delimiters)) {
            return params.delimiters.filter((delimiter) => typeof delimiter === "string" && delimiter.length);
        }

        return [];
    }

    _separator(params = {}, delimiters = []) {
        if (typeof params?.separator === "string") {
            return params.separator;
        }

        return delimiters[0] ?? "";
    }

    _tokens(value, delimiters) {
        if (delimiters.length === 1) {
            return value.split(delimiters[0]);
        }

        const pattern = new RegExp(delimiters.map((delimiter) => this._escape(delimiter)).join("|"), "g");
        return value.split(pattern);
    }

    _escape(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    _isLookupTable(values) {
        return !!values && typeof values === "object" && !Array.isArray(values);
    }

    _warnInvalidConfiguration(field, path, runtime = {}, reason) {
        const pack = runtime?.currentCompendium?.()?.metadata?.id
            ?? runtime?.currentCompendium?.()?.metadata?.name
            ?? "unknown";
        const warningKey = `${pack}::${field}::${path}::${reason}`;

        if (warnedInvalidTokenizedLookupConfigurations.has(warningKey)) {
            return;
        }

        warnedInvalidTokenizedLookupConfigurations.add(warningKey);
        console.warn(`Babele | invalid tokenizedLookup configuration for field '${field}', field will fail open`, {
            pack,
            field,
            path,
            reason,
        });
    }
}
