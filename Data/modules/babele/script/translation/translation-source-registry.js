import {DirectoryTranslationSource, PublishedTranslationSource} from "./translation-source.js";

/**
 * Registry of external translation sources known to the engine.
 *
 * This class owns source registration only: modules, system translations, the
 * user-configured directory, and the published fallback source used by
 * non-browsing clients. It does not discover files or load JSON payloads.
 */
export class TranslationSourceRegistry {

    constructor({
        publishedSource = new PublishedTranslationSource({
            translationFiles: () => game.settings.get("babele", "translationFiles"),
            mappingFiles: () => game.settings.get("babele", "mappingFiles"),
        }),
    } = {}) {
        this._sources = [];
        this._moduleRegistrations = new Map();
        this._publishedSource = publishedSource;
    }

    /**
     * Register or replace one translation source by name.
     *
     * @param {{name?: string}} source
     * @returns {TranslationSourceRegistry}
     */
    register(source) {
        this._sources = [
            ...this._sources.filter((registered) => registered?.name !== source?.name),
            source,
        ];
        return this;
    }

    /**
     * Remove a previously registered source by name.
     *
     * @param {string} name
     * @returns {TranslationSourceRegistry}
     */
    unregister(name) {
        this._sources = this._sources.filter((source) => source?.name !== name);
        return this;
    }

    /**
     * Register the translation source contributed by one module registration.
     *
     * @param {{module: string, dir?: string|string[], dirs?: string[], lang?: string}} module
     * @returns {TranslationSourceRegistry}
     */
    registerModule(module) {
        const registration = this.#moduleRegistrationFor(module);

        return this.register(new DirectoryTranslationSource({
            name: registration.name,
            weight: 20,
            supports: (language) => registration.lang === language,
            translationDirectories: () => registration.dirs.map((dir) => `modules/${registration.module}/${dir}`),
            mappingDirectories: () => registration.dirs.map((dir) => `modules/${registration.module}/${dir}`),
        }));
    }

    /**
     * Register or remove the current system translation source.
     *
     * @param {string|null} directory
     * @returns {TranslationSourceRegistry}
     */
    registerSystemTranslations(directory) {
        if (!directory) {
            return this.unregister("system");
        }

        return this.register(new DirectoryTranslationSource({
            name: "system",
            weight: 10,
            translationDirectories: (language) => [`systems/${game.system.id}/${directory}/${language}`],
            mappingDirectories: () => [`systems/${game.system.id}/${directory}`],
        }));
    }

    /**
     * Register the directory configured from Babele settings.
     *
     * @returns {TranslationSourceRegistry}
     */
    registerConfiguredDirectory() {
        return this.register(new DirectoryTranslationSource({
            name: "directory",
            weight: 30,
            translationDirectories: (language) => {
                const directory = game.settings.get("babele", "directory");
                return directory?.trim?.() ? [`${directory}/${language}`] : [];
            },
            mappingDirectories: () => {
                const directory = game.settings.get("babele", "directory");
                return directory?.trim?.() ? [directory] : [];
            },
        }));
    }

    /**
     * Return the effective source list for one language.
     *
     * @param {string} language
     * @returns {object[]}
     */
    activeSources(language) {
        if (!this.#canIndexFiles()) {
            return [this._publishedSource];
        }

        return [...this._sources]
            .filter((source) => source && (source.supports?.(language) ?? true))
            .sort((left, right) => (left.weight?.() ?? 0) - (right.weight?.() ?? 0));
    }

    /**
     * Return the configured source priority.
     *
     * @returns {{global: string[], collections: Record<string, string[]>}}
     */
    sourcePriority() {
        return this.#sourcePriorityConfig();
    }

    /**
     * Persist source priority for one collection.
     *
     * @param {string} collection
     * @param {string[]} sources
     * @returns {Promise<void>}
     */
    async setSourcePriority(collection, sources = []) {
        const config = this.#sourcePriorityConfig();
        const normalized = [...new Set((sources ?? []).filter(Boolean).map(String))];

        if (normalized.length === 0) {
            delete config.collections[collection];
        } else {
            config.collections[collection] = normalized;
        }

        await game.settings.set("babele", "sourcePriority", config);
    }

    /**
     * Return source precedence override for one collection.
     *
     * @param {string} collection
     * @returns {string[]}
     */
    sourceOrderFor(collection) {
        const config = this.#sourcePriorityConfig();
        return config.collections[collection] ?? config.global ?? [];
    }

    /**
     * Return a snapshot of registered sources for diagnostics.
     *
     * @returns {object[]}
     */
    registeredSources() {
        return this._sources.map((source) => ({
            name: source?.name ?? null,
            weight: source?.weight?.() ?? null,
        }));
    }

    canIndexFiles() {
        return this.#canIndexFiles();
    }

    #sourcePriorityConfig() {
        const raw = game.settings.get("babele", "sourcePriority");
        if (Array.isArray(raw)) {
            return {
                global: [...new Set(raw.filter(Boolean).map(String))],
                collections: {},
            };
        }

        if (!raw || typeof raw !== "object") {
            return {
                global: [],
                collections: {},
            };
        }

        const collections = Object.fromEntries(
            Object.entries(raw.collections ?? {})
                .filter(([, value]) => Array.isArray(value))
                .map(([collection, value]) => [
                    collection,
                    [...new Set(value.filter(Boolean).map(String))],
                ]),
        );

        return {
            global: Array.isArray(raw.global) ? [...new Set(raw.global.filter(Boolean).map(String))] : [],
            collections,
        };
    }

    #canIndexFiles() {
        return game.user.hasPermission("FILES_BROWSE") && game.user.isGM;
    }

    #moduleRegistrationFor(module) {
        const name = this.#moduleSourceName(module);
        const current = this._moduleRegistrations.get(name) ?? {
            name,
            module: module.module,
            lang: module.lang,
            dirs: [],
        };

        current.dirs = [...new Set([
            ...current.dirs,
            ...this.#moduleDirs(module),
        ])];
        this._moduleRegistrations.set(name, current);
        return current;
    }

    #moduleSourceName(module) {
        return `module:${module.module}:${module.lang ?? "*"}`;
    }

    #moduleDirs(module) {
        const dirs = module.dirs ?? module.dir ?? [];
        return (Array.isArray(dirs) ? dirs : [dirs]).filter(Boolean);
    }
}
