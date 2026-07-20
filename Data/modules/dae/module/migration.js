import { MODULE_ID } from "../dae.js";
import { deprecatedKeyPatterns } from "./dae.js";
import { getDeprecatedSpecialDurMap } from "./specialDurations.js";
import { rewriteAtlChanges, coerceOverrideOnlyChangeTypes } from "./atlMigration.js";
const fieldMappings = {
    "StatusEffect": "macro.StatusEffect",
    "system.traits.di.all": { key: "system.traits.di.value", value: "ALL", type: "add" },
    "system.traits.dr.all": { key: "system.traits.dr.value", value: "ALL", type: "add" },
    "system.traits.dv.all": { key: "system.traits.dv.value", value: "ALL", type: "add" },
};
/**
 * Compute a migration delta for a single effect's data object.
 * Returns null if no migration is needed.
 * This is the core function — usable for testing individual effects.
 *
 * @param options.atl  If true, also rewrite ATL.* change keys to native v14 token.*
 *                     (driven by the "dae.atlCompatibility" setting being "migrate" or "full").
 */
export function migrateEffectData(effectData, options = {}) {
    const update = {};
    // 1. flags.dae.showIcon → ActiveEffect.showIcon
    if (effectData.flags?.dae?.showIcon) {
        update["showIcon"] = 2;
        update["flags.dae.-=showIcon"] = null;
    }
    // 2. Deprecated special durations → duration.expiry
    const specialDurs = effectData.flags?.dae?.specialDuration ?? [];
    const deprecatedSpecialDurMap = getDeprecatedSpecialDurMap();
    const deprecatedDurs = specialDurs.filter(sd => sd in deprecatedSpecialDurMap);
    if (deprecatedDurs.length > 0) {
        const expiry = deprecatedSpecialDurMap[deprecatedDurs[0]];
        update["flags.dae.specialDuration"] = specialDurs.filter(sd => !(sd in deprecatedSpecialDurMap));
        update["duration.expiry"] = expiry;
    }
    // 3-5. Change key migrations
    const changes = effectData.system?.changes ?? effectData.changes ?? [];
    let changesModified = false;
    const newChanges = changes.map((c) => {
        const change = foundry.utils.deepClone(c);
        let modified = false;
        // 3. Field mappings
        const mapping = fieldMappings[change.key];
        if (mapping) {
            if (typeof mapping === "string") {
                change.key = mapping;
            }
            else {
                change.key = mapping.key;
                if (mapping.value !== undefined)
                    change.value = mapping.value;
                if (mapping.type !== undefined)
                    change.type = mapping.type;
            }
            modified = true;
        }
        // 4. Old data. prefix patterns
        if (!modified) {
            for (const { pattern, replacement } of deprecatedKeyPatterns) {
                const match = change.key.match(pattern);
                if (match) {
                    change.key = replacement(match[1]);
                    modified = true;
                    break;
                }
            }
        }
        // 5. midi-qol optional missing .all suffix
        if (!modified && change.key.startsWith("flags.midi-qol.optional")) {
            const parts = change.key.split(".");
            if (parts.length === 5 && ["save", "check", "skill", "damage", "attack"].includes(parts[4])) {
                change.key = `${change.key}.all`;
                modified = true;
            }
        }
        if (modified)
            changesModified = true;
        return change;
    });
    // ATL → token.* rewriting. Done after the existing transformations so it operates on the
    // already-normalised key list (e.g. won't double-rewrite if an earlier mapping changed the key).
    let finalChanges = newChanges;
    if (options.atl) {
        const rewritten = rewriteAtlChanges(newChanges);
        if (rewritten !== newChanges) {
            finalChanges = rewritten;
            changesModified = true;
        }
    }
    // Coerce picker-only keys (e.g. token.sight.visionMode) to type "override". Runs always —
    // v14's default change type "add" concatenates strings and silently breaks these fields.
    const coerced = coerceOverrideOnlyChangeTypes(finalChanges);
    if (coerced !== finalChanges) {
        finalChanges = coerced;
        changesModified = true;
    }
    if (changesModified) {
        // v14 effects use system.changes, older use changes
        const changesKey = effectData.system?.changes ? "system.changes" : "changes";
        update[changesKey] = finalChanges;
    }
    return Object.keys(update).length > 0 ? update : null;
}
/**
 * Migrate all effects on a single actor (both direct effects and item-embedded effects).
 * Returns a summary of what was migrated.
 */
