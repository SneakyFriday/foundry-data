/**
 * Applies declarative post-translation ordering to embedded document arrays.
 *
 * The sorter intentionally knows nothing about JournalEntry pages, DnD, or a
 * specific language. Translation modules can provide the language/editorial
 * policy through converter params or through a per-entry `$sort` directive in
 * the translated collection payload.
 */
export class DocumentCollectionSort {

    #policy;

    constructor(policy = null) {
        this.#policy = this.#normalizePolicy(policy);
    }

    static from(...policies) {
        const policy = policies.reduce((out, item) => {
            if (!item) {
                return out;
            }

            return foundry.utils.mergeObject(out ?? {}, DocumentCollectionSort.policyData(item), {inplace: false});
        }, null);

        return new DocumentCollectionSort(policy);
    }

    static policyData(policy) {
        if (policy === true || policy === "localizedName" || policy === "name") {
            return {by: "name"};
        }

        if (policy === "sort" || policy === "sourceSort") {
            return {by: "sort", mode: "numeric", assign: false};
        }

        return policy && typeof policy === "object" && !Array.isArray(policy) ? policy : null;
    }

    get active() {
        return this.#policy !== null;
    }

    apply(values) {
        if (!this.active || !Array.isArray(values) || values.length < 2) {
            return values;
        }

        const sorted = this.#sortValues(values, this.#policy);
        return this.#policy.assign === false ? sorted : this.#assignSort(sorted, this.#policy);
    }

    #normalizePolicy(policy) {
        const data = DocumentCollectionSort.policyData(policy);
        if (!data) {
            return null;
        }

        const first = this.#stringArray(data.first ?? data.firstIds);
        const order = this.#stringArray(data.order ?? data.ids);
        const by = data.by ?? data.path ?? (order.length ? null : "name");

        const normalized = {
            by,
            idPath: data.idPath ?? "_id",
            mode: data.mode ?? (by === "sort" ? "numeric" : "locale"),
            locale: data.locale ?? globalThis.game?.i18n?.lang ?? undefined,
            direction: data.direction === "desc" ? -1 : 1,
            first,
            order,
            groups: [],
            assign: data.assign !== false,
            sortPath: data.sortPath ?? "sort",
            sortStart: Number.isFinite(data.sortStart) ? data.sortStart : 1000,
            sortStep: Number.isFinite(data.sortStep) ? data.sortStep : 1000,
            ignoreLeadingWords: this.#stringArray(data.ignoreLeadingWords),
            ignoreLeadingPrefixes: this.#stringArray(data.ignoreLeadingPrefixes),
            ignoreWords: this.#stringArray(data.ignoreWords),
            ignoreCase: data.ignoreCase !== false,
        };

        normalized.groups = Array.isArray(data.groups)
            ? data.groups.map((group) => this.#normalizeGroup(group, normalized))
            : [];

        return normalized;
    }

