import {CompendiumRuntime} from "../compendium/compendium-runtime.js";

/**
 * Built-in converter for fields whose translation can fall back to a field of
 * another referenced document resolved via UUID.
 *
 * Translation precedence is:
 * 1. explicit local translation payload for the current field
 * 2. translated field resolved from the referenced compendium document
 * 3. fail open with no merged value
 */
export class ReferencedDocumentFieldConverter {

    translate(context) {
        if (typeof context.translation !== "undefined" && context.translation !== null) {
            return context.translation;
        }

        if (typeof context.value === "undefined" || context.value === null) {
            return context.value;
        }

        const referencedField = context.params?.referencedField ?? context.field;
        const documentUuid = this.#valueAtPath(context.source, context.params?.uuidPath ?? "documentUuid");
        const pack = foundry.utils.parseUuid(documentUuid)?.collection?.collection ?? null;

        if (!pack) {
            return undefined;
        }

        const runtime = CompendiumRuntime.from(context.runtime);
        const referencedPack = runtime.mappedCompendiumFor(pack);
        if (!referencedPack) {
            return undefined;
        }

        return referencedPack.translateField(referencedField, {
            [referencedField]: context.value,
        }, runtime);
    }

    extract(context) {
        return context.value;
    }

    #valueAtPath(source, path) {
        if (!source || !path) {
            return undefined;
        }

        return String(path)
            .split(".")
            .reduce((value, segment) => value?.[segment], source);
    }
}
