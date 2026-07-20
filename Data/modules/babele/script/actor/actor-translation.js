import {DocumentTranslation} from "../translation/document-translation.js";

/**
 * Builds and applies on-demand Actor translation proposals.
 */
export class ActorTranslation {

    constructor({
        sourceDataForUuid,
        translatedPackFor,
        translatedPacks,
        rollbackDocument,
        translationLanguage,
    } = {}) {
        const babele = arguments[0];
        this.sourceDataForUuid = sourceDataForUuid ?? ((uuid, options = {}) => babele?.sourceDataForUuid?.(uuid, options));
        this.translatedPackFor = translatedPackFor ?? ((documentType, data, options = {}) => babele?.translatedPackFor?.(documentType, data, options));
        this.translatedPacks = translatedPacks ?? (() => {
            const registry = babele?.mappedCompendiums;
            return registry?.values?.()
                ? [...registry.values()]
                : Array.isArray(registry) ? [...registry] : Object.values(registry ?? {});
        });
        this.rollbackDocument = rollbackDocument ?? ((documentType, data, options = {}) => babele?.rollbackDocument?.(documentType, data, options));
        this.translationLanguage = translationLanguage ?? (() => game?.settings?.get?.("core", "language") ?? null);
        this._sourceDocumentCache = new Map();
        this._packIndexCache = new Map();
    }

