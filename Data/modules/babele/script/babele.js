import {registerModuleSettings} from "./settings.js";
import {initWrapper} from "./wrapper.js";
import {HtmlUtils} from "./html-utils.js";
import {Converters} from "./converters.js";
import {TranslatedCompendium} from "./translated-compendium.js";
import {ExportTranslationsDialog} from "./export-translations-dialog.js";
import {OnDemandTranslateDialog} from "./on-demand-translate-dialog.js";
import {defaultMappings} from "./default-mappings.js"

/****************
 * HOOKS
 ***************/

Hooks.once('init', () => {
    let babele = new Babel();
    Babel.instance = babele;
    game["babele"] = babele;
    registerModuleSettings();
    initWrapper();
    Hooks.callAll('babele.init', babele);
});

Hooks.once('ready', async () => {

    await game.babele.init();

    await game.babele.shareTranslationFiles();
    await game.babele.shareGlobalMappingFiles();

    game.packs.forEach(pack => {
        game.babele.translateIndex(pack.index, pack.collection);
        game.babele.translatePackFolders(pack);
        pack.initializeTree();
    });

    game.babele.translateSystemPackFolders();

    Hooks.callAll('babele.ready');
    await ui.compendium.render();
});

function addTranslateButton(app, html, data){
    const exportEnabled = game.settings.get('babele', 'showTranslateOption');
    if(exportEnabled && game.user.isGM && data.editable) {
        let title = game.i18n.localize("BABELE.TranslateActorHeadBtn");
        HtmlUtils.appendHeaderButton(html, title, ev => {
            game.babele.translateActor(app.actor);
        });
    }
}

Hooks.on('renderActorSheet', (app, html, data) => addTranslateButton(app, html[0], data));

Hooks.on('getHeaderControlsActorSheetV2', (sheet, controls) => {
    const exportEnabled = game.settings.get('babele', 'showTranslateOption');
    if(exportEnabled && game.user.isGM && sheet.isEditable) {
        let label = game.i18n.localize("BABELE.TranslateActorHeadBtn");
        controls.push({
            icon: 'fas fa-globe',
            label: label,
            onClick: () => game.babele.translateActor(sheet.actor),
        });
    }
});

Hooks.on('renderCompendium', (app, html, data) => {
    const exportEnabled = game.settings.get('babele', 'export');
    if(game.user.isGM && exportEnabled) {
        let title = game.i18n.localize("BABELE.CompendiumTranslations");
        HtmlUtils.appendHeaderButton(html, title, ev => {
            game.babele.exportTranslationsFile(app.collection)
        });
    }

    if (game.settings.get('babele', 'showOriginalName')) {
        html.querySelectorAll('.directory-list .entry-name, .directory-list .document-name').forEach((item) => {
            const entry = item.textContent?.length ? data.collection.index.find(i => i.name === item.textContent) : null;

            if (entry && entry.translated && entry.hasTranslation) {
                item.setAttribute('style', 'line-height: normal; padding-top: 10px;');
                item.innerHTML += `<div style="line-height: normal; font-size: 12px; color: gray;">${entry.originalName}</div>`;
            }
        });
    }
});

Hooks.on('importAdventure', () => {
    game.scenes.forEach(scene => {
        scene.tokens.forEach(token => {
            const actor = game.actors.get(token.actorId);
            if (actor && !token.delta.name) {
                token.update({ name: actor.prototypeToken.name });
            }
        });
    });
});

/**
 * Main facade class with init logic and on API for on demand translations based on loaded mapping files.
 */
export class Babel {
    /** @type {Promise<boolean> | null} */
    #initialized

    static get PACK_FOLDER_TRANSLATION_NAME_SUFFIX() {
        return '_packs-folders';
    }

    static get SUPPORTED_PACKS() {
        return ['Adventure', 'Actor', 'Cards', 'Folder', 'Item', 'JournalEntry', 'Macro', 'Playlist', 'RollTable', 'Scene'];
    }

    static DEFAULT_MAPPINGS = defaultMappings;

    /**
     * Singleton implementation.
     *
     * @deprecated
     * @returns {Babel}
     */
    static get() {
        foundry.utils.logCompatibilityWarning('Babele.get is deprecated, use game.babele instead', {since: "2.5.5", until: 4});
        if (!Babel.instance) {
            Babel.instance = new Babel();
        }
        return Babel.instance;
    }

    constructor() {
        this.modules = [];
        this.converters = {};
        this.translations = null;
        this.systemTranslationsDir = null;
        this.#initialized = null;
        this.registerDefaultConverters();
    }

