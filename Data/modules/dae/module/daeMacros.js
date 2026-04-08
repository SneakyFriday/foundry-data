import { socketlibSocket } from "./GMAction.js";
import { warn, error } from "../dae.js";
function getTokenUuid(token) {
    if (token instanceof foundry.canvas.placeables.Token)
        return token.document.uuid;
    if (token instanceof TokenDocument)
        return token.uuid;
    return undefined;
}
let tokenScene = (tokenName, sceneName) => {
    if (!sceneName) {
        for (let scene of game.scenes ?? []) {
            let found = scene.tokens.getName(tokenName);
            if (found)
                return { scene, found };
            found = scene.tokens.get(tokenName);
            if (found)
                return { scene, found };
        }
    }
    else {
        let scene = game.scenes?.getName(sceneName);
        if (scene) {
            let found = scene.tokens.getName(tokenName);
            if (found) {
                return { scene, found };
            }
            found = scene.tokens.get(tokenName);
            if (found) {
                return { scene, found };
            }
        }
    }
    return { scene: null, tokenDocument: null };
};
export let moveToken = async (token, targetTokenName, xGridOffset = 0, yGridOffset = 0, targetSceneName = "") => {
    let { scene, found } = tokenScene(targetTokenName, targetSceneName);
    if (!token) {
        warn("dae | moveToken: Token not found");
        return ("Token not found");
    }
    if (!found) {
        warn("dae | moveToken: Target Not found");
        return `Token ${targetTokenName} not found`;
    }
    socketlibSocket.executeAsGM("recreateToken", {
        userId: game.user?.id,
        startSceneId: canvas?.scene?.id,
        tokenUuid: getTokenUuid(token),
        targetSceneId: scene?.id,
        tokenData: (token instanceof TokenDocument ? token : token.document).toObject(false),
        x: found.x + xGridOffset * (canvas.scene?.grid.size ?? 100),
        y: found.y + yGridOffset * (canvas.scene?.grid.size ?? 100)
    });
};
export let renameToken = async (token, newName) => {
    socketlibSocket.executeAsGM("renameToken", { userId: game.user?.id, startSceneId: canvas.scene?.id, tokenData: token.document.toObject(false), newName });
};
export async function teleportToken(token, scene, position) {
    let theScene;
    if (typeof scene === "string")
        theScene = game.scenes?.get(scene);
    else
        theScene = scene;
    return teleport(token, theScene, position.x, position.y);
}
export let teleportToToken = async (token, targetTokenName, xGridOffset = 0, yGridOffset = 0, targetSceneName = "") => {
    let { scene, found } = tokenScene(targetTokenName, targetSceneName);
    if (!token) {
        error("dae | teleportToToken: Token not found");
        return ("Token not found");
    }
    if (!found || !scene) {
        error("dae | teleportToToken: Target Not found");
        return `Token ${targetTokenName} not found`;
    }
    return await teleport(token, scene, found.x + xGridOffset * (canvas.scene?.grid.size ?? 100), found.y + yGridOffset * (canvas.scene?.grid.size ?? 100));
};
export async function createToken(tokenData, x, y) {
    let targetSceneId = canvas?.scene?.id;
    // requestGMAction(GMAction.actions.createToken, {userId: game.user.id, targetSceneId, tokenData, x, y})
    return socketlibSocket.executeAsGM("createToken", { userId: game.user?.id, targetSceneId, tokenData, x, y });
}
export let teleport = async (token, targetScene, xpos, ypos) => {
    token = token instanceof TokenDocument ? token.object : token;
    let x = Number(xpos);
    let y = Number(ypos);
    if (isNaN(x) || isNaN(y)) {
        error("dae | teleport: Invalid co-ords", xpos, ypos);
        return `Invalid target co-ordinates (${xpos}, ${ypos})`;
    }
    if (!token) {
        console.warn("dae | teleport: No Token");
        return "No active token";
    }
    if (!targetScene) {
        console.warn("dae | teleport: No Scene");
        return "No scene";
    }
    // Hide the current token
    if (targetScene.name === canvas?.scene?.name) {
        foundry.canvas.animation.CanvasAnimation.terminateAnimation(`Token.${token.id}.animateMovement`);
        let sourceSceneId = canvas.scene?.id;
        await socketlibSocket.executeAsGM("recreateToken", { userId: game.user.id, tokenUuid: getTokenUuid(token), startSceneId: sourceSceneId, targetSceneId: targetScene.id, tokenData: token.document.toObject(false), x: xpos, y: ypos });
        canvas.pan({ x: xpos, y: ypos });
        return true;
    }
    // deletes and recreates the token
    let sourceSceneId = canvas?.scene?.id;
    Hooks.once("canvasReady", () => {
        socketlibSocket.executeAsGM("createToken", { userId: game.user?.id, startSceneId: sourceSceneId, targetSceneId: targetScene.id, tokenData: token.document.toObject(false), x: xpos, y: ypos })
            .then(async () => {
            // canvas.pan({ x: xpos, y: ypos });
            // await requestGMAction(GMAction.actions.deleteToken, { userId: game.user.id, tokenUuid: getTokenUuid(token)});
            await socketlibSocket.executeAsGM("deleteToken", { userId: game.user?.id, tokenUuid: getTokenUuid(token) });
        });
    });
    // Need to stop animation since we are going to delete the token and if that happens before the animation completes we get an error
    foundry.canvas.animation.CanvasAnimation.terminateAnimation(`Token.${token.id}.animateMovement`);
    return await targetScene.view();
};
export async function setTokenVisibility(tokenOrId, visible) {
    let tokenUuid;
    if (typeof tokenOrId !== "string")
        tokenUuid = getTokenUuid(tokenOrId);
    else if (tokenOrId.startsWith("Scene"))
        tokenUuid = tokenOrId;
    else
        tokenUuid = `Scene.${canvas.scene?.id}.Token.${tokenOrId}`;
    return socketlibSocket.executeAsGM("setTokenVisibility", { tokenUuid, hidden: !visible });
}
export async function setTileVisibility(tileOrId, visible) {
    let tileUuid;
    if (tileOrId instanceof TileDocument)
        tileUuid = tileOrId.uuid;
    else {
        let tile = fromUuidSync(tileOrId);
        if (!tile)
            tile = canvas.scene?.tiles.get(tileOrId);
        if (tile)
            tileUuid = tile.uuid;
    }
    if (!tileUuid)
        return;
    return socketlibSocket.executeAsGM("setTileVisibility", { tileUuid, hidden: !visible });
}
// TODO fix this for v10
export async function blindToken(tokenOrId) {
    let tokenUuid;
    if (typeof tokenOrId !== "string")
        tokenUuid = getTokenUuid(tokenOrId);
    else if (tokenOrId.startsWith("Scene"))
        tokenUuid = tokenOrId;
    else
        tokenUuid = `Scene.${canvas?.scene?.id}.Token.${tokenOrId}`;
    return socketlibSocket.executeAsGM("blindToken", { tokenUuid });
}
// TODO fix this for v10
export async function restoreVision(tokenOrId) {
    let tokenUuid;
    if (typeof tokenOrId !== "string")
        tokenUuid = getTokenUuid(tokenOrId);
    else if (tokenOrId.startsWith("Scene"))
        tokenUuid = tokenOrId;
    else
        tokenUuid = `Scene.${canvas?.scene?.id}.Token.${tokenOrId}`;
    return socketlibSocket.executeAsGM("restoreVision", { tokenUuid });
}
export function getTokenFlag(token, flagName) {
    const tokenDocument = token instanceof TokenDocument ? token : token.document;
    return foundry.utils.getProperty(tokenDocument, `flags.dae.${flagName}`);
}
export async function deleteItemActiveEffects(tokens, origin, ignore = [], deleteEffects = [], removeSequencer = true, options) {
    const targets = tokens.map(t => ({ "uuid": typeof t === "string" ? t : getTokenUuid(t) }));
    return socketlibSocket.executeAsGM("deleteEffects", { targets, origin, ignore, deleteEffects, removeSequencer, options });
}
export async function deleteActiveEffect(uuid, origin, ignore = [], deleteEffects = [], removeSequencer = true, options) {
    return socketlibSocket.executeAsGM("deleteEffects", { targets: [{ uuid }], origin, ignore, deleteEffects, removeSequencer, options });
}
export async function setTokenFlag(tokenOrId, flagName, flagValue) {
    let tokenUuid = "";
    if (typeof tokenOrId === "string") {
        if (tokenOrId.startsWith("Scene."))
            tokenUuid = tokenOrId;
        else
            tokenUuid = canvas?.scene?.tokens.get(tokenOrId)?.uuid ?? "";
    }
    else
        tokenUuid = getTokenUuid(tokenOrId) ?? "";
    return socketlibSocket.executeAsGM("setTokenFlag", { tokenUuid: tokenUuid, flagName, flagValue });
}
export function getFlag(entity, flagId) {
    let theActor;
    if (!entity)
        return error(`dae.getFlag: entity not defined`);
    if (typeof entity === "string") {
        // Try as UUID, see if actor
        let retrievedDocument = fromUuidSync(entity);
        if (retrievedDocument instanceof Actor)
            theActor = retrievedDocument;
        else if (retrievedDocument instanceof TokenDocument)
            theActor = retrievedDocument.actor;
        else {
            // Try as token ID
            theActor = canvas.tokens?.get(entity)?.actor;
            // Try as actor ID
            if (!theActor)
                theActor = game.actors.get(entity);
        }
    }
    else {
        if (entity instanceof Actor)
            theActor = entity;
        else
            theActor = entity.actor;
    }
    if (!theActor)
        return error(`dae.getFlag: actor not defined`);
    warn("dae get flag ", entity, theActor, foundry.utils.getProperty(theActor, `flags.dae.${flagId}`));
    return foundry.utils.getProperty(theActor, `flags.dae.${flagId}`);
}
export async function setFlag(tactor, flagId, value) {
    if (typeof tactor === "string" && (tactor.startsWith("Scene") || tactor.startsWith("Actor"))) {
        return socketlibSocket.executeAsGM("setFlag", { actorUuid: tactor, flagId, value });
    }
    if (typeof tactor === "string") {
        return socketlibSocket.executeAsGM("setFlag", { actorId: tactor, flagId, value });
        // return requestGMAction(GMAction.actions.setFlag, { actorId: actor, flagId, value})
    }
    let actor;
    if (tactor instanceof foundry.canvas.placeables.Token)
        actor = tactor.actor;
    if (tactor instanceof Actor)
        actor = tactor;
    if (!actor)
        return error(`dae.setFlag: actor not defined`);
    return socketlibSocket.executeAsGM("setFlag", { actorId: actor.id, actorUuid: actor.uuid, flagId, value });
    // return requestGMAction(GMAction.actions.setFlag, { actorId: actor.id, actorUuid: actor.uuid, flagId, value})
}
export async function unsetFlag(tactor, flagId) {
    if (typeof tactor === "string" && (tactor.startsWith("Scene") || tactor.startsWith("Actor"))) {
        return socketlibSocket.executeAsGM("unsetFlag", { actorUuid: tactor, flagId });
    }
    if (typeof tactor === "string") {
        return socketlibSocket.executeAsGM("unsetFlag", { actorId: tactor, flagId });
        // return requestGMAction(GMAction.actions.setFlag, { actorId: actor, flagId, value})
    }
    let actor;
    if (tactor instanceof foundry.canvas.placeables.Token)
        actor = tactor.actor;
    if (tactor instanceof Actor)
        actor = tactor;
    if (!actor)
        return error(`dae.setFlag: actor not defined`);
    return socketlibSocket.executeAsGM("unsetFlag", { actorId: actor.id, actorUuid: actor.uuid, flagId });
    // return requestGMAction(GMAction.actions.unsetFlag, { actorId: actor.id, actorUuid: actor.uuid, flagId})
}
export async function macroActorUpdate(...args) {
    let [action, actorUuid, type, value, targetField, undo] = args;
    //if (args.length>6) undo = args.slice(5,-1).join('');    //someone might have forgotten to wrap the undo within ""
    const lastArg = args[args.length - 1];
    if (!(actorUuid && type && value && targetField)) {
        console.warn("dae | invalid arguments passed ", ...args);
        console.warn(`dae | macro.actorUpdate expects the following arguments:
      actorUuid: string
      type: "number", "boolean", "string"
      expression: a roll expression, optionally starting with +-/*
      targetField: "string", e.g. system.attrbutes.hp.value
      undo: 
          blank/true/restore: set the target field back to what it was before the effect was applied
          false: don't change the target field when removing the effect
          remove: remove the numeric effect of the change to the target field
          "+-*/"newValue add/subtract/multiply/divide the value of the field with the newValue
    `);
        return;
    }
    const tactor = await fromUuid(actorUuid);
    const actor = tactor instanceof TokenDocument ? tactor.actor : tactor;
    if (!actor) {
        console.warn("dae | invalid argument passed", actorUuid);
        console.warn("dae | no corresponding actor or token document found");
        return;
    }
    // const fieldDef = `flags.dae.save.${targetField}`;
    const fieldDef = `flags.dae.actorUpdate.${lastArg.effectId}.${targetField}`;
    let actorValue = foundry.utils.getProperty(actor, targetField);
    if (action === "each") {
        // for subsequent executions we have to recover the original actor value from the saved value.
        const fieldValue = foundry.utils.getProperty(actor, fieldDef);
        actorValue = fieldValue.actorValue;
    }
    const rollContext = actor.getRollData();
    rollContext.stackCount = lastArg.efData.flags?.dae?.stacks ?? 1;
    if (["on", "each"].includes(action)) {
        if (!game.user?.isGM) {
            console.warn(`dae | macro.actorUpdate user ${game.user?.name} is updating ${actor.name} ${targetField}`);
        }
        switch (type) {
            case 'boolean':
                value = JSON.parse(value) ? true : false;
                break;
            case 'number':
                let op = ' ';
                if (typeof value === 'string') {
                    value = value.trim();
                    op = value[0];
                }
                value = `${value}`.replace(/(\*\*(.+?)\*\*)/g, '@$2');
                if (['+', '-', '*', '/'].includes(op) && Number.isNumeric(actorValue))
                    value = new Roll(`${actorValue}${value}`, rollContext).evaluateSync({ strict: false }).total;
                else
                    value = new Roll(value, rollContext).evaluateSync({ strict: false }).total;
                break;
            default: // assume a string
        }
        const update = {};
        update[fieldDef] = { oldValue: actorValue, updateValue: value };
        update[targetField] = value;
        if (actor.isOwner)
            return await actor.update(update);
        else
            return await socketlibSocket.executeAsGM("_updateActor", { actorUuid: actor.uuid, update });
    }
    else if (action === "off") {
        const { oldValue = 0, updateValue } = foundry.utils.getProperty(actor, fieldDef);
        let restoreValue;
        if (undo === undefined)
            undo = true;
        if (typeof undo === "string")
            undo = undo.replace(/(\*\*(.+?)\*\*)/g, "@$2");
        if (typeof undo === "string") {
            undo = undo.trim();
        }
        if (typeof undo === "string" && undo === "restore") {
            undo = true;
        }
        if (typeof undo === "string" && undo === "remove") {
            restoreValue = Math.max(0, actorValue - (updateValue - oldValue));
        }
        else if (typeof undo == "string" && type === "number" && ["+", "-", "/", "*"].includes(undo[0])) {
            restoreValue = (await new Roll(`${actorValue}${undo}`, rollContext).roll()).total;
        }
        else if (typeof undo === "string" /*&&!undo.includes("Actor") && !undo.includes("Token")*/ && type === "number") {
            if (undo.includes("actorValue"))
                undo = undo.replace("actorValue", `${actorValue}`);
            restoreValue = new Roll(`${undo}`, rollContext).evaluateSync({ strict: false }).total;
        }
        else if (undo === "undefined") {
            restoreValue = undefined;
        }
        else if (typeof undo === "string") {
            restoreValue = JSON.parse(undo);
        }
        if (undo === true)
            restoreValue = oldValue;
        if (undo !== false) {
            const update = {};
            foundry.utils.setProperty(update, `flags.dae.actorUpdate.-=${lastArg.effectId}`, null);
            update[targetField] = restoreValue;
            if (actor.isOwner)
                return await actor.update(update);
            else
                return await socketlibSocket.executeAsGM("_updateActor", { actorUuid: actor.uuid, update });
        }
    }
}
