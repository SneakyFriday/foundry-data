import { fetchParams } from "./dae.js";
import { migrateWorld } from "./migration.js";
export const registerSettings = async function () {
    game.settings.register("dae", "DependentConditions", {
        name: "dae.DependentConditions.Name",
        hint: "dae.DependentConditions.Hint",
        scope: "world",
        default: true,
        type: Boolean,
        config: true,
        onChange: fetchParams
    });
    game.settings.register("dae", "noDupDamageMacro", {
        name: "dae.noDupDamageMacro.Name",
        hint: "dae.noDupDamageMacro.Hint",
        scope: "world",
        default: false,
        type: Boolean,
        config: true,
        onChange: fetchParams
    });
    game.settings.register("dae", "showInline", {
        scope: "client",
        name: "dae.ShowInline.Name",
        hint: "dae.ShowInline.Hint",
        default: false,
        config: true,
        type: Boolean,
        onChange: fetchParams
    });
    game.settings.register("dae", "DAETitleBar", {
        name: "dae.DAETitleBar.Name",
        hint: "dae.DAETitleBar.Hint",
        scope: "world",
        default: true,
        type: Boolean,
        config: true,
        onChange: fetchParams
    });
    game.settings.register("dae", "DIMETitleBar", {
        name: "dae.DIMETitleBar.Name",
        hint: "dae.DIMETitleBar.Hint",
        scope: "world",
        default: true,
        type: Boolean,
        config: true,
        onChange: fetchParams
    });
    game.settings.register("dae", "DAEColorTitleBar", {
        name: "dae.DAEColorTitleBar.Name",
        hint: "dae.DAEColorTitleBar.Hint",
        scope: "world",
        default: true,
        type: Boolean,
        config: true,
        onChange: fetchParams
    });
    game.settings.register("dae", "DAENoTitleText", {
        name: "dae.DAENoTitleText.Name",
        hint: "dae.DAENoTitleText.Hint",
        scope: "world",
        default: false,
        type: Boolean,
        config: true,
        onChange: fetchParams
    });
    game.settings.register("dae", "DAEAddHalfHealthEffect", {
        name: "dae.DAEAddHalfHealthEffect.Name",
        hint: "dae.DAEAddHalfHealthEffect.Hint",
        scope: "world",
        default: false,
        type: Boolean,
        config: true,
        onChange: fetchParams,
        requiresReload: true
    });
    game.settings.register("dae", "DAEUntestedSystems", {
        name: "dae.DAEUntestedSystems.Name",
        hint: "dae.DAEUntestedSystems.Hint",
        scope: "world",
        default: false,
        type: Boolean,
        config: true,
        onChange: fetchParams
    });
    game.settings.register("dae", "ZZDebug", {
        name: "dae.Debug.Name",
        hint: "dae.Debug.Hint",
        scope: "world",
        default: "none",
        type: String,
        config: true,
        onChange: fetchParams,
        choices: { none: "None", warn: "warnings", debug: "debug", all: "all" }
    });
    game.settings.register("dae", "initMacrosOnLoad", {
        name: "dae.InitMacrosOnLoad.Name",
        hint: "dae.InitMacrosOnLoad.Hint",
        scope: "world",
        default: true,
        type: Boolean,
        config: true,
        requiresReload: true
    });
    game.settings.register("dae", "disableEffects", {
        name: "dae.DisableEffects.Name",
        hint: "dae.DisableEffects.Hint",
        scope: "world",
        default: false,
        type: Boolean,
        config: true,
        requiresReload: true
    });
    game.settings.register("dae", "expireRoundEffectsOnCombatEnd", {
        name: "dae.expireRoundEffectsOnCombatEnd.Name",
        hint: "dae.expireRoundEffectsOnCombatEnd.Hint",
        scope: "world",
        default: false,
        type: Boolean,
        config: true,
        onChange: fetchParams
    });
    game.settings.register("dae", "expiryAction", {
        name: "dae.expiryAction.Name",
        hint: "dae.expiryAction.Hint",
        scope: "world",
        default: "default",
        type: String,
        config: true,
        choices: {
            "default": "dae.expiryAction.default",
            "delete": "dae.expiryAction.delete",
            "update": "dae.expiryAction.update"
        },
        onChange: fetchParams
    });
    game.settings.register("dae", "coreExpiryAction", {
        name: "dae.coreExpiryAction.Name",
        hint: "dae.coreExpiryAction.Hint",
        scope: "world",
        default: "update",
        type: String,
        config: true,
        choices: {
            "update": "dae.coreExpiryAction.update",
            "delete": "dae.coreExpiryAction.delete",
            "none": "dae.coreExpiryAction.none"
        },
        requiresReload: true
    });
    game.settings.register("dae", "enableAutoMigration", {
        name: "dae.EnableAutoMigration.Name",
        hint: "dae.EnableAutoMigration.Hint",
        scope: "world",
        default: false,
        type: Boolean,
        config: true,
    });
    // ATL → native v14 token.* migration policy.
    // - legacy : ATL.* keys passed through to the ATL module (current behavior).
    // - runtime: Layer B only — rewrite ATL.* keys to token.* at apply time; effects on disk
    //            are untouched. Cheap, no migration commitment.
    // - migrate: Layers A + C — bulk-migrate world data once, plus pre-write normalisation for
    //            anything saved later. No runtime fallback, so unmigrated compendium content
    //            still needs ATL until edited (or until the user switches to "full").
    // - full   : Layers A + B + C — bulk migration + pre-write + runtime fallback.
    game.settings.register("dae", "atlCompatibility", {
        name: "dae.AtlCompatibility.Name",
        hint: "dae.AtlCompatibility.Hint",
        scope: "world",
        default: "legacy",
        type: String,
        config: true,
        choices: {
            "legacy": "dae.AtlCompatibility.legacy",
            "runtime": "dae.AtlCompatibility.runtime",
            "migrate": "dae.AtlCompatibility.migrate",
            "full": "dae.AtlCompatibility.full",
        },
        onChange: fetchParams,
        requiresReload: true,
    });
    game.settings.register("dae", "migrationVersion", {
        scope: "world",
        default: "",
        type: String,
        config: false,
    });
};
async function showMigrationDialog() {
    const lastVersion = game.settings.get("dae", "migrationVersion") || "Never";
    const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "DAE Migration" },
        content: `<p style="color: #d32f2f; font-weight: bold; font-size: 1.1em;">⚠ This migration cannot be undone. Make sure you have backed up your world before running!</p>`
            + `<p>Migrate all world actors, items, scene tokens, and compendium packs to update deprecated DAE effect data.</p>`
            + `<p><strong>Last migration:</strong> ${lastVersion}</p>`
            + `<p>This will update: <code>flags.dae.showIcon</code>, deprecated special durations, old change key paths, and missing <code>.all</code> suffixes on optional bonus keys.</p>`,
        yes: { label: "Run Migration", icon: "fas fa-exchange-alt" },
        no: { label: "Cancel" },
    });
    if (confirmed)
        await migrateWorld();
}
Hooks.on("renderSettingsConfig", (app, html) => {
    if (!game.user?.isGM)
        return;
    const autoMigrationInput = html.querySelector(`[name="dae.enableAutoMigration"]`);
    if (!autoMigrationInput)
        return;
    const formGroup = autoMigrationInput.closest(".form-group");
    if (!formGroup)
        return;
    const buttonGroup = document.createElement("div");
    buttonGroup.classList.add("form-group");
    buttonGroup.innerHTML = `
    <label>${game.i18n.localize("dae.MigrateNow.Name")}</label>
    <div class="form-fields">
      <button type="button" data-action="dae-migrate-now">
        <i class="fas fa-exchange-alt"></i> ${game.i18n.localize("dae.MigrateNow.Label")}
      </button>
    </div>
    <p class="notes">${game.i18n.localize("dae.MigrateNow.Hint")}</p>`;
    buttonGroup.querySelector("button").addEventListener("click", (e) => {
        e.preventDefault();
        showMigrationDialog();
    });
    formGroup.after(buttonGroup);
});