    /**
     * Register the default provided converters.
     */
    registerDefaultConverters() {
        this.registerConverters({
            "fromPack": Converters.fromPack(),
            "name": Converters.mappedField("name"),
            "nameCollection": Converters.fieldCollection("name"),
            "textCollection": Converters.fieldCollection("text"),
            "tableResults": Converters.tableResults(),
            "tableResultsCollection": Converters.tableResultsCollection(),
            "pages": Converters.pages(),
            "playlistSounds": Converters.playlistSounds(),
            "deckCards": Converters.deckCards(),
            "sceneRegions": Converters.sceneRegions(),
            "adventureItems": Converters.fromDefaultMapping("Item", "items"),
            "adventureActors": Converters.fromDefaultMapping("Actor", "actors"),
            "adventureCards": Converters.fromDefaultMapping("Cards", "card"),
            "adventureJournals": Converters.fromDefaultMapping("JournalEntry", "journals"),
            "adventurePlaylists": Converters.fromDefaultMapping("Playlist", "playlists"),
            "adventureMacros": Converters.fromDefaultMapping("Macro", "macros"),
            "adventureScenes": Converters.fromDefaultMapping("Scene", "scenes")
        })
    }

    /**
     *
     * @param module
     */
    register(module) {
        this.modules.push(module);
    }

    /**
     *
     * @param converters
     */
    registerConverters(converters) {
        this.converters = foundry.utils.mergeObject(this.converters, converters);
    }

    /**
     *
     * @param converters
     */
    registerMapping(mapping) {
        for (const [key, value] of Object.entries(mapping)) {
            if (Babel.DEFAULT_MAPPINGS[key]) {
                Babel.DEFAULT_MAPPINGS[key] = foundry.utils.mergeObject(Babel.DEFAULT_MAPPINGS[key], value);
            } else {
                Babel.DEFAULT_MAPPINGS[key] = value;
            }
        }
    }

    /**
     *
     * @param pack
     * @returns {boolean}
     */
    supported(pack) {
        return Babel.SUPPORTED_PACKS.includes(pack.type);
    }

    /**
     *
     * @param dir
     */
    setSystemTranslationsDir(dir) {
        this.systemTranslationsDir = dir;
    }

    /**
     * Initialize babele downloading the available translations files and instantiating the associated
     * translated compendium class.
     *
     * @returns {Promise<boolean>}
     */
    async init() {
        if(this.#initialized !== null)
            return await this.#initialized;

        this.#initialized = new Promise(async (resolve) => {
            if (!this.translations) {
                this.translations = await this.loadTranslations();
            }

            this.packs = new foundry.utils.Collection();

            const addTranslations = (metadata) => {
                const collection = this.getCollection(metadata);

                if (this.supported(metadata)) {
                    let translation = this.translations.find(t => t.collection === collection);
                    if(translation) {
                        this.packs.set(collection, new TranslatedCompendium(metadata, translation));
                        if(metadata.type === 'Adventure' && translation.entries) {
                            let entries = translation.entries;
                            Object.values(Array.isArray(entries) ? entries : entries || {}).forEach(adventure =>
                                this.packs.set(`${collection}-items`, new TranslatedCompendium({
                                    type: 'Item'
                                }, {
                                    mapping: translation.mapping ? translation.mapping['items'] ?? {} : {},
                                    entries: adventure.items ?? {}
                                }))
                            );
                        }
                    }
                }
            };

            for (const metadata of game.data.packs) {
                addTranslations(metadata);
            }

            // Handle specific files for pack folders
            this.folders = game.data.folders;

            if (this.folders) {
                const files = await this.#getTranslationsFiles();

                // Handle specific files for pack folders
                for (const file of files.filter((file) => file.endsWith(`${Babel.PACK_FOLDER_TRANSLATION_NAME_SUFFIX}.json`))) {
                    addTranslations(this.#getSpecialPacksFoldersMetadata(file.split('/').pop()));
                }
            }

            resolve(true)
        });

        const result = await this.#initialized;
        Hooks.callAll('babele.dataLoaded');
        return result;
    }

    getCollection(metadata) {
        const collectionPrefix = metadata.packageType === "world" ? "world" : metadata.packageName;
        return `${collectionPrefix}.${metadata.name}`;
    }

