/**
 * Filesystem-backed translation source.
 *
 * The source knows where to browse for translation and mapping files, but it
 * does not interpret their payloads or decide whether they map to supported
 * Foundry compendiums.
 *
 * `weight()` defines merge precedence:
 * - lower weights are loaded first
 * - higher weights are loaded later and therefore override earlier payloads
 */
export class DirectoryTranslationSource {

    static MAPPING_FILENAME = "mappings.json";
    static LEGACY_MAPPING_FILENAME = "mapping.json";

    /**
     * @param {object} [options]
     * @param {string} [options.name]
     * @param {number} [options.weight] Merge precedence for this source.
     * Lower values are applied first; higher values override later.
     * @param {(language: string) => boolean} [options.supports]
     * @param {(language: string) => string[]|string[]} [options.translationDirectories]
     * @param {(language: string) => string[]|string[]} [options.mappingDirectories]
     */
    constructor({
        name = "directory",
        weight = 0,
        supports = () => true,
        translationDirectories = () => [],
        mappingDirectories = () => [],
        warnOnMissingDirectory = false,
    } = {}) {
        this.name = name;
        this._weight = weight;
        this._supports = supports;
        this._translationDirectories = translationDirectories;
        this._mappingDirectories = mappingDirectories;
        this._warnOnMissingDirectory = warnOnMissingDirectory;
    }

    /**
     * Merge precedence for this source.
     *
     * Lower weights are discovered first; higher weights win when multiple
     * files contribute to the same compendium payload.
     *
     * @returns {number}
     */
    weight() {
        return this._weight;
    }

    /**
     * @param {string} language
     * @returns {boolean}
     */
    supports(language) {
        return this._supports(language);
    }

    /**
     * @param {string} language
     * @returns {Promise<object[]>}
     */
    async translationFiles(language) {
        return this.#discover("translation", this.#directoriesFor(this._translationDirectories, language));
    }

    /**
     * @param {string} language
     * @returns {Promise<object[]>}
     */
    async mappingFiles(language) {
        return this.#discover("mapping", this.#directoriesFor(this._mappingDirectories, language));
    }

    #directoriesFor(factory, language) {
        const directories = typeof factory === "function" ? factory(language) : factory;
        return [...new Set((directories ?? []).filter(Boolean))];
    }

    async #discover(kind, directories) {
        const results = await Promise.all(
            directories.map(async (directory) => {
                try {
                    return await foundry.applications.apps.FilePicker.browse("data", directory);
                } catch (error) {
                    if (this.#shouldWarn(error)) {
                        console.warn(`Babele: ${error}`);
                    }
                    return {files: []};
                }
            }),
        );

        return results.flatMap((result, index) => {
            const directory = directories[index];
            return (result.files ?? [])
                .filter((file) => this.#matchesKind(file, kind))
                .map((file) => this.#buildFile(file, directory, kind));
        });
    }

    #buildFile(file, directory, kind) {
        return {
            file,
            directory,
            baseName: this.#baseName(file),
            kind,
            source: this.name,
        };
    }

    #isMappingFile(file) {
        return file.endsWith(`/${DirectoryTranslationSource.MAPPING_FILENAME}`)
            || file.endsWith(`/${DirectoryTranslationSource.LEGACY_MAPPING_FILENAME}`);
    }

    #matchesKind(file, kind) {
        if (!file.endsWith(".json")) {
            return false;
        }

        return kind === "translation" ? !this.#isMappingFile(file) : this.#isMappingFile(file);
    }

    #baseName(file) {
        return file.split("/").pop().split("\\").pop();
    }

    #shouldWarn(error) {
        if (this._warnOnMissingDirectory) {
            return true;
        }

        const message = String(error?.message ?? error ?? "");
        return !message.includes("does not exist");
    }
}

/**
 * Settings-backed source used when the current user cannot browse the
 * filesystem and must rely on file lists published by the GM.
 *
 * This source does not participate in the normal precedence chain while file
 * browsing is available. It is used only as the effective source of truth for
 * players and other non-browsing clients.
 */
export class PublishedTranslationSource {

    /**
     * @param {object} [options]
     * @param {string} [options.name]
     * @param {number} [options.weight]
     * @param {() => string[]} [options.translationFiles]
     * @param {() => string[]} [options.mappingFiles]
     */
    constructor({
        name = "published",
        weight = 0,
        translationFiles = () => [],
        mappingFiles = () => [],
    } = {}) {
        this.name = name;
        this._weight = weight;
        this._translationFiles = translationFiles;
        this._mappingFiles = mappingFiles;
    }

    /**
     * @returns {number}
     */
    weight() {
        return this._weight;
    }

    /**
     * @returns {boolean}
     */
    supports() {
        return true;
    }

    /**
     * @returns {Promise<object[]>}
     */
    async translationFiles() {
        return this.#buildFiles("translation", this._translationFiles());
    }

    /**
     * @returns {Promise<object[]>}
     */
    async mappingFiles() {
        return this.#buildFiles("mapping", this._mappingFiles());
    }

    #buildFiles(kind, files) {
        return [...new Set(files ?? [])].map((file) => ({
            file,
            directory: this.#directoryName(file),
            baseName: this.#baseName(file),
            kind,
            source: this.name,
        }));
    }

    #baseName(file) {
        return file.split("/").pop().split("\\").pop();
    }

    #directoryName(file) {
        const baseName = this.#baseName(file);
        return file.slice(0, file.length - baseName.length);
    }
}
