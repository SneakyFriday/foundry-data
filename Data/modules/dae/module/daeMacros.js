import { socketlibSocket } from "./GMAction.js";
import { warn, error } from "../dae.js";
function getTokenUuid(token) {
    if (token instanceof foundry.canvas.placeables.Token)
        return token.document.uuid;
    if (token instanceof TokenDocument)
        return token.uuid;
    return undefined;
}
function resolveTokenUuid(tokenOrId) {
    if (typeof tokenOrId !== "string")
        return getTokenUuid(tokenOrId);
    if (tokenOrId.startsWith("Scene"))
        return tokenOrId;
    return `Scene.${canvas?.scene?.id}.Token.${tokenOrId}`;
}
function resolveActorRef(tactor) {
    if (typeof tactor === "string") {
        if (tactor.startsWith("Scene") || tactor.startsWith("Actor"))
            return { actorUuid: tactor };
        return { actorId: tactor };
    }
    const actor = tactor instanceof foundry.canvas.placeables.Token ? tactor.actor : tactor instanceof Actor ? tactor : undefined;
    if (!actor)
        return undefined;
    return { actorId: actor.id, actorUuid: actor.uuid };
}
function findTokenInScene(tokenName, scene) {
    return scene.tokens.getName(tokenName) ?? scene.tokens.get(tokenName) ?? undefined;
}
let tokenScene = (tokenName, sceneName) => {
    const scenes = sceneName ? [game.scenes?.getName(sceneName)] : (game.scenes ?? []);
    for (const scene of scenes) {
        if (!scene)
            continue;
        const found = findTokenInScene(tokenName, scene);
        if (found)
            return { scene, found };
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
            await socketlibSocket.executeAsGM("deleteToken", { userId: game.user?.id, tokenUuid: getTokenUuid(token) });
        })
            .catch(err => console.error("dae | cross-scene teleport failed", err));
    });
    // Need to stop animation since we are going to delete the token and if that happens before the animation completes we get an error
    foundry.canvas.animation.CanvasAnimation.terminateAnimation(`Token.${token.id}.animateMovement`);
    return await targetScene.view();
};
export async function setTokenVisibility(tokenOrId, visible) {
    return socketlibSocket.executeAsGM("setTokenVisibility", { tokenUuid: resolveTokenUuid(tokenOrId), hidden: !visible });
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
export async function blindToken(tokenOrId) {
    return socketlibSocket.executeAsGM("blindToken", { tokenUuid: resolveTokenUuid(tokenOrId) });
}
export async function restoreVision(tokenOrId) {
    return socketlibSocket.executeAsGM("restoreVision", { tokenUuid: resolveTokenUuid(tokenOrId) });
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
    return socketlibSocket.executeAsGM("setTokenFlag", { tokenUuid: resolveTokenUuid(tokenOrId) ?? "", flagName, flagValue });
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
    const ref = resolveActorRef(tactor);
    if (!ref)
        return error(`dae.setFlag: actor not defined`);
    return socketlibSocket.executeAsGM("setFlag", { ...ref, flagId, value });
}
export async function unsetFlag(tactor, flagId) {
    const ref = resolveActorRef(tactor);
    if (!ref)
        return error(`dae.unsetFlag: actor not defined`);
    return socketlibSocket.executeAsGM("unsetFlag", { ...ref, flagId });
}
export async function macroActorUpdate(...args) {
    let [action, actorUuid, type, value, targetField, undo] = args;
    const lastArg = args[args.length - 1];
    if (!(actorUuid && type && value && targetField)) {
        console.warn("dae | macro.actorUpdate: missing arguments (actorUuid, type, expression, targetField, [undo])", ...args);
        return;
    }
    const tactor = await fromUuid(actorUuid);
    const actor = tactor instanceof TokenDocument ? tactor.actor : tactor;
    if (!actor) {
        console.warn("dae | macro.actorUpdate: actor not found", actorUuid);
        return;
    }
    const fieldDef = `flags.dae.actorUpdate.${lastArg.effectId}.${targetField}`;
    let actorValue = foundry.utils.getProperty(actor, targetField);
    if (action === "each") {
        actorValue = foundry.utils.getProperty(actor, fieldDef)?.actorValue;
    }
    const rollContext = actor.getRollData();
    rollContext.stackCount = lastArg.efData.flags?.dae?.stacks ?? 1;
    const doUpdate = async (update) => {
        if (actor.isOwner)
            return actor.update(update);
        return socketlibSocket.executeAsGM("_updateActor", { actorUuid: actor.uuid, update });
    };
    if (["on", "each"].includes(action)) {
        if (type === "boolean")
            value = !!JSON.parse(value);
        else if (type === "number") {
            let op = ' ';
            if (typeof value === "string") {
                value = value.trim();
                op = value[0];
            }
            value = `${value}`.replace(/(\*\*(.+?)\*\*)/g, "@$2");
            value = (['+', '-', '*', '/'].includes(op) && Number.isNumeric(actorValue))
                ? new Roll(`${actorValue}${value}`, rollContext).evaluateSync({ strict: false }).total
                : new Roll(value, rollContext).evaluateSync({ strict: false }).total;
        }
        return doUpdate({ [fieldDef]: { oldValue: actorValue, updateValue: value }, [targetField]: value });
    }
    if (action === "off") {
        const { oldValue = 0, updateValue } = foundry.utils.getProperty(actor, fieldDef) ?? {};
        if (undo === undefined)
            undo = true;
        if (typeof undo === "string") {
            undo = undo.replace(/(\*\*(.+?)\*\*)/g, "@$2").trim();
            if (undo === "restore")
                undo = true;
        }
        let restoreValue;
        if (undo === true)
            restoreValue = oldValue;
        else if (undo === false)
            return;
        else if (undo === "undefined")
            restoreValue = undefined;
        else if (typeof undo === "string" && undo === "remove")
            restoreValue = Math.max(0, actorValue - (updateValue - oldValue));
        else if (typeof undo === "string" && type === "number" && ["+", "-", "/", "*"].includes(undo[0]))
            restoreValue = (await new Roll(`${actorValue}${undo}`, rollContext).roll()).total;
        else if (typeof undo === "string" && type === "number") {
            if (undo.includes("actorValue"))
                undo = undo.replace("actorValue", `${actorValue}`);
            restoreValue = new Roll(`${undo}`, rollContext).evaluateSync({ strict: false }).total;
        }
        else if (typeof undo === "string")
            restoreValue = JSON.parse(undo);
        const update = { [targetField]: restoreValue };
        foundry.utils.setProperty(update, `flags.dae.actorUpdate.-=${lastArg.effectId}`, null);
        return doUpdate(update);
    }
}