    /**
     * Find and download the translation files for each compendium present on the world.
     * Verify the effective presence of each file using the FilePicker API.
     *
     * @returns {Promise<[]>}
     */
    async loadTranslations() {
        const files = await this.#getTranslationsFiles();

        if (files.length === 0) {
            console.log(`Babele | no compendium translation files found for ${game.settings.get('core', 'language')} language.`);

            return [];
        }

        const allTranslations = [];
        const loadTranslations = async (collection, urls) => {
            if (urls.length === 0) {
                console.log(`Babele | no translation file found for ${collection} pack`);
            } else {
                const [translations] = await Promise.all(
                    [Promise.all(urls.map((url) => fetch(url).then((r) => r.json()).catch(e => {
                    })))],
                );

                let translation;
                translations.forEach(t => {
                    if (t) {
                        if (translation) {
                            translation.label = t.label ?? translation.label;
                            if (t.entries) {
                                translation.entries = {...translation.entries, ...t.entries};
                            }
                            if (t.mapping) {
                                translation.mapping = {...translation.mapping, ...t.mapping};
                            }
                        } else {
                            translation = t;
                        }
                    }
                });

                if (translation) {
                    console.log(`Babele | translation for ${collection} pack successfully loaded`);
                    allTranslations.push(foundry.utils.mergeObject(translation, {collection: collection}));
                }
            }
        };

        const packPromises = game.data.packs
            .filter(metadata => this.supported(metadata))
            .map(metadata => {
                const collection = this.getCollection(metadata);
                const collectionFileName = encodeURI(`${collection}.json`);
                const urls = files.filter(file => file.split('/').pop().split('\\').pop() === collectionFileName);
                return loadTranslations(collection, urls);
            });

        // Handle specific files for pack folders
        const folderPromises = files
            .filter(file => file.endsWith(`${Babel.PACK_FOLDER_TRANSLATION_NAME_SUFFIX}.json`))
            .map(file => {
                const fileName = file.split('/').pop();
                return loadTranslations(fileName.replace('.json', ''), [file]);
            });

        await Promise.all([...packPromises, ...folderPromises]);

        // Handle global mappings
        const mappingFiles = await this.#getMappingFiles();

        if (mappingFiles.length > 0) {
            console.log(`Babele | global mapping files found, defaults will be enriched/overwritten...`);

            const loadMappings = async () => {
                const [mappings] = await Promise.all(
                    [Promise.all(mappingFiles.map((file) => fetch(file).then((r) => r.json()).catch(e => {
                    })))],
                );
                mappings.forEach(mapping => {
                    this.registerMapping(mapping);
                })
            }
            await loadMappings();
        }

        return allTranslations;
    }

    /**
     * Translates inplace and returns the compendium index.
     *
     * @param index the untranslated index
     * @param pack the pack name
     * @returns {*} the translated index
     */
    translateIndex(index, pack) {
        const lang = game.settings.get('core', 'language');
        for (const entry of index){
            let translated = entry?.translated;
            if (translated) {
                foundry.utils.mergeObject(entry, this.translate(pack, entry, true), { inplace:true });
            } else {
                foundry.utils.mergeObject(entry, this.translate(pack, entry), { inplace:true });
            }
        }
        return index;
    }

    /**
     * Check if the compendium pack is translated (exists an associated translation file).
     *
     * @param pack compendium name (ex. dnd5e.classes)
     * @returns {boolean|*} true if the compendium is translated.
     */
    isTranslated(pack) {
        const tc = this.packs.get(pack);
        return tc && tc.translated;
    }

    /**
     * Translate the
     *
     * @param pack
     * @param data
     * @param translationsOnly
     * @returns {*}
     */
    translate(pack, data, translationsOnly) {
        const tc = this.packs.get(pack);
        if (!tc || !(tc.hasTranslation(data) || tc.mapping.isDynamic())) {
            return data;
        }
        return tc.translate(data, translationsOnly);
    }

    /**
     *
     * @param field
     * @param pack
     * @param data
     * @returns {*}
     */
    translateField(field, pack, data) {
        const tc = this.packs.get(pack);
        if (!tc) {
            return null;
        }
        if (!(tc.hasTranslation(data) || tc.mapping.isDynamic())) {
            return tc.extractField(field, data);
        }
        return tc.translateField(field, data);
    }

    /**
     *
     * @param pack
     * @param data
     * @returns {*}
     */
    extract(pack, data) {
        return this.packs.get(pack)?.extract(data);
    }

    /**
     *
     * @param pack
     * @param field
     * @param data
     * @returns {*}
     */
    extractField(pack, field, data) {
        return this.packs.get(pack)?.extractField(field, data);
    }