export async function migrateActor(actor, options = {}) {
    let effectsMigrated = 0;
    const errors = [];
    // Migrate actor's direct effects
    const effectUpdates = [];
    for (const effect of actor.effects) {
        try {
            const effectData = effect.toObject();
            const delta = migrateEffectData(effectData, options);
            if (delta) {
                delta._id = effect.id;
                effectUpdates.push(delta);
                console.log(`dae | migration | Actor "${actor.name}" effect "${effect.name}": ${Object.keys(delta).filter(k => k !== "_id").join(", ")}`);
            }
        }
        catch (err) {
            errors.push(`Effect "${effect.name}" on actor "${actor.name}": ${err.message}`);
        }
    }
    if (effectUpdates.length > 0) {
        try {
            await actor.updateEmbeddedDocuments("ActiveEffect", effectUpdates, { render: false });
            effectsMigrated += effectUpdates.length;
        }
        catch (err) {
            errors.push(`Actor "${actor.name}" effect batch update: ${err.message}`);
        }
    }
    // Migrate effects on actor's items
    for (const item of actor.items) {
        const itemEffectUpdates = [];
        for (const effect of item.effects) {
            try {
                const effectData = effect.toObject();
                const delta = migrateEffectData(effectData, options);
                if (delta) {
                    delta._id = effect.id;
                    itemEffectUpdates.push(delta);
                    console.log(`dae | migration | Actor "${actor.name}" item "${item.name}" effect "${effect.name}": ${Object.keys(delta).filter(k => k !== "_id").join(", ")}`);
                }
            }
            catch (err) {
                errors.push(`Effect "${effect.name}" on item "${item.name}" (actor "${actor.name}"): ${err.message}`);
            }
        }
        if (itemEffectUpdates.length > 0) {
            try {
                await item.updateEmbeddedDocuments("ActiveEffect", itemEffectUpdates, { render: false });
                effectsMigrated += itemEffectUpdates.length;
            }
            catch (err) {
                errors.push(`Item "${item.name}" (actor "${actor.name}") effect batch update: ${err.message}`);
            }
        }
    }
    return { effectsMigrated, errors };
}
/**
 * Migrate all effects on a single world item.
 */
export async function migrateItem(item, options = {}) {
    let effectsMigrated = 0;
    const errors = [];
    const effectUpdates = [];
    for (const effect of item.effects) {
        try {
            const effectData = effect.toObject();
            const delta = migrateEffectData(effectData, options);
            if (delta) {
                delta._id = effect.id;
                effectUpdates.push(delta);
                console.log(`dae | migration | Item "${item.name}" effect "${effect.name}": ${Object.keys(delta).filter(k => k !== "_id").join(", ")}`);
            }
        }
        catch (err) {
            errors.push(`Effect "${effect.name}" on item "${item.name}": ${err.message}`);
        }
    }
    if (effectUpdates.length > 0) {
        try {
            await item.updateEmbeddedDocuments("ActiveEffect", effectUpdates, { render: false });
            effectsMigrated += effectUpdates.length;
        }
        catch (err) {
            errors.push(`Item "${item.name}" effect batch update: ${err.message}`);
        }
    }
    return { effectsMigrated, errors };
}
/**
 * Check whether a compendium pack should be migrated.
 * World compendiums always, system never, module only if no download/manifest URL (local dev).
 */
