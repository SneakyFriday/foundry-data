/**
 * Apply one loaded Babele session to Foundry runtime collections and caches.
 *
 * This is a Foundry adapter operation, not a domain object: the coherent
 * translation state lives in `TranslationSession`, while this function mutates
 * Foundry's visible runtime structures.
 *
 * @param {object} context
 * @param {import("../translation/translation-sources.js").TranslationSources} context.sources
 * @param {import("../translation/translation-session.js").TranslationSession|null} context.session
 * @param {object} [options]
 * @param {boolean} [options.shareSources]
 * @param {boolean} [options.notify]
 * @returns {Promise<void>}
 */
export async function applyRuntimeTranslationsToFoundry(
    {sources, session},
    {shareSources = false, notify = false} = {},
) {
    if (shareSources && game.user.isGM) {
        await sources.shareTranslationFiles();
        await sources.shareGlobalMappingFiles();
    }

    const mappedCompendiums = session?.mappedCompendiums ?? null;
    const folderTranslations = session?.folderTranslations ?? null;

    game.packs.forEach((pack) => {
        restorePackLabel(pack);
        restorePackIndex(pack);
        restorePackFolders(pack);
        translatePackLabel(pack, mappedCompendiums);
        mappedCompendiums?.get?.(pack.collection)?.translateIndex(pack.index);
        folderTranslations?.translatePackFolders?.(pack);
        pack.initializeTree?.();
        pack.clear?.();
    });

    restoreWorldFolders();
    folderTranslations?.translateSystemPackFolders?.();
    folderTranslations?.translateImportedCompendiumFolders?.();
    await rebuildDocumentIndex(game.documentIndex);

    if (notify) {
        ui.notifications?.info?.(game.i18n.localize("BABELE.TranslationSourcesRefreshed"));
    }
}

async function rebuildDocumentIndex(documentIndex) {
    if (!documentIndex || typeof documentIndex.index !== "function") {
        return;
    }

    await documentIndex.ready;
    clearDocumentIndex(documentIndex);
    await documentIndex.index();
}

function clearDocumentIndex(documentIndex) {
    for (const key of Object.keys(documentIndex?.trees ?? {})) {
        delete documentIndex.trees[key];
    }

    for (const key of Object.keys(documentIndex?.uuids ?? {})) {
        delete documentIndex.uuids[key];
    }
}

function restorePackIndex(pack) {
    pack?.index?.forEach?.((entry) => {
        if (entry?.originalName) {
            entry.name = entry.originalName;
        }
        if (entry?.flags?.babele) {
            delete entry.flags.babele;
        }
        delete entry.originalName;
        delete entry.translated;
        delete entry.hasTranslation;
    });
}

function restorePackLabel(pack) {
    if (!pack?.metadata) {
        return;
    }

    if (pack.metadata.originalLabel) {
        pack.metadata.label = pack.metadata.originalLabel;
        delete pack.metadata.originalLabel;
    }
}

function restorePackFolders(pack) {
    pack?.folders?.forEach?.((folder) => {
        if (folder?.originalName) {
            folder.name = folder.originalName;
        }
    });
}

function translatePackLabel(pack, mappedCompendiums) {
    const collection = pack?.collection ?? pack?.metadata?.id ?? null;
    const translatedLabel = mappedCompendiums?.get?.(collection)?.metadata?.label ?? null;

    if (!translatedLabel || !pack?.metadata) {
        return;
    }

    const originalLabel = pack.metadata.originalLabel ?? pack.metadata.label;
    if (translatedLabel === originalLabel) {
        return;
    }

    pack.metadata.originalLabel = originalLabel;
    pack.metadata.label = translatedLabel;
}

function restoreWorldFolders() {
    const folders = game.collections.get("Folder");
    folders?.forEach?.((folder) => {
        if (folder?.originalName) {
            folder.name = folder.originalName;
        }
    });
}