    #normalizeGroup(group = {}, parentPolicy) {
        return {
            parent: group.parent ?? group.after ?? null,
            ids: this.#stringArray(group.ids ?? group.pages),
            range: this.#stringArray(group.range),
            sort: group.sort === false
                ? false
                : this.#normalizePolicy(foundry.utils.mergeObject(
                    this.#sortOnlyPolicy(parentPolicy),
                    DocumentCollectionSort.policyData(group.sort ?? {}) ?? {},
                    {inplace: false},
                )),
        };
    }

    #sortOnlyPolicy(policy) {
        return {
            by: policy.by,
            idPath: policy.idPath,
            mode: policy.mode,
            locale: policy.locale,
            direction: policy.direction === -1 ? "desc" : "asc",
            ignoreLeadingWords: policy.ignoreLeadingWords,
            ignoreLeadingPrefixes: policy.ignoreLeadingPrefixes,
            ignoreWords: policy.ignoreWords,
            ignoreCase: policy.ignoreCase,
            assign: false,
        };
    }

    #stringArray(value) {
        return Array.isArray(value)
            ? value.filter((item) => typeof item === "string" && item.length)
            : [];
    }

    #sortValues(values, policy) {
        const first = this.#takeByIds(values, policy.first, policy);
        let remaining = values.filter((value) => !first.includes(value));
        remaining = this.#sortGroup(remaining, policy);
        remaining = this.#applyGroups(remaining, policy);
        return [...first, ...remaining];
    }

    #takeByIds(values, ids, policy) {
        return ids.map((id) => values.find((value) => this.#idFor(value, policy) === id)).filter(Boolean);
    }

    #sortGroup(values, policy) {
        const order = new Map(policy.order.map((id, index) => [id, index]));
        return values
            .map((value, index) => ({value, index}))
            .sort((left, right) => this.#compareEntries(left, right, policy, order))
            .map((entry) => entry.value);
    }

    #compareEntries(left, right, policy, order = new Map()) {
        const leftOrder = order.get(this.#idFor(left.value, policy));
        const rightOrder = order.get(this.#idFor(right.value, policy));

        if (Number.isInteger(leftOrder) || Number.isInteger(rightOrder)) {
            if (!Number.isInteger(leftOrder)) return 1;
            if (!Number.isInteger(rightOrder)) return -1;
            if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        }

        const compared = this.#compareByPath(left.value, right.value, policy);
        return compared !== 0 ? compared : left.index - right.index;
    }

    #compareByPath(left, right, policy) {
        if (!policy.by) {
            return 0;
        }

        const leftValue = foundry.utils.getProperty(left, policy.by);
        const rightValue = foundry.utils.getProperty(right, policy.by);

        if (policy.mode === "numeric") {
            return policy.direction * ((Number(leftValue) || 0) - (Number(rightValue) || 0));
        }

        return policy.direction * this.#collator(policy).compare(
            this.#sortText(leftValue, policy),
            this.#sortText(rightValue, policy),
        );
    }

    #collator(policy) {
        return new Intl.Collator(policy.locale, {
            sensitivity: "base",
            numeric: true,
        });
    }

    #sortText(value, policy) {
        let text = String(value ?? "").trim();
        if (policy.ignoreCase) {
            text = text.toLocaleLowerCase(policy.locale);
        }

        for (const prefix of policy.ignoreLeadingPrefixes) {
            if (text.startsWith(prefix.toLocaleLowerCase(policy.locale))) {
                text = text.slice(prefix.length).trimStart();
                break;
            }
        }

        const words = policy.ignoreLeadingWords.map((word) => word.toLocaleLowerCase(policy.locale));
        while (words.length) {
            const [first, ...rest] = text.split(/\s+/);
            if (!words.includes(first)) {
                break;
            }

            text = rest.join(" ").trimStart();
        }

        for (const word of policy.ignoreWords) {
            text = text.replace(this.#ignoreWordPattern(word, policy), " ");
        }

        return text.replace(/\s+/g, " ").trim();
    }

    #ignoreWordPattern(word, policy) {
        const escaped = this.#escapeRegex(word.toLocaleLowerCase(policy.locale)).replace(/\s+/g, "\\s+");
        const startsWithWord = /^\p{L}|\d/u.test(word);
        const endsWithWord = /\p{L}|\d$/u.test(word);
        const start = startsWithWord ? "\\b" : "";
        const end = endsWithWord ? "\\b" : "";
        return new RegExp(`${start}${escaped}${end}\\s*`, "giu");
    }

    #escapeRegex(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    #applyGroups(values, policy) {
        return policy.groups.reduce((out, group) => this.#applyGroup(out, group, policy), values);
    }

    #applyGroup(values, group, parentPolicy) {
        if (!group.parent) {
            return values;
        }

        const parentIndex = values.findIndex((value) => this.#idFor(value, parentPolicy) === group.parent);
        if (parentIndex === -1) {
            return values;
        }

        const ids = group.range.length === 2 ? this.#rangeIds(values, group.range, parentPolicy) : group.ids;
        if (!ids.length) {
            return values;
        }

        const grouped = this.#takeByIds(values, ids, parentPolicy);
        if (!grouped.length) {
            return values;
        }

        const sortedGroup = group.sort === false ? grouped : this.#sortGroup(grouped, group.sort);
        const before = values.slice(0, parentIndex + 1).filter((value) => !grouped.includes(value));
        const after = values.slice(parentIndex + 1).filter((value) => !grouped.includes(value));
        return [...before, ...sortedGroup, ...after];
    }

    #rangeIds(values, range, policy) {
        const start = values.findIndex((value) => this.#idFor(value, policy) === range[0]);
        const end = values.findIndex((value) => this.#idFor(value, policy) === range[1]);
        if (start === -1 || end === -1) {
            return [];
        }

        const [from, to] = start <= end ? [start, end] : [end, start];
        return values.slice(from, to + 1).map((value) => this.#idFor(value, policy));
    }

    #idFor(value, policy) {
        const id = foundry.utils.getProperty(value, policy.idPath) ?? value?.id ?? null;
        return id === null || typeof id === "undefined" ? null : String(id);
    }

    #assignSort(values, policy) {
        return values.map((value, index) => {
            const sortValue = policy.sortStart + (index * policy.sortStep);
            return foundry.utils.mergeObject(
                value,
                this.#objectAtPath(policy.sortPath, sortValue),
                {inplace: false},
            );
        });
    }

    #objectAtPath(path, value) {
        const keys = String(path ?? "").split(".").filter((key) => key.length);
        return keys.reduceRight((out, key) => ({[key]: out}), value);
    }
}