function shouldMigrateCompendium(pack) {
    if (!["Actor", "Item", "ActiveEffect"].includes(pack.documentName))
        return false;
    if (pack.metadata.packageType === "world")
        return true;
    if (pack.metadata.packageType === "system")
        return false;
    const module = game.modules.get(pack.metadata.packageName);
    return !module?.download && !module?.manifest;
}
/**
 * Run the full world migration — all actors, world items, scene tokens, and compendium packs.
 *
 * Reads `dae.atlCompatibility` to decide whether to also rewrite ATL.* keys to native v14
 * token.* keys ("migrate" or "full" enables the rewrite; "full" additionally unlocks locked
 * compendiums for migration).
 */
export async function migrateWorld() {
    // Only the active GM should run the migration. Foundry designates one GM as "active" for
    // write operations; if two GMs are logged in, isGM returns true on both, but isActiveGM
    // identifies the single client that should own world-mutating tasks.
    if (!game.user?.isActiveGM) {
        if (game.user?.isGM) {
            console.log(`dae | migration | Skipping on non-active GM "${game.user.name}"; the active GM will run it.`);
        }
        else {
            ui.notifications?.error("DAE | Only a GM can run the migration.");
        }
        return { actorsMigrated: 0, itemsMigrated: 0, effectsMigrated: 0, errors: ["Not active GM"] };
    }
    const atlCompat = game.settings.get(MODULE_ID, "atlCompatibility") ?? "legacy";
    const atl = atlCompat === "migrate" || atlCompat === "full";
    const unlockLockedCompendiums = atlCompat === "full";
    const migrateOptions = { atl };
    const result = { actorsMigrated: 0, itemsMigrated: 0, effectsMigrated: 0, errors: [] };
    const packsToMigrate = game.packs.filter(p => shouldMigrateCompendium(p));
    const unlinkedTokenCount = game.scenes.reduce((n, s) => n + s.tokens.filter(t => !t.actorLink && !!t.actor).length, 0);
    const packDocCount = packsToMigrate.reduce((n, p) => n + p.index.size, 0);
    const totalDocuments = game.actors.size + game.items.size + unlinkedTokenCount + packDocCount;
    let migrated = 0;
    const progress = ui.notifications?.info("DAE | Migration started...", {
        console: false, permanent: true, progress: true
    });
    // Migrate world actors
    for (const actor of game.actors) {
        try {
            const { effectsMigrated, errors } = await migrateActor(actor, migrateOptions);
            if (effectsMigrated > 0) {
                result.actorsMigrated++;
                result.effectsMigrated += effectsMigrated;
            }
            result.errors.push(...errors);
        }
        catch (err) {
            result.errors.push(`Actor "${actor.name}": ${err.message}`);
        }
        migrated++;
        progress?.update({ pct: migrated / totalDocuments });
    }
    // Migrate world items
    for (const item of game.items) {
        try {
            const { effectsMigrated, errors } = await migrateItem(item, migrateOptions);
            if (effectsMigrated > 0) {
                result.itemsMigrated++;
                result.effectsMigrated += effectsMigrated;
            }
            result.errors.push(...errors);
        }
        catch (err) {
            result.errors.push(`Item "${item.name}": ${err.message}`);
        }
        migrated++;
        progress?.update({ pct: migrated / totalDocuments });
    }
    // Migrate unlinked token actors in scenes
    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            if (token.actorLink || !token.actor) {
                continue;
            }
            try {
                const { effectsMigrated, errors } = await migrateActor(token.actor, migrateOptions);
                if (effectsMigrated > 0) {
                    result.actorsMigrated++;
                    result.effectsMigrated += effectsMigrated;
                }
                result.errors.push(...errors);
            }
            catch (err) {
                result.errors.push(`Scene "${scene.name}" token "${token.name}": ${err.message}`);
            }
            migrated++;
            progress?.update({ pct: migrated / totalDocuments });
        }
    }
    // Migrate compendium packs
    for (const pack of packsToMigrate) {
        let packEffectsMigrated = 0;
        let lockedHere = false;
        // For "full" mode, auto-unlock locked compendiums so writes succeed; relock when done.
        if (unlockLockedCompendiums && pack.locked) {
            try {
                await pack.configure({ locked: false });
                lockedHere = true;
            }
            catch (err) {
                result.errors.push(`Compendium "${pack.metadata.label}" unlock: ${err.message}`);
            }
        }
        else if (pack.locked) {
            // "migrate" mode — skip locked compendiums silently (they need user action or "full").
            console.log(`dae | migration | Compendium "${pack.metadata.label}": skipped (locked; set atlCompatibility="full" to auto-unlock)`);
            // Advance progress so the bar reflects skipped packs.
            migrated += pack.index.size;
            progress?.update({ pct: migrated / totalDocuments });
            continue;
        }
        try {
            const docs = await pack.getDocuments();
            for (const doc of docs) {
                try {
                    if (doc instanceof CONFIG.Actor.documentClass) {
                        const { effectsMigrated, errors } = await migrateActor(doc, migrateOptions);
                        if (effectsMigrated > 0) {
                            result.actorsMigrated++;
                            result.effectsMigrated += effectsMigrated;
                            packEffectsMigrated += effectsMigrated;
                        }
                        result.errors.push(...errors);
                    }
                    else if (doc instanceof CONFIG.Item.documentClass) {
                        const { effectsMigrated, errors } = await migrateItem(doc, migrateOptions);
                        if (effectsMigrated > 0) {
                            result.itemsMigrated++;
                            result.effectsMigrated += effectsMigrated;
                            packEffectsMigrated += effectsMigrated;
                        }
                        result.errors.push(...errors);
                    }
                    else if (doc instanceof CONFIG.ActiveEffect.documentClass) {
                        const effectData = doc.toObject();
                        const delta = migrateEffectData(effectData, migrateOptions);
                        if (delta) {
                            console.log(`dae | migration | Compendium "${pack.metadata.label}" effect "${doc.name}": ${Object.keys(delta).join(", ")}`);
                            await doc.update(delta, { render: false });
                            result.effectsMigrated++;
                            packEffectsMigrated++;
                        }
                    }
                }
                catch (err) {
                    result.errors.push(`Compendium "${pack.metadata.label}" doc "${doc.name}": ${err.message}`);
                }
                migrated++;
                progress?.update({ pct: migrated / totalDocuments });
            }
        }
        catch (err) {
            result.errors.push(`Compendium "${pack.metadata.label}": ${err.message}`);
        }
        finally {
            // Re-lock if we unlocked it ourselves.
            if (lockedHere) {
                try {
                    await pack.configure({ locked: true });
                }
                catch (err) {
                    result.errors.push(`Compendium "${pack.metadata.label}" relock: ${err.message}`);
                }
            }
        }
        if (packEffectsMigrated === 0) {
            console.log(`dae | migration | Compendium "${pack.metadata.label}": no deprecated data found`);
        }
    }
    // Update migration version
    await game.settings.set(MODULE_ID, "migrationVersion", game.modules.get(MODULE_ID).version);
    progress?.remove();
    if (result.errors.length > 0) {
        console.warn("dae | Migration completed with errors:", result.errors);
        ui.notifications?.warn(`DAE | Migration complete. ${result.effectsMigrated} effects migrated, ${result.errors.length} errors (see console).`);
    }
    else if (result.effectsMigrated > 0) {
        ui.notifications?.info(`DAE | Migration complete. ${result.effectsMigrated} effects migrated across ${result.actorsMigrated} actors and ${result.itemsMigrated} items.`);
    }
    else {
        ui.notifications?.info("DAE | Migration complete. No deprecated data found.");
    }
    return result;
}
/**
 * Check whether auto-migration should run on ready. Only the active GM runs it to avoid
 * concurrent writes when multiple GMs are logged in.
 */
export function shouldAutoMigrate() {
    if (!game.user?.isActiveGM)
        return false;
    if (!game.settings.get(MODULE_ID, "enableAutoMigration"))
        return false;
    const lastVersion = game.settings.get(MODULE_ID, "migrationVersion");
    const currentVersion = game.modules.get(MODULE_ID).version;
    if (!lastVersion)
        return true;
    return foundry.utils.isNewerVersion(currentVersion, lastVersion);
}
