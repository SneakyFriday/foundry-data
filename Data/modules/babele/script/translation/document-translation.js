/**
 * Materialized result of applying a translated payload to one document.
 *
 * This object owns the common Babele flag semantics shared by root document
 * translation and embedded document translation. It intentionally knows
 * nothing about compendiums, mappings, fallback packs, or runtime scopes.
 */
export class DocumentTranslation {

    #source;
    #payload;
    #hasTranslation;
    #originalPayload;
    #requiresPayload;
    #language;

    /**
     * @param {object} options
     * @param {object} options.source Source document payload.
     * @param {object} [options.payload] Translated payload to merge into the source.
     * @param {boolean} [options.hasTranslation] Whether a translation entry was matched.
     * @param {object|null} [options.originalPayload] Extracted source-language mapped payload.
     * @param {boolean} [options.requiresPayload] Whether empty payloads should leave the source untouched.
     * @param {string|null} [options.language] Language used to materialize the translation.
     */
    constructor({source, payload = {}, hasTranslation = false, originalPayload = null, requiresPayload = false, language = null} = {}) {
        this.#source = source;
        this.#payload = payload ?? {};
        this.#hasTranslation = hasTranslation === true;
        this.#originalPayload = originalPayload ?? null;
        this.#requiresPayload = requiresPayload === true;
        this.#language = typeof language === "string" && language.trim().length > 0 ? language.trim() : null;
    }

    /**
     * Return the translated document with Babele flags, or the original source
     * when there is no effective translation to materialize.
     *
     * @returns {object}
     */
    apply() {
        if (this.#requiresPayload && !this.#hasPayload()) {
            return this.#source;
        }

        const translatedDocument = foundry.utils.mergeObject(this.#source, this.#payload, {inplace: false});
        const translated = this.#changesSource(translatedDocument);

        if (!this.#hasTranslation && !translated) {
            return this.#source;
        }

        return foundry.utils.mergeObject(
            translatedDocument,
            this.#flags(translated),
            {inplace: false},
        );
    }

    #changesSource(translatedDocument) {
        if (!this.#hasPayload()) {
            return false;
        }

        return !this.#sameValue(this.#source, translatedDocument);
    }

    #hasPayload() {
        return !!this.#payload && Object.keys(this.#payload).length > 0;
    }

    #flags(translated) {
        const babele = {
            translated,
            hasTranslation: this.#hasTranslation,
            originalName: this.#source?.name,
        };

        if (this.#originalPayload) {
            babele.originalPayload = this.#originalPayload;
        }

        if (this.#language) {
            babele.lang = this.#language;
        }

        return {
            translated,
            hasTranslation: this.#hasTranslation,
            originalName: this.#source?.name,
            flags: {
                babele,
            },
        };
    }

    #sameValue(left, right) {
        if (left === right) {
            return true;
        }

        if (Array.isArray(left) || Array.isArray(right)) {
            if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
                return false;
            }

            return left.every((value, index) => this.#sameValue(value, right[index]));
        }

        if (!this.#isPlainObject(left) || !this.#isPlainObject(right)) {
            return false;
        }

        const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
        for (const key of keys) {
            if (!this.#sameValue(left[key], right[key])) {
                return false;
            }
        }

        return true;
    }

    #isPlainObject(value) {
        return !!value && typeof value === "object" && !Array.isArray(value);
    }
}