    /**
     * Build a translation proposal for one Actor's embedded Items without
     * writing anything to the Actor.
     *
     * @param {Actor|object} actor
     * @param {object} [options]
     * @param {string} [options.documentType="Item"]
     * @returns {Promise<ActorTranslationProposal>}
     */
    async proposal(actor, options = {}) {
        const documentType = options.documentType ?? "Item";
        const entries = await Promise.all([...actor.items?.contents ?? []].map(async (item) => {
            const source = item.toObject();
            const alreadyTranslated = this.#alreadyTranslated(item, source);
            const sourceDocument = alreadyTranslated ? null : await this.#sourceDocumentData(source);
            const lookupSource = this.#lookupSource(source, sourceDocument);
            const candidates = await this.#translationCandidates(documentType, item, source, lookupSource, sourceDocument);
            const candidate = candidates[0];
            const rollbackUpdate = alreadyTranslated ? this.#rollbackUpdateFor(documentType, item, source) : null;

            if (!candidate) {
                const legacyMatch = this._legacyTranslatedMatch(documentType, source);
                if (legacyMatch) {
                    this.#debug("entry:already-translated-legacy", {
                        item: this.#debugItem(source),
                        sourceDocument: this.#debugDocument(sourceDocument),
                        lookupSource: this.#debugDocument(lookupSource),
                        pack: legacyMatch.pack?.metadata?.collection ?? legacyMatch.pack?.metadata?.label ?? null,
                        originalName: legacyMatch.originalName,
                    });
                    return ActorTranslationEntry.alreadyTranslated({
                        documentType,
                        item,
                        source: {
                            ...source,
                            originalName: legacyMatch.originalName,
                        },
                        pack: legacyMatch.pack,
                        translatedData: legacyMatch.translatedData,
                        rollbackUpdate,
                    });
                }

                if (alreadyTranslated) {
                    this.#debug("entry:already-translated", {
                        item: this.#debugItem(source),
                        sourceDocument: this.#debugDocument(sourceDocument),
                        lookupSource: this.#debugDocument(lookupSource),
                    });
                    return ActorTranslationEntry.alreadyTranslated({documentType, item, source, rollbackUpdate});
                }

                this.#debug("entry:missing", {
                    item: this.#debugItem(source),
                    sourceDocument: this.#debugDocument(sourceDocument),
                    lookupSource: this.#debugDocument(lookupSource),
                    translatedPacks: this._translatedPacks(documentType, lookupSource).map((pack) => this.#debugPack(pack)),
                });
                return ActorTranslationEntry.untranslated({documentType, item, source});
            }

            this.#debug("entry:candidate-selected", {
                item: this.#debugItem(source),
                sourceDocument: this.#debugDocument(sourceDocument),
                lookupSource: this.#debugDocument(lookupSource),
                candidate: this.#debugCandidate(candidate),
                candidates: candidates.map((entryCandidate) => this.#debugCandidate(entryCandidate)),
            });
            return ActorTranslationEntry.translated({
                documentType,
                item,
                source,
                pack: candidate.pack,
                translatedData: candidate.translatedData,
                update: candidate.update,
                alreadyTranslated,
                changed: candidate.changed,
                candidates,
                rollbackUpdate,
            });
        }));

        return new ActorTranslationProposal(actor, {documentType, entries});
    }

    /**
     * Apply a previously computed Actor translation proposal.
     *
     * @param {ActorTranslationProposal} proposal
     * @param {object} [options]
     * @returns {Promise<Array<object>>}
     */
    async apply(proposal, options = {}) {
        return proposal.apply(options);
    }

    #lookupSource(source, sourceDocument = null) {
        const originalName = source?.flags?.babele?.originalName
            ?? source?.originalName
            ?? sourceDocument?.name;

        if (!originalName || source?.name === originalName) {
            return source;
        }

        return {
            ...source,
            name: originalName,
        };
    }

    #alreadyTranslated(item, source) {
        const hasTranslation = item?.getFlag?.("babele", "hasTranslation")
            ?? source?.flags?.babele?.hasTranslation;
        const translated = item?.getFlag?.("babele", "translated")
            ?? source?.flags?.babele?.translated;

        return hasTranslation === true || translated === true;
    }

    #updateFor(item, source, translatedData, {changed, originalPayload = null}) {
        const materialized = new DocumentTranslation({
            source,
            payload: translatedData,
            hasTranslation: true,
            originalPayload,
            language: this.translationLanguage?.() ?? null,
        }).apply();

        return foundry.utils.mergeObject(translatedData, {
            _id: item.id ?? source._id,
            originalName: materialized.originalName ?? source.name,
            hasTranslation: materialized.hasTranslation ?? true,
            translated: materialized.translated ?? changed,
            flags: {
                babele: materialized.flags?.babele ?? {},
            },
        });
    }

    #rollbackUpdateFor(documentType, item, source) {
        const restored = this.rollbackDocument?.(documentType, source, {
            pack: this._sourceCollection(source),
        });

        if (!restored) {
            return null;
        }

        return foundry.utils.mergeObject(restored, {
            _id: item.id ?? source._id,
            "-=originalName": null,
            "-=hasTranslation": null,
            "-=translated": null,
            "flags.babele.-=originalName": null,
            "flags.babele.-=hasTranslation": null,
            "flags.babele.-=translated": null,
            "flags.babele.-=originalPayload": null,
            "flags.babele.-=lang": null,
            "flags.-=babele": null,
        });
    }

    #documentChanged(sourcePayload, translatedData) {
        return JSON.stringify(sourcePayload) !== JSON.stringify(translatedData);
    }

    #userChanged(source, sourceDocument, pack = null) {
        if (!sourceDocument) {
            return false;
        }

        const current = this.#currentPayload(pack, source);
        const original = this.#sourcePayload(pack, sourceDocument);
        const translated = this.#translatedPayload(pack, sourceDocument);
        if (!current || !original || !translated) {
            this.#debug("userChanged:skipped-missing-payload", {
                item: this.#debugItem(source),
                pack: this.#debugPack(pack),
                hasCurrent: !!current,
                hasOriginal: !!original,
                hasTranslated: !!translated,
                sourceDocument: this.#debugDocument(sourceDocument),
            });
            return false;
        }

        const translatedPaths = this.#changedPaths(original, translated);
        if (translatedPaths.length === 0) {
            this.#debug("userChanged:no-translated-paths", {
                item: this.#debugItem(source),
                pack: this.#debugPack(pack),
                current,
                original,
                translated,
            });
            return false;
        }

        const comparisons = translatedPaths.map((path) => {
            const currentHasPath = this.#hasPath(current, path);
            const originalHasPath = this.#hasPath(original, path);
            const currentValue = currentHasPath ? this.#pathValue(current, path) : undefined;
            const originalValue = originalHasPath ? this.#pathValue(original, path) : undefined;
            return {
                path: this.#pathToString(path),
                currentHasPath,
                originalHasPath,
                currentValue,
                originalValue,
                changed: currentHasPath && originalHasPath
                    ? JSON.stringify(this._comparableValue(path, currentValue)) !== JSON.stringify(this._comparableValue(path, originalValue))
                    : false,
            };
        });
        const userChanged = comparisons.some((comparison) => comparison.changed);

        this.#debug("userChanged:evaluated", {
            item: this.#debugItem(source),
            pack: this.#debugPack(pack),
            translatedPaths: translatedPaths.map((path) => this.#pathToString(path)),
            comparisons,
            current,
            original,
            translated,
            sourceDocument: this.#debugDocument(sourceDocument),
            userChanged,
        });

        return userChanged;
    }

    async #sourceDocumentData(source) {
        const uuid = source?.flags?.core?.sourceId ?? source?._stats?.compendiumSource;
        if (!uuid) {
            return null;
        }

        const sourceData = await this.sourceDataForUuid?.(uuid, {data: source});
        return sourceData ? this.#sourceLikeData(sourceData) : null;
    }

    #sourceLikeData(data) {
        const originalName = data?.flags?.babele?.originalName ?? data?.originalName;
        if (!originalName || data?.name === originalName) {
            return data;
        }

        return {
            ...data,
            name: originalName,
        };
    }

    #currentPayload(pack, data) {
        try {
            const extracted = pack?.extract?.(data);
            return typeof extracted === "undefined" ? null : extracted;
        } catch (_error) {
            return null;
        }
    }

    #sourcePayload(pack, data) {
        try {
            const originalPayload = data?.flags?.babele?.originalPayload;
            if (originalPayload) {
                return originalPayload;
            }

            const extracted = pack?.extract?.(data);
            return typeof extracted === "undefined" ? null : extracted;
        } catch (_error) {
            return null;
        }
    }

    #sharedPayloadChanged(current, original) {
        if (this.#isPlainObject(current) && this.#isPlainObject(original)) {
            for (const [key, value] of Object.entries(current)) {
                if (!Object.prototype.hasOwnProperty.call(original, key)) {
                    continue;
                }

                if (this.#sharedPayloadChanged(value, original[key])) {
                    return true;
                }
            }

            return false;
        }

        if (Array.isArray(current) && Array.isArray(original)) {
            const length = Math.min(current.length, original.length);
            for (let index = 0; index < length; index += 1) {
                if (
                    !Object.prototype.hasOwnProperty.call(current, index)
                    || !Object.prototype.hasOwnProperty.call(original, index)
                ) {
                    continue;
                }

                if (this.#sharedPayloadChanged(current[index], original[index])) {
                    return true;
                }
            }

            return false;
        }

        return JSON.stringify(current) !== JSON.stringify(original);
    }

    #payloadChangedAtPaths(current, original, paths = []) {
        return paths.some((path) => {
            if (!this.#hasPath(current, path) || !this.#hasPath(original, path)) {
                return false;
            }

            return JSON.stringify(this.#pathValue(current, path)) !== JSON.stringify(this.#pathValue(original, path));
        });
    }

    #changedPaths(original, translated, prefix = []) {
        if (this.#isPlainObject(original) && this.#isPlainObject(translated)) {
            return [...new Set([
                ...Object.keys(original),
                ...Object.keys(translated),
            ])].flatMap((key) => this.#changedPaths(original[key], translated[key], [...prefix, key]));
        }

        if (Array.isArray(original) && Array.isArray(translated)) {
            const length = Math.max(original.length, translated.length);
            const paths = [];
            for (let index = 0; index < length; index += 1) {
                paths.push(...this.#changedPaths(original[index], translated[index], [...prefix, index]));
            }
            return paths;
        }

        return JSON.stringify(original) === JSON.stringify(translated) ? [] : [prefix];
    }

    #pathValue(source, path = []) {
        return path.reduce((value, segment) => value?.[segment], source);
    }

    #hasPath(source, path = []) {
        let current = source;
        for (const segment of path) {
            if (current == null || !Object.prototype.hasOwnProperty.call(current, segment)) {
                return false;
            }
            current = current[segment];
        }

        return true;
    }

    #isPlainObject(value) {
        return Object.prototype.toString.call(value) === "[object Object]";
    }

    async #translationCandidates(documentType, item, source, lookupSource, sourceDocument) {
        const exactCandidates = await this.#exactCandidates(documentType, item, source, lookupSource, sourceDocument);
        if (exactCandidates.length > 0) {
            return exactCandidates;
        }

        return this.#variantCandidates(documentType, item, source, lookupSource, sourceDocument);
    }

    async #exactCandidates(documentType, item, source, lookupSource, sourceDocument) {
        const exactPacks = this._preferredPacks(
            this._translatedPacks(documentType, lookupSource)
                .filter((pack) => pack.hasTranslation?.(lookupSource, documentType) === true),
            source,
        );

        if (exactPacks.length === 0) {
            const fallbackPack = this.translatedPackFor?.(documentType, lookupSource);
            if (fallbackPack) {
                exactPacks.push(fallbackPack);
            }
        }

        const candidates = [];
        let candidateIndex = 0;
        for (const pack of this.#uniquePacks(exactPacks)) {
            const packCandidates = await this.#exactCandidatesForPack(pack, {
                item,
                source,
                lookupSource,
                sourceDocument,
                startIndex: candidateIndex,
            });
            candidates.push(...packCandidates);
            candidateIndex += packCandidates.length;
        }

        return candidates;
    }

    async #exactCandidatesForPack(pack, {item, source, lookupSource, sourceDocument, startIndex = 0}) {
        const sources = await this.#exactSourceCandidates(pack, lookupSource, sourceDocument);
        const reviewRequired = sources.length > 1;

        return sources
            .map((candidateSource, index) => this.#candidateFromSource(pack, startIndex + index, {
                item,
                source,
                originalSource: lookupSource,
                candidateSource: candidateSource.document,
                sourceDocument: candidateSource.document,
                reviewRequired,
                reviewReason: reviewRequired ? "ambiguous-exact" : null,
                label: reviewRequired ? candidateSource.label : "",
                idSuffix: reviewRequired ? candidateSource.idSuffix : null,
            }))
            .filter(Boolean);
    }

    async #exactSourceCandidates(pack, lookupSource, sourceDocument) {
        const collection = pack?.metadata?.collection ?? pack?.metadata?.id ?? null;
        const name = this.#normalizedName(lookupSource?.name);
        if (!collection || !name) {
            return [this.#candidateSourceDescriptor(lookupSource, sourceDocument)];
        }

        const currentSource = this._sourceCollection(lookupSource) === collection ? sourceDocument ?? lookupSource : null;
        const currentDescriptor = currentSource ? this.#candidateSourceDescriptor(currentSource, currentSource) : null;
        const exactEntries = this.#packIndexEntries(collection)
            .filter((entry) => this.#isExactSourceMatch(entry, lookupSource, name));

        if (exactEntries.length <= 1) {
            return [currentDescriptor ?? this.#candidateSourceDescriptor(lookupSource, sourceDocument)];
        }

        const documents = await Promise.all(exactEntries.map(async (entry) => {
            const id = entry?._id ?? entry?.id ?? null;
            return id ? this.#sourceDocumentForCollection(collection, id) : null;
        }));
        const candidates = documents
            .filter((document) => document && this.#normalizedName(document?.name) === name)
            .map((document) => this.#candidateSourceDescriptor(document, document));

        if (currentDescriptor) {
            candidates.unshift(currentDescriptor);
        }

        const deduped = this.#dedupeCandidateSources(candidates);
        return deduped.length > 0
            ? this.#sortCandidateSources(deduped, lookupSource)
            : [currentDescriptor ?? this.#candidateSourceDescriptor(lookupSource, sourceDocument)];
    }

    #candidateSourceDescriptor(candidateSource, sourceDocument = candidateSource) {
        const document = sourceDocument ?? candidateSource;
        return {
            document,
            idSuffix: document?._id ?? candidateSource?._id ?? candidateSource?.name ?? "candidate",
            label: this.#candidateContextLabel(document ?? candidateSource),
        };
    }

    #dedupeCandidateSources(candidates = []) {
        const seen = new Set();
        return candidates.filter((candidate) => {
            const key = candidate?.document?._id
                ?? candidate?.document?.flags?.core?.sourceId
                ?? candidate?.document?._stats?.compendiumSource
                ?? candidate?.idSuffix
                ?? candidate?.document?.name
                ?? null;
            if (!key || seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
    }

    #sortCandidateSources(candidates, lookupSource) {
        const sourceId = foundry.utils.parseUuid(
            lookupSource?.flags?.core?.sourceId
            || lookupSource?._stats?.compendiumSource,
        )?.id ?? null;

        return [...candidates].sort((left, right) => {
            const leftPrimary = left.document?._id === sourceId ? 1 : 0;
            const rightPrimary = right.document?._id === sourceId ? 1 : 0;
            if (leftPrimary !== rightPrimary) {
                return rightPrimary - leftPrimary;
            }

            return left.label.localeCompare(right.label);
        });
    }

    #isExactSourceMatch(entry, lookupSource, normalizedName) {
        if (this.#normalizedName(entry?.name) !== normalizedName) {
            return false;
        }

        if (!lookupSource?.type || !entry?.type) {
            return true;
        }

        return entry.type === lookupSource.type;
    }

    #packIndexEntries(collection) {
        if (this._packIndexCache.has(collection)) {
            return this._packIndexCache.get(collection);
        }

        const pack = game.packs?.get?.(collection) ?? null;
        const index = pack?.index;
        const entries = Array.isArray(index)
            ? [...index]
            : index?.contents ? [...index.contents]
                : index?.values ? [...index.values()]
                    : [];
        this._packIndexCache.set(collection, entries);
        return entries;
    }

    async #sourceDocumentForCollection(collection, id) {
        const key = `${collection}:${id}`;
        if (this._sourceDocumentCache.has(key)) {
            return this._sourceDocumentCache.get(key);
        }

        const uuid = `Compendium.${collection}.Item.${id}`;
        let data = await this.sourceDataForUuid?.(uuid);

        if (!data) {
            const pack = game.packs?.get?.(collection) ?? null;
            const document = await pack?.getDocument?.(id);
            data = document?.toObject?.() ?? null;
        }

        const sourceLike = data ? this.#sourceLikeData(data) : null;
        this._sourceDocumentCache.set(key, sourceLike);
        return sourceLike;
    }

    #candidateFromSource(pack, index, {item, source, originalSource = source, candidateSource, sourceDocument, suggested = false, match = null, reviewRequired = false, reviewReason = null, label = "", idSuffix = null}) {
        if (typeof pack?.translate !== "function") {
            return null;
        }

        const translatedData = pack.translate(candidateSource, true);
        const translatedDocument = foundry.utils.mergeObject(source, translatedData, {inplace: false});
        const changed = this.#documentChanged(source, translatedDocument);
        const originalPayload = this.#originalPayload(pack, sourceDocument ?? candidateSource);
        const update = this.#updateFor(item, originalSource, translatedData, {changed, originalPayload});
        const userChanged = changed && this.#userChanged(source, sourceDocument, pack);

        return new ActorTranslationCandidate({
            id: this.#candidateId(pack, index, idSuffix),
            pack,
            translatedData,
            update,
            changed,
            userChanged,
            suggested,
            match,
            reviewRequired,
            reviewReason,
            label,
            sourceDocument,
        });
    }

    #variantCandidates(documentType, item, source, lookupSource, sourceDocument) {
        const matches = this._preferredPacks(this._translatedPacks(documentType, lookupSource), source)
            .flatMap((pack) => this.#variantMatches(pack, lookupSource).map((match) => ({pack, match})));
        const candidates = matches
            .sort((left, right) => right.match.score - left.match.score)
            .slice(0, 5)
            .map(({pack, match}, index) => this.#candidateFromSource(pack, index, {
                item,
                source,
                originalSource: lookupSource,
                candidateSource: {
                    ...lookupSource,
                    name: match.key,
                },
                sourceDocument,
                suggested: true,
                match,
            }))
            .filter(Boolean);

        this.#debug("variantCandidates:evaluated", {
            item: this.#debugItem(source),
            lookupSource: this.#debugDocument(lookupSource),
            sourceDocument: this.#debugDocument(sourceDocument),
            matches: matches.map(({pack, match}) => ({
                pack: this.#debugPack(pack),
                match,
            })),
            candidates: candidates.map((candidate) => this.#debugCandidate(candidate)),
        });

        return candidates;
    }

    #variantMatches(pack, source) {
        const sourceName = this.#normalizedName(source?.name);
        if (!sourceName) {
            return [];
        }

        return this.#translationEntries(pack)
            .map(([key, translation]) => ({
                key,
                translation,
                score: this.#variantScore(sourceName, this.#normalizedName(key)),
            }))
            .filter(({key, translation, score}) =>
                typeof translation?.name === "string"
                && this.#normalizedName(key) !== sourceName
                && score >= 0.55,
            );
    }

    #translationEntries(pack) {
        if (typeof pack?.translationEntries?.entries === "function") {
            return [...pack.translationEntries.entries()];
        }

        return Object.entries(
            pack?.translations
            ?? pack?.translation?.entries
            ?? {},
        );
    }

    #variantScore(sourceName, candidateName) {
        if (!sourceName || !candidateName) {
            return 0;
        }

        if (sourceName === candidateName) {
            return 1;
        }

        const contains = sourceName.includes(candidateName) || candidateName.includes(sourceName)
            ? 0.92 - (Math.abs(sourceName.length - candidateName.length) / Math.max(sourceName.length, candidateName.length, 1)) * 0.25
            : 0;
        const sourceTokens = sourceName.split(" ").filter(Boolean);
        const candidateTokens = candidateName.split(" ").filter(Boolean);
        const sharedTokens = sourceTokens.filter((token) => candidateTokens.includes(token));
        const tokenScore = sharedTokens.length === 0
            ? 0
            : sharedTokens.length / Math.max(sourceTokens.length, candidateTokens.length);
        const distance = this.#levenshteinDistance(sourceName, candidateName);
        const levenshtein = 1 - (distance / Math.max(sourceName.length, candidateName.length, 1));

        return Math.max(contains, tokenScore, levenshtein);
    }

    #normalizedName(name) {
        return String(name ?? "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/gu, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/gu, " ")
            .trim()
            .replace(/\s+/gu, " ");
    }

    #levenshteinDistance(left, right) {
        const rows = Array.from({length: left.length + 1}, (_, index) => [index]);
        for (let column = 0; column <= right.length; column += 1) {
            rows[0][column] = column;
        }

        for (let row = 1; row <= left.length; row += 1) {
            for (let column = 1; column <= right.length; column += 1) {
                const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
                rows[row][column] = Math.min(
                    rows[row - 1][column] + 1,
                    rows[row][column - 1] + 1,
                    rows[row - 1][column - 1] + substitutionCost,
                );
            }
        }

        return rows[left.length][right.length];
    }

    #uniquePacks(packs = []) {
        const seen = new Set();
        return packs.filter((pack) => {
            const key = pack?.metadata?.id ?? pack?.metadata?.collection ?? pack?.metadata?.label ?? pack;
            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
    }

    _preferredPacks(packs = [], source = null) {
        const unique = this.#uniquePacks(packs);
        const sourceCollection = this._sourceCollection(source);
        if (!sourceCollection) {
            return unique;
        }

        const preferred = unique.filter((pack) => pack?.metadata?.collection === sourceCollection);
        return preferred.length > 0 ? preferred : unique;
    }

    #originalPayload(pack, data) {
        if (!data) {
            return null;
        }

        const originalPayload = data?.flags?.babele?.originalPayload;
        if (originalPayload) {
            return originalPayload;
        }

        try {
            return pack?.sourcePayload?.(data)
                ?? pack?.extract?.(data)
                ?? null;
        } catch (_error) {
            return null;
        }
    }

    #translatedPayload(pack, data) {
        if (!pack || !data) {
            return null;
        }

        try {
            const translatedData = pack.translate?.(data, true);
            const translatedDocument = foundry.utils.mergeObject(data, translatedData, {inplace: false});
            return pack?.extract?.(translatedDocument) ?? null;
        } catch (_error) {
            return null;
        }
    }

    #candidateId(pack, index, suffix = null) {
        const base = pack?.metadata?.id ?? pack?.metadata?.collection ?? pack?.metadata?.name ?? pack?.metadata?.label ?? "candidate";
        return suffix ? `${base}::${suffix}` : `${base}::${index}`;
    }

    #candidateContextLabel(source) {
        const requirements = this.#stringValue(source?.system?.requirements);
        if (requirements) {
            return requirements;
        }

        const level = this.#stringValue(source?.system?.level);
        if (level) {
            return level;
        }

        const type = this.#stringValue(source?.type);
        if (type) {
            return type;
        }

        return this.#stringValue(source?._id) ?? "";
    }

    #stringValue(value) {
        if (typeof value !== "string") {
            return null;
        }

        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    #debugEnabled() {
        return globalThis.BABELE_DEBUG_ACTOR_TRANSLATION === true;
    }

    #debug(event, details = {}) {
        if (!this.#debugEnabled()) {
            return;
        }

        console.debug(`Babele | ActorTranslation | ${event}`, details);
    }

    #debugItem(source) {
        return {
            id: source?._id ?? null,
            name: source?.name ?? null,
            type: source?.type ?? null,
            sourceId: source?.flags?.core?.sourceId ?? source?._stats?.compendiumSource ?? null,
            originalName: source?.flags?.babele?.originalName ?? source?.originalName ?? null,
            hasTranslation: source?.flags?.babele?.hasTranslation ?? source?.hasTranslation ?? null,
            translated: source?.flags?.babele?.translated ?? source?.translated ?? null,
        };
    }

    #debugDocument(data) {
        if (!data) {
            return null;
        }

        return {
            id: data?._id ?? null,
            name: data?.name ?? null,
            type: data?.type ?? null,
            sourceId: data?.flags?.core?.sourceId ?? data?._stats?.compendiumSource ?? null,
            originalName: data?.flags?.babele?.originalName ?? data?.originalName ?? null,
            hasOriginalPayload: !!data?.flags?.babele?.originalPayload,
            system: data?.system ?? null,
            flags: data?.flags ?? null,
        };
    }

    #debugPack(pack) {
        if (!pack) {
            return null;
        }

        return {
            collection: pack?.metadata?.collection ?? pack?.metadata?.id ?? null,
            label: pack?.metadata?.label ?? pack?.metadata?.name ?? null,
            documentType: pack?.metadata?.type ?? null,
            translated: pack?.translated ?? null,
            types: pack?.types ?? null,
        };
    }

    #debugCandidate(candidate) {
        if (!candidate) {
            return null;
        }

        return {
            id: candidate.id,
            pack: this.#debugPack(candidate.pack),
            proposedName: candidate.proposedName?.() ?? null,
            changed: candidate.changed,
            userChanged: candidate.userChanged,
            suggested: candidate.suggested,
            match: candidate.match ?? null,
            translatedData: candidate.translatedData ?? null,
            update: candidate.update ?? null,
        };
    }

    #pathToString(path = []) {
        return path.map((segment) => String(segment)).join(".");
    }

    _sourceCollection(source) {
        const uuid = source?.flags?.core?.sourceId ?? source?._stats?.compendiumSource ?? null;
        const match = typeof uuid === "string" ? uuid.match(/^Compendium\.([^.]+\.[^.]+)\./) : null;
        return match?.[1] ?? null;
    }

    _comparableValue(path, value) {
        if (typeof value === "string") {
            return this._normalizedStringValue(path, value);
        }

        if (Array.isArray(value)) {
            return value.map((entry) => this._comparableValue(path, entry));
        }

        if (this.#isPlainObject(value)) {
            return Object.fromEntries(
                Object.entries(value).map(([key, entry]) => [key, this._comparableValue([...path, key], entry)]),
            );
        }

        return value;
    }

    _normalizedStringValue(path, value) {
        const field = path[path.length - 1];
        let normalized = value
            .normalize("NFKC")
            .replace(/\u00a0/gu, " ")
            .replace(/&nbsp;/giu, " ")
            .replace(/&amp;reference\[/giu, "&reference[")
            .replace(/@UUID\[[^\]]+\]\{([^}]+)\}/gu, "$1")
            .replace(/&reference\[([^\]]+)\](?:\{([^}]+)\})?/giu, (_match, key, label) => label ?? key.split(/\s+/u)[0])
            .replace(/<br\s*\/?>/giu, "<br>")
            .replace(/>\s+</gu, "><")
            .replace(/\s+/gu, " ")
            .trim();

        if (field === "description" || field === "chat") {
            normalized = normalized
                .replace(/<[^>]+>/gu, " ")
                .replace(/\bAt Higher Levels\./giu, "Higher Levels.")
                .replace(/\s+/gu, " ")
                .trim();
        }

        if (field === "subtype" || field === "identifier" || field === "slug") {
            normalized = normalized.toLowerCase();
        }

        return normalized;
    }

    _legacyTranslatedMatch(documentType, source) {
        if (!source?.name) {
            return null;
        }

        for (const pack of this._translatedPacks(documentType, source)) {
            for (const [key, translation] of Object.entries(pack.translations ?? {})) {
                if (translation?.name !== source.name) {
                    continue;
                }

                return {
                    pack,
                    translatedData: translation,
                    originalName: key === source._id ? source.name : key,
                };
            }
        }

        return null;
    }

    _translatedPacks(documentType, source) {
        return (this.translatedPacks?.() ?? []).filter((pack) => {
            if (pack?.translated !== true) {
                return false;
            }

            if (documentType && pack.metadata?.type && pack.metadata.type !== documentType) {
                return false;
            }

            return !(pack.types && !pack.types.includes(source.type));
        });
    }
}

