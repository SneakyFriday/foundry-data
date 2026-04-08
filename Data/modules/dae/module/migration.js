import { effectIsTransfer } from "./dae.js";
export async function cleanDAEArmorWorld() {
    await removeAllActorArmorItems();
    await removeAllTokenArmorItems();
}
export async function removeAllActorArmorItems() {
    let promises = [];
    if (game.actors)
        for (let actor of game.actors) {
            await removeActorArmorItems(actor);
        }
}
export async function removeAllTokenArmorItems() {
    let promises = [];
    if (game.scenes)
        for (let scene of game.scenes) {
            for (let tokenDocument of scene.tokens) {
                if (!tokenDocument.isLinked && tokenDocument.actor) {
                    await removeActorArmorItems(tokenDocument.actor);
                }
            }
        }
}
export async function removeActorArmorItems(actor) {
    let promises = [];
    for (let item of actor.items) {
        let toDelete = [];
        if (!item.effects)
            continue;
        for (let effect of item.effects) {
            for (let change of effect.changes) {
                if (change.key === "data.attributes.ac.value" && change.value === "AutoCalc") {
                    console.warn("Removing DAE Item ", actor.name, item.name, item.id);
                    if (item.id)
                        toDelete.push(item.id);
                }
            }
        }
        if (toDelete.length > 0) {
            await actor.deleteEmbeddedDocuments("Item", toDelete);
        }
    }
}
export async function cleanEffectOrigins(processItems = false) {
    await cleanAllActorEffectOrigins();
    await cleanAllTokenEffectOrigins();
    if (processItems) {
        await cleanAllActorItemsEffectOrigins();
        await cleanAllTokenEffectOrigins();
    }
}
export async function cleanAllActorEffectOrigins() {
    for (let actor of game.actors?.contents ?? []) {
        let ownedItemEffects = actor.effects.filter(ef => ef.origin?.includes("OwnedItem"));
        let updates = ownedItemEffects.map(ef => { return { _id: ef.id, origin: ef.origin?.replace("OwnedItem", "Item") }; });
        if (updates.length > 0) {
            await actor.updateEmbeddedDocuments("ActiveEffect", updates);
            console.warn("Updates are ", actor.name, updates);
        }
        const itemChanges = [];
        for (let item of actor.items) {
            if (!(item.effects.some(ef => ef.origin?.includes("OwnedItem"))))
                continue;
            const itemData = item.toObject(true);
            for (let effectData of itemData.effects)
                if (typeof effectData.origin === "string")
                    effectData.origin = effectData.origin.replace("OwnedItem", "Item");
            itemChanges.push(itemData);
        }
        if (itemChanges.length > 0) {
            await actor.updateEmbeddedDocuments("Item", itemChanges);
            console.warn("Item changes are", actor.name, itemChanges);
        }
    }
}
export async function cleanAllTokenItemEffectOrigins() {
    if (game.scenes)
        for (let scene of game.scenes) {
            if (scene.tokens)
                for (let tokenDocument of (scene.tokens)) {
                    if (!tokenDocument.isLinked && tokenDocument.actor) {
                        const actor = tokenDocument.actor;
                        cleanActorItemsEffectOrigins(actor);
                    }
                }
        }
}
export async function cleanAllActorItemsEffectOrigins() {
    if (game.actors)
        for (let actor of game.actors)
            await cleanActorItemsEffectOrigins(actor);
}
export async function cleanActorItemsEffectOrigins(actor) {
    const itemChanges = [];
    for (let item of actor.items) {
        if (!(item.effects.some(ef => !!ef.origin?.includes("OwnedItem"))))
            continue;
        const itemData = item.toObject(true);
        for (let effectData of itemData.effects)
            if (typeof effectData.origin === "string")
                effectData.origin = effectData.origin.replace("OwnedItem", "Item");
        itemChanges.push(itemData);
    }
    if (itemChanges.length > 0) {
        await actor.updateEmbeddedDocuments("Item", itemChanges);
        console.warn("Item changes are", actor.name, itemChanges);
    }
}
export async function cleanAllTokenEffectOrigins() {
    if (game.scenes)
        for (let scene of game.scenes) {
            for (let tokenDocument of scene.tokens) {
                if (!tokenDocument.isLinked && tokenDocument.actor) {
                    const actor = tokenDocument.actor;
                    let ownedItemEffects = actor.effects.filter(ef => !!ef.origin?.includes("OwnedItem"));
                    let updates = ownedItemEffects.map(ef => { return { _id: ef.id, origin: ef.origin?.replace("OwnedItem", "Item") }; });
                    if (updates.length > 0) {
                        await actor.updateEmbeddedDocuments("ActiveEffect", updates);
                    }
                }
            }
        }
}
export async function tobMapper(iconsPath = "icons/TOBTokens") {
    const pack = game.packs?.get("tome-of-beasts.beasts");
    await pack?.getDocuments();
    if (!pack)
        return;
    let details = pack?.contents.map(a => a._source);
    let detailNames = foundry.utils.duplicate(details).map(detail => {
        let name = detail.name
            .replace(/[_\-,'"]/g, "")
            .replace(" of", "")
            .replace(" the", "")
            .replace(/\(.*\)/, "")
            .replace(/\s\s*/g, " ")
            .replace("Adult", "")
            .replace("Chieftain", "Chieftan")
            .toLocaleLowerCase();
        name = name.split(" ");
        detail.splitName = name;
        return detail;
    });
    detailNames = detailNames.sort((a, b) => b.splitName.length - a.splitName.length);
    let fields = details.map(a => { return { "name": a.name, "id": a._id, "tokenimg": a.prototypeToken.texture.src }; });
    let count = 0;
    game.socket?.emit("manageFiles", { action: "browseFiles", storage: "data", target: iconsPath }, {}, async (result) => {
        for (let fileEntry of result.files) {
            let fileNameParts = fileEntry.split("/");
            const name = fileNameParts[fileNameParts.length - 1]
                .replace(".png", "")
                .replace(/['",\-_,]/g, "")
                .replace(/-/g, "")
                .toLocaleLowerCase();
            detailNames.filter(dtname => {
                if (!dtname.splitName)
                    return false;
                for (let namePart of dtname.splitName) {
                    if (!name.includes(namePart))
                        return false;
                }
                dtname.prototypeToken.texture.src = fileEntry;
                // dtname.img = fileEntry;
                delete dtname.splitName;
                // dtname.img = fileEntry;
                count += 1;
                return true;
            });
        }
        console.log("Matched ", count, "out of", detailNames.length, detailNames);
        console.log("Unmatched ", detailNames.filter(dt => dt.splitName));
        if (pack) {
            for (let actorData of detailNames) {
                if (actorData.splitName)
                    continue;
                let actor = pack.get(actorData._id);
                if (actor)
                    await actor.update(actorData);
            }
        }
    });
}
export async function fixTransferEffects(actor) {
    if (!actor) {
        return;
    }
    let items = Array.from(actor.items) || [];
    return await _fixTransferEffects(actor, items);
}
async function _fixTransferEffects(actor, itemsToCheck) {
    let items = itemsToCheck.filter(i => i.effects.some(e => effectIsTransfer(e)));
    let transferEffects = actor.effects.filter(e => (!e.isTemporary || effectIsTransfer(e)) && !!e.origin?.includes("Item."));
    console.warn("Deleting effects", transferEffects);
    await actor.deleteEmbeddedDocuments("ActiveEffect", transferEffects.map(e => e.id));
    const toCreate = items.map(i => i.toObject());
    console.warn("Deleting items ", items.map(i => i.id));
    await actor.deleteEmbeddedDocuments("Item", items.map(i => i.id));
    console.warn("Creating items ", toCreate);
    await actor.createEmbeddedDocuments("Item", toCreate);
}
export async function fixTransferEffect(actor, item) {
    if (!item) {
        return;
    }
    let items = [item];
    return await _fixTransferEffects(actor, items);
}
async function removeDaePassiveEffectsActor(actor, skipOrigins = false) {
    if (CONFIG.ActiveEffect.legacyTransferral === true) {
        ui.notifications?.error("Must be run in a world with legacy transferral false");
        return;
    }
    if (!actor)
        return;
    const effectsToDelete = actor.effects.filter(ef => foundry.utils.getProperty(ef, "flags.dae.transfer"));
    if (effectsToDelete?.length > 0) {
        console.log("Actor ", actor.name, "removing legacy effects", effectsToDelete.map(ef => ef.name));
        await actor.deleteEmbeddedDocuments("ActiveEffect", effectsToDelete.map(ef => ef.id));
    }
    if (!skipOrigins) {
        for (let item of actor.items) {
            for (let effect of item.effects) {
                const effectsToUpdate = item.effects.filter(ef => ef.transfer && ef.origin !== item.uuid);
                if (effectsToUpdate?.length > 0) {
                    console.log("Actor", actor.name, "updating origin for ", item.name, effectsToUpdate.map(ef => ef.name));
                    await item.updateEmbeddedDocuments("ActiveEffect", effectsToUpdate.map(ef => ({ _id: effect.id, origin: item.uuid })));
                }
            }
        }
    }
}
export async function removeScenePassiveEffects() {
    if (CONFIG.ActiveEffect.legacyTransferral === true) {
        ui.notifications?.error("Must be run in a world with legacy transferral false");
        return;
    }
    for (let token of canvas?.scene?.tokens ?? []) {
        try {
            if (token.actor)
                await removeDaePassiveEffectsActor(token.actor, false);
        }
        catch (err) {
            console.warn("error when removing legacy passive effects for", token?.actor?.name, err);
        }
    }
    ui.notifications?.notify("Scene Token legacy passive effects removed");
}
export async function removeActorsPassiveEffects() {
    if (CONFIG.ActiveEffect.legacyTransferral === true) {
        ui.notifications?.error("Must be run in a world with legacy transferral false");
        return;
    }
    for (let actor of game.actors ?? []) {
        try {
            await removeDaePassiveEffectsActor(actor, false);
        }
        catch (err) {
            console.warn("error when removing legacy passive effects for", actor?.name, err);
        }
    }
    ui.notifications?.notify("Actor legacy passive effects removed");
}
export async function migrateCompendium(pack) {
    if (CONFIG.ActiveEffect.legacyTransferral === true) {
        ui.notifications?.error("Must be run in a world with legacy transferral false");
        return;
    }
    const documentName = pack.documentName;
    if (!["Actor"].includes(documentName))
        return;
    // Unlock the pack for editing
    const wasLocked = pack.locked;
    await pack.configure({ locked: false });
    //@ts-expect-error no dnd5e-types
    game.dnd5e.moduleArt.suppressArt = true;
    const documents = await pack.getDocuments();
    // Iterate over compendium entries - applying fine-tuned migration functions
    for (let doc of documents) {
        try {
            switch (documentName) {
                case "Actor":
                    console.log(`Checking ${documentName} document ${doc.name} in Compendium ${pack.collection}`);
                    await removeDaePassiveEffectsActor(doc, true);
                    break;
                default:
                    break;
            }
        }
        // Handle migration failures
        catch (err) {
            err.message = `Legacy passive wEffect removal for document ${doc.name} in pack ${pack.collection} failed: ${err.message}`;
            console.error(err);
        }
    }
    // Apply the original locked status for the pack
    await pack.configure({ locked: wasLocked });
    //@ts-expect-error no dnd5e-types
    game.dnd5e.moduleArt.suppressArt = false;
    ui.notifications?.notify(`Removed Passive effects for all ${documentName} documents from Compendium ${pack.collection}`);
}
;
export async function removeCompendiaPassiveEffects() {
    if (CONFIG.ActiveEffect.legacyTransferral === true) {
        ui.notifications?.error("Must be run in a world with legacy transferral false");
        return;
    }
    // Migrate World Compendium Packs
    for (let p of game.packs ?? []) {
        // if (p.metadata.packageType !== "world") continue;
        if (!["Actor"].includes(p.documentName))
            continue;
        console.log("doing compendium", p.collection);
        await migrateCompendium(p);
    }
    ui.notifications?.notify("Finsihed compendium clean up");
}
export async function removeAllScenesPassiveEffects() {
    if (CONFIG.ActiveEffect.legacyTransferral === true) {
        ui.notifications?.error("Must be run in a world with legacy transferral false");
        return;
    }
    if (game.scenes)
        for (let scene of game.scenes) {
            for (let token of scene.tokens) {
                if (token.actorLink || !token.actor)
                    continue;
                await removeDaePassiveEffectsActor(token.actor, true);
            }
        }
    ui.notifications?.notify("All Scene Token legacy passive effects removed");
}
