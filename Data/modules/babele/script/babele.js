import {registerModuleSettings} from "./foundry/settings.js";
import {initWrapper} from "./foundry/wrapper.js";
import {OnDemandTranslateDialog} from "./ui/on-demand-translate-dialog.js";
import {applyRuntimeTranslationsToFoundry} from "./foundry/babele-runtime-applier.js";
import {BabeleUiBridge} from "./ui/babele-ui-bridge.js";
import {CompendiumRuntime} from "./compendium/compendium-runtime.js";
import {PackFoldersExport} from "./export/pack-folders-export.js";
import {DirectoryExport} from "./export/directory-export.js";
import {TranslationExport} from "./export/translation-export.js";
import {ActorTranslation} from "./actor/actor-translation.js";
import {Babele} from "./core/babele.js";
import {DocumentMappings} from "./mapping/document-mappings.js";

/****************
 * FOUNDRY RUNTIME BOOTSTRAP
 *
 * This file is the Foundry-facing facade/adapter layer. It is expected to
 * interact with `game.babele`, Hooks, settings, and UI integration points.
 *
 * Headless/framework-safe translation logic lives under `core/`,
 * `compendium/`, `translation/`, `mapping/`, and `converter/`.
 ***************/

const uiBridge = new BabeleUiBridge();

Hooks.once('init', () => {
    let babele = new BabeleFacade();
    BabeleFacade.instance = babele;
    game["babele"] = babele;
    registerModuleSettings();
    initWrapper();
    uiBridge.registerHooks();
    Hooks.callAll('babele.init', babele);
});

Hooks.once('ready', async () => {

    const initialized = await game.babele.init(async (babele) => {
        await babele.applyRuntimeTranslations({
            shareSources: true,
        });
    });

    if (!initialized) {
        return;
    }

    Hooks.callAll('babele.ready');
    await ui.compendium.render();
});

Hooks.on('importAdventure', (_adventure, _options, created = {}) => {
    if (game.settings.get("babele", "syncImportedAdventureTokenNames") === false) {
        return;
    }

    const createdActors = new Set((created?.Actor ?? []).map((actor) => actor?.id).filter(Boolean));
    for (const scene of created?.Scene ?? []) {
        for (const token of scene.tokens ?? []) {
            if (!createdActors.has(token.actorId) || token.delta?.name) {
                continue;
            }

            const actor = game.actors.get(token.actorId);
            if (actor?.prototypeToken?.name) {
                token.update({name: actor.prototypeToken.name});
            }
        }
    }
});

Hooks.on("createFolder", (folder) => {
    game.babele?.translateImportedCompendiumFolder?.(folder);
});

/**
 * Foundry runtime facade.
 *
 * This adapter exposes Babele through `game.babele` and bridges the headless
 * framework to Foundry-specific lifecycle hooks, settings, wrappers, and UI.
 * Framework consumers that need a headless API should use `core/babele.js`
 * and `TranslationSession` directly instead of depending on this facade.
 */
class BabeleFacade {
    /** @type {Promise<boolean> | null} */
    #initialized
    #dataLoaded
    #engine
    #actorTranslation
    #session

    /**
     * Compatibility view of the built-in default mappings.
     *
     * The built-in snapshot lives in `DocumentMappings`; this getter
     * remains as a stable public entry point for callers that still inspect
     * default mappings through the facade.
     *
     * @returns {object}
     */
    static get DEFAULT_MAPPINGS() {
        return DocumentMappings.DEFAULT_MAPPINGS;
    }

    /**
     * Live converter registry used by the underlying framework.
     *
     * @returns {import("./converter/converter-registry.js").ConverterRegistry}
     */
    get converterRegistry() {
        return this.#engine.converterRegistry;
    }

    /**
     * Effective document mappings for the active runtime session.
     *
     * Before initialization this returns the framework mappings configured
     * through registrations. After initialization it returns the mappings
     * materialized for the active language session.
     *
     * @returns {import("./mapping/document-mappings.js").DocumentMappings}
     */
    get documentMappings() {
        return this.#session?.documentMappings ?? this.#engine.documentMappings();
    }