/**
 * One possible translated payload for an embedded Actor item.
 */
export class ActorTranslationCandidate {
    constructor({
        id,
        pack,
        translatedData,
        update,
        changed = false,
        userChanged = false,
        suggested = false,
        match = null,
        reviewRequired = false,
        reviewReason = null,
        label = "",
        sourceDocument = null,
    }) {
        this.id = id;
        this.pack = pack;
        this.translatedData = translatedData;
        this.update = update;
        this.changed = changed;
        this.userChanged = userChanged;
        this.suggested = suggested;
        this.match = match;
        this._reviewRequired = reviewRequired || suggested === true;
        this.reviewReason = reviewReason ?? (suggested ? "fuzzy" : null);
        this.label = label;
        this.sourceDocument = sourceDocument;
    }

    proposedName(fallback = "") {
        return this.update?.name ?? this.translatedData?.name ?? fallback;
    }

    packLabel() {
        return this.pack?.metadata?.label
            ?? this.pack?.metadata?.name
            ?? this.pack?.metadata?.collection
            ?? "";
    }

    reviewRequired() {
        return this._reviewRequired === true;
    }

    optionLabel() {
        const packLabel = this.packLabel();
        return this.label
            ? `${packLabel} · ${this.label}`
            : packLabel;
    }

    packKey() {
        return this.pack?.metadata?.id
            ?? this.pack?.metadata?.collection
            ?? this.pack?.metadata?.name
            ?? this.pack?.metadata?.label
            ?? this.id;
    }

