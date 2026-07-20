import {ExportTranslationsDialog} from "../ui/export-translations-dialog.js";

/**
 * Translation export flow for a single compendium pack.
 *
 * The object owns export-specific behavior such as:
 * - computing dialog counts
 * - hydrating source data for export
 * - building the JSON payload
 * - packaging and downloading the zip file
 *
 * `Babel` remains the public facade and delegates export work here.
 */
export class TranslationExport {

    constructor(babele, pack) {
        this.babele = babele;
        this.pack = pack;
        this.mappedCompendium = babele.mappedCompendiumFor(pack.collection);
    }

    async download() {
        const conf = await new ExportTranslationsDialog(this.pack, {
            hasTranslations: !!this.mappedCompendium?.translated,
            format: "compatible",
            selection: "all",
            counts: await this.selectionCounts(),
        }).prompt();

        if (!conf) {
            return;
        }

        const exportEntries = await this.entries();
        const file = await this.data({
            ...conf,
            mappedCompendium: this.mappedCompendium,
            entries: exportEntries,
        });
        const dataStr = JSON.stringify(file, null, "\t");
        const exportFileDefaultName = `${this.pack.collection}.json`;

        const zip = new JSZip();
        zip.file(exportFileDefaultName, dataStr);
        const progress = this.#createZipProgress();
        this.#updateZipProgress(progress, 0.01);
        await this.#yieldToUi();
        const content = await zip.generateAsync({type: "blob"}, (metadata) => {
            this.#updateZipProgress(progress, (metadata?.percent ?? 0) / 100);
        });
        this.#updateZipProgress(progress, 1);
        saveAs(content, `${this.pack.collection}.zip`);
    }

    async data(options = {}) {
        const format = options.format === "legacy" ? "legacy" : "compatible";
        const selection = this.#normalizedSelection(options.selection);
        const mappedCompendium = options.mappedCompendium ?? this.mappedCompendium;
        const exportEntries = options.entries ?? await this.entries(mappedCompendium);
        const folders = this.folderTranslations();
        const file = {
            label: this.pack.metadata.label,
            ...(folders ? {folders} : {}),
            entries: format === "legacy" ? [] : {},
        };
        const skippedDynamicFields = [];

        for (const {entity, sourceData, hasTranslation} of exportEntries) {
            const exportedData = await this.#payloadData(sourceData, hasTranslation, mappedCompendium, selection);
            if (!exportedData) {
                continue;
            }

            const name = this.#entryName(entity, exportedData, sourceData);

            if (!this.#shouldInclude(selection, hasTranslation)) {
                continue;
            }

            const alreadyExtracted = selection === "source" ? this.#originalPayload(exportedData) : null;
            const extracted = this.pruneData(alreadyExtracted ?? this.babele.extract(this.pack.collection, exportedData, {
                format,
                onSkippedDynamicField: info => skippedDynamicFields.push({
                    entry: name,
                    ...info,
                }),
            })) ?? {};

            if (format === "legacy") {
                file.entries.push(foundry.utils.mergeObject({id: name}, extracted));
            } else {
                file.entries[name] = extracted;
            }
        }

        if (skippedDynamicFields.length) {
            console.warn("Babele | skipped dynamic export fields", {
                pack: this.pack.collection,
                fields: skippedDynamicFields,
            });
        }

        return file;
    }

    async selectionCounts() {
        const index = this.#normalizedIndex(await this.pack.getIndex());
        const all = index.length;
        const present = index.filter((entry) => this.#hasTranslation(entry, this.#lookupData(entry), this.mappedCompendium)).length;

        return {
            all,
            present,
            missing: all - present,
        };
    }

    async entries(mappedCompendium = this.mappedCompendium) {
        const index = this.#normalizedIndex(await this.pack.getIndex());
        const entities = await Promise.all(index.map(entry => this.pack.getDocument(entry._id)));

        return entities.map((entity) => {
            const sourceData = this.#sourceData(entity);
            return {
                entity,
                sourceData,
                hasTranslation: this.#hasTranslation(entity, sourceData, mappedCompendium),
            };
        });
    }

    folderTranslations() {
        if (!this.pack?.folders?.size) {
            return undefined;
        }

        const folders = {};
        this.pack.folders.forEach((folder) => {
            const name = folder?.originalName ?? folder?.name;
            if (name) {
                folders[name] = name;
            }
        });

        return Object.keys(folders).length ? folders : undefined;
    }

    pruneData(value) {
        if (typeof value === "undefined" || value === null || value === "") {
            return undefined;
        }

        if (Array.isArray(value)) {
            const pruned = value
                .map((item) => this.pruneData(item))
                .filter((item) => typeof item !== "undefined");

            return pruned.length ? pruned : undefined;
        }

        if (typeof value === "object") {
            const pruned = Object.entries(value).reduce((out, [key, entryValue]) => {
                const nextValue = this.pruneData(entryValue);
                if (typeof nextValue !== "undefined") {
                    out[key] = nextValue;
                }
                return out;
            }, {});

            return Object.keys(pruned).length ? pruned : undefined;
        }

        return value;
    }

    #normalizedSelection(selection) {
        if (selection === "source" || selection === "original") {
            return "source";
        }

        if (selection === "present" || selection === "translated") {
            return "present";
        }

        if (selection === "missing" || selection === "untranslated") {
            return "missing";
        }

        return "all";
    }