    /**
     * Singleton implementation.
     *
     * @deprecated
     * @returns {BabeleFacade}
     */
    static get() {
        foundry.utils.logCompatibilityWarning('Babele.get is deprecated, use game.babele instead', {since: "2.5.5", until: 4});
        if (!BabeleFacade.instance) {
            BabeleFacade.instance = new BabeleFacade();
        }
        return BabeleFacade.instance;
    }

    constructor({engine = Babele.createFoundryDefault()} = {}) {
        this.#engine = engine;
        this.#session = null;
        this.#initialized = null;
        this.#dataLoaded = false;
        this.#actorTranslation = new ActorTranslation({
            sourceDataForUuid: (uuid, options = {}) => this.sourceDataForUuid(uuid, options),
            translatedPackFor: (documentType, data, options = {}) => this.#translatedPackFor(documentType, data, options),
            translatedPacks: () => this.#translatedPacks(),
            rollbackDocument: (documentType, data, options = {}) => this.rollbackDocument(documentType, data, options),
            translationLanguage: () => this.#language(),
        });
    }

    /**
     * Register one module translation source.
     *
     * The module declaration mirrors the public API historically exposed by
     * Babele: the directory identifies the root containing language folders
     * and optional mapping files.
     *
     *
     * @param {{module: string, dir: string, lang?: string}} module
     * @returns {void}
     */
    register(module) {
        this.#assertConfigurable("register");
        this.#engine.register(module);
    }

    /**
     * Register one named converter.
     *
     * Function-based legacy converters are normalized to the internal OO
     * converter contract at registration time.
     *
     * Registrations must happen during the `babele.init` hook, before the
     * runtime session is initialized.
     *
     * @param {string} name
     * @param {Function|object} converter
     * @returns {void}
     */
    registerConverter(name, converter) {
        this.registerConverters({[name]: converter});
    }

    /**
     * Register multiple named converters at once.
     *
     * Registrations must happen during the `babele.init` hook, before the
     * runtime session is initialized.
     *
     * @param {Record<string, Function|object>} converters
     * @returns {void}
     */
    registerConverters(converters) {
        this.#assertConfigurable("registerConverters");
        this.#engine.registerConverters(converters);
    }

    /**
     * Register an additional translation match strategy. Custom strategies are
     * evaluated before Babele built-ins.
     *
     * Registrations must happen during the `babele.init` hook, before the
     * runtime session is initialized.
     *
     * @param {import("./translation/translation-entries.js").TranslationStrategy} strategy
     */
    registerTranslationMatchStrategy(strategy) {
        this.registerTranslationMatchStrategies([strategy]);
    }

    /**
     * Register additional translation match strategies. Custom strategies are
     * evaluated before Babele built-ins.
     *
     * Registrations must happen during the `babele.init` hook, before the
     * runtime session is initialized.
     *
     * @param {import("./translation/translation-entries.js").TranslationStrategy[]} strategies
     */
    registerTranslationMatchStrategies(strategies) {
        this.#assertConfigurable("registerTranslationMatchStrategies");
        this.#engine.registerTranslationMatchStrategies(strategies);
    }

    /**
     * Register one named identity extractor.
     *
     * Identity extractors can be referenced by document mappings when the
     * default `_id`/`name`/`sourceId` identity candidates are not sufficient.
     *
     * Registrations must happen during the `babele.init` hook, before the
     * runtime session is initialized.
     *
     * @param {string} name
     * @param {Function} extractor
     * @returns {void}
     */
    registerIdentityExtractor(name, extractor) {
        this.registerIdentityExtractors({[name]: extractor});
    }

    /**
     * Register multiple named identity extractors.
     *
     * Registrations are intended to happen before `init()`. When performed
     * later, they only affect the next full session rebuild.
     *
     * @param {Record<string, Function>} extractors
     * @returns {void}
     */
    registerIdentityExtractors(extractors = {}) {
        this.#assertConfigurable("registerIdentityExtractors");
        this.#engine.registerIdentityExtractors(extractors);
    }

    /**
     * Expose the live identity-extractor registry used by document mappings.
     *
     * This is an advanced extension point intended for integrations that need
     * to inspect or reuse the same registry object used by the facade.
     *
     * @returns {IdentityExtractorRegistry}
     */
    identityExtractorRegistry() {
        return this.#engine.identityExtractorRegistry();
    }

    /**
     * Return the effective translation match strategies in precedence order.
     *
     * @returns {import("./translation/translation-entries.js").TranslationStrategy[]}
     */
    translationMatchStrategies() {
        return this.#engine.translationMatchStrategies();
    }

    /**
     * Register one global document mapping layer.
     *
     * Registered mappings enrich or override the built-in defaults for every
     * session built after bootstrap. Runtime sessions reject late mapping
     * registration to keep configuration and loaded data coherent.
     *
     * @param {object} mapping
     * @returns {void}
     */
    registerMapping(mapping) {
        this.#assertConfigurable("registerMapping");
        this.#engine.registerMapping(mapping);
    }

    /**
     * Return a diagnostic view of the effective mapping for one document type.
     *
     * @param {string} documentType
     * @param {{data?: object, customMapping?: object|null}} [options]
     * @returns {object}
     */
    inspectMapping(documentType, options = {}) {
        return this.documentMappings.inspect(documentType, options);
    }

    /**
     * Explicitly clear runtime caches owned by the current Babele session.
     *
     * This only resets session-owned translated-index caches. It does not
     * rebuild source discovery or the live translation session. Use
     * `reinitialize()` or `refreshTranslationSources()` when source
     * configuration changes.
     *
     * @param {string} [reason]
     * @returns {void}
     */
    invalidateCaches(reason = "manual") {
        this.#session?.invalidateCaches?.(reason);
    }

    /**
     * Return a diagnostic snapshot of Babele cache boundaries.
     *
     * @returns {object}
     */
    cacheDiagnostics() {
        return {
            boundary: "babele-facade",
            initialized: this.#initialized !== null,
            dataLoaded: this.#dataLoaded,
            language: this.#session?.language ?? this.#language(),
            translationSources: this.#engine.translationSources.cacheDiagnostics(this.#session?.language ?? this.#language()),
            session: this.#session?.cacheDiagnostics?.() ?? null,
        };
    }

    /**
     * Return translation-source diagnostics, including overlapping sources and
     * effective merge order for each translated collection.
     *
     * @param {string} [language]
     * @returns {Promise<object>}
     */
    async sourceDiagnostics(language = undefined) {
        return this.#engine.sourceDiagnostics(language);
    }

    /**
     * Build a headless translation session for one language without applying
     * it to the Foundry runtime.
     *
     * @param {object} [options]
     * @param {string} [options.language]
     * @returns {Promise<TranslationSession>}
     */
    async sessionFor({language = this.#language()} = {}) {
        return this.#engine.session({language});
    }

    /**
     * Return the configured source priority.
     *
     * @returns {{global: string[], collections: Record<string, string[]>}}
     */
    sourcePriority() {
        return this.#engine.sourcePriority();
    }

    /**
     * Persist source priority for one collection and refresh the runtime session.
     *
     * The provided array is merge order: listed sources are applied after
     * unlisted sources, and later listed sources override earlier listed
     * sources.
     *
     * @param {string} collection
     * @param {string[]} sources
     * @param {{refresh?: boolean}} [options]
     * @returns {Promise<boolean>}
     */
    async setSourcePriority(collection, sources = [], {refresh = true} = {}) {
        await this.#engine.setSourcePriority(collection, sources);
        if (!refresh) {
            return true;
        }

        return this.refreshTranslationSources();
    }

    /**
     * Declare the system-level translations directory.
     *
     * The directory is resolved relative to `systems/<system-id>` and acts as
     * the lowest-precedence filesystem source in the registry.
     *
     * @param {string|null} dir
     * @returns {void}
     */
    setSystemTranslationsDir(dir) {
        this.#assertConfigurable("setSystemTranslationsDir");
        this.#engine.setSystemTranslationsDir(dir);
    }

    /**
     * Initialize or reload the active Babele session.
     *
     * The wrapper can call this with no options before Foundry is ready: Babele
     * loads a coherent session but does not mutate runtime UI/cache structures.
     * Ready/settings flows can request runtime application explicitly.
     *
     * @param {Function|object} [callbackOrOptions]
     * @param {Function} [callbackOrOptions.afterInitialized]
     * @param {boolean} [callbackOrOptions.reload]
     * @returns {Promise<boolean>}
     */
    async init(callbackOrOptions = {}) {
        const {
            reload = false,
            afterInitialized = null,
        } = this.#initOptions(callbackOrOptions);

        if (this.#initialized !== null && !reload) {
            const initialized = await this.#initialized;
            if (initialized && afterInitialized) {
                await afterInitialized(this);
            }
            return initialized;
        }

        const initializing = this.#replaceSession({
            afterInitialized,
            emitReinitialized: reload,
        });

        this.#initialized = initializing;
        return await initializing;
    }

    /**
     * Reload the current Babele session and apply it to Foundry runtime views.
     *
     * This remains as an explicit public alias for settings/UI flows whose
     * intent is a refresh rather than first initialization.
     *
     * @param {object} [options]
     * @param {boolean} [options.shareSources]
     * @param {boolean} [options.notify]
     * @returns {Promise<boolean>}
     */
    async reinitialize({shareSources = false, notify = false} = {}) {
        return this.init({
            reload: true,
            afterInitialized: async (babele) => {
                await babele.applyRuntimeTranslations({shareSources, notify});
                await ui.compendium?.render?.();
            },
        });
    }

    /**
     * Refresh translation sources after a settings change and publish the new
     * effective file revision for non-browsing clients.
     *
     * @returns {Promise<boolean>}
     */
    async refreshTranslationSources() {
        const refreshed = await this.reinitialize({
            shareSources: true,
            notify: false,
        });

        if (!refreshed) {
            return false;
        }

        await this.#publishSourcesRevision();
        ui.notifications?.info?.(
            "Babele refreshed translation sources. Closed compendium documents are updated; already open documents may need to be reopened.",
        );
        return true;
    }

    /**
     * Re-apply the current loaded Babele session to Foundry runtime collections.
     *
     * This updates translated indexes, imported folders, and the published
     * file lists used as fallback by clients that cannot browse the
     * filesystem.
     *
     * @param {object} [options]
     * @param {boolean} [options.shareSources]
     * @param {boolean} [options.notify]
     * @returns {Promise<void>}
     */
    async applyRuntimeTranslations(options = {}) {
        await applyRuntimeTranslationsToFoundry({
            sources: this.#engine.translationSources,
            session: this.#session,
        }, options);
    }

    /**
     * Return a frozen compatibility snapshot of the registered converters.
     *
     * @returns {Record<string, object>}
     */
    get converters() {
        return this.converterRegistry.snapshot();
    }

    /**
     * Resolve one named converter from the registry.
     *
     * @param {string} name
     * @returns {object|null}
     */
    converterNamed(name) {
        return this.converterRegistry.named(name);
    }

    /**
     * Resolve the translated mapped compendium that should translate a
     * document of the given type in the current runtime visibility rules.
     *
     * Callers may provide an explicit runtime registry through `options` to
     * constrain lookup to a custom scope, such as on-demand translation or
     * embedded-document processing.
     *
     * @param {string|null} documentType
     * @param {object} data
     * @param {object} [options]
     * @param {Map|object[]|null} [options.registry]
     * @returns {import("./compendium/mapped-compendium.js").MappedCompendium|null}
     */
    translatedPackFor(documentType, data, options = {}) {
        return this.#translatedPackFor(documentType, data, options);
    }

    /**
     * Translates inplace and returns the compendium index.
     *
     * @param {object[]} index the untranslated index
     * @param {string} pack the pack name
     * @returns {object[]} the translated index
     */
    translateIndex(index, pack) {
        return this.#session?.translateIndex?.(index, pack) ?? index;
    }

    /**
     * Check if the compendium pack is translated (exists an associated translation file).
     *
     * @param {string} pack compendium name (ex. dnd5e.classes)
     * @returns {boolean} true if the compendium is translated.
     */
    isTranslated(pack) {
        return this.#session?.isTranslated?.(pack) ?? false;
    }

    /**
     * Translate one compendium document payload.
     *
     * When `translationsOnly` is truthy the mapped compendium may return only
     * the translated delta rather than the full merged document shape.
     *
     * @param {string} pack
     * @param {*} data
     * @param {boolean} [translationsOnly]
     * @returns {*}
     */
    translate(pack, data, translationsOnly) {
        return this.#session?.translate?.(pack, data, translationsOnly) ?? data;
    }

    /**
     * Translate one mapped field from a compendium document.
     *
     * @param {string} field
     * @param {string} pack
     * @param {*} data
     * @returns {*}
     */
    translateField(field, pack, data) {
        return this.#session?.translateField?.(field, pack, data) ?? null;
    }

    /**
     * Extract the exportable translation payload for one compendium document.
     *
     * @param {string} pack
     * @param {*} data
     * @param {object} [options]
     * @returns {*}
     */
    extract(pack, data, options = {}) {
        return this.#session?.extract?.(pack, data, options);
    }

    /**
     * Extract one mapped field from a compendium document.
     *
     * @param {string} pack
     * @param {string} field
     * @param {*} data
     * @returns {*}
     */
    extractField(pack, field, data) {
        return this.#session?.extractField?.(pack, field, data);
    }

    /**
     * Resolve the translated mapped compendium for a collection id.
     *
     * @param {string} pack
     * @returns {import("./compendium/mapped-compendium.js").MappedCompendium|null}
     */
    translatedCompendiumFor(pack) {
        return this.#session?.translatedCompendiumFor?.(pack) ?? null;
    }

    /**
     * Resolve the mapped compendium for a collection id, translated or not.
     *
     * @param {string} pack
     * @returns {import("./compendium/mapped-compendium.js").MappedCompendium|null}
     */
    mappedCompendiumFor(pack) {
        return this.#session?.mappedCompendiumFor?.(pack) ?? null;
    }

    /**
     * Export one compendium translation ZIP through the interactive export UI.
     *
     * @param {object} pack
     * @returns {Promise<void>}
     */
    async exportTranslationsFile(pack) {
        return new TranslationExport(this, pack).download();
    }

    /**
     * Produce the raw export payload for one compendium without downloading it.
     *
     * This is mainly useful for tests and advanced integrations.
     *
     * @param {object} pack
     * @param {object} [options]
     * @returns {Promise<object>}
     */
    async exportDataFor(pack, options = {}) {
        return new TranslationExport(this, pack).data(options);
    }

    /**
     * Export synthetic package-scoped `_packs-folders` starter files.
     *
     * @returns {Promise<void>}
     */
    async exportPackFoldersFile() {
        return new PackFoldersExport(this).download();
    }

    /**
     * Produce raw synthetic `_packs-folders` export payloads without
     * downloading them.
     *
     * @param {object} [options]
     * @returns {Array<object>}
     */
    exportPackFoldersData(options = {}) {
        return new PackFoldersExport(this).data(options);
    }

    /**
     * Export translation starter files from the compendium directory.
     *
     * This global flow can include synthetic `_packs-folders` files, bulk
     * compendium exports, or both in the same zip.
     *
     * @returns {Promise<void>}
     */
    async exportDirectoryTranslations() {
        return new DirectoryExport(this).download();
    }

    /**
     * Produce raw compendium-directory export payloads without downloading
     * them.
     *
     * @param {object} [options]
     * @returns {Promise<Array<object>>}
     */
    async exportDirectoryData(options = {}) {
        return new DirectoryExport(this).data(options);
    }

    /**
     * Open the on-demand actor translation dialog.
     *
     * @param {Actor} actor
     * @returns {void}
     */
    translateActor(actor) {
        let d = new OnDemandTranslateDialog(actor);
        d.render(true);
    }

    /**
     * Build an on-demand Actor translation proposal without applying changes.
     *
     * @param {Actor|object} actor
     * @param {object} [options]
     * @returns {Promise<ActorTranslationProposal>}
     */
    async proposeActorTranslation(actor, options = {}) {
        return this.#actorTranslation.proposal(actor, options);
    }

    /**
     * Load source data for a compendium UUID. If Foundry returns a runtime
     * translated document, only Babele's saved originalPayload snapshot is
     * considered reliable.
     *
     * @param {string} uuid
     * @param {object} [options]
     * @param {CompendiumCollection|object} [options.pack] Explicit pack to read when it is not available from game.packs.
     * @returns {Promise<object|null>}
     */
    async sourceDataForUuid(uuid, options = {}) {
        const source = this.#compendiumSourceFromUuid(uuid);
        if (!source) {
            return null;
        }

        const pack = options.pack ?? game.packs?.get?.(source.collection);
        if (!pack) {
            return null;
        }

        const document = await pack.getDocument?.(source.id);
        return this.#sourceData(document?.toObject?.() ?? document ?? null);
    }

    /**
     * Restore one translated document to its original mapped payload and strip
     * Babele translation markers.
     *
     * The rollback logic itself lives in the core engine. The facade only
     * enriches the call with session-scoped mapping layers and compendium
     * context when available.
     *
     * @param {string} documentType
     * @param {object} data
     * @param {object} [options]
     * @param {string|object|null} [options.pack]
     * @param {object|null} [options.customMapping]
     * @param {object|null} [options.documentMappings]
     * @param {object} [options.runtime]
     * @returns {object|null}
     */
    rollbackDocument(documentType, data, options = {}) {
        const collection = this.#rollbackCollection(options.pack, data);
        const mappedCompendium = collection ? this.#session?.mappedCompendiumFor?.(collection) ?? null : null;

        return this.#engine.rollbackDocument(documentType, data, {
            documentMappings: options.documentMappings ?? this.#session?.documentMappings ?? null,
            customMapping: options.customMapping ?? mappedCompendium?.customMapping ?? null,
            runtime: options.runtime ?? this.#rollbackRuntime(mappedCompendium),
        });
    }

    /**
     * Apply a previously computed on-demand Actor translation proposal.
     *
     * @param {ActorTranslationProposal} proposal
     * @param {object} [options]
     * @returns {Promise<Array<object>>}
     */
    async applyActorTranslation(proposal, options = {}) {
        return this.#actorTranslation.apply(proposal, options);
    }

    /**
     * Apply folder-name translations to one open compendium tree.
     *
     * @param {CompendiumCollection|object} pack
     * @returns {void}
     */
    translatePackFolders(pack) {
        this.#session?.translatePackFolders?.(pack);
    }

    /**
     * Apply folder-name translations to one imported world folder when its
     * source compendium can be resolved.
     *
     * @param {Folder|object} folder
     * @returns {void}
     */
    translateImportedCompendiumFolder(folder) {
        this.#session?.translateImportedCompendiumFolder?.(folder);
    }

    /**
     * Re-apply imported compendium folder translations to a folder collection.
     *
     * @param {Iterable<Folder>|object} [folders]
     * @returns {void}
     */
    translateImportedCompendiumFolders(folders = game.collections.get("Folder")) {
        this.#session?.translateImportedCompendiumFolders?.(folders);
    }

    /**
     * Apply `_packs-folders` translations to top-level system/world folders.
     *
     * @returns {void}
     */
    translateSystemPackFolders() {
        this.#session?.translateSystemPackFolders?.();
    }

    /**
     * Build the next coherent Babele session from the currently registered
     * translation sources.
     *
     * This method does not mutate the facade runtime session. It only loads the
     * data required to do so safely in a later step.
     *
     * @returns {Promise<TranslationSession>}
     */
    async #loadSession() {
        let step = "load translations";

        try {
            step = "build translation session";
            return await this.sessionFor({language: this.#language()});
        } catch (error) {
            console.error(`Babele | initialization failed during step: ${step}`, error);
            throw error;
        }
    }

    /**
     * Publish the effective source revision so non-GM clients can trigger a
     * synchronized refresh when the GM changes translation directories.
     *
     * @returns {Promise<void>}
     */
    async #publishSourcesRevision() {
        if (!game.user.isGM) {
            return;
        }

        await game.settings.set("babele", "sourcesRevision", Date.now());
    }

    async #replaceSession({
        afterInitialized = null,
        emitReinitialized = false,
    } = {}) {
        const previousInitialization = this.#initialized;
        const previousSession = this.#session;

        try {
            const session = await this.#loadSession();
            this.#installSession(session, {disposePrevious: false});

            if (!this.#dataLoaded) {
                this.#dataLoaded = true;
                Hooks.callAll("babele.dataLoaded");
            }

            try {
                if (afterInitialized) {
                    await afterInitialized(this);
                }
                previousSession?.dispose?.("session-replaced");
            } catch (error) {
                const failedSession = this.#session;
                if (previousSession) {
                    this.#installSession(previousSession, {disposePrevious: false});
                }
                failedSession?.dispose?.("runtime-application-failed");
                throw error;
            }

            this.#initialized = Promise.resolve(true);
            if (emitReinitialized && previousSession) {
                Hooks.callAll("babele.reinitialized", this);
            }
            return true;
        } catch (error) {
            this.#initialized = previousInitialization;
            if (!previousSession) {
                this.#session = null;
                this.#initialized = null;
            }
            console.error("Babele | session initialization failed", error);
            return false;
        }
    }

    #initOptions(callbackOrOptions = {}) {
        if (typeof callbackOrOptions === "function") {
            return {
                reload: false,
                afterInitialized: callbackOrOptions,
            };
        }

        return {
            reload: callbackOrOptions?.reload === true,
            afterInitialized: typeof callbackOrOptions?.afterInitialized === "function"
                ? callbackOrOptions.afterInitialized
                : null,
        };
    }

    #sourceData(data) {
        if (!data) {
            return null;
        }

        const originalPayload = data?.flags?.babele?.originalPayload;
        if (originalPayload) {
            return foundry.utils.mergeObject({}, data, {inplace: false});
        }

        return this.#runtimeTranslatedData(data) ? null : data;
    }

    #runtimeTranslatedData(data) {
        return !!(
            data?.originalName
            || data?.translated
            || data?.hasTranslation
            || data?.flags?.babele
        );
    }

    #compendiumSourceFromUuid(uuid) {
        const match = String(uuid ?? "").match(/^Compendium\.([^.]+\.[^.]+)\.(?:[^.]+\.)?([^.]+)$/);
        if (!match) {
            return null;
        }

        return {
            collection: match[1],
            id: match[2],
        };
    }

    #language() {
        return game.settings.get("core", "language");
    }

    #rollbackCollection(pack, data) {
        if (typeof pack === "string" && pack.length > 0) {
            return pack;
        }

        const collection = pack?.metadata?.collection ?? pack?.collection ?? null;
        if (collection) {
            return collection;
        }

        const sourceId = data?.flags?.core?.sourceId ?? data?.sourceId ?? null;
        return this.#compendiumSourceFromUuid(sourceId)?.collection ?? null;
    }

    #rollbackRuntime(currentCompendium = null) {
        return this.#session?.runtime?.({currentCompendium})
            ?? this.#session?.mappedCompendiums?.runtime?.({currentCompendium})
            ?? new CompendiumRuntime({
                globalPacks: this.#session?.mappedCompendiums instanceof foundry.utils.Collection
                    ? this.#session.mappedCompendiums
                    : new foundry.utils.Collection(),
                currentCompendium,
            });
    }

    #assertConfigurable(operation) {
        if (!this.#session) {
            return;
        }

        throw new Error(
            `Babele | ${operation} must be called during the babele.init hook, before the runtime session is initialized. `
            + `Runtime source changes must use setSourcePriority(), refreshTranslationSources(), or reinitialize(); `
            + `new modules, converters, identity extractors, match strategies, and mappings are bootstrap-only.`,
        );
    }

    #translatedPackFor(documentType, data, options = {}) {
        if (options.registry) {
            return CompendiumRuntime.from({globalPacks: options.registry}).translatedPackFor(documentType, data);
        }

        return this.#session?.runtime?.()?.translatedPackFor(documentType, data)
            ?? this.#session?.mappedCompendiums?.runtime?.()?.translatedPackFor(documentType, data)
            ?? null;
    }

    #translatedPacks() {
        const registry = this.#session?.mappedCompendiums;
        return registry?.values?.()
            ? [...registry.values()]
            : Array.isArray(registry) ? [...registry] : Object.values(registry ?? {});
    }

    #installSession(session, {disposePrevious = true} = {}) {
        const previousSession = this.#session;
        this.#session = session;

        if (disposePrevious && previousSession !== session) {
            previousSession?.dispose?.("session-replaced");
        }
    }

}

export {Babele, BabeleFacade};

export default BabeleFacade

window.Babele = BabeleFacade;