    matchScore() {
        if (typeof this.match?.score === "number") {
            return this.match.score;
        }

        return 1;
    }

    matchPercent() {
        return Math.round(this.matchScore() * 100);
    }

    choiceLabel(fallback = "") {
        const parts = [this.proposedName(fallback)];
        const type = this.#stringValue(this.sourceDocument?.type ?? this.translatedData?.type ?? this.update?.type ?? null);
        if (type) {
            parts.push(type);
        }
        if (this.label) {
            parts.push(this.label);
        }
        parts.push(`${this.matchPercent()}%`);
        return parts.join(" · ");
    }

    #stringValue(value) {
        if (typeof value !== "string") {
            return null;
        }

        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
}

/**
 * A computed set of Actor embedded-document translation changes.
 */
export class ActorTranslationProposal {
    constructor(actor, {documentType = "Item", entries = []} = {}) {
        this.actor = actor;
        this.documentType = documentType;
        this.entries = entries;
    }

    /**
     * @returns {{total: number, ready: number, modified: number, translated: number, untranslated: number}}
     */
    summary() {
        const modified = this.entries.filter((entry) => !entry.alreadyTranslated && entry.applicable() && entry.userChanged && !entry.reviewRequired()).length;
        const ready = this.entries.filter((entry) => !entry.alreadyTranslated && entry.applicable() && !entry.userChanged && !entry.reviewRequired()).length;
        const translated = this.entries.filter((entry) =>
            entry.alreadyTranslated || (entry.hasTranslation() && !entry.applicable() && !entry.reviewRequired()),
        ).length;
        return {
            total: this.entries.length,
            ready,
            modified,
            translated,
            untranslated: this.entries.length - ready - modified - translated,
        };
    }

