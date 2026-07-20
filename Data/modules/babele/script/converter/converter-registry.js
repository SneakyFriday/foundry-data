import {FunctionalConverter} from "./functional-converter.js";

/**
 * Registry of named converters available to field mappings.
 *
 * This object normalizes registrations at the boundary so the rest of the
 * runtime always works with the internal converter contract.
 */
export class ConverterRegistry {

    #byName;

    constructor(converters = {}) {
        this.#byName = {};
        this.registerAll(converters);
    }

    /**
     * Register one converter under a stable name.
     *
     * @param {string} name
     * @param {*} converter
     * @returns {*}
     */
    register(name, converter) {
        this.#byName[name] = this.#normalize(name, converter);
        return this.named(name);
    }

    /**
     * Register multiple converters at once.
     *
     * @param {object} converters
     * @returns {ConverterRegistry}
     */
    registerAll(converters = {}) {
        for (const [name, converter] of Object.entries(converters)) {
            this.register(name, converter);
        }

        return this;
    }

    /**
     * Resolve one converter by name.
     *
     * @param {string} name
     * @returns {*|null}
     */
    named(name) {
        return this.#byName[name] ?? null;
    }

    /**
     * Return a frozen compatibility view of the registered converters.
     *
     * @returns {object}
     */
    snapshot() {
        return Object.freeze({...this.#byName});
    }

    #normalize(name, converter) {
        if (typeof converter === "function") {
            return new FunctionalConverter(converter);
        }

        if (converter && typeof converter.translate === "function") {
            return converter;
        }

        throw new Error(`Invalid converter registration for '${name}'. Expected a function or an object exposing translate(context).`);
    }
}
