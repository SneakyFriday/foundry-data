import {ExportPackFoldersDialog} from "../ui/export-pack-folders-dialog.js";

/**
 * Exporter for synthetic package-scoped `_packs-folders` translation files.
 */
export class PackFoldersExport {

    static FILE_SUFFIX = "_packs-folders.json";

    constructor(babele) {
        this.babele = babele;
    }

    async download() {
        const packages = this.availablePackages();
        if (!packages.length) {
            ui.notifications?.warn?.("Babele | no synthetic `_packs-folders` data available for export");
            return;
        }

        const selection = packages.length === 1 ? packages[0].value : "all";
        const conf = await new ExportPackFoldersDialog(packages, {selection}).prompt();
        if (!conf) {
            return;
        }

        const files = this.data(conf);
        if (!files.length) {
            ui.notifications?.warn?.("Babele | no synthetic `_packs-folders` files matched the current export selection");
            return;
        }

        const zip = new JSZip();
        for (const file of files) {
            zip.file(file.name, JSON.stringify(file.payload, null, "\t"));
        }

        const content = await zip.generateAsync({type: "blob"});
        const filename = files.length === 1
            ? files[0].name.replace(/\.json$/i, ".zip")
            : "babele-pack-folders.zip";
        saveAs(content, filename);
    }

    data(options = {}) {
        const packageIds = this.#normalizedPackageIds(options);
        return this.#packagePayloads()
            .filter((entry) => packageIds === "all" || packageIds.includes(entry.packageId))
            .map((entry) => ({
                packageId: entry.packageId,
                name: `${entry.packageId}.${PackFoldersExport.FILE_SUFFIX}`,
                payload: {
                    entries: entry.entries,
                },
            }));
    }

    availablePackages() {
        return this.#packagePayloads().map((entry) => ({
            value: entry.packageId,
            label: entry.packageId,
            count: Object.keys(entry.entries).length,
        }));
    }

    #normalizedPackageIds(options = {}) {
        if (Array.isArray(options.packageIds)) {
            const ids = options.packageIds.filter(Boolean);
            return ids.length ? ids : [];
        }

        const selection = options.selection;
        if (typeof selection === "string" && selection && selection !== "all") {
            return [selection];
        }

        return "all";
    }

    #packagePayloads() {
        const foldersByPackage = new Map();

        for (const pack of this.#packs()) {
            const packageId = this.#packageIdFor(pack);
            if (!packageId) {
                continue;
            }

            const packageFolders = foldersByPackage.get(packageId) ?? new Set();
            let folder = pack?.folder ?? null;
            while (folder) {
                if (folder.name) {
                    packageFolders.add(folder.name);
                }
                folder = folder.folder ?? null;
            }

            if (packageFolders.size) {
                foldersByPackage.set(packageId, packageFolders);
            }
        }

        return [...foldersByPackage.entries()]
            .map(([packageId, entries]) => ({
                packageId,
                entries: Object.fromEntries(
                    [...entries]
                        .sort((left, right) => left.localeCompare(right))
                        .map((name) => [name, name]),
                ),
            }))
            .filter((entry) => Object.keys(entry.entries).length > 0)
            .sort((left, right) => left.packageId.localeCompare(right.packageId));
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
}
