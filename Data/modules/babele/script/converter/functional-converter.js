/**
 * Adapter for function-based converters.
 *
 * A function-based converter is a first-class Babele converter shape: a plain
 * translation function, optionally enriched with `prepare` and/or `extract`
 * hooks when needed.
 */
export class FunctionalConverter {

    constructor(fn) {
        this.fn = fn;
    }

    /**
     * Forward optional pre-translation preparation to the wrapped function.
     *
     * @returns {*}
     */
    prepare() {
        if (typeof this.fn.prepare !== "function") {
            return undefined;
        }

        const [context] = arguments;

        return this.fn.prepare(
            context.value,
            context.translation,
            context.source,
            context.contextCompendium,
            context.allTranslations,
            context.runtime,
            context.params,
        );
    }

    /**
     * Translate through the historical function-based Babele converter
     * signature.
     *
     * @param {object} context
     * @returns {*}
     */
    translate(context) {
        return this.fn(
            context.value,
            context.translation,
            context.source,
            context.contextCompendium,
            context.allTranslations,
            context.runtime,
            context.params,
        );
    }

    /**
     * Extract through the historical function-based Babele converter
     * signature when the wrapped function exposes an `extract` hook.
     *
     * @param {object} context
     * @returns {*}
     */
    extract(context) {
        if (typeof this.fn.extract !== "function") {
            return undefined;
        }

        return this.fn.extract(
            context.value,
            context.source,
            context.contextCompendium,
            {
                field: context.field,
                path: context.path,
                params: context.params,
                mapping: context.params,
                runtime: context.runtime,
            },
        );
    }
}
