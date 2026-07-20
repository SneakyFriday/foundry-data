/**
 * Since foundry 0.8.+, translations are directly applied replacing the default ClientDatabaseBackend _getDocuments implementation
 * with a code that merge the incoming data with the mapped translations using LibWrapper.
 */
export function initWrapper() {

    if(!game.modules.get('lib-wrapper')?.active && game.user.isGM) {
        ui.notifications.error(game.i18n.localize("BABELE.requireLibWrapperMessage"));
    }

    libWrapper.register('babele', 'CONFIG.DatabaseBackend._getDocuments', async function (wrapped, ...args) {
        const result = await wrapped(...args);
        return await translateResult(result, contextFromArgs(args));
    }, 'WRAPPER');

    /**
     * Necessary to solve a problem caused by the replacement of the index, even if already present, after reading the document.
     */
    libWrapper.register('babele', 'foundry.documents.collections.CompendiumCollection.prototype.indexDocument', function (wrapped, ...args) {
        return preserveIndexFlags(this, wrapped, args);
    }, 'WRAPPER');
}

export function contextFromArgs(args = []) {
    const [documentClass, request = {}] = args;
    return {
        documentClass: typeof documentClass === "function" ? documentClass : null,
        request,
        pack: request?.pack ?? null,
        index: !!(request?.index ?? request?.options?.index),
    };
}

export async function translateResult(result, context = {}, babele = game?.babele ?? null) {
    if (!babele || !Array.isArray(result) || result.length === 0) {
        return result;
    }

    if (!await babele.init()) {
        return result;
    }

    const {
        documentClass = null,
        pack = null,
        index = false,
    } = context;

    if (!pack) {
        return result;
    }

    const compendium = babele.translatedCompendiumFor(pack);
    if (!compendium) {
        return result;
    }

    if (index) {
        return compendium.translateIndex(result);
    }

    return result.map((document) => translateDocument(document, documentClass, pack, compendium));
}

export function preserveIndexFlags(collection, wrapped, args = []) {
    const [document] = args;
    const id = document?.id;
    const idx = id ? collection.index.get(id) : null;
    const flag = document?.flags?.babele ?? {};

    const result = wrapped(...args);

    if (id) {
        collection.index.set(id, foundry.utils.mergeObject(
            collection.index.get(id),
            {
                ...idx,
                ...flag
            }
        ));
    }

    return result;
}

function translateDocument(document, documentClass, pack, compendium) {
    const source = documentSource(document);
    if (!source) {
        return document;
    }

    try {
        const translated = compendium.translate(source);

        if (!documentClass) {
            return translated;
        }

        return reconstructDocument(documentClass, translated, {pack});
    } catch (error) {
        console.error(`Babele | failed to translate loaded compendium document from '${pack}'`, {
            pack,
            documentId: source?._id ?? null,
            documentName: source?.name ?? null,
            error: error?.message ?? String(error),
        });
        return document;
    }
}

function reconstructDocument(documentClass, source, context) {
    if (typeof documentClass?.fromSource === "function") {
        return documentClass.fromSource(source, context);
    }

    return new documentClass(source, context);
}

function documentSource(document) {
    if (!document) {
        return null;
    }

    if (typeof document.toObject === "function") {
        return document.toObject();
    }

    if (typeof document === "object") {
        return document;
    }

    return null;
}
