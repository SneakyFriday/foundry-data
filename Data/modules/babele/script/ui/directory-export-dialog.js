function localizeWithFallback(key, fallback) {
    const localized = game.i18n.localize(key);
    return localized === key ? fallback : localized;
}

/**
 * Global compendium-directory export dialog.
 */
export class DirectoryExportDialog {

    constructor(packs = [], {
        packages = [],
        includeCompendiums = true,
        includePackFolders = true,
        packMode = "all",
        packageMode = "all",
        format = "compatible",
        selection = "all",
        selectedPacks = [],
        selectedPackageIds = [],
    } = {}) {
        this.packs = [...packs];
        this.packages = [...packages];
        this.includeCompendiums = includeCompendiums;
        this.includePackFolders = includePackFolders;
        this.packMode = packMode;
        this.packageMode = packageMode;
        this.format = format;
        this.selection = selection;
        this.selectedPacks = [...selectedPacks];
        this.selectedPackageIds = [...selectedPackageIds];
    }

    async prompt() {
        const content = await foundry.applications.handlebars.renderTemplate(
            "modules/babele/templates/directory-export-dialog.html",
            this.#context(),
        );

        return foundry.applications.api.DialogV2.input({
            window: {
                title: game.i18n.localize("BABELE.ExportDirectoryTitle"),
            },
            position: {
                width: 860,
            },
            content,
            ok: {
                label: game.i18n.localize("BABELE.ExportDirectoryBtn"),
                icon: "fas fa-download",
                callback: (_event, button) => {
                    const form = button.form;
                    const object = new foundry.applications.ux.FormDataExtended(form).object;
                    object.includeCompendiums = form.querySelector('input[name="includeCompendiums"]')?.checked ?? false;
                    object.includePackFolders = form.querySelector('input[name="includePackFolders"]')?.checked ?? false;
                    object.packs = [...form.querySelectorAll('input[name="packs"]:checked')].map((input) => input.value);
                    object.packageIds = [...form.querySelectorAll('input[name="packageIds"]:checked')].map((input) => input.value);
                    return object;
                },
            },
            rejectClose: false,
            modal: true,
        });
    }

    #context() {
        const selectedPacks = new Set(this.selectedPacks);
        const selectedPackageIds = new Set(this.selectedPackageIds);
        const format = this.format;
        const selection = this.selection;
        const packMode = this.packMode;
        const packageMode = this.packageMode;

        return {
            packs: this.packs.map((pack) => ({
                ...pack,
                checked: selectedPacks.has(pack.collection),
            })),
            packages: this.packages.map((entry) => ({
                ...entry,
                checked: selectedPackageIds.has(entry.value),
            })),
            hasPacks: this.packs.length > 0,
            hasPackages: this.packages.length > 0,
            includeCompendiums: this.includeCompendiums,
            includePackFolders: this.includePackFolders,
            isAllPacks: packMode === "all",
            isSelectedPacks: packMode === "selected",
            isAllPackages: packageMode === "all",
            isSelectedPackages: packageMode === "selected",
            isCompatible: format === "compatible",
            isLegacy: format === "legacy",
            isAll: selection === "all",
            isSource: selection === "source",
            isPresent: selection === "present",
            isMissing: selection === "missing",
            texts: {
                notes: localizeWithFallback(
                    "BABELE.ExportDirectoryNotes",
                    "Export translation starter files from the compendium directory. You can include synthetic `_packs-folders` files, bulk compendium exports, or both in the same zip.",
                ),
                includeCompendiums: localizeWithFallback("BABELE.ExportDirectoryIncludeCompendiums", "Compendiums"),
                includePackFolders: localizeWithFallback("BABELE.ExportDirectoryIncludePackFolders", "Synthetic `_packs-folders`"),
                compendiums: localizeWithFallback("BABELE.ExportDirectoryCompendiums", "Compendiums"),
                packMode: localizeWithFallback("BABELE.ExportDirectoryPackMode", "Compendium Selection"),
                packModeAll: localizeWithFallback("BABELE.ExportDirectoryPackModeAll", "All Compendiums"),
                packModeSelected: localizeWithFallback("BABELE.ExportDirectoryPackModeSelected", "Selected Compendiums"),
                packModeAllHint: localizeWithFallback(
                    "BABELE.ExportDirectoryPackModeAllHint",
                    "Export every available compendium without selecting them manually.",
                ),
                packModeSelectedHint: localizeWithFallback(
                    "BABELE.ExportDirectoryPackModeSelectedHint",
                    "Show the list below and export only the compendiums you choose.",
                ),
                packages: localizeWithFallback("BABELE.ExportDirectoryPackages", "Packages"),
                packageMode: localizeWithFallback("BABELE.ExportDirectoryPackageMode", "Synthetic Folder Selection"),
                packageModeAll: localizeWithFallback("BABELE.ExportDirectoryPackageModeAll", "All Package Root Folders"),
                packageModeSelected: localizeWithFallback("BABELE.ExportDirectoryPackageModeSelected", "Selected Package Root Folders"),
                packageModeAllHint: localizeWithFallback(
                    "BABELE.ExportDirectoryPackageModeAllHint",
                    "Export one `_packs-folders` file for every available package root.",
                ),
                packageModeSelectedHint: localizeWithFallback(
                    "BABELE.ExportDirectoryPackageModeSelectedHint",
                    "Show the list below and export only the package roots you choose.",
                ),
                packFoldersHint: localizeWithFallback(
                    "BABELE.ExportDirectoryPackFoldersHint",
                    "Each generated `_packs-folders` file covers the root compendium folders for one package.",
                ),
                format: localizeWithFallback("BABELE.ExportTranslationFormat", "Format"),
                formatLegacy: localizeWithFallback("BABELE.ExportTranslationFormatLegacy", "Legacy"),
                formatCompatible: localizeWithFallback("BABELE.ExportTranslationFormatCompatible", "Compatible"),
                compatibleHint: localizeWithFallback(
                    "BABELE.ExportTranslationFormatCompatibleHint",
                    "Recommended. Exports the canonical object-based format, better suited for modern translation workflows.",
                ),
                legacyDeprecation: localizeWithFallback(
                    "BABELE.ExportTranslationFormatLegacyDeprecated",
                    "Deprecated. Will be removed in a future major version.",
                ),
                selection: localizeWithFallback("BABELE.ExportTranslationSelection", "Entries"),
                selectionAll: localizeWithFallback("BABELE.ExportTranslationSelectionAll", "All Entries"),
                selectionAllHint: localizeWithFallback(
                    "BABELE.ExportTranslationSelectionAllHint",
                    "Export both entries already present in the translation file and entries still missing from it.",
                ),
                selectionSource: localizeWithFallback("BABELE.ExportTranslationSelectionSource", "All Original Entries"),
                selectionSourceHint: localizeWithFallback(
                    "BABELE.ExportTranslationSelectionSourceHint",
                    "Export every entry using the current source-language values only.",
                ),
                selectionPresent: localizeWithFallback("BABELE.ExportTranslationSelectionPresent", "Entries Present in Translation File"),
                selectionMissing: localizeWithFallback("BABELE.ExportTranslationSelectionMissing", "Entries Missing from Translation File"),
                noPacks: localizeWithFallback(
                    "BABELE.ExportDirectoryNoPacks",
                    "No exportable compendiums are currently available.",
                ),
                noPackages: localizeWithFallback(
                    "BABELE.ExportDirectoryNoPackages",
                    "No synthetic `_packs-folders` sources are currently available.",
                ),
            },
        };
    }
}
