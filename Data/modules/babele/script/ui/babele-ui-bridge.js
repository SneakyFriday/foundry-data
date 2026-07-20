/**
 * UI integration bridge that isolates Foundry hooks and wrappers from the
 * Babele facade.
 */
export class BabeleUiBridge {
    #searchWrapperRegistered = false;

    registerHooks() {
        this.registerSearchWrapper();
        Hooks.on("getActorSheetHeaderButtons", (app, buttons) => this.extendLegacyActorSheetHeaderButtons(app, buttons));
        Hooks.on("getHeaderControlsActorSheetV2", (sheet, controls) => this.extendActorSheetHeaderControls(sheet, controls));
        Hooks.on("getHeaderControlsCompendium", (app, controls) => this.extendCompendiumHeaderControls(app, controls));
        Hooks.on("renderCompendiumDirectory", (app, html) => this.extendCompendiumDirectoryControls(app, html));
        Hooks.on("renderCompendium", (app, html, data) => this.renderCompendium(app, html, data));
    }

    /**
     * Extend Foundry directory name search so translated compendium rows can
     * still match their original untranslated names.
     */
    registerSearchWrapper() {
        if (this.#searchWrapperRegistered || typeof libWrapper?.register !== "function") {
            return;
        }

        libWrapper.register(
            "babele",
            "foundry.applications.sidebar.DocumentDirectory.prototype._matchSearchEntries",
            function (wrapped, query, entryIds, folderIds, autoExpandIds, options = {}) {
                wrapped(query, entryIds, folderIds, autoExpandIds, options);
                matchOriginalNameEntries(this, query, entryIds, folderIds, autoExpandIds);
            },
            "WRAPPER",
        );

        this.#searchWrapperRegistered = true;
    }

    /**
     * Inject the legacy ApplicationV1 actor-sheet header button.
     *
     * @param {Application} app
     * @param {Array<object>} buttons
     */
    extendLegacyActorSheetHeaderButtons(app, buttons) {
        if (!this.#canTranslateActorSheet(app?.options?.editable)) {
            return;
        }

        if (buttons.some((button) => button?.class === "babele-translate-actor")) {
            return;
        }

        buttons.unshift({
            label: game.i18n.localize("BABELE.TranslateActorHeadBtn"),
            class: "babele-translate-actor",
            icon: "fas fa-globe",
            onclick: () => game.babele.translateActor(app.actor),
        });
    }

    /**
     * Inject the ApplicationV2 actor-sheet header control.
     *
     * @param {ApplicationV2} sheet
     * @param {Array<object>} controls
     */
    extendActorSheetHeaderControls(sheet, controls) {
        if (!this.#canTranslateActorSheet(sheet?.isEditable)) {
            return;
        }

        if (controls.some((control) => control?.action === "babele-translate-actor")) {
            return;
        }

        controls.push({
            action: "babele-translate-actor",
            icon: "fas fa-globe",
            label: game.i18n.localize("BABELE.TranslateActorHeadBtn"),
            onClick: () => game.babele.translateActor(sheet.actor),
        });
    }

    /**
     * Inject the ApplicationV2 compendium header control.
     *
     * @param {ApplicationV2} app
     * @param {Array<object>} controls
     */
    extendCompendiumHeaderControls(app, controls) {
        if (!this.#canExportCompendium()) {
            return;
        }

        if (controls.some((control) => control?.action === "babele-export-translations")) {
            return;
        }

        controls.push({
            action: "babele-export-translations",
            icon: "fas fa-globe",
            label: game.i18n.localize("BABELE.CompendiumTranslations"),
            onClick: () => game.babele.exportTranslationsFile(app.collection),
        });
    }

    /**
     * Inject a compendium-directory level export control for synthetic
     * `_packs-folders` starter files.
     *
     * @param {ApplicationV2} app
     * @param {HTMLElement|jQuery} html
     */
    extendCompendiumDirectoryControls(app, html) {
        if (!this.#canExportCompendium()) {
            return;
        }

        const root = this.#element(html);
        const actions = root?.querySelector?.(".header-actions");
        if (!actions) {
            return;
        }

        if (actions.querySelector(".babele-export-pack-folders")) {
            return;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "babele-export-pack-folders";
        button.dataset.action = "babele-export-pack-folders";

        const icon = document.createElement("i");
        icon.className = "fas fa-globe";
        button.appendChild(icon);

        const label = document.createElement("span");
        label.textContent = game.i18n.localize("BABELE.ExportDirectoryBtn");
        button.appendChild(label);

        button.addEventListener("click", () => game.babele.exportDirectoryTranslations(app));
        actions.appendChild(button);
    }

    /**
     * Render original-name hints for translated compendium entries.
     *
     * @param {Application} app
     * @param {HTMLElement|jQuery} html
     * @param {object} data
     */
    renderCompendium(app, html, data) {
        const root = this.#element(html);
        if (!root) {
            return;
        }

        if (!game.settings.get("babele", "showOriginalName")) {
            return;
        }

        const index = indexEntriesFor(
            data?.collection?.index
            ?? app?.collection?.index
            ?? data?.collection?.contents
            ?? app?.collection?.contents
            ?? [],
        );
        const entriesById = new Map(
            index
                .map((entry) => [entry?._id ?? entry?.id, entry])
                .filter(([id]) => !!id),
        );
        const items = root.querySelectorAll([
            "[data-entry-id] .entry-name",
            "[data-entry-id] .document-name",
            "[data-document-id] .entry-name",
            "[data-document-id] .document-name",
            ".directory-list .entry-name",
            ".directory-list .document-name",
        ].join(", "));

        items.forEach((item) => {
                const entry = this.#compendiumEntryFor(item, entriesById, index);
                if (!entry?.translated || !entry?.hasTranslation || !entry?.originalName) {
                    return;
                }

                this.#appendOriginalName(item, entry.originalName);
            });
    }

    #element(html) {
        return html?.[0] ?? html ?? null;
    }