    /**
     *
     * @param pack
     */
    exportTranslationsFile(pack) {

        ExportTranslationsDialog.create(pack).then(async conf => {

            if (conf) {

                let file = {
                    label: pack.metadata.label,
                    entries: conf.format === 'legacy' ? [] : {}
                };

                let index = await pack.getIndex();
                Promise.all(index.map(entry => pack.getDocument(entry._id))).then(entities => {
                    entities.forEach((entity, idx) => {
                        const name = entity.getFlag("babele", "translated") ? entity.getFlag("babele", "originalName") : entity.name;
                        if (conf.format === 'legacy') {
                            let entry = foundry.utils.mergeObject({id: name}, this.extract(pack.collection, entity));
                            file.entries.push(entry);
                        } else {
                            file.entries[`${name}`] = this.extract(pack.collection, entity);
                        }
                    });

                    let dataStr = JSON.stringify(file, null, '\t');
                    let exportFileDefaultName = pack.collection + '.json';

                    var zip = new JSZip();
                    zip.file(exportFileDefaultName, dataStr);
                    zip.generateAsync({type: "blob"})
                        .then(content => {
                            saveAs(content, pack.collection + ".zip");
                        });
                });
            }
        });
    }

    /**
     *
     * @param actor
     */
    translateActor(actor) {
        let d = new OnDemandTranslateDialog(actor);
        d.render(true);
    }

    translatePackFolders(pack) {
        if (!pack?.folders?.size) {
            return;
        }

        const tcFolders = this.packs.get(pack.metadata.id)?.folders ?? [];

        pack.folders.forEach((folder) => folder.name = tcFolders[folder.name] ?? folder.name);
    }

    translateSystemPackFolders() {
        if (!game.data.folders?.length) {
            return;
        }

        const translations = {};

        this.packs
            .filter((pack) => pack.metadata.name === Babel.PACK_FOLDER_TRANSLATION_NAME_SUFFIX)
            .forEach((pack) => Object.assign(translations, pack.translations));

        game.collections.get('Folder').forEach((folder) => folder.name = translations[folder.name] ?? folder.name);
    }

    async shareTranslationFiles() {
        if (game.user.isGM) {
            let files = await game.babele.#getTranslationsFiles();
            game.settings.set('babele', 'translationFiles', files);
        }
    }

    async shareGlobalMappingFiles() {
        if (game.user.isGM) {
            let files = await game.babele.#getMappingFiles();
            game.settings.set('babele', 'mappingFiles', files);
        }
    }

    _files = []

    _mappingFiles = []

    async #getTranslationsFiles() {

        if(this._files.length) {
            return this._files;
        }

        if (!Babel.#canIndexFiles) {
            return game.settings.get('babele', 'translationFiles');
        }

        const lang = game.settings.get('core', 'language');
        const directory = game.settings.get('babele', 'directory');
        const directories = this.modules
            .filter(module => module.lang === lang)
            .map(module => `modules/${module.module}/${module.dir}`);

        if (directory && directory.trim && directory.trim()) {
            directories.push(`${directory}/${lang}`);
        }

        if (this.systemTranslationsDir) {
            directories.push(`systems/${game.system.id}/${this.systemTranslationsDir}/${lang}`);
        }

        const results = await Promise.all(
            directories.map(dir =>
                foundry.applications.apps.FilePicker.browse('data', dir).catch(err => {
                    console.warn('Babele: ' + err);
                    return { files: [] };
                })
            )
        );
        const files = results.flatMap(result => result.files);

        this._files = files;

        return files;
    }

    #getSpecialPacksFoldersMetadata(file) {
        const [packageName, name] = file.split('.');

        return {
            packageType: 'system',
            type: 'Folder',
            packageName,
            name,
        };
    }

    async #getMappingFiles() {

        if(this._mappingFiles.length) {
            return this._mappingFiles;
        }

        if (!Babel.#canIndexFiles) {
            return game.settings.get('babele', 'mappingFiles');
        }

        const directory = game.settings.get('babele', 'directory');
        const directories = this.modules
            .map(module => `modules/${module.module}/${module.dir}`);

        if (directory && directory.trim && directory.trim()) {
            directories.push(`${directory}`);
        }

        if (this.systemTranslationsDir) {
            directories.push(`systems/${game.system.id}/${this.systemTranslationsDir}`);
        }

        const results = await Promise.all(
            directories.map(dir =>
                foundry.applications.apps.FilePicker.browse('data', dir).catch(err => {
                    console.warn('Babele: ' + err);
                    return { files: [] };
                })
            )
        );
        const files = results.flatMap(result => result.files.filter(file => file.endsWith('/mapping.json')));

        this._mappingFiles = files;

        return files;
    }

    /**
     * @type {boolean}
     */
    static get #canIndexFiles(){
        // Needs to check both the permissions and the GM status 
        // as the file discovery will fail if a folder is hidden
        // This is checked by the server itself and can't be changed
        return game.user.hasPermission('FILES_BROWSE') && game.user.isGM;
    }
}

window.Babele = Babel;
