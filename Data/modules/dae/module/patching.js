import { libWrapper, replaceFormulaData } from "./dae.js";
import { log } from "../dae.js";
export function patchingInitSetup() {
    return;
}
export function initPatching() {
    log("Patching Roll.replaceFormulaData");
    libWrapper.register("dae", "Roll.replaceFormulaData", replaceFormulaData, "MIXED");
}
export function setupPatching() {
    log("Patching ActiveEffect.isTemporary");
    libWrapper.register("dae", "CONFIG.ActiveEffect.documentClass.prototype.isTemporary", isTemporary, "WRAPPER");
}
;
function isTemporary(wrapped) {
    // if (this.parent instanceof CONFIG.Actor.documentClass && this.data.flags?.dae?.transfer) return false;
    this._prepareDuration();
    return wrapped() || this.flags?.dae?.showIcon;
}
