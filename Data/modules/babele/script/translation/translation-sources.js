import {TranslationSourceRegistry} from "./translation-source-registry.js";
import {TranslationSourceDiscovery} from "./translation-source-discovery.js";
import {TranslationLoader} from "./translation-loader.js";

/**
 * Engine bootstrap collaborator for translation sources.
 *
 * Registration is owned by `TranslationSourceRegistry`, source discovery by
 * `TranslationSourceDiscovery`, and JSON composition by `TranslationLoader`.
 * It owns source registration plus the high-level load/diagnostic APIs used by
 * the engine, while discovery and JSON loading stay delegated.
 */
export class TranslationSources {

    constructor({
        sourceRegistry = new TranslationSourceRegistry(),
        discovery = null,
        loader = null,
        jsonLoader = null,
    } = {}) {
        this.sourceRegistry = sourceRegistry;
        this.discovery = discovery ?? new TranslationSourceDiscovery({
            sources: this.sourceRegistry,
        });
        this.loader = loader ?? new TranslationLoader({
            discovery: this.discovery,
            jsonLoader,
        });
    }

    /**
     * Register or replace one translation source by name.
     *
     * @param {{name?: string}} source
     * @returns {TranslationSources}
     */
    register(source) {
        this.sourceRegistry.register(source);
        this.#clearDiscovery("register");
        return this;
    }

    /**
     * Remove a previously registered source by name.
     *
     * @param {string} name
     * @returns {TranslationSources}
     */
    unregister(name) {
        this.sourceRegistry.unregister(name);
        this.#clearDiscovery("unregister");
        return this;
    }

    /**
     * Register the translation source contributed by one module registration.
     *
     * @param {{module: string, dir?: string|string[], dirs?: string[], lang?: string}} module
     * @returns {TranslationSources}
     */
    registerModule(module) {
        this.sourceRegistry.registerModule(module);
        this.#clearDiscovery("registerModule");
        return this;
    }

    /**
     * Register or remove the current system translation source.
     *
     * @param {string|null} directory
     * @returns {TranslationSources}
     */
    registerSystemTranslations(directory) {
        this.sourceRegistry.registerSystemTranslations(directory);
        this.#clearDiscovery("registerSystemTranslations");
        return this;
    }

    /**
     * Register the directory configured from Babele settings.
     *
     * @returns {TranslationSources}
     */
    registerConfiguredDirectory() {
        this.sourceRegistry.registerConfiguredDirectory();
        this.#clearDiscovery("registerConfiguredDirectory");
        return this;
    }

    cacheDiagnostics(language = this.#language()) {
        const diagnostics = this.discovery.cacheDiagnostics(language);
        const sourcePriority = this.sourcePriority();
        return {
            ...diagnostics,
            boundary: "translation-sources",
            sourcePriorityConfigured: (sourcePriority.global?.length ?? 0) > 0
                || Object.keys(sourcePriority.collections ?? {}).length > 0,
            sourcePriority,
        };
    }

    sourcePriority() {
        return this.sourceRegistry.sourcePriority();
    }

    async setSourcePriority(collection, sources = []) {
        await this.sourceRegistry.setSourcePriority(collection, sources);
    }

    async loadTranslations(language = this.#language()) {
        return this.loader.loadTranslations(language);
    }

    async loadMappings(language = this.#language()) {
        return this.loader.loadMappings(language);
    }

    async diagnostics(language = this.#language()) {
        return this.discovery.diagnostics(language);
    }

    async shareTranslationFiles(language = this.#language()) {
        if (!game.user.isGM) {
            return;
        }

        game.settings.set(
            "babele",
            "translationFiles",
            (await this.discovery.translationSources(language)).map((source) => source.file),
        );
    }

    async shareGlobalMappingFiles(language = this.#language()) {
        if (!game.user.isGM) {
            return;
        }

        game.settings.set(
            "babele",
            "mappingFiles",
            (await this.discovery.mappingSources(language)).map((source) => source.file),
        );
    }

    #language() {
        return game.settings.get("core", "language");
    }

    #clearDiscovery(reason) {
        this.discovery.clear(reason);
        this.#debug("cleared translation sources discovery cache", {reason});
    }

    #debug(message, data = {}) {
        if (!globalThis.CONFIG?.debug?.babele) {
            return;
        }

        console.debug(`Babele | ${message}`, data);
    }
}