    /**
     * @returns {Array<ActorTranslationEntry>}
     */
    translatedEntries() {
        return this.entries.filter((entry) => entry.applicable());
    }

    /**
     * @returns {Array<ActorTranslationEntry>}
     */
    untranslatedEntries() {
        return this.entries.filter((entry) => !entry.hasTranslation());
    }

    /**
     * @param {Array<ActorTranslationEntry>} [entries]
     * @returns {Array<object>}
     */
    updates(entries = this.translatedEntries()) {
        return entries
            .filter((entry) => entry.applicable())
            .map((entry) => entry.update);
    }

    /**
     * @param {object} [options]
     * @param {Array<ActorTranslationEntry>} [options.entries]
     * @returns {Promise<Array<object>>}
     */
    async apply({entries = this.translatedEntries()} = {}) {
        const updates = this.updates(entries);
        if (updates.length === 0) {
            return [];
        }

        await this.actor.updateEmbeddedDocuments(this.documentType, updates);
        return updates;
    }
}

/**
 * One embedded-document translation candidate.
 */
export class ActorTranslationEntry {
    static translated({
        documentType,
        item,
        source,
        pack,
        translatedData,
        update,
        alreadyTranslated = false,
        changed = true,
        userChanged = false,
        candidates = [],
        rollbackUpdate = null,
    }) {
        return new ActorTranslationEntry({
            documentType,
            item,
            source,
            pack,
            translatedData,
            update,
            translated: true,
            alreadyTranslated,
            changed,
            userChanged,
            candidates,
            rollbackUpdate,
        });
    }