    #appendOriginalName(target, text) {
        if (!target || !text) {
            return;
        }

        target.querySelector(".babele-original-name")?.remove();
        target.style.display = "flex";
        target.style.flexDirection = "column";
        target.style.alignItems = "flex-start";
        target.style.lineHeight = "normal";
        target.style.paddingTop = "2px";
        target.style.whiteSpace = "normal";
        target.style.overflow = "visible";
        target.style.textOverflow = "initial";

        const label = document.createElement("span");
        label.className = "babele-original-name";
        label.style.display = "block";
        label.style.lineHeight = "normal";
        label.style.fontSize = "12px";
        label.style.color = "gray";
        label.textContent = text;
        target.appendChild(label);
    }

    #canTranslateActorSheet(editable) {
        return game.settings.get("babele", "showTranslateOption") && game.user.isGM && editable;
    }

    #canExportCompendium() {
        return game.user.isGM && game.settings.get("babele", "export");
    }

    #compendiumEntryFor(item, entriesById, index) {
        const row = item.closest?.("[data-entry-id], [data-document-id]");
        const entryId = row?.dataset?.entryId ?? row?.dataset?.documentId;
        if (entryId && entriesById.has(entryId)) {
            return entriesById.get(entryId);
        }

        const text = item.firstChild?.nodeType === 3 ? item.firstChild.textContent?.trim() : item.textContent?.trim();
        if (!text) {
            return null;
        }

        return index.find((entry) => entry?.name === text) ?? null;
    }
}

/**
 * Add matches for translated entries whose original untranslated name satisfies
 * the current name-only directory query.
 *
 * @param {object} directory
 * @param {RegExp} query
 * @param {Set<string>} entryIds
 * @param {Set<string>} folderIds
 * @param {Set<string>} autoExpandIds
 */
export function matchOriginalNameEntries(directory, query, entryIds, folderIds, autoExpandIds) {
    if (!isNameOnlySearch(directory?.collection)) {
        return;
    }

    const entries = indexEntriesFor(directory?.collection?.index ?? directory?.collection?.contents ?? []);

    for (const entry of entries) {
        const entryId = entry?._id ?? entry?.id;
        if (!entryId) {
            continue;
        }

        const originalName = entry?.originalName ?? entry?.flags?.babele?.originalName;
        if (!originalName) {
            continue;
        }

        if (query.test(cleanSearchQuery(originalName))) {
            entryIds.add(entryId);
            includeMatchedFolder(directory?.collection, entry?.folder, folderIds, autoExpandIds);
        }
    }
}

function isNameOnlySearch(collection) {
    const nameMode = globalThis.DIRECTORY_SEARCH_MODES?.NAME ?? "name";
    const searchMode = collection?.searchMode;
    return !searchMode || searchMode === nameMode;
}

function cleanSearchQuery(text) {
    const clean = foundry.applications?.ux?.SearchFilter?.cleanQuery;
    return typeof clean === "function" ? clean(text) : text;
}

function includeMatchedFolder(collection, folder, folderIds, autoExpandIds, {autoExpand = true} = {}) {
    if (typeof folder === "string") {
        folder = collection?.folders?.get?.(folder);
    }

    if (!folder) {
        return;
    }

    const folderId = folder?._id ?? folder?.id;
    if (!folderId) {
        return;
    }

    const visited = folderIds.has(folderId);
    folderIds.add(folderId);

    if (autoExpand) {
        autoExpandIds.add(folderId);
    }

    if (!visited && folder.folder) {
        includeMatchedFolder(collection, folder.folder, folderIds, autoExpandIds);
    }
}

function indexEntriesFor(source) {
    if (Array.isArray(source)) {
        return source;
    }

    if (Array.isArray(source?.contents)) {
        return source.contents;
    }

    if (typeof source?.values === "function") {
        return Array.from(source.values());
    }

    return [];
}