    #sourceData(entity) {
        if (typeof entity?.toObject === "function") {
            const sourceData = entity.toObject();

            if (this.#isJournalEntry(entity)) {
                this.#hydrateJournalEmbeddedData(sourceData, entity);
            }

            return sourceData;
        }

        return entity;
    }

    #isJournalEntry(entity) {
        return entity?.documentName === "JournalEntry"
            || entity?.constructor?.metadata?.name === "JournalEntry";
    }

    #hydrateJournalEmbeddedData(sourceData, entity) {
        this.#hydrateEmbeddedCollection(sourceData, entity, "pages");
        this.#hydrateEmbeddedCollection(sourceData, entity, "categories");
    }

    #hydrateEmbeddedCollection(sourceData, entity, key) {
        const current = sourceData?.[key];
        if (Array.isArray(current) && current.length > 0) {
            return;
        }

        const embedded = entity?.[key]?.contents;
        if (!Array.isArray(embedded) || embedded.length === 0) {
            return;
        }

        sourceData[key] = embedded.map((document) => typeof document?.toObject === "function" ? document.toObject() : document);
    }

    #normalizedIndex(index) {
        if (Array.isArray(index)) {
            return index;
        }

        if (typeof index?.values === "function") {
            return Array.from(index.values());
        }

        if (index && typeof index[Symbol.iterator] === "function") {
            return Array.from(index);
        }

        return [];
    }

    #lookupData(data) {
        if (!data) {
            return data;
        }

        const originalName = data?.flags?.babele?.originalName ?? data?.originalName ?? null;
        if (!originalName || data?.name === originalName) {
            return data;
        }

        return {
            ...data,
            name: originalName,
        };
    }

    #hasTranslation(entity, data, mappedCompendium) {
        const explicitFlag = entity?.getFlag?.("babele", "hasTranslation")
            ?? entity?.flags?.babele?.hasTranslation
            ?? data?.flags?.babele?.hasTranslation
            ?? entity?.hasTranslation
            ?? data?.hasTranslation;

        if (typeof explicitFlag === "boolean") {
            return explicitFlag;
        }

        return mappedCompendium?.hasTranslation?.(this.#lookupData(data)) ?? false;
    }

    #shouldInclude(selection, hasTranslation) {
        if (selection === "present") {
            return hasTranslation;
        }

        if (selection === "missing") {
            return !hasTranslation;
        }

        return true;
    }

    async #payloadData(sourceData, hasTranslation, mappedCompendium, selection) {
        if (selection === "source") {
            const originalPayload = this.#originalPayload(sourceData);
            return (originalPayload ? this.#sourcePayloadData(originalPayload) : null)
                ?? (this.#runtimeTranslatedData(sourceData) ? await this.#sourceDataFor(sourceData) : null)
                ?? (this.#runtimeTranslatedData(sourceData) ? null : sourceData);
        }

        if (!hasTranslation) {
            return sourceData;
        }

        return mappedCompendium?.translate?.(sourceData) ?? sourceData;
    }

    #originalPayload(data) {
        return data?.flags?.babele?.originalPayload ?? null;
    }

    #sourcePayloadData(originalPayload) {
        return foundry.utils.mergeObject(originalPayload, {
            flags: {
                babele: {
                    originalPayload,
                },
            },
        }, {inplace: false});
    }

    async #sourceDataFor(data) {
        const id = data?._id ?? data?.id;
        if (!id) {
            return null;
        }

        return this.babele.sourceDataForUuid?.(`Compendium.${this.pack.collection}.${id}`, {
            data,
            pack: this.pack,
        }) ?? null;
    }

    #runtimeTranslatedData(data) {
        return !!(
            data?.originalName
            || data?.translated
            || data?.hasTranslation
            || data?.flags?.babele
        );
    }

    #entryName(...candidates) {
        for (const candidate of candidates) {
            const name = candidate?.getFlag?.("babele", "originalName")
                ?? candidate?.flags?.babele?.originalName
                ?? candidate?.originalName
                ?? candidate?.name;

            if (name) {
                return name;
            }
        }

        return "entry";
    }

    #createZipProgress() {
        const label = `Babele | Exporting ${this.pack.metadata.label} zip`;

        if (typeof ui?.notifications?.info === "function") {
            return ui.notifications.info(label, {
                progress: true,
                console: false,
            });
        }

        return null;
    }

    #updateZipProgress(progress, percent) {
        const pct = Math.max(0, Math.min(1, percent));
        const message = `Babele | Exporting ${this.pack.metadata.label} zip`;

        if (progress?.update) {
            progress.update({message, pct});
        }
    }

    async #yieldToUi() {
        if (typeof requestAnimationFrame === "function") {
            await new Promise((resolve) => requestAnimationFrame(() => resolve()));
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}