    static untranslated({documentType, item, source}) {
        return new ActorTranslationEntry({
            documentType,
            item,
            source,
            translated: false,
        });
    }

    static alreadyTranslated({documentType, item, source, pack = null, translatedData = null, rollbackUpdate = null}) {
        return new ActorTranslationEntry({
            documentType,
            item,
            source,
            pack,
            translatedData,
            translated: false,
            alreadyTranslated: true,
            rollbackUpdate,
        });
    }

    constructor({
        documentType,
        item,
        source,
        pack = null,
        translatedData = null,
        update = null,
        translated = false,
        alreadyTranslated = false,
        changed = false,
        userChanged = false,
        candidates = [],
        rollbackUpdate = null,
    }) {
        this.documentType = documentType;
        this.item = item;
        this.source = source;
        this.pack = pack;
        this.translatedData = translatedData;
        this.#fallbackUpdate = update;
        this.translated = translated;
        this.alreadyTranslated = alreadyTranslated;
        this.#fallbackChanged = changed;
        this.#fallbackUserChanged = userChanged;
        this.candidates = candidates;
        this.selectedCandidateId = candidates[0]?.id ?? null;
        this.#rollbackUpdate = rollbackUpdate;
        this.currentMode = this.#defaultMode();
    }

    #fallbackUpdate
    #fallbackChanged
    #fallbackUserChanged
    #rollbackUpdate

