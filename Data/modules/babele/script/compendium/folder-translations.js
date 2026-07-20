/**
 * Folder-translation behavior for the current Babele state.
 *
 * This object owns:
 * - translating pack folders from loaded folder payloads
 * - translating imported world folders by resolving their source pack
 * - translating level-0 pack folders exposed by systems/modules
 */
export class FolderTranslations {

    static FOLDER_TRANSLATION_NAME = "_packs-folders";

    constructor({
        mappedCompendiums = null,
        packFolderTranslations = null,
    } = {}) {
        this._mappedCompendiums = typeof mappedCompendiums === "function"
            ? mappedCompendiums
            : () => mappedCompendiums;
        this._packFolderTranslations = typeof packFolderTranslations === "function"
            ? packFolderTranslations
            : () => packFolderTranslations;
    }

    translatePackFolders(pack) {
        if (!pack?.folders?.size) {
            return;
        }

        const collection = pack?.collection ?? pack?.metadata?.id ?? null;
        const translations = this.#folderTranslationsFor(collection);

        pack.folders.forEach((folder) => {
            const originalName = folder.originalName ?? folder.name;
            const translatedName = translations[originalName];

            if (translatedName) {
                folder.originalName = originalName;
                folder.name = translatedName;
            }
        });
    }

    translateImportedCompendiumFolder(folder) {
        if (!folder) {
            return;
        }

        const sourceCollection = this.#sourcePackCollectionFor(folder);
        if (!sourceCollection) {
            return;
        }

        const translations = this.#folderTranslationsFor(sourceCollection);
        const originalName = folder.originalName ?? folder.name;
        const translatedName = translations[originalName];

        if (translatedName) {
            folder.originalName = originalName;
            folder.name = translatedName;
        }
    }

    translateImportedCompendiumFolders(folders = game.collections.get("Folder")) {
        folders?.forEach?.((folder) => this.translateImportedCompendiumFolder(folder));
    }

    translateSystemPackFolders() {
        if (!game.data.folders?.length) {
            return;
        }

        const translations = this.#packFolderTranslations()?.allTranslations?.() ?? {};

        game.collections.get("Folder").forEach((folder) => {
            const originalName = folder.originalName ?? folder.name;
            const translatedName = translations[originalName];
            if (translatedName) {
                folder.originalName = originalName;
                folder.name = translatedName;
            }
        });
    }

    #sourcePackCollectionFor(document) {
        const directSourceId = document?._stats?.compendiumSource ?? document?.flags?.core?.sourceId;
        const directCollection = this.#collectionFromSourceId(directSourceId);
        if (directCollection) {
            return directCollection;
        }

        for (const entry of document?.contents ?? []) {
            const entrySourceId = entry?._stats?.compendiumSource ?? entry?.flags?.core?.sourceId;
            const entryCollection = this.#collectionFromSourceId(entrySourceId);
            if (entryCollection) {
                return entryCollection;
            }
        }

        const folderId = document?.id ?? document?._id;
        const documentType = document?.type ?? null;

        if (!folderId) {
            return null;
        }

        return game.packs?.find?.((pack) => {
            const packType = pack?.metadata?.type ?? pack?.documentName ?? null;
            if (documentType && packType && documentType !== packType) {
                return false;
            }

            return !!pack?.folders?.get?.(folderId);
        })?.collection ?? null;
    }

    #mappedCompendiumFor(collection) {
        if (!collection) {
            return null;
        }

        return this.#mappedCompendiums()?.get?.(collection) ?? null;
    }

    #folderTranslationsFor(collection) {
        return this.#folderTranslationsPayload(this.#mappedCompendiumFor(collection));
    }

    #folderTranslationsPayload(compendium) {
        if (!compendium) {
            return {};
        }

        if (typeof compendium.folderTranslations === "function") {
            return compendium.folderTranslations();
        }

        if (compendium?.metadata?.name === FolderTranslations.FOLDER_TRANSLATION_NAME) {
            return compendium.entries ?? compendium.translations ?? {};
        }

        return compendium.folders ?? {};
    }

    #packFolderTranslations() {
        return this._packFolderTranslations?.() ?? null;
    }

    #mappedCompendiums() {
        return this._mappedCompendiums?.() ?? null;
    }

    #collectionFromSourceId(sourceId) {
        if (!sourceId) {
            return null;
        }

        return String(sourceId).match(/^Compendium\.([^.]+\.[^.]+)\./)?.[1] ?? null;
    }
}
