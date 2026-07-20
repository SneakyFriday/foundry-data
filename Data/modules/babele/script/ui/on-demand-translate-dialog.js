import {ActorTranslation} from "../actor/actor-translation.js";

function localizeWithFallback(key, fallback) {
    const localized = game.i18n.localize(key);
    return localized === key ? fallback : localized;
}

/**
 * Foundry ApplicationV2 review UI for on-demand Actor translation.
 *
 * This class is intentionally facade-coupled: it talks to `game.babele`
 * because it is part of the interactive Foundry UI surface, not the headless
 * translation framework.
 */
export class OnDemandTranslateDialog extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: "babele-actor-translation-{id}",
        classes: ["babele", "babele-actor-translation-app"],
        window: {
            title: "BABELE.TranslateActorTitle",
            icon: "fas fa-globe",
            minimizable: false,
            resizable: true,
        },
        position: {
            width: 760,
            height: "auto",
        },
    };

    constructor(actor, actorTranslation = new ActorTranslation(game.babele), options = {}) {
        super(options);
        this.actor = actor;
        this.actorTranslation = actorTranslation;
        this.proposal = null;
        this.#selectedEntryIds = new Set();
        this.#selectionInitialized = false;
        this.#activeFilters = new Set(["all"]);
    }

    #selectedEntryIds
    #selectionInitialized
    #activeFilters

    render(force = true) {
        return super.render({force});
    }

    async _prepareContext(_options) {
        const proposal = await this.#proposal();
        const summary = this.#summary(proposal);
        const texts = this.#texts();

        this.#initializeSelection(proposal);

        const entries = proposal.entries.map((entry) => this.#entryContext(entry, texts));
        const counts = this.#counts(entries);

        return {
            actorName: this.actor.name ?? "",
            summary: {
                ...summary,
                review: counts.review,
                missing: counts.missing,
            },
            entries,
            hasEntries: entries.length > 0,
            hasTranslated: summary.translated > 0,
            hasReady: summary.ready > 0,
            selectedCount: this.#selectedEntries().length,
            filters: [
                this.#filterContext("all", texts.all, summary.total, texts.allHint),
                this.#filterContext("ready", texts.ready, summary.ready, texts.readyHint, summary.ready > 0),
                this.#filterContext("review", texts.review, counts.review, texts.reviewHint, counts.review > 0),
                this.#filterContext("translated", texts.translated, summary.translated, texts.translatedHint, summary.translated > 0),
                this.#filterContext("missing", texts.missing, counts.missing, texts.missingHint, counts.missing > 0),
            ].filter((filter) => filter.visible),
            stats: [
                this.#summaryStat("total", texts.total, summary.total, texts.totalHint, "is-total", true),
                this.#summaryStat("ready", texts.ready, summary.ready, texts.readyHint, "is-ready", summary.ready > 0),
                this.#summaryStat("translated", texts.translated, summary.translated, texts.translatedHint, "is-translated", summary.translated > 0),
                this.#summaryStat("review", texts.review, counts.review, texts.reviewHint, "is-review", counts.review > 0),
                this.#summaryStat("missing", texts.missing, counts.missing, texts.missingHint, "is-missing", counts.missing > 0),
            ].filter((stat) => stat.visible),
            texts,
        };
    }

    async _renderHTML(context, _options) {
        const html = await foundry.applications.handlebars.renderTemplate(
            "modules/babele/templates/on-demand-translate-dialog.html",
            context,
        );
        const element = document.createElement("div");
        element.innerHTML = html;
        return element.firstElementChild ?? element;
    }

    _replaceHTML(result, content, _options) {
        content.replaceChildren(result);
    }

    async _onRender(context, options) {
        if (typeof super._onRender === "function") {
            await super._onRender(context, options);
        }
        this.#activateListeners(this.element);
    }

    #activateListeners(root) {
        if (!root) {
            return;
        }

        root.addEventListener("change", (event) => {
            const modeSelector = event.target?.closest?.("[data-mode-selector]");
            if (modeSelector) {
                event.preventDefault?.();
                event.stopImmediatePropagation?.();
                event.stopPropagation?.();
                const entry = this.#selectMode(modeSelector.dataset.entryId, modeSelector.value);
                this.#refreshCandidateChoice(root, entry);
                return;
            }

            const packSelector = event.target?.closest?.("[data-pack-selector]");
            if (packSelector) {
                event.preventDefault?.();
                event.stopImmediatePropagation?.();
                event.stopPropagation?.();
                const entry = this.#selectPack(packSelector.dataset.entryId, packSelector.value);
                this.#refreshCandidateChoice(root, entry);
                return;
            }

            const candidateSelector = event.target?.closest?.("[data-candidate-selector]");
            if (candidateSelector) {
                event.preventDefault?.();
                event.stopImmediatePropagation?.();
                event.stopPropagation?.();
                const entry = this.#selectCandidate(candidateSelector.dataset.entryId, candidateSelector.value);
                this.#refreshCandidateChoice(root, entry);
                return;
            }

            const selector = event.target?.closest?.("[data-entry-selector]");
            if (!selector) {
                return;
            }

            if (selector.checked) {
                this.#selectedEntryIds.add(selector.dataset.entryId);
            } else {
                this.#selectedEntryIds.delete(selector.dataset.entryId);
            }

            this.#refreshActions(root);
        }, {capture: true});

        root.addEventListener("click", async (event) => {
            const action = event.target?.closest?.("[data-action]")?.dataset.action;
            if (!action) {
                return;
            }

            event.preventDefault();
            if (action === "select-all") {
                this.#selectAll(root);
            } else if (action === "select-none") {
                this.#selectNone(root);
            } else if (action === "filter") {
                this.#applyFilter(root, event.target.closest("[data-filter]")?.dataset.filter ?? "all");
            } else if (action === "apply-selected") {
                await this.#applySelected();
            } else if (action === "cancel") {
                await this.close?.();
            }
        });

        this.#refreshActions(root);
        this.#refreshFilters(root);
    }

    async #proposal() {
        this.proposal ??= await (game.babele?.proposeActorTranslation?.(this.actor) ?? this.actorTranslation.proposal(this.actor));
        return this.proposal;
    }

    async #applySelected() {
        const selectedEntries = this.#selectedEntries();
        if (selectedEntries.length === 0) {
            return [];
        }

        const updates = await (game.babele?.applyActorTranslation?.(this.proposal, {entries: selectedEntries})
            ?? this.actorTranslation.apply(this.proposal, {entries: selectedEntries}));
        await this.close?.({submitted: true});
        return updates;
    }

    #initializeSelection(proposal) {
        if (this.#selectionInitialized) {
            return;
        }

        for (const entry of proposal.translatedEntries()) {
            if (entry.alreadyTranslated) {
                continue;
            }
            if (entry.userChanged || entry.reviewRequired()) {
                continue;
            }

            this.#selectedEntryIds.add(entry.id());
        }
        this.#selectionInitialized = true;
    }

    #selectedEntries() {
        return this.proposal.translatedEntries()
            .filter((entry) => this.#selectedEntryIds.has(entry.id()));
    }

    #selectAll(root) {
        for (const entry of this.proposal.translatedEntries()) {
            if (entry.reviewRequired()) {
                continue;
            }
            this.#selectedEntryIds.add(entry.id());
        }

        for (const selector of root.querySelectorAll("[data-entry-selector]")) {
            selector.checked = !selector.disabled;
        }

        this.#refreshActions(root);
    }

    #selectNone(root) {
        this.#selectedEntryIds.clear();

        for (const selector of root.querySelectorAll("[data-entry-selector]")) {
            selector.checked = false;
        }

        this.#refreshActions(root);
    }

    #selectCandidate(entryId, candidateId) {
        const entry = this.proposal.entries.find((candidate) => candidate.id() === entryId);
        if (!entry?.selectCandidate(candidateId)) {
            return null;
        }

        if (!entry.applicable()) {
            this.#selectedEntryIds.delete(entry.id());
        }

        return entry;
    }

    #selectPack(entryId, packKey) {
        const entry = this.proposal.entries.find((candidate) => candidate.id() === entryId);
        if (!entry?.selectPack(packKey)) {
            return null;
        }

        if (!entry.applicable()) {
            this.#selectedEntryIds.delete(entry.id());
        }

        return entry;
    }

    #selectMode(entryId, mode) {
        const entry = this.proposal.entries.find((candidate) => candidate.id() === entryId);
        if (!entry?.selectMode(mode)) {
            return null;
        }

        if (!entry.applicable()) {
            this.#selectedEntryIds.delete(entry.id());
        }

        return entry;
    }

    #refreshCandidateChoice(root, entry) {
        if (!entry) {
            return;
        }

        const texts = this.#texts();
        const context = this.#entryContext(entry, texts);
        const row = root.querySelector(`[data-entry-id="${context.id}"]`);
        if (!row) {
            return;
        }

        row.className = `babele-actor-translation__entry ${context.cssClass}`;
        row.dataset.entryFilter = context.filter;
        row.hidden = !this.#entryMatchesFilters(context.filter);

        const proposedName = row.querySelector("[data-proposed-name]");
        if (proposedName) {
            proposedName.textContent = context.proposedName;
            proposedName.classList.toggle?.("is-missing", context.proposedMissing);
            proposedName.hidden = !context.showProposedName;
        }

        const proposedLabel = row.querySelector("[data-proposed-label]");
        if (proposedLabel) {
            proposedLabel.textContent = context.proposedLabel;
        }

        const status = row.querySelector("[data-entry-status]");
        if (status) {
            status.textContent = context.status;
        }

        const reviewHint = row.querySelector("[data-review-hint]");
        if (reviewHint) {
            reviewHint.hidden = !context.reviewReason;
            if (context.reviewReason) {
                reviewHint.setAttribute("title", context.reviewReason);
                reviewHint.setAttribute("aria-label", context.reviewReason);
            } else {
                reviewHint.removeAttribute?.("title");
                reviewHint.removeAttribute?.("aria-label");
            }
        }

        const selector = row.querySelector("[data-entry-selector]");
        if (selector) {
            selector.disabled = !context.applicable;
            selector.checked = context.selected;
        }

        const candidateSelector = row.querySelector("[data-candidate-selector]");
        if (candidateSelector) {
            candidateSelector.value = context.selectedCandidateId ?? "";
            candidateSelector.disabled = !context.candidateChoiceEnabled;
            candidateSelector.hidden = !context.showCandidateChoice;
        }

        const packSelector = row.querySelector("[data-pack-selector]");
        if (packSelector) {
            packSelector.value = context.selectedPackKey ?? "";
            packSelector.disabled = !context.packChoiceEnabled;
            packSelector.hidden = !context.showPackChoice;
        }

        const packLabel = row.querySelector("[data-pack-label]");
        if (packLabel) {
            packLabel.textContent = context.showPackLabel;
            packLabel.hidden = !context.showPackLabelValue;
        }

        const packLine = row.querySelector("[data-pack-line]");
        if (packLine) {
            packLine.hidden = !context.showPackDetails;
        }

        const modeSelector = row.querySelector("[data-mode-selector]");
        if (modeSelector) {
            modeSelector.value = context.selectedMode ?? "retranslate";
            modeSelector.disabled = !context.modeChoiceEnabled;
        }

        const arrow = row.querySelector("[data-arrow]");
        if (arrow) {
            arrow.className = `fas ${context.arrowIcon}`;
        }

        this.#refreshSummary(root);
        this.#refreshActions(root);
        this.#refreshFilters(root);
    }

    #entryContext(entry, texts) {
        const translated = entry.hasTranslation();
        const applicable = entry.applicable();
        const alreadyTranslated = entry.alreadyTranslated;
        const rollbackMode = entry.rollbackMode();
        const reviewRequired = entry.reviewRequired();
        const unchanged = entry.translated && !entry.changed && !alreadyTranslated;
        const missing = !alreadyTranslated && !entry.translated;
        const review = !alreadyTranslated && !missing && (entry.userChanged || reviewRequired);
        const filter = alreadyTranslated ? "translated" : missing ? "missing" : review ? "review" : applicable ? "ready" : "translated";
        const id = entry.id();
        const originalName = entry.name();
        const currentName = entry.currentName();
        const candidates = entry.candidates.map((candidate) => ({
            id: candidate.id,
            label: candidate.choiceLabel(originalName),
            proposedName: candidate.proposedName(originalName),
            packKey: candidate.packKey(),
            matchPercent: candidate.matchPercent(),
            selected: candidate.id === entry.selectedCandidateId,
        }));
        const packChoices = [...new Map(entry.candidates.map((candidate) => [
            candidate.packKey(),
            {
                id: candidate.packKey(),
                label: candidate.packLabel(),
                selected: candidate.packKey() === entry.selectedPackKey(),
            },
        ])).values()];
        const hasCandidates = candidates.length > 0;
        const hasCandidateChoices = candidates.length > 1;
        const showCandidateChoice = !rollbackMode && hasCandidateChoices;
        const showProposedName = rollbackMode || !showCandidateChoice;
        const showPackChoice = !rollbackMode && packChoices.length > 1;
        const showPackLabel = !rollbackMode && packChoices.length === 1 ? packChoices[0]?.label ?? "" : "";
        const modeChoices = entry.modeChoices().map((mode) => ({
            id: mode,
            label: mode === "rollback" ? texts.rollback : texts.retranslate,
            selected: entry.currentMode === mode,
        }));

        return {
            id,
            originalName,
            currentName,
            translationLanguage: entry.translationLanguage(),
            hasCurrentTranslation: translated && !!currentName && currentName !== originalName,
            proposedName: rollbackMode
                ? entry.rollbackName()
                : hasCandidates ? entry.proposedName() : translated ? currentName || texts.translated : texts.missing,
            proposedLabel: rollbackMode ? texts.rollbackTarget : texts.proposed,
            proposedMissing: !rollbackMode && !hasCandidates && !translated,
            itemType: entry.type(),
            translated,
            alreadyTranslated,
            userChanged: entry.userChanged,
            applicable: missing ? false : applicable,
            selected: applicable && this.#selectedEntryIds.has(id),
            unchanged,
            review,
            missing,
            reviewReason: review ? this.#reviewReason(entry, texts) : "",
            filter,
            cssClass: missing ? "is-missing" : review ? "is-review" : entry.alreadyTranslated ? "is-already" : unchanged ? "is-unchanged" : translated ? "is-translated" : "is-missing",
            status: missing ? texts.missing : review ? texts.review : entry.alreadyTranslated ? texts.translated : unchanged ? texts.unchanged : translated ? texts.ready : texts.missing,
            packLabel: entry.packLabel(),
            candidates,
            selectedCandidateId: entry.selectedCandidate()?.id ?? "",
            packChoices,
            selectedPackKey: entry.selectedPackKey() ?? "",
            hasCandidates,
            hasCandidateChoices,
            showCandidateChoice,
            showProposedName,
            candidateChoiceEnabled: !missing && !rollbackMode && hasCandidateChoices,
            showPackChoice,
            showPackLabel,
            showPackLabelValue: !!showPackLabel,
            showPackDetails: !rollbackMode && hasCandidates,
            packChoiceEnabled: !missing && !rollbackMode && showPackChoice,
            showModeChoice: alreadyTranslated && modeChoices.length > 0,
            modeChoices,
            selectedMode: entry.currentMode,
            modeChoiceEnabled: modeChoices.length > 1,
            rollbackMode,
            arrowIcon: rollbackMode ? "fa-arrow-left-long" : "fa-arrow-right-long",
        };
    }

    #refreshActions(root) {
        const selectedCount = this.#selectedEntries().length;
        const applyButton = root.querySelector('[data-action="apply-selected"]');
        if (applyButton) {
            applyButton.disabled = selectedCount === 0;
        }

        const selectedCountElement = root.querySelector("[data-selected-count]");
        if (selectedCountElement) {
            selectedCountElement.textContent = String(selectedCount);
        }

        for (const button of root.querySelectorAll('[data-action="select-all"], [data-action="select-none"]')) {
            button.disabled = this.proposal.translatedEntries().length === 0;
        }
    }

    #refreshSummary(root) {
        const summary = this.#summary(this.proposal);
        const counts = this.#counts(this.proposal.entries.map((entry) => this.#entryContext(entry, this.#texts())));
        for (const key of ["total", "ready", "translated", "review", "missing"]) {
            const element = root.querySelector(`[data-summary-${key}]`);
            if (element) {
                const value = key === "review" ? counts.review : key === "missing" ? counts.missing : summary[key];
                element.textContent = String(value);
            }
        }

        const filterCounts = {
            all: summary.total,
            ready: summary.ready,
            review: counts.review,
            translated: summary.translated,
            missing: counts.missing,
        };

        for (const [filter, count] of Object.entries(filterCounts)) {
            const element = root.querySelector(`[data-filter-count="${filter}"]`);
            if (element) {
                element.textContent = String(count);
            }
        }

        for (const stat of root.querySelectorAll("[data-summary-stat]")) {
            const key = stat.dataset.summaryStat;
            const count = filterCounts[key] ?? summary[key] ?? 0;
            stat.hidden = key !== "total" && count === 0;
        }

        for (const filterButton of root.querySelectorAll("[data-filter]")) {
            const key = filterButton.dataset.filter;
            if (key === "all") {
                filterButton.hidden = false;
                continue;
            }

            filterButton.hidden = (filterCounts[key] ?? 0) === 0;
        }
    }

    #filterContext(filter, label, count, hint, visible = true) {
        return {
            filter,
            label,
            count,
            hint,
            active: this.#activeFilters.has(filter),
            visible,
        };
    }

    #applyFilter(root, filter) {
        if (filter === "all" || !["ready", "review", "translated", "missing"].includes(filter)) {
            this.#activeFilters = new Set(["all"]);
            this.#refreshFilters(root);
            return;
        }

        if (this.#activeFilters.has("all")) {
            this.#activeFilters.clear();
        }

        if (this.#activeFilters.has(filter)) {
            this.#activeFilters.delete(filter);
        } else {
            this.#activeFilters.add(filter);
        }

        if (this.#activeFilters.size === 0) {
            this.#activeFilters.add("all");
        }

        this.#refreshFilters(root);
    }

    #refreshFilters(root) {
        for (const entry of root.querySelectorAll("[data-entry-filter]")) {
            entry.hidden = !this.#entryMatchesFilters(entry.dataset.entryFilter);
        }

        for (const button of root.querySelectorAll("[data-filter]")) {
            const active = this.#activeFilters.has(button.dataset.filter);
            button.setAttribute("aria-pressed", String(active));
            button.dataset.active = active ? "true" : "false";
        }
    }

    #entryMatchesFilters(filter) {
        return this.#activeFilters.has("all") || this.#activeFilters.has(filter);
    }

    #texts() {
        return {
            intro: localizeWithFallback(
                "BABELE.ActorTranslationIntro",
                "Review the item translations found for this Actor and choose which ones to apply.",
            ),
            translated: localizeWithFallback("BABELE.ActorTranslationTranslated", "Translated"),
            review: localizeWithFallback("BABELE.ActorTranslationReview", "Review"),
            missing: localizeWithFallback("BABELE.ActorTranslationMissing", "Missing"),
            already: localizeWithFallback("BABELE.ActorTranslationAlready", "Translated"),
            unchanged: localizeWithFallback("BABELE.ActorTranslationUnchanged", "No changes"),
            selected: localizeWithFallback("BABELE.ActorTranslationSelected", "Selected"),
            all: localizeWithFallback("BABELE.ActorTranslationAll", "All"),
            total: localizeWithFallback("BABELE.ActorTranslationTotal", "Total"),
            ready: localizeWithFallback("BABELE.ActorTranslationReady", "Ready"),
            allHint: localizeWithFallback("BABELE.ActorTranslationAllHint", "Show every embedded Item in this review."),
            totalHint: localizeWithFallback("BABELE.ActorTranslationTotalHint", "Total embedded Items reviewed for this Actor."),
            readyHint: localizeWithFallback("BABELE.ActorTranslationReadyHint", "Items with an available translation and no detected local changes. These are selected by default."),
            reviewHint: localizeWithFallback("BABELE.ActorTranslationReviewHint", "Items that require manual review because the match is not unique, not exact, or local changes were detected."),
            missingHint: localizeWithFallback("BABELE.ActorTranslationMissingHint", "Items for which Babele did not find any translation candidate."),
            translatedHint: localizeWithFallback("BABELE.ActorTranslationTranslatedHint", "Items already marked as translated by Babele. They are not selected for re-translation by default."),
            retranslate: localizeWithFallback("BABELE.ActorTranslationRetranslate", "Retranslate"),
            rollback: localizeWithFallback("BABELE.ActorTranslationRollback", "Rollback"),
            rollbackTarget: localizeWithFallback("BABELE.ActorTranslationRollbackTarget", "Rollback"),
            original: localizeWithFallback("BABELE.ActorTranslationOriginal", "Original"),
            proposed: localizeWithFallback("BABELE.ActorTranslationProposed", "Proposed"),
            current: localizeWithFallback("BABELE.ActorTranslationCurrent", "Current"),
            type: localizeWithFallback("BABELE.ActorTranslationType", "Type"),
            from: localizeWithFallback("BABELE.ActorTranslationFrom", "From"),
            choose: localizeWithFallback("BABELE.ActorTranslationChoose", "Choose"),
            selectAll: localizeWithFallback("BABELE.ActorTranslationSelectAll", "Select All"),
            selectNone: localizeWithFallback("BABELE.ActorTranslationSelectNone", "Select None"),
            apply: localizeWithFallback("BABELE.ActorTranslationApplySelected", "Apply Selected"),
            cancel: localizeWithFallback("BABELE.ActorTranslationCancel", "Cancel"),
            empty: localizeWithFallback("BABELE.ActorTranslationEmpty", "This Actor has no embedded Items to translate."),
            actor: localizeWithFallback("BABELE.ActorTranslationActor", "Actor"),
            reviewReasonSimilar: localizeWithFallback("BABELE.ActorTranslationReviewReasonSimilar", "No exact match found. Review similar candidates."),
            reviewReasonAmbiguous: localizeWithFallback("BABELE.ActorTranslationReviewReasonAmbiguous", "More than one exact match was found. Choose the correct entry."),
            reviewReasonModified: localizeWithFallback("BABELE.ActorTranslationReviewReasonModified", "Local changes were detected in translated fields. Applying a translation may overwrite them."),
            reviewReasonMissing: localizeWithFallback("BABELE.ActorTranslationReviewReasonMissing", "No translation candidate was found for this item."),
        };
    }

    #summary(proposal) {
        const summary = proposal.summary();
        return {
            ...summary,
            review: summary.modified,
            missing: summary.untranslated,
        };
    }

    #counts(entries) {
        return entries.reduce((counts, entry) => {
            if (entry.filter === "review") {
                counts.review += 1;
            } else if (entry.filter === "missing") {
                counts.missing += 1;
            }
            return counts;
        }, {review: 0, missing: 0});
    }

    #summaryStat(key, label, count, hint, cssClass, visible = true) {
        return {
            key,
            label,
            count,
            hint,
            cssClass,
            visible,
        };
    }

    #reviewReason(entry, texts) {
        if (entry.userChanged) {
            return texts.reviewReasonModified;
        }

        const candidate = entry.selectedCandidate();
        if (candidate?.reviewReason === "ambiguous-exact") {
            return texts.reviewReasonAmbiguous;
        }

        if (candidate?.reviewReason === "fuzzy") {
            return texts.reviewReasonSimilar;
        }

        return texts.reviewReasonMissing;
    }
}