    get update() {
        return this.rollbackMode() ? this.#rollbackUpdate : this.selectedCandidate()?.update ?? this.#fallbackUpdate;
    }

    get changed() {
        return this.rollbackMode() ? !!this.#rollbackUpdate : this.selectedCandidate()?.changed ?? this.#fallbackChanged;
    }

    get userChanged() {
        return this.rollbackMode() ? false : this.selectedCandidate()?.userChanged ?? this.#fallbackUserChanged;
    }

    /**
     * @returns {string}
     */
    name() {
        return this.source?.flags?.babele?.originalName
            ?? this.source?.originalName
            ?? this.source?.name
            ?? this.item?.name
            ?? "";
    }

    /**
     * @returns {string}
     */
    id() {
        return String(this.item?.id ?? this.source?._id ?? this.name());
    }

    /**
     * @returns {string}
     */
    proposedName() {
        return this.selectedCandidate()?.proposedName(this.name())
            ?? this.update?.name
            ?? this.translatedData?.name
            ?? this.name();
    }

    /**
     * @returns {string}
     */
    currentName() {
        return this.source?.name
            ?? this.item?.name
            ?? "";
    }

    /**
     * @returns {string}
     */
    translationLanguage() {
        return this.source?.flags?.babele?.lang
            ?? this.item?.getFlag?.("babele", "lang")
            ?? "";
    }

