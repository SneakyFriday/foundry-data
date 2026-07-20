import {DirectoryExportDialog} from "../ui/directory-export-dialog.js";
import {PackFoldersExport} from "./pack-folders-export.js";
import {TranslationExport} from "./translation-export.js";

/**
 * Bulk export flow from the compendium directory.
 */
export class DirectoryExport {

    constructor(babele) {
        this.babele = babele;
        this.packFoldersExport = new PackFoldersExport(babele);
    }

    async download() {
        const packs = this.availablePacks();
        const packages = this.packFoldersExport.availablePackages();
        const conf = await new DirectoryExportDialog(packs, {
            packages,
            includeCompendiums: true,
            includePackFolders: true,
            packMode: "all",
            packageMode: "all",
            format: "compatible",
            selection: "all",
        }).prompt();

        if (!conf) {
            return;
        }

        const progress = this.#createZipProgress();
        const initialTotal = this.#preparationTotal(conf);
        this.#updateZipProgress(progress, 0.01, this.#preparationMessage(0, initialTotal));
        await this.#yieldToUi();
        const files = await this.data({
            ...conf,
            onProgress: ({completed, total}) => {
                const ratio = total > 0 ? completed / total : 1;
                this.#updateZipProgress(
                    progress,
                    0.05 + (ratio * 0.65),
                    this.#preparationMessage(completed, total),
                );
            },
        });
        if (!files.length) {
            ui.notifications?.warn?.("Babele | no exportable files matched the current directory export selection");
            return;
        }

        const zip = new JSZip();
        for (const file of files) {
            zip.file(file.name, JSON.stringify(file.payload, null, "\t"));
        }

        this.#updateZipProgress(progress, 0.72, "Babele | Packaging directory zip");
        await this.#yieldToUi();
        const content = await zip.generateAsync({type: "blob"}, (metadata) => {
            const ratio = (metadata?.percent ?? 0) / 100;
            this.#updateZipProgress(progress, 0.72 + (ratio * 0.28), "Babele | Packaging directory zip");
        });
        this.#updateZipProgress(progress, 1, "Babele | Packaging directory zip");
        saveAs(content, "babele-directory-export.zip");
    }

    async data(options = {}) {
        const includeCompendiums = options.includeCompendiums !== false && options.includeCompendiums !== "false";
        const includePackFolders = options.includePackFolders !== false && options.includePackFolders !== "false";
        const packs = this.#selectedPacks(options);
        const files = [];
        const onProgress = options.onProgress;
        const total = (includePackFolders ? 1 : 0) + (includeCompendiums ? packs.length : 0);
        let completed = 0;

        if (includePackFolders) {
            files.push(...this.packFoldersExport.data({
                packageIds: this.#selectedPackageIds(options),
            }));
            completed += 1;
            onProgress?.({completed, total});
        }

        if (includeCompendiums) {
            for (const pack of packs) {
                files.push({
                    name: `${pack.collection}.json`,
                    payload: await new TranslationExport(this.babele, pack).data({
                        format: options.format,
                        selection: options.selection,
                    }),
                });
                completed += 1;
                onProgress?.({completed, total});
            }
        }

        return files;
    }

    availablePacks() {
        return this.#packs()
            .filter((pack) => !!this.babele.mappedCompendiumFor(pack.collection))
            .map((pack) => ({
                collection: pack.collection,
                label: pack.metadata?.label ?? pack.collection,
                packageId: this.#packageIdFor(pack),
            }))
            .sort((left, right) => {
                const packageCompare = String(left.packageId ?? "").localeCompare(String(right.packageId ?? ""));
                if (packageCompare !== 0) {
                    return packageCompare;
                }

                return String(left.label).localeCompare(String(right.label));
            });
    }

    #selectedPacks(options = {}) {
        if (this.#packMode(options) === "selected") {
            const selected = new Set((options.packs ?? []).filter(Boolean));
            return this.#packs().filter((pack) => selected.has(pack.collection) && !!this.babele.mappedCompendiumFor(pack.collection));
        }

        return this.#packs().filter((pack) => !!this.babele.mappedCompendiumFor(pack.collection));
    }

    #packMode(options = {}) {
        return options.packMode === "selected" ? "selected" : "all";
    }

    #packageMode(options = {}) {
        return options.packageMode === "selected" ? "selected" : "all";
    }

    #selectedPackageIds(options = {}) {
        if (this.#packageMode(options) !== "selected") {
            return undefined;
        }

        const selected = [...new Set((options.packageIds ?? []).filter(Boolean))];
        return selected;
    }

    #packs() {
        if (typeof game.packs?.values === "function") {
            return [...game.packs.values()];
        }

        if (Array.isArray(game.packs)) {
            return game.packs;
        }

        return [];
    }

    #packageIdFor(pack) {
        const packageType = pack?.metadata?.packageType ?? null;
        if (packageType === "world") {
            return "world";
        }

        return pack?.metadata?.packageName ?? null;
    }

    #createZipProgress() {
        const label = "Babele | Preparing directory export";

        if (typeof ui?.notifications?.info === "function") {
            return ui.notifications.info(label, {
                progress: true,
                console: false,
            });
        }

        return null;
    }

    #preparationTotal(options = {}) {
        const includeCompendiums = options.includeCompendiums !== false && options.includeCompendiums !== "false";
        const includePackFolders = options.includePackFolders !== false && options.includePackFolders !== "false";
        const packs = this.#selectedPacks(options);
        return (includePackFolders ? 1 : 0) + (includeCompendiums ? packs.length : 0);
    }

    #preparationMessage(completed, total) {
        if (!total) {
            return "Babele | Preparing directory export";
        }

        return `Babele | Preparing directory export (${completed}/${total})`;
    }

    #updateZipProgress(progress, percent, message = "Babele | Exporting directory zip") {
        const pct = Math.max(0, Math.min(1, percent));

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
