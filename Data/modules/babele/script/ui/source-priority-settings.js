function localizeWithFallback(key, fallback) {
    const localized = game.i18n.localize(key);
    return localized === key ? fallback : localized;
}

/**
 * Settings submenu entry point for source-priority management.
 */
export class SourcePrioritySettings extends foundry.applications.api.ApplicationV2 {
    render(_options = {}) {
        void new SourcePriorityDialog().prompt();
        return this;
    }
}

/**
 * Dialog that lets GMs configure source merge order for overlapping packs.
 */
export class SourcePriorityDialog {
    async prompt() {
        const diagnostics = await game.babele.sourceDiagnostics();
        const priority = game.babele.sourcePriority();
        const context = this.#context(diagnostics, priority);
        const content = await foundry.applications.handlebars.renderTemplate(
            "modules/babele/templates/source-priority-settings.html",
            context,
        );

        return foundry.applications.api.DialogV2.input({
            window: {
                title: localizeWithFallback("BABELE.SourcePriorityTitle", "Babele Source Priority"),
            },
            position: {
                width: 760,
            },
            content,
            render: (_event, dialog) => {
                this.#activatePriorityControls(dialog.element);
            },
            ok: {
                label: localizeWithFallback("BABELE.SourcePrioritySave", "Save Priority"),
                icon: "fas fa-save",
                callback: async (_event, button) => {
                    const updates = this.#updates(button.form);
                    for (const update of updates) {
                        await game.babele.setSourcePriority(update.collection, update.sources, {refresh: false});
                    }

                    if (updates.length > 0) {
                        await game.babele.refreshTranslationSources();
                    }

                    return updates;
                },
            },
            rejectClose: false,
            modal: true,
        });
    }

    #context(diagnostics, priority) {
        const collections = new Map(Object.entries(priority.collections ?? {}));
        const overlaps = diagnostics.translation?.overlaps ?? [];

        return {
            hasOverlaps: overlaps.length > 0,
            overlaps: overlaps.map((overlap) => {
                const configured = collections.get(overlap.collection) ?? [];
                const configuredSet = new Set(configured);
                const sources = this.#orderedSources(overlap.sources ?? [], configured);
                return {
                    collection: overlap.collection,
                    sourceCount: sources.length,
                    enabled: configured.length > 0,
                    sources: sources.map((source, index) => ({
                        source,
                        index: index + 1,
                        configured: configuredSet.has(source),
                    })),
                };
            }),
            texts: {
                intro: localizeWithFallback(
                    "BABELE.SourcePriorityIntro",
                    "Choose the merge order for compendiums that receive translations from more than one source. Sources lower in the list are applied later and override sources above them.",
                ),
                noOverlaps: localizeWithFallback(
                    "BABELE.SourcePriorityNoOverlaps",
                    "No overlapping translation sources are currently loaded.",
                ),
                explicitPriority: localizeWithFallback("BABELE.SourcePriorityExplicit", "Use explicit priority for this collection"),
                source: localizeWithFallback("BABELE.SourcePrioritySource", "Source"),
                order: localizeWithFallback("BABELE.SourcePriorityOrder", "Order"),
                moveUp: localizeWithFallback("BABELE.SourcePriorityMoveUp", "Move Up"),
                moveDown: localizeWithFallback("BABELE.SourcePriorityMoveDown", "Move Down"),
                sourceHint: localizeWithFallback("BABELE.SourcePrioritySourceHint", "Configured sources are persisted for this collection."),
            },
        };
    }

    #orderedSources(sources, configured) {
        const seen = new Set();
        const ordered = [];

        for (const source of configured) {
            if (sources.includes(source) && !seen.has(source)) {
                ordered.push(source);
                seen.add(source);
            }
        }

        for (const source of sources) {
            if (!seen.has(source)) {
                ordered.push(source);
                seen.add(source);
            }
        }

        return ordered;
    }

    #updates(form) {
        return [...form.querySelectorAll(".babele-source-priority-collection")].map((collectionElement) => {
            const collection = collectionElement.dataset.collection;
            const enabled = collectionElement.querySelector('[name="sourcePriorityEnabled"]')?.checked ?? false;
            if (!enabled) {
                return {collection, sources: []};
            }

            const sources = [...collectionElement.querySelectorAll(".babele-source-priority-row")]
                .map((row) => row.dataset.source)
                .filter((source) => source);

            return {collection, sources};
        });
    }

    #activatePriorityControls(root) {
        if (!root) {
            return;
        }

        root.addEventListener("click", (event) => {
            const button = event.target?.closest?.("[data-action]");
            const action = button?.dataset.action;
            if (!this.#isPriorityAction(action) || button.disabled) {
                return;
            }

            event.preventDefault();
            const row = button.closest(".babele-source-priority-row");
            const collection = row?.closest(".babele-source-priority-collection");
            if (!row || !collection) {
                return;
            }

            this.#moveRow(row, action);
            this.#refreshControls(collection);
        });

        root.addEventListener("change", (event) => {
            const enabled = event.target?.closest?.('[name="sourcePriorityEnabled"]');
            const collection = enabled?.closest?.(".babele-source-priority-collection");
            if (collection) {
                this.#refreshControls(collection);
            }
        });

        for (const collection of root.querySelectorAll(".babele-source-priority-collection")) {
            this.#refreshControls(collection);
        }
    }

    #isPriorityAction(action) {
        return action === "source-priority-up" || action === "source-priority-down";
    }

    #moveRow(row, action) {
        const parent = row.parentNode;
        if (!parent) {
            return;
        }

        const rows = [...parent.querySelectorAll(".babele-source-priority-row")];
        const index = rows.indexOf(row);
        if (index < 0) {
            return;
        }

        if (action === "source-priority-up" && index > 0) {
            parent.insertBefore(row, rows[index - 1]);
        } else if (action === "source-priority-down" && index < rows.length - 1) {
            parent.insertBefore(rows[index + 1], row);
        }
    }

    #refreshControls(collection) {
        const enabled = collection.querySelector('[name="sourcePriorityEnabled"]')?.checked ?? false;
        const rows = [...collection.querySelectorAll(".babele-source-priority-row")];
        rows.forEach((row, index) => {
            row.dataset.priority = String(index + 1);
            for (const button of row.querySelectorAll("[data-action]")) {
                const action = button.dataset.action;
                if (action === "source-priority-up") {
                    button.disabled = !enabled || index === 0;
                } else if (action === "source-priority-down") {
                    button.disabled = !enabled || index === rows.length - 1;
                }
                button.setAttribute("aria-disabled", String(button.disabled));
            }
        });
    }
}
