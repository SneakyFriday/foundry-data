import { daeSpecialDurations } from '../../dae.js';
import { teleportToToken, blindToken, restoreVision, setTokenVisibility, setTileVisibility, moveToken, renameToken, getTokenFlag, setTokenFlag, setFlag, unsetFlag, getFlag, deleteActiveEffect, createToken, teleportToken, deleteItemActiveEffects } from '../../module/daeMacros.js';
import { convertDuration } from '../GMAction.js';
import { ActiveEffects } from '../apps/ActiveEffects.js';
import { BooleanFormulaField, DAEActiveEffectConfig, addAutoFields, otherFieldsMap, registerFieldEditor } from '../apps/DAEActiveEffectConfig.js';
import { DIMEditor } from '../apps/DIMEditor.js';
import { daeMacro, doEffects, daeSystemClass, actionQueue, actorFromUuid, doActivityEffects, localizationMap, getItemMacroCommand, allMacroEffects, macroDestination } from '../dae.js';
import * as atlMigration from '../atlMigration.js';
import * as daeModule from '../dae.js';
import { ValidSpec, wildcardEffects } from '../Systems/DAESystem.js';
import { enumerateBaseValues } from '../dae.js';
import { expireEffect, isEffectExpired, isTransferEffect, hasDuration, hasExpiry } from '../specialDurations.js';
import { migrateEffectData, migrateActor, migrateItem, migrateWorld } from '../migration.js';
import { resolveItemFromEffect, resolveMacro, resolveWorldMacro, resolveItemMacroCommand, resolveActivityMacroCommand, createSyntheticMacro, createFunctionMacro } from '../lib/macroResolution.js';
import { registerChangeHandler, getChangeHandler, changeHandlerRegistry } from '../lib/changeHandlerRegistry.js';
const API = {
    ActiveEffects(document) {
        return new ActiveEffects({ document });
    },
    get actionQueue() { return actionQueue; },
    get allValidSpecKeys() {
        return [...otherFieldsMap.keys()].concat(Object.keys(ValidSpec.actorSpecs["union"].allSpecsObj));
    },
    DAEActiveEffectConfig(document, options = {}) {
        return new DAEActiveEffectConfig({ document, ...options });
    },
    get DIMEditor() { return DIMEditor; },
    get daeCustomEffect() {
        return daeSystemClass.daeCustomEffect;
    },
    daeSpecialDurations() {
        return daeSpecialDurations;
    },
    evalExpression() {
        return daeSystemClass.safeEvalExpression.bind(daeSystemClass);
    },
    get localizationMap() { return localizationMap; },
    get otherValidSpecKeys() { return [...otherFieldsMap.keys()]; },
    get ValidSpec() { return ValidSpec; },
    get wildcardBaseEffects() {
        return wildcardEffects;
    },
    actorFromUuid,
    addAutoFields,
    get changeHandlerRegistry() { return changeHandlerRegistry; },
    createFunctionMacro,
    createSyntheticMacro,
    get allMacroEffects() { return allMacroEffects; },
    BooleanFormulaField,
    blindToken,
    convertDuration,
    createToken,
    daeMacro,
    deleteActiveEffect,
    deleteItemActiveEffects,
    doActivityEffects,
    doEffects,
    enumerateBaseValues,
    expireEffect,
    getChangeHandler,
    getFlag,
    getItemMacroCommand,
    getTokenFlag,
    hasDuration,
    hasExpiry,
    isEffectExpired,
    isTransferEffect,
    get macroDestination() { return macroDestination; },
    moveToken,
    registerChangeHandler,
    registerFieldEditor,
    renameToken,
    resolveActivityMacroCommand,
    resolveItemFromEffect,
    resolveItemMacroCommand,
    resolveMacro,
    resolveWorldMacro,
    restoreVision,
    setFlag,
    setTileVisibility,
    setTokenFlag,
    setTokenVisibility,
    teleportToken,
    teleportToToken,
    unsetFlag,
    migrateEffectData,
    migrateActor,
    migrateItem,
    migrateWorld,
    // ATL → token.* migration surface (see Changelog 14.0.10).
    atlMigration,
    get atlCompatMode() { return daeModule.atlCompatMode; },
    get atlRewriteAtPreWrite() { return daeModule.atlRewriteAtPreWrite; },
    get atlRewriteAtRuntime() { return daeModule.atlRewriteAtRuntime; },
    get atlMigrateWorldData() { return daeModule.atlMigrateWorldData; },
};
export default API;
