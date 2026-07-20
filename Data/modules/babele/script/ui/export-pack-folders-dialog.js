function localizeWithFallback(key, fallback) {
    const localized = game.i18n.localize(key);
    return localized === key ? fallback : localized;
}

/**
 * Minimal dialog for exporting synthetic `_packs-folders` starter files.
 */
export class ExportPackFoldersDialog {

    constructor(packages = [], {selection = "all"} = {}) {
        this.packages = [...packages];
        this.selection = selection;
    }

    async prompt() {
        const content = await foundry.applications.handlebars.renderTemplate(
            "modules/babele/templates/export-pack-folders-dialog.html",
            this.#context(),
        );

        return foundry.applications.api.DialogV2.input({
            window: {
                title: game.i18n.localize("BABELE.ExportPackFoldersTitle"),
            },
            position: {
                width: 520,
            },
            content,
            ok: {
                label: game.i18n.localize("BABELE.ExportPackFoldersBtn"),
                icon: "fas fa-download",
                callback: (_event, button) => new foundry.applications.ux.FormDataExtended(button.form).object,
            },
            rejectClose: false,
            modal: true,
        });
    }

    #context() {
        const selection = this.selection;

        return {
            packages: this.packages.map((entry) => ({
                ...entry,
                selected: selection === entry.value,
            })),
            isAll: selection === "all",
            hasPackages: this.packages.length > 0,
            texts: {
                notes: localizeWithFallback(
                    "BABELE.ExportPackFoldersNotes",
                    "Export starter files for synthetic `_packs-folders` translations. These files are package-scoped and cover the compendium-directory folders shown in the sidebar.",
                ),
                selection: localizeWithFallback("BABELE.ExportPackFoldersSelection", "Package"),
                selectionAll: localizeWithFallback("BABELE.ExportPackFoldersSelectionAll", "All Packages"),
                noPackages: localizeWithFallback(
                    "BABELE.ExportPackFoldersNoPackages",
                    "No compendium-directory folders are currently available for `_packs-folders` export.",
                ),
            },
        };
    }
}
