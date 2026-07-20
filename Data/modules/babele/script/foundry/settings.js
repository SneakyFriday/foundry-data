
import {SourcePrioritySettings} from "../ui/source-priority-settings.js";

function localizeWithFallback(key, fallback) {
    const localized = game.i18n.localize(key);
    return localized === key ? fallback : localized;
}

/**
 * Register Foundry module settings.
 *
 * This module is intentionally coupled to `game.babele` because it reacts to
 * user-driven Foundry settings changes and delegates runtime refresh/reinit to
 * the public facade.
 */
export function registerModuleSettings() {

    game.settings.register('babele', 'directory', {
        name: game.i18n.localize("BABELE.TranslationDirTitle"),
        hint: game.i18n.localize("BABELE.TranslationDirHint"),
        type: String,
        scope: 'world',
        config: true,
        filePicker: "folder",
        default: '',
        onChange: () => {
            if (!game.user.isGM) {
                return;
            }

            void game.babele?.refreshTranslationSources?.();
        }
    });

    game.settings.register('babele', 'export', {
        name: game.i18n.localize("BABELE.EnableTranslationExportTile"),
        hint: game.i18n.localize("BABELE.EnableTranslationExportHint"),
        scope: 'world',
        type: Boolean,
        config: true,
        default: true
    });

    game.settings.register('babele', 'showOriginalName', {
        name: game.i18n.localize("BABELE.ShowOriginalName"),
        hint: game.i18n.localize("BABELE.ShowOriginalNameHint"),
        scope: 'client',
        type: Boolean,
        config: true,
        default: false
    });

    game.settings.register('babele', 'showTranslateOption', {
        name: game.i18n.localize("BABELE.ShowTranslateOption"),
        hint: game.i18n.localize("BABELE.ShowTranslateOptionHint"),
        scope: 'client',
        type: Boolean,
        config: true,
        default: true
    });

    game.settings.register('babele', 'syncImportedAdventureTokenNames', {
        name: localizeWithFallback("BABELE.SyncImportedAdventureTokenNames", "Sync imported Adventure token names"),
        hint: localizeWithFallback(
            "BABELE.SyncImportedAdventureTokenNamesHint",
            "When importing an Adventure, update token names only for tokens in imported Scenes whose Actors were imported by that same Adventure.",
        ),
        scope: 'world',
        type: Boolean,
        config: true,
        default: true,
    });

    game.settings.register('babele', 'warnMissingPaths', {
        name: game.i18n.localize("BABELE.WarnMissingPaths"),
        hint: game.i18n.localize("BABELE.WarnMissingPathsHint"),
        scope: 'client',
        type: Boolean,
        config: true,
        default: false
    });

    game.settings.register('babele', 'translationFiles', {
        type: Array,
        default: [],
        scope: 'world',
        config: false
    });

    game.settings.register('babele', 'mappingFiles', {
        type: Array,
        default: [],
        scope: 'world',
        config: false
    });

    game.settings.register('babele', 'sourcePriority', {
        type: Object,
        default: {},
        scope: 'world',
        config: false,
        onChange: () => {
            if (!game.user.isGM) {
                return;
            }

            void game.babele?.refreshTranslationSources?.();
        },
    });

    game.settings.registerMenu?.('babele', 'sourcePriorityMenu', {
        name: localizeWithFallback("BABELE.SourcePriorityTitle", "Translation Source Priority"),
        label: localizeWithFallback("BABELE.SourcePriorityOpen", "Configure Source Priority"),
        hint: localizeWithFallback("BABELE.SourcePriorityHint", "Choose the merge order when more than one translation source contributes to the same compendium."),
        icon: "fas fa-layer-group",
        type: SourcePrioritySettings,
        restricted: true,
    });

    game.settings.register('babele', 'sourcesRevision', {
        type: Number,
        default: 0,
        scope: 'world',
        config: false,
        onChange: () => {
            if (game.user.isGM) {
                return;
            }

            void game.babele?.reinitialize?.({
                shareSources: false,
                notify: true,
            });
        },
    });
}