    /**
     * @returns {string}
     */
    type() {
        return this.source?.type ?? this.item?.type ?? "";
    }

    /**
     * @returns {string}
     */
    packLabel() {
        return this.selectedCandidate()?.packLabel()
            ?? this.pack?.metadata?.label
            ?? this.pack?.metadata?.name
            ?? this.pack?.metadata?.collection
            ?? "";
    }

    /**
     * @returns {boolean}
     */
    hasTranslation() {
        return this.translated || this.alreadyTranslated;
    }

    reviewRequired() {
        if (this.rollbackMode()) {
            return false;
        }
        return this.selectedCandidate()?.reviewRequired() === true;
    }

    /**
     * @returns {boolean}
     */
    applicable() {
        if (this.rollbackMode()) {
            return !!this.#rollbackUpdate;
        }

        if (this.alreadyTranslated) {
            return this.translated && !!this.update;
        }

        return this.translated && this.changed && !!this.update;
    }

    rollbackMode() {
        return this.currentMode === "rollback";
    }

    modeChoices() {
        const choices = [];
        if (this.translated) {
            choices.push("retranslate");
        }
        if (this.#rollbackUpdate) {
            choices.push("rollback");
        }
        return choices;
    }

    selectMode(mode) {
        if (!this.modeChoices().includes(mode)) {
            return false;
        }

        this.currentMode = mode;
        return true;
    }

    rollbackName() {
        return this.name();
    }

    selectedCandidate() {
        return this.candidates.find((candidate) => candidate.id === this.selectedCandidateId) ?? null;
    }

    selectedPackKey() {
        return this.selectedCandidate()?.packKey() ?? null;
    }

    selectPack(packKey) {
        const candidate = this.candidates.find((entry) => entry.packKey() === packKey) ?? null;
        if (!candidate) {
            return false;
        }

        this.selectedCandidateId = candidate.id;
        return true;
    }

    selectCandidate(candidateId) {
        if (!this.candidates.some((candidate) => candidate.id === candidateId)) {
            return false;
        }

        this.selectedCandidateId = candidateId;
        return true;
    }

    #defaultMode() {
        if (!this.alreadyTranslated) {
            return "retranslate";
        }

        if (this.translated) {
            return "retranslate";
        }

        return this.#rollbackUpdate ? "rollback" : "retranslate";
    }
}
