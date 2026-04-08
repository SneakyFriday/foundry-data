const { ApplicationV2: ApplicationV2$2, HandlebarsApplicationMixin: HandlebarsApplicationMixin$2 } = foundry.applications.api;

class DiceCreator extends HandlebarsApplicationMixin$2(ApplicationV2$2) {
	constructor(object, options = {}) {
		super(options);
		const { dice, diceRows, form, settings } = object;
		this.object = { dice, diceRows, settings };
		this.parent = form;
		Hooks.once("closeDiceRowSettings", () => this.close());
	}

	static DEFAULT_OPTIONS = {
		id: "dice-creator-form",
		form: {
			handler: DiceCreator.#onSubmit,
			closeOnSubmit: true,
		},
		position: {
			width: 450,
			height: "auto",
		},
		tag: "form",
		window: {
			icon: "fas fa-dice",
			contentClasses: ["standard-form", "dice-tray-dice-creator"],
			title: "DICE_TRAY.SETTINGS.DiceCreator"
		}
	};

	static PARTS = {
		diceRows: {
			template: "./modules/dice-calculator/templates/DiceCreator.hbs"
		},
		footer: { template: "templates/generic/form-footer.hbs" }
	};

	_prepareContext(options) {
		const { dice, diceRows, settings } = this.object;
		const nextRow = diceRows.findIndex((row) => Object.keys(row).length < 7);
		const rowIndex = (nextRow !== -1 ? nextRow : diceRows.length) + 1;
		const label = dice?.key ? "SETTINGS.Save" : "DICE_TRAY.DiceCreator.CreateDice";
		return {
			dice,
			diceRows: this.object.diceRows, // this.diceRows,
			value: dice?.row ?? rowIndex,
			maxRows: rowIndex,
			settings,
			buttons: [
				{ type: "submit", icon: "fa-solid fa-save", label },
			]
		};
	}

	static async #onSubmit(event, form, formData) {
		let { dice, row } = foundry.utils.expandObject(formData.object);
		// Account for ROW being 1-index for better UX
		const actualRow = row - 1;
		if (this.object.dice && this.object.dice.row !== row) {
			const key = this.object.dice.originalKey;
			delete this.parent.diceRows[actualRow][key];
		}
		if (row > this.parent.diceRows.length) {
			this.parent.diceRows.push({});
		}
		const cleanKey = Object.fromEntries(Object.entries(dice).filter(([k, v]) => k !== "key" && v !== ""));
		if (!cleanKey.img && !cleanKey.label) {
			cleanKey.label = dice.key;
		}
		this.parent.diceRows[actualRow][dice.key] = cleanKey;
		this.parent.render(true);
	}
}

const { ApplicationV2: ApplicationV2$1, HandlebarsApplicationMixin: HandlebarsApplicationMixin$1 } = foundry.applications.api;
class DiceRowSettings extends HandlebarsApplicationMixin$1(ApplicationV2$1) {
	constructor(object, options = {}) {
		super(object, options);
		this.diceRows = foundry.utils.deepClone(game.settings.get("dice-calculator", "diceRows"));
	}

	static DEFAULT_OPTIONS = {
		id: "dice-row-form",
		form: {
			handler: DiceRowSettings.#onSubmit,
			closeOnSubmit: true,
		},
		position: {
			width: 450,
			height: "auto",
		},
		tag: "form",
		window: {
			icon: "fas fa-dice",
			contentClasses: ["standard-form", "dice-tray-row-settings"],
			title: "DICE_TRAY.SETTINGS.DiceRowSettings"
		},
		actions: {
			add: DiceRowSettings.#add,
			reset: DiceRowSettings.#reset
		}
	};

	static PARTS = {
		diceRows: {
			template: "./modules/dice-calculator/templates/DiceRowSettings.hbs"
		},
		footer: { template: "templates/generic/form-footer.hbs" }
	};

	settings;

	static get settingsKeys() {
		const keys = ["compactMode", "hideNumberInput", "hideNumberButtons", "hideRollButton"];
		if (CONFIG.DICETRAY.showExtraButtons) keys.splice(4, 0, "hideAdv");
		return keys;
	}

	_prepareContext(options) {
		this.settings ??= DiceRowSettings.settingsKeys.reduce((obj, key) => {
			obj[key] = game.settings.get("dice-calculator", key);
			return obj;
		}, {});
		return {
			diceRows: this.diceRows,
			settings: this.settings,
			showExtraButtons: CONFIG.DICETRAY.showExtraButtons,
			buttons: [
				{ type: "button", icon: "fa-solid fa-plus", label: "DICE_TRAY.DiceCreator.CreateDice", action: "add" },
				{ type: "submit", icon: "fa-solid fa-save", label: "SETTINGS.Save" },
				{ type: "button", icon: "fa-solid fa-undo", label: "SETTINGS.Reset", action: "reset" }
			]
		};
	}

	_onRender(context, options) {
		super._onRender(context, options);
		CONFIG.DICETRAY.applyLayout(this.element, { hideAdv: context.settings.hideAdv });
		const diceTrayInput = this.element.querySelector("input.dice-tray__input");
		for (const input of this.element.querySelectorAll(".form-group input")) {
			input.addEventListener("click", async (event) => {
				const { checked, name } = event.currentTarget;
				this.settings[name] = checked;
				this.render(true);
			});
		}
		if (diceTrayInput) diceTrayInput.disabled = true;
		for (const button of this.element.querySelectorAll(".dice-tray button.dice-tray__button")) {
			button.addEventListener("click", async (event) => {
				event.preventDefault();
				const { formula: key, tooltip } = Object.keys(event.target.parentElement.dataset).length
					? event.target.parentElement.dataset
					: event.target.dataset;
				const row = this.diceRows.findIndex((r) => r[key]);
				const diceData = this.diceRows[row][key];
				const { color, img, label } = diceData;
				new DiceCreator({
					form: this,
					diceRows: this.diceRows,
					dice: {
						key,
						originalKey: key, // In case the key is changed later.
						color,
						img,
						label,
						tooltip: tooltip !== key ? tooltip : "",
						row: row + 1,
					},
					settings: this.settings
				}).render(true);
			});
			button.addEventListener("contextmenu", async (event) => {
				event.preventDefault();
				const { formula: key } = Object.keys(event.target.parentElement.dataset).length
					? event.target.parentElement.dataset
					: event.target.dataset;
				const row = this.diceRows.findIndex((r) => r[key]);
				delete this.diceRows[row][key];
				if (!Object.keys(this.diceRows[row]).length) {
					this.diceRows.splice(row, 1);
				}
				this.render(false);
			});
		}
		for (const button of this.element.querySelectorAll(".dice-tray .dice-tray__math button")) {
			button.addEventListener("click", async (event) => {
				event.preventDefault();
			});
		}
	}

	static #add() {
		new DiceCreator({
			form: this,
			diceRows: this.diceRows,
			settings: this.settings
		}).render(true);
	}

	static #reset() {
		this.diceRows = game.settings.settings.get("dice-calculator.diceRows").default;
		this.render(false);
	}

	static async #onSubmit(event, form, formData) {
		let forceRender = false;
		await Promise.all(
			DiceRowSettings.settingsKeys.map(async (key) => {
				const current = game.settings.get("dice-calculator", key);
				if (current !== this.settings[key]) {
					await game.settings.set("dice-calculator", key, this.settings[key]);
					forceRender = true;
				}
			})
		);
		const current = game.settings.get("dice-calculator", "diceRows");
		if (JSON.stringify(this.diceRows) !== JSON.stringify(current)) {
			await game.settings.set("dice-calculator", "diceRows", this.diceRows);
			forceRender = true;
		}
		if (forceRender) Hooks.callAll("dice-calculator.forceRender");
	}
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class DiceTrayPopOut extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "dice-tray-popout",
		tag: "aside",
		position: {
			width: ui?.sidebar?.options.width ?? 300
		},
		window: {
			title: "DICE_TRAY.DiceTray",
			icon: "fas fa-dice-d20",
			minimizable: true
		}
	};

	static PARTS = {
		list: {
			id: "list",
			template: "modules/dice-calculator/templates/tray.html",
		}
	};

	async _renderFrame(options) {
		const frame = await super._renderFrame(options);
		this.window.close.remove(); // Prevent closing
		return frame;
	}

	async close(options={}) {
		if ( !options.closeKey ) return super.close(options);
		return this;
	}

	get chatElement() {
		return ui.sidebar.popouts.chat?.element || ui.chat.element;
	}

	_configureRenderOptions(options) {
		super._configureRenderOptions(options);
		if ( options.isFirstRender && ui.nav ) {
			const position = game.settings.get("dice-calculator", "popoutPosition");
			const {right, top} = ui.nav.element.getBoundingClientRect();
			const uiScale = game.settings.get("core", "uiConfig").uiScale;
			options.position.left ??= position.left ?? right + (16 * uiScale);
			options.position.top ??= position.top ?? top;
		}
	}

	_onRender(context, options) {
		super._onRender(context, options);
		CONFIG.DICETRAY.applyLayout(this.element);
		CONFIG.DICETRAY.applyListeners(this.element);
	}

	async _prepareContext(_options) {
		return {
			dicerows: game.settings.get("dice-calculator", "diceRows"),
			settings: DiceRowSettings.settingsKeys.reduce((obj, key) => {
				obj[key] = game.settings.get("dice-calculator", key);
				return obj;
			}, {})
		};
	}

	setPosition(position) {
		const superPosition = super.setPosition(position);
		const { left, top } = superPosition;
		game.settings.set("dice-calculator", "popoutPosition", { left, top });
		return superPosition;
	}
}

class TemplateDiceMap {
	_rightClickCommand;

	/** Unmark the KH/KL buttons if a roll is made */
	removeAdvOnRoll = true;

	/** Shows the KH/KL buttons */
	showExtraButtons = true;

	template = "modules/dice-calculator/templates/tray.html";

	/**
	 * The formula that will be rendered on the KH/KL buttons
	 * @returns {{}}
	 *
	 * @example Making the buttons be +1/-1 for additional logic
	 * ```js
	 * return {
	 *	kh: "+1",
	 *	kl: "-1"
	 * };
	 */
	get buttonFormulas() {
		return {
			kh: "kh",
			kl: "kl"
		};
	}

	/**
	 * The dice rows that will be shown on the dice tray.
	 * @property {String} color		Optional RGB or Hex value that colors a dice's background image. If none is preset, it will be white.
	 * @property {String} img		The path to an image that will be shown on the button. If none is present, the label will be used instead.
	 * @property {String} label		The label meant to be used when the button doesn't have a proper image, like Fate Dice or multiple dice.
	 * @property {String} tooltip	Optional tooltip that will be shown instead of the key. Useful for special dice like Genesys system's.
	 * @returns {[Object]}
	 *
	 * @example
	 * ```js Dice buttons with mixed image/label
	 * return [{
	 * 	d6: { img: "icons/dice/d6black.svg" },
	 *  "4df": { label: "Fate Dice" }
	 * }];
	 * ```
	 *
	 * @example Dice buttons with just labels
	 * ```js
	 * return [{
	 * 	d6: { label: "1d6" },
	 *  "2d6": { label: "2d6" }
	 *  "3d6": { label: "3d6" }
	 * }];
	 * ```
	 *
	 * @example Dice buttons with tooltips
	 * ```js
	 * return [{
	 * 	da: { tooltip: "Proficiency" },
	 *  ds: { tooltip: "Setback" }
	 *  df: { tooltip: "Force" }
	 * }];
	 * ```
	 */
	get dice() {
		return [
			{
				d4: { img: "icons/dice/d4black.svg" },
				d6: { img: "icons/dice/d6black.svg" },
				d8: { img: "icons/dice/d8black.svg" },
				d10: { img: "icons/dice/d10black.svg" },
				d12: { img: "icons/dice/d12black.svg" },
				d20: { img: "icons/dice/d20black.svg" },
				d100: { img: "modules/dice-calculator/assets/icons/d100black.svg" },
			}
		];
	}

	/**
	 * Labels that will be shown on the Keep Highest/Lowest button if they are shown.
	 */
	get labels() {
		return {
			advantage: "DICE_TRAY.KeepHighest",
			adv: "KH",
			disadvantage: "DICE_TRAY.KeepLowest",
			dis: "KL"
		};
	}

	get rightClickCommand() {
		this._rightClickCommand ??= game.settings.get("dice-calculator", "rightClickCommand");
		return this._rightClickCommand;
	}

	/**
	 * List of additional settings to be registered during the i18nInit hook.
	 */
	get settings() {
		return {};
	}

	get textarea() {
		return document.querySelector("textarea.chat-input");
	}

	roll(formula) {
		const [rollMode] = ui.chat.constructor.parse(formula);
		Roll.create(formula.replace(/(\/r|\/gmr|\/br|\/sr) /, "")).toMessage({}, { rollMode });
	}

	/**
	 * Logic to set display the additiona KH/KL buttons and event listeners.
	 * @param {HTMLElement} html
	 * @param {Object} options
	 */
	applyLayout(html, options = {}) {
		const disableExtras = options.hideAdv ?? game.settings.get("dice-calculator", "hideAdv");
		if (this.showExtraButtons && !disableExtras) {
			this._createExtraButtons(html);
			this._extraButtonsLogic(html);
		}

		/** Clicking the Roll button clears and hides all orange number flags, and unmark the KH/KL keys */
		html.querySelector(".dice-tray__roll")?.addEventListener("click", async (event) => {
			event.preventDefault();
			this.roll(this.textarea.value);
			this.reset();
			this.textarea.value = "";
		});
	}

	applyListeners(html) {
		html.querySelectorAll(".dice-tray button").forEach((button) => {
			// Avoids moving focus to the button
			button.addEventListener("pointerdown", (event) => {
				event.preventDefault();
				this.textarea.select();
			});
		});
		html.querySelectorAll(".dice-tray__button").forEach((button) => {
			button.addEventListener("click", (event) => {
				event.preventDefault();
				const dataset = event.currentTarget.dataset;
				CONFIG.DICETRAY.updateChatDice(dataset, "add", html);
			});

			button.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				const dataset = event.currentTarget.dataset;
				switch (this.rightClickCommand) {
					case "roll": {
						this.roll(dataset.formula);
						break;
					}
					case "decrease":
					default:
						CONFIG.DICETRAY.updateChatDice(dataset, "sub", html);
				}
			});
		});

		// Handle correcting the modifier math if it's null.
		const diceTrayInput = html.querySelector(".dice-tray__input");
		diceTrayInput?.addEventListener("input", (event) => {
			let modVal = Number(event.target.value);
			modVal = Number.isNaN(modVal) ? 0 : modVal;
			event.target.value = modVal;
			CONFIG.DICETRAY.applyModifier(html, { noFocus: true });
		});
		diceTrayInput?.addEventListener("wheel", (event) => {
			const diff = event.deltaY < 0 ? 1 : -1;
			let modVal = event.currentTarget.value;
			modVal = Number.isNaN(modVal) ? 0 : Number(modVal);
			event.currentTarget.value = modVal + diff;
			CONFIG.DICETRAY.applyModifier(html, { noFocus: true });
		});
		diceTrayInput?.addEventListener("focus", (event) => {
			diceTrayInput.select();
		});

		// Handle +/- buttons near the modifier input.
		html.querySelectorAll("button.dice-tray__math")?.forEach((button) => {
			button.addEventListener("click", (event) => {
				event.preventDefault();
				let modVal = Number(html.querySelector('input[name="dice.tray.modifier"]').value);
				modVal = Number.isNaN(modVal) ? 0 : modVal;

				switch (event.currentTarget.dataset.formula) {
					case "+1":
						modVal += 1;
						break;
					case "-1":
						modVal -= 1;
						break;
				}

				html.querySelector('input[name="dice.tray.modifier"]').value = modVal;
				CONFIG.DICETRAY.applyModifier(html);
			});
		});
	}

	async render() {
		const content = await foundry.applications.handlebars.renderTemplate(this.template, {
			dicerows: game.settings.get("dice-calculator", "diceRows"),
			settings: DiceRowSettings.settingsKeys.reduce((obj, key) => {
				obj[key] = game.settings.get("dice-calculator", key);
				return obj;
			}, {})
		});

		if (this.rendered) this.element.remove();
		if (content.length > 0) {
			const inputElement = document.getElementById("chat-message");
			inputElement.insertAdjacentHTML("afterend", content);
			CONFIG.DICETRAY.element = inputElement.parentElement.querySelector(".dice-tray");
			CONFIG.DICETRAY.applyLayout(CONFIG.DICETRAY.element);
			CONFIG.DICETRAY.applyListeners(CONFIG.DICETRAY.element);
		}
		this.rendered = true;
	}

	/**
	 * Clears the dice tray's orange markers
	 */
	reset() {
		TemplateDiceMap._resetTray(this.element);
		TemplateDiceMap._resetTray(CONFIG.DICETRAY.popout?.element);
	}

	/**
	 * Creates the KH/KL buttons
	 * @param {HTMLElement} html
	 */
	_createExtraButtons(html) {
		const { kh, kl } = this.buttonFormulas;
		const math = html.querySelector("#dice-tray-math");
		math.removeAttribute("hidden");
		const div = document.createElement("div");
		div.classList.add("dice-tray__stacked", "flexcol");

		const buttonAdv = document.createElement("button");
		buttonAdv.classList.add("dice-tray__ad", "dice-tray__advantage");
		buttonAdv.setAttribute("data-formula", kh);
		buttonAdv.setAttribute("data-tooltip", game.i18n.localize(this.labels.advantage));
		buttonAdv.setAttribute("data-tooltip-direction", "UP");
		buttonAdv.textContent = game.i18n.localize(this.labels.adv);

		const buttonDis = document.createElement("button");
		buttonDis.classList.add("dice-tray__ad", "dice-tray__disadvantage");
		buttonDis.setAttribute("data-formula", kl);
		buttonDis.setAttribute("data-tooltip", game.i18n.localize(this.labels.disadvantage));
		buttonDis.setAttribute("data-tooltip-direction", "UP");
		buttonDis.textContent = game.i18n.localize(this.labels.dis);

		div.appendChild(buttonAdv);
		div.appendChild(buttonDis);

		math.append(div);
	}

	/**
	 * Sets the logic for using the KH/KL buttons.
	 * This version appends KH/KL to rolls. Check DCC or SWADE for other uses.
	 * @param {HTMLElement} html
	 */
	_extraButtonsLogic(html) {
		for (const button of html.querySelectorAll(".dice-tray__ad")) {
			button.addEventListener("click", (event) => {
				event.preventDefault();
				const dataset = event.currentTarget.dataset;
				const chat = this.textarea;
				let chatVal = String(chat.value);
				const matchString = /\d*d\d+[khl]*/;

				// If there's a d20, toggle the current if needed.
				if (matchString.test(chatVal)) {
					// If there was previously a kh or kl, update it.
					if (/d\d+k[hl]/g.test(chatVal)) {
						chatVal = chatVal.replace(/(\d*)(d\d+)(k[hl]\d*)/g, (match, p1, p2, p3, offset, string) => {
							let diceKeep = this.updateDiceKeep(p1, p2, p3, -1, dataset.formula);
							html.querySelector(`.dice-tray__flag--${p2}`).textContent = diceKeep.count;
							return diceKeep.content;
						});
					}
					// Otherwise, add it.
					else {
						chatVal = chatVal.replace(/(\d*)(d\d+)/g, (match, p1, p2, offset, string) => {
							let diceKeep = this.updateDiceKeep(p1, p2, "", 1, dataset.formula);
							html.querySelector(`.dice-tray__flag--${p2}`).textContent = diceKeep.count;
							return diceKeep.content;
						});
					}
				}
				// else {
				// 	let diceKeep = this.updateDiceKeep("1", "d20", "", 1, dataset.formula);
				// 	html.find(".dice-tray__flag--d20").text(diceKeep.count);
				// 	chatVal += diceKeep.content;
				// }

				// Handle toggle classes.
				const toggleClass = (selector, condition) => {
					html.querySelector(selector)?.classList.toggle("active", condition);
				};
				toggleClass(".dice-tray__advantage", chatVal.includes("kh"));
				toggleClass(".dice-tray__disadvantage", chatVal.includes("kl"));
				// Update the value.
				chat.value = chatVal;
			});
		}
	}

	static _resetTray(html) {
		if (!html) return;
		if (html.querySelector(".dice-tray__input")) html.querySelector(".dice-tray__input").value = 0;
		for (const flag of html.querySelectorAll(".dice-tray__flag")) {
			flag.textContent = "";
			flag.classList.add("hide");
		}
		if (CONFIG.DICETRAY.removeAdvOnRoll ) {
			html.querySelector(".dice-tray__ad")?.classList?.remove("active");
		}
	}

	/**
	 * Logic to apply the number on the -/+ selector.
	 * @param {HTMLElement} html
	 * @param {Object} options
	 */
	applyModifier(html, options = {}) {
		const modInput = html.querySelector(".dice-tray__input");
		if (!modInput) return;
		const modVal = Number(modInput.value);

		if (modInput.length === 0 || isNaN(modVal)) return;

		let modString = "";
		if (modVal > 0) {
			modString = `+${modVal}`;
		} else if (modVal < 0) {
			modString = `${modVal}`;
		}

		const chat = this.textarea;
		const chatVal = String(chat.value);

		const matchString = /(\+|-)(\d+)$/;
		if (matchString.test(chatVal)) {
			chat.value = chatVal.replace(matchString, modString);
		} else if (chatVal !== "") {
			chat.value = chatVal + modString;
		} else {
			const rollPrefix = this._getRollMode(html);
			chat.value = `${rollPrefix} ${modString}`;
		}
		if (/(\/r|\/gmr|\/br|\/sr) $/g.test(chat.value)) {
			chat.value = "";
		}
		if (!options.noFocus) this.textarea.focus();
	}

	/**
	 * Returns a string with the number of dice to be rolled.
	 * Generally simple, unless the system demands some complex use.
	 * Consider checking SWADE's implementation.
	 * @param {String} qty
	 * @param {String} dice
	 * @param {HTMLElement} html
	 * @returns {String}
	 */
	rawFormula(qty, dice, html) {
		return `${qty === "" ? 1 : qty}${dice}`;
	}

	/**
	 * Handles clicks on the dice buttons.
	 * @param {Object} dataset
	 * @param {String} direction
	 * @param {HTMLElement} html
	 * @returns
	 */
	updateChatDice(dataset, direction, html) {
		const chat = this.textarea;
		let currFormula = String(chat.value);
		if (direction === "sub" && currFormula === "") {
			this.reset();
			return;
		}
		const rollPrefix = this._getRollMode(html);
		let qty = 1;
		let dice = "";

		let matchDice = dataset.formula;
		const diceRegex = /^(\d*)(d.+)/;
		if (diceRegex.test(dataset.formula)) {
			const match = dataset.formula.match(diceRegex);
			qty = Number(match[1]) || 1;
			// Avoid issues with 0-ended dice (e.g. d100 vs d10, d20 vs d2)
			matchDice = `${match[2]}(?!0)`;
			dice = match[2];
		}
		// Catch KH/KL
		matchDice += "[khl]*";

		const matchString = new RegExp(`${this.rawFormula("(?<qty>\\d*)", `(?<dice>${matchDice})`, html)}(?=\\+|\\-|$)`);
		if (matchString.test(currFormula)) {
			const match = currFormula.match(matchString);
			const parts = {
				qty: Number(match.groups?.qty ?? (match[1] || 1)),
				die: match.groups?.dice ?? (match[2] || ""),
			};

			if (parts.die === "" && match[3]) {
				parts.die = match[3];
			}

			qty = direction === "add" ? parts.qty + (qty || 1) : parts.qty - (qty || 1);

			if (!qty && direction === "sub") {
				currFormula = currFormula.replace(matchString, "");
				// Clear formula if remaining formula is something like "/r kh"
				if (new RegExp(`${rollPrefix}\\s+(?!.*d\\d+.*)`).test(currFormula)) {
					currFormula = "";
				}
			} else currFormula = currFormula.replace(matchString, this.rawFormula(qty, parts.die, html));

		} else if (currFormula === "") {
			currFormula = `${rollPrefix} ${this.rawFormula(qty, dice || dataset.formula, html)}`;
		} else {
			const signal = (/(\/r|\/gmr|\/br|\/sr) (?!-)/g.test(currFormula)) ? "+" : "";
			currFormula = currFormula.replace(/(\/r|\/gmr|\/br|\/sr) /g, `${rollPrefix} ${this.rawFormula(qty, dice || dataset.formula, html)}${signal}`);
		}
		chat.value = currFormula;

		// Add a flag indicator on the dice.
		this.updateDiceFlags(qty, dataset.formula);

		currFormula = currFormula.replace(/(\/r|\/gmr|\/br|\/sr)(( \+)| )/g, `${rollPrefix} `).replace(/\+{2}/g, "+").replace(/-{2}/g, "-").replace(/\+$/g, "");
		chat.value = currFormula;
		this.applyModifier(html);
	}

	updateDiceFlags(qty, formula) {
		const flags = document.querySelectorAll(`.dice-tray__flag--${formula}`);
		for (const flag of flags) {
			flag.textContent = qty !== 0 ? qty : "";
			flag.classList.toggle("hide", qty === 0);
		}
	}

	/**
	 * Gets the selected roll mode. This is completely cosmetic or for pressing Enter on chat, the rollMode is picked up during Roll#toMessage
	 * @param {HTMLElement} html
	 * @returns {String}
	 */
	_getRollMode(html) {
		const rollMode = game.settings.get("core", "rollMode");
		switch (rollMode) {
			case "gmroll":
				return "/gmr";
			case "blindroll":
				return "/br";
			case "selfroll":
				return "/sr";
			case "publicroll":
			default:
				return "/r";
		}
	}

	/**
     * Process a formula to apply advantage or disadvantage. Should be used
     * within a regex replacer function's callback.
     *
     * @param {string} count Current dice count in the formula.
     * @param {string} dice Current dice in the formula.
     * @param {string} khl Current kh/kl in the formula.
     * @param {number} countDiff Integer to adjust the dice count by.
     * @param {string} newKhl Formula of the button (kh or kl).
     * @returns {object} Object with content and count keys.
     */
	updateDiceKeep(count, dice, khl, countDiff, newKhl) {
		// Start by getting the current number of dice (minimum 1).
		const keep = Number.isNumeric(count) ? Math.max(Number(count), 1) : 1;

		// Apply the count diff to adjust how many dice we need for adv/dis.
		let newCount = keep + countDiff;
		let newKeep = newCount - 1;

		if (khl) {
			// Toggling between kh and kl — reset to base count
			if (!khl.includes(newKhl)) {
				newCount = keep;
				newKeep = newCount - 1;
				khl = newKhl;
			}
			// Toggling off adv/dis
			else {
				newCount = keep > 2 ? keep : newCount;
				newKeep = 0;
			}
		} else {
			khl = newKhl;
		}

		// Limit the count to 2 when adding adv/dis to avoid accidental super advantage.
		if (newCount > 2 && newKeep > 0) {
			newCount = 2;
			newKeep = newCount - 1;
		}

		// Create the updated text string.
		let result = `${newCount > 0 ? newCount : 1}${dice}`;
		// Append kh or kl if needed.
		if (newCount > 1 && newKeep > 0) {
			result = `${result}${newKhl}`;
		}

		// TODO: This allows for keeping multiple dice (e.g. 3d20kh2), but in this case, we only need to keep one.
		// if (newCount > 1 && newKeep > 1) result = `${result}${newKeep}`;

		// Return an object with the updated text and the new count.
		return {
			content: result,
			count: newCount
		};
	}

	async togglePopout() {
		this.popout ??= new DiceTrayPopOut();
		if (this.popout.rendered) await this.popout.close({ animate: false });
		else await this.popout.render(true);
	}
}

class cosmereDiceMap extends TemplateDiceMap {
	get dice() {
		return [
			{
				d4: { img: "icons/dice/d4black.svg" },
				d6: { img: "icons/dice/d6black.svg" },
				d8: { img: "icons/dice/d8black.svg" },
				d10: { img: "icons/dice/d10black.svg" },
				d12: { img: "icons/dice/d12black.svg" },
				d20: { img: "icons/dice/d20black.svg" },
				dp: { img: "systems/cosmere-rpg/assets/icons/svg/dice/dp_op.svg", tooltip: game.i18n.localize("DICE.Plot.Die") },
			}
		];
	}

	get labels() {
		return {
			advantage: "DICE_TRAY.Advantage",
			adv: "DICE_TRAY.Adv",
			disadvantage: "DICE_TRAY.Disadvantage",
			dis: "DICE_TRAY.Dis"
		};
	}
}

class dccDiceMap extends TemplateDiceMap {
	// Redundant, buttons don't keep lit up on use
	removeAdvOnRoll = false;

	get buttonFormulas() {
		return {
			kh: "+1",
			kl: "-1"
		};
	}

	get dice() {
		return [
			{
				d3: { img: "modules/dice-calculator/assets/icons/d3black.svg" },
				d4: { img: "icons/dice/d4black.svg" },
				d5: { img: "modules/dice-calculator/assets/icons/d5black.svg" },
				d6: { img: "icons/dice/d6black.svg" },
				d7: { img: "modules/dice-calculator/assets/icons/d7black.svg" },
				d8: { img: "icons/dice/d8black.svg" },
				d10: { img: "icons/dice/d10black.svg" },
			},
			{
				d12: { img: "icons/dice/d10black.svg" },
				d14: { img: "modules/dice-calculator/assets/icons/d14black.svg" },
				d16: { img: "modules/dice-calculator/assets/icons/d16black.svg" },
				d20: { img: "icons/dice/d20black.svg" },
				d24: { img: "modules/dice-calculator/assets/icons/d24black.svg" },
				d30: { img: "modules/dice-calculator/assets/icons/d30black.svg" },
				d100: { img: "modules/dice-calculator/assets/icons/d100black.svg" },
			},
		];
	}

	get labels() {
		return {
			advantage: "DICE_TRAY.PlusOneDieLong",
			adv: "DICE_TRAY.PlusOneDie",
			disadvantage: "DICE_TRAY.MinusOneDieLong",
			dis: "DICE_TRAY.MinusOneDie"
		};
	}

	_extraButtonsLogic(html) {
		const buttons = html.querySelectorAll(".dice-tray__ad");
		for (const button of buttons) {
			button.addEventListener("click", (event) => {
				event.preventDefault();
				const chat = this.textarea;
				let chatVal = chat.value;
				const matchString = /(\d+)d(\d+)/;

				// Find the first dice on the line to update
				const match = chatVal.match(matchString);
				if (match) {
					const diceChain = [3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 30];
					// Locate this die in the dice chain
					const chainIndex = diceChain.indexOf(parseInt(match[2]));
					if (chainIndex >= 0) {
						const newIndex = chainIndex + parseInt(event.currentTarget.dataset.formula);
						// Is the new index still in range?
						if (newIndex >= 0 && newIndex < diceChain.length) {
							chatVal = chatVal.replace(matchString, `${match[1]}d${diceChain[newIndex]}`);
						}
					}
				}

				// Update the value.
				chat.value = chatVal;
			});
		}
	}
}

class demonlordDiceMap extends TemplateDiceMap {

	get dice() {
		const dice = [
			{
				d3: { img: "modules/dice-calculator/assets/icons/d3black.svg" },
				d6: { img: "icons/dice/d6black.svg" },
				d20: { img: "icons/dice/d20black.svg" }
			}
		];
		return dice;
	}

	get buttonFormulas() {
		return {
			kh: "+",
			kl: "-"
		};
	}

	get labels() {
		return {
			advantage: game.i18n.localize("DL.DialogBoon"),
			adv: game.i18n.localize("DL.DialogBoon"),
			disadvantage: game.i18n.localize("DL.DialogBane"),
			dis: game.i18n.localize("DL.DialogBane")
		};
	}

	_extraButtonsLogic(html) {
		const buttons = html.querySelectorAll(".dice-tray__ad");
		for (const button of buttons) {
			button.addEventListener("click", (event) => {
				event.preventDefault();
				let sign = event.currentTarget.dataset.formula;
				const chat = this.textarea; // Assuming `this.textarea` refers to a valid element
				let chatVal = String(chat.value);
				const matchString = /(?<sign>[+-])(?<qty>\d*)d6kh/;
				const match = chatVal.match(matchString);

				if (match) {
					let qty = parseInt(match.groups.qty) || 1;
					let replacement = "";

					if (match.groups.sign === sign) {
						qty += 1;
						replacement = `${sign}${qty}d6kh`;
					} else if (qty !== 1) {
						qty -= 1;
						sign = sign === "+" ? "-" : "+";
						replacement = `${sign}${qty}d6kh`;
					}

					chatVal = chatVal.replace(matchString, replacement);
				} else {
					chatVal = `${chatVal}${sign}1d6kh`;
				}

				chat.value = chatVal;
			});
		}
	}
}

class dnd5eDiceMap extends TemplateDiceMap {
	get labels() {
		return {
			advantage: "DICE_TRAY.Advantage",
			adv: "DICE_TRAY.Adv",
			disadvantage: "DICE_TRAY.Disadvantage",
			dis: "DICE_TRAY.Dis"
		};
	}
}

class FateDiceMap extends TemplateDiceMap {
	get dice() {
		return [
			{
				d6: { img: "icons/dice/d6black.svg" },
				"4df": { label: game.i18n.localize("DICE_TRAY.FateDice")},
			}
		];
	}
}

class GrimwildDiceMap extends TemplateDiceMap {
	// Ironically, this is used to *remove* extra buttons like the input.
	// @todo update the parent class to add something like a render hook
	// for a more accurate place to modify the final markup.
	showExtraButtons = true;

	// Prepare dice buttons.
	get dice() {
		return [
			{
				d: {
					// img: "icons/dice/d6black.svg",
					tooltip: "Dice",
					label: "<i class=\"fas fa-dice-d6\"></i> d",
					direction: "LEFT"
				},
				t: {
					// img: "icons/dice/d8black.svg",
					tooltip: "Thorns",
					label: "<i class=\"fas fa-dice-d8\"></i> t",
					direction: "LEFT"
				},
				p: {
					// img: "icons/dice/d6black.svg",
					tooltip: "Pool",
					label: "<i class=\"fas fa-dice-d6\"></i> Pool",
					direction: "LEFT"
				},
			}
		];
	}

	// Override the chat formula logic.
	updateChatDice(dataset, direction, html) {
		// Retrieve the current chat value.
		const chat = this.textarea;
		let currFormula = String(chat.value);
		// Exit early if there's nothing in chat and this is a remove operation.
		if (direction === "sub" && currFormula === "") return;
		// Grab the dice roll mode from chat.
		let rollPrefix = this._getRollMode(html);
		// Store the current dice and thorn values for later.
		let dice = "";
		let thorns = "";

		// If the current formula is empty, set it to the roll prefix as our baseline.
		if (currFormula === "") currFormula = rollPrefix;

		// Prepare a string of possible roll types for the regex. This should also
		// catch any manually written roll types, like "/gmroll".
		const rollModes = [
			"/roll", "/r",
			"/publicroll", "/pr",
			"/gmroll", "/gmr",
			"/blindroll", "/broll", "/br",
			"/selfroll", "/sr"
		].join("|");

		// Convert our operation into math.
		let delta = direction === "add" ? 1 : -1;

		/**
		 * Regex for the dice expression. Examples: /r 4d2t, /gmr 2d, /br 4p
		 * Parts:
		 * (${rollModes})+ - Will be the /r, /gmroll, etc.
		 * \\s* - Whitespace between roll and formula.
		 * (\\d+[dp])* - Dice or pool, 4d, 4p, etc.
		 * (\\d+t)* - Thorns, 4t
		 * (.)* - Catch all for trailing characters. Used to snip off extras like "/r 4d6" becoming "/r 4d"
		 */
		const rollTextRegex = new RegExp(`(${rollModes})+\\s*(\\d+[dp])*(\\d+t)*(.)*`);
		// Run the regex with capture groups for targeted replacement.
		currFormula = currFormula.replace(rollTextRegex, (match, rollMode, diceMatch, thornsMatch, trailMatch) => {
			// If this is a remove operation and no dice were found, exit early.
			if (direction === "sub" && !diceMatch) {
				return match;
			}

			// Handle dice and pools.
			if (dataset.formula === "d" || dataset.formula === "p") {
				if (diceMatch) {
					diceMatch = diceMatch.replace(/(\d+)([dp])/, (subMatch, digit, letter) => {
						const newDigit = Number(digit) + delta;
						return newDigit > 0 ? `${newDigit}${dataset.formula}` : "";
					});

					if (!diceMatch && thornsMatch) {
						thornsMatch = "";
					}
				}
				else if (delta > 0) {
					diceMatch = `1${dataset.formula}`;
				}

				if (thornsMatch && dataset.formula === "p") {
					thornsMatch = "";
				}
			}

			// Handle thorns.
			if (dataset.formula === "t") {
				if (thornsMatch) {
					thornsMatch = thornsMatch.replace(/(\d+)(t)/, (subMatch, digit, letter) => {
						const newDigit = Number(digit) + delta;
						return newDigit > 0 ? `${newDigit}${letter}` : "";
					});
				}
				else if (delta > 0) {
					thornsMatch = "1t";
				}

				if (!diceMatch) {
					diceMatch = "1d";
				}

				diceMatch = diceMatch.replace("p", "d");
			}

			// Update variables.
			dice = diceMatch;
			thorns = thornsMatch;

			// Update the chat string.
			return `${rollPrefix} ${diceMatch}${thornsMatch ?? ""}`;
		});

		// Update flags over dice buttons. Use document instead of html so that we
		// also catch the popout element if present.
		let flagButton = document.querySelectorAll(".dice-tray__flag");
		flagButton.forEach((button) => {
			const buttonType = button.closest("button")?.dataset?.formula ?? false;
			// Update dice button.
			if (buttonType === "d") {
				if (dice && ["d", "t"].includes(dataset.formula)) {
					button.textContent = dice;
					button.classList.remove("hide");
				}
				else {
					button.textContent = "";
					button.classList.add("hide");
				}
			}
			// Update thorn button.
			else if (buttonType === "t") {
				if (thorns && ["d", "t"].includes(dataset.formula)) {
					button.textContent = thorns;
					button.classList.remove("hide");
				}
				else {
					button.textContent = "";
					button.classList.add("hide");
				}
			}
			// Update pool button.
			else if (buttonType === "p") {
				if (dice && dataset.formula === "p") {
					button.textContent = dice;
					button.classList.remove("hide");
				}
				else {
					button.textContent = "";
					button.classList.add("hide");
				}
			}
		});

		// Update chat area if the formula is valid.
		if (rollTextRegex.test(currFormula)) {
			// If there are dice, apply the formula. Otherwise, empty it.
			chat.value = dice ? currFormula : "";
		}
	}

	/**
	 * Remove buttons unused by Grimwild.
	 * @param {HTMLElement} html
	 */
	_createExtraButtons(html) {
		html.querySelector(".dice-tray__math--sub").remove();
		html.querySelector(".dice-tray__math--add").remove();
		html.querySelector(".dice-tray__input").remove();
	}
}

class HeXXen1733DiceMap extends TemplateDiceMap {
	/** Shows the KH/KL buttons */
	showExtraButtons = false;

	get dice() {
		return [
			{
				h: {
					tooltip: "HeXXenwürfel",
					img: "systems/hexxen-1733/img/dice/svg/erfolgswuerfel_einfach.svg",
					color: "#00a806"
				},
				s: {
					tooltip: "Segnungswürfel",
					img: "systems/hexxen-1733/img/dice/svg/erfolgswuerfel_doppel.svg",
					color: "#d1c5a8"
				},
				b: {
					tooltip: "Blutwürfel",
					img: "systems/hexxen-1733/img/dice/svg/blutwuerfel_3.svg",
					color: "#a74937"
				},
				e: {
					tooltip: "Elixierwürfel",
					img: "systems/hexxen-1733/img/dice/svg/elixirwuerfel_5.svg",
					color: "#4c7ba0"
				}
			}
		];
	}

	applyModifier(html) {
		const modInput = html.querySelector(".dice-tray__input");
		if (!modInput) return;
		const modVal = Number(modInput.value);

		if (modInput.length === 0 || isNaN(modVal)) return;

		let modString = "";
		let modTemp = "";
		if (modVal > 0) {
			modString = `${modVal}+`;
		} else if (modVal < 0) {
			modTemp = Math.abs(modVal);
			modString = `${modTemp}-`;
		}

		const chat = this.textarea;
		const chatVal = String(chat.value);

		const matchString = /(\d+)(\+|-)$/;
		if (matchString.test(chatVal)) {
			chat.value = chatVal.replace(matchString, modString);
		} else if (chatVal !== "") {
			chat.value = chatVal + modString;
		} else {
			const rollPrefix = this._getRollMode(html);
			chat.value = `${rollPrefix} ${modString}`;
		}

		if (/(\/r|\/gmr|\/br|\/sr) $/g.test(chat.value)) {
			chat.value = "";
		}
	}

	updateChatDice(dataset, direction, html) {
		const chat = this.textarea;
		let currFormula = String(chat.value);

		if (direction === "sub" && currFormula === "") {
			this.reset();
			return;
		}

		const rollPrefix = this._getRollMode(html);
		let qty = 1;

		let matchDice = dataset.formula;
		const matchString = new RegExp(`${this.rawFormula("(?<qty>\\d*)", `(?<dice>${matchDice})`, html)}(?=[0-9]|$)`);

		if (matchString.test(currFormula)) {
			const match = currFormula.match(matchString);
			const parts = {
				txt: match[0] || "",
				qty: Number(match.groups?.qty ?? (match[1] || 1)),
				die: match.groups?.dice ?? (match[2] || ""),
			};

			if (parts.die === "" && match[3]) {
				parts.die = match[3];
			}

			qty = direction === "add" ? parts.qty + (qty || 1) : parts.qty - (qty || 1);

			if (!qty && direction === "sub") {
				let regexxx =`${this.rawFormula("(\\d+)", `(${matchDice})`, html)}(?=[0-9]|$)`;
				const newMatchString = new RegExp(regexxx);
				currFormula = currFormula.replace(newMatchString, "");
				if (!(/(\d+[hsbe+-])/.test(currFormula))) {
					currFormula = "";
				}
			} else currFormula = currFormula.replace(matchString, this.rawFormula(qty, parts.die, html));
		} else if (currFormula === "") {
			currFormula = `${rollPrefix} ${this.rawFormula(qty, dataset.formula, html)}`;
		} else {
			const signal = (/(\/r|\/gmr|\/br|\/sr) (?!-)/g.test(currFormula)) ? "+" : "";
			currFormula = currFormula.replace(/(\/r|\/gmr|\/br|\/sr) /g, `${rollPrefix} ${this.rawFormula(qty, dataset.formula, html)}${signal}`);
		}
		chat.value = currFormula;

		// Add a flag indicator on the dice.
		const flagNumber = direction === "add" ? qty : 0;
		this.updateDiceFlags(flagNumber, dataset.formula);

		currFormula = currFormula.replace(/(\/r|\/gmr|\/br|\/sr)(( \+)| )/g, `${rollPrefix} `).replace(/\+{2}/g, "+").replace(/-{2}/g, "-");
		chat.value = currFormula;
		this.applyModifier(html);
	}
}

class pf2eDiceMap extends TemplateDiceMap {
	get buttonFormulas() {
		if (game.settings.get("dice-calculator", "flatCheck")) {
			return {
				kh: 5,
				kl: 11
			};
		}
		return super.buttonFormulas;
	}

	get dice() {
		return [
			{
				d4: { img: "icons/dice/d4black.svg" },
				d6: { img: "icons/dice/d6black.svg" },
				d8: { img: "icons/dice/d8black.svg" },
				d10: { img: "icons/dice/d10black.svg" },
				d12: { img: "icons/dice/d12black.svg" },
				d20: { img: "icons/dice/d20black.svg" }
			}
		];
	}

	flatCheckLabel(dc) {
		return game.i18n.format("DICE_TRAY.SETTINGS.PF2E.flatCheckLabel", {
			dc: game.i18n.format("PF2E.InlineAction.Check.DC", { dc }),
			text: game.i18n.localize("PF2E.FlatCheck"),
		});
	}

	get labels() {
		if (game.settings.get("dice-calculator", "flatCheck")) {
			const dc = game.i18n.localize("PF2E.Check.DC.Unspecific");
			return {
				advantage: this.flatCheckLabel(5),
				adv: game.i18n.format("DICE_TRAY.SETTINGS.PF2E.flatCheckLabel", { dc, text: 5 }),
				disadvantage: this.flatCheckLabel(11),
				dis: game.i18n.format("DICE_TRAY.SETTINGS.PF2E.flatCheckLabel", { dc, text: 11 }),
			};
		}
		return {
			advantage: "DICE_TRAY.Fortune",
			adv: "DICE_TRAY.For",
			disadvantage: "DICE_TRAY.Misfortune",
			dis: "DICE_TRAY.Mis"
		};
	}

	get settings() {
		return {
			flatCheck: {
				name: "DICE_TRAY.SETTINGS.PF2E.flatCheck.name",
				hint: "DICE_TRAY.SETTINGS.PF2E.flatCheck.hint",
				default: true,
				type: Boolean,
				onChange: () => CONFIG.DICETRAY.render()
			}
		};
	}

	_extraButtonsLogic(html) {
		if (game.settings.get("dice-calculator", "flatCheck")) {
			for (const button of html.querySelectorAll(".dice-tray__ad")) {
				button.addEventListener("click", (event) => {
					event.preventDefault();
					const { formula } = event.currentTarget.dataset;
					const actor = canvas.tokens.controlled.length === 1
						? canvas.tokens.controlled[0].actor
						: game.user.character ?? {};
					game.pf2e.Check.roll(new game.pf2e.StatisticModifier(this.flatCheckLabel(formula), []), {
						actor: actor ?? {},
						type: "flat-check",
						dc: { value: formula },
						options: new Set(["flat-check"]),
						createMessage: true,
						skipDialog: true,
					});
				});
			}
		} else {
			super._extraButtonsLogic(html);
		}
	}
}

class starwarsffgDiceMap extends TemplateDiceMap {
	showExtraButtons = false;

	get dice() {
		return [
			{
				dp: {
					tooltip: game.i18n.localize("SWFFG.DiceProficiency"),
					img: "systems/starwarsffg/images/dice/starwars/yellow.png",
					color: "#fef135"
				},
				da: {
					tooltip: game.i18n.localize("SWFFG.DiceAbility"),
					img: "systems/starwarsffg/images/dice/starwars/green.png",
					color: "#46ac4f"
				},
				dc: {
					tooltip: game.i18n.localize("SWFFG.DiceChallenge"),
					img: "systems/starwarsffg/images/dice/starwars/red.png",
					color: "#751317"
				},
				di: {
					tooltip: game.i18n.localize("SWFFG.DiceDifficulty"),
					img: "systems/starwarsffg/images/dice/starwars/purple.png",
					color: "#52287e"
				},
				db: {
					tooltip: game.i18n.localize("SWFFG.DiceBoost"),
					img: "systems/starwarsffg/images/dice/starwars/blue.png",
					color: "#76c3db"
				},
				ds: {
					tooltip: game.i18n.localize("SWFFG.DiceSetback"),
					img: "systems/starwarsffg/images/dice/starwars/black.png",
					color: "#141414"
				},
				df: {
					tooltip: game.i18n.localize("SWFFG.DiceForce"),
					img: "systems/starwarsffg/images/dice/starwars/whiteHex.png",
					color: "#ffffff"
				}
			}
		];
	}
}

class SWADEDiceMap extends TemplateDiceMap {
	removeAdvOnRoll = false;

	get dice() {
		const dice = [
			{
				d4: { img: "icons/dice/d4black.svg" },
				d6: { img: "icons/dice/d6black.svg" },
				d8: { img: "icons/dice/d8black.svg" },
				d10: { img: "icons/dice/d10black.svg" },
				d12: { img: "icons/dice/d12black.svg" }
			}
		];
		return dice;
	}

	get labels() {
		return {
			advantage: game.i18n.localize("DICE_TRAY.WildDie"),
			adv: game.i18n.localize("DICE_TRAY.Wild"),
			disadvantage: game.i18n.localize("DICE_TRAY.ExplodingDie"),
			dis: game.i18n.localize("DICE_TRAY.Ace")
		};
	}

	get settings() {
		return {
			wildDieBehavior: {
				name: "DICE_TRAY.SETTINGS.SWADE.wildDieBehavior.name",
				hint: "DICE_TRAY.SETTINGS.SWADE.wildDieBehavior.hint",
				default: false,
				type: Boolean
			}
		};
	}

	_extraButtonsLogic(html) {
		const advantage = html.querySelector(".dice-tray__advantage");
		const disadvantage = html.querySelector(".dice-tray__disadvantage");
		advantage.addEventListener("click", (event) => {
			event.preventDefault();
			advantage.classList.toggle("active");
			disadvantage.classList.toggle("active", advantage.classList.contains("active"));
		});
		disadvantage.addEventListener("click", (event) => {
			event.preventDefault();
			disadvantage.classList.toggle("active");
			if (!disadvantage.classList.contains("active")) advantage.classList.remove("active");
		});
	}

	rawFormula(qty, dice, html) {
		let roll_suffix = "";
		let add_wild = html.querySelector(".dice-tray__advantage").classList.contains("active");

		if (html.querySelector(".dice-tray__disadvantage").classList.contains("active")) {
			roll_suffix = "x=";
		}

		if (add_wild) {
			if (!game.settings.get("dice-calculator", "wildDieBehavior")) {
				return `{${qty === "" ? 1 : qty}${dice}${roll_suffix},1d6${roll_suffix}}kh`;
			}

			dice = dice.replace("(", "").replace(")", "");
			if (!Number.isNumeric(qty)) {
				return `{1(${dice})${roll_suffix}.*,1d6${roll_suffix}}kh(?<qty>\\d*)`;
			}
			return `{${`1${dice}${roll_suffix},`.repeat(qty)}1d6${roll_suffix}}kh${qty}`;
		}
		return `${qty === "" ? 1 : qty}${dice}${roll_suffix}`;
	}
}

var keymaps = /*#__PURE__*/Object.freeze({
	__proto__: null,
	Template: TemplateDiceMap,
	cosmere: cosmereDiceMap,
	dcc: dccDiceMap,
	demonlord: demonlordDiceMap,
	dnd5e: dnd5eDiceMap,
	fateCoreOfficial: FateDiceMap,
	fatex: FateDiceMap,
	ModularFate: FateDiceMap,
	grimwild: GrimwildDiceMap,
	hexxen1733: HeXXen1733DiceMap,
	pf2e: pf2eDiceMap,
	starwarsffg: starwarsffgDiceMap,
	swade: SWADEDiceMap
});

/**
 * Javascript imports don't support dashes so the workaround
 * for systems with dashes in their names is to create this map.
 */
const KEYS = {
	"cosmere-rpg": "cosmere",
	"fate-core-official": "fateCoreOfficial",
	"hexxen-1733": "hexxen1733"
};

function registerSettings() {
	game.settings.registerMenu("dice-calculator", "DiceRowSettings", {
		name: "DICE_TRAY.SETTINGS.DiceRowSettings",
		label: "DICE_TRAY.SETTINGS.DiceRowSettings",
		icon: "fas fa-cogs",
		type: DiceRowSettings,
		restricted: true,
	});

	game.settings.register("dice-calculator", "enableDiceTray", {
		name: game.i18n.localize("DICE_TRAY.SETTINGS.enableDiceTray.name"),
		hint: game.i18n.localize("DICE_TRAY.SETTINGS.enableDiceTray.hint"),
		scope: "user",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true
	});

	game.settings.register("dice-calculator", "hideAdv", {
		name: game.i18n.localize("DICE_TRAY.SETTINGS.hideAdv.name"),
		hint: game.i18n.localize("DICE_TRAY.SETTINGS.hideAdv.hint"),
		scope: "world",
		config: false,
		default: false,
		type: Boolean
	});

	// Menu Settings

	game.settings.register("dice-calculator", "diceRows", {
		scope: "world",
		config: false,
		default: CONFIG.DICETRAY.dice,
		type: Array,
	});

	game.settings.register("dice-calculator", "compactMode", {
		scope: "world",
		config: false,
		default: false,
		type: Boolean,
	});
	game.settings.register("dice-calculator", "hideNumberInput", {
		scope: "world",
		config: false,
		default: false,
		type: Boolean,
	});
	game.settings.register("dice-calculator", "hideNumberButtons", {
		scope: "world",
		config: false,
		default: false,
		type: Boolean
	});
	game.settings.register("dice-calculator", "hideRollButton", {
		scope: "world",
		config: false,
		default: false,
		type: Boolean,
	});

	game.settings.register("dice-calculator", "popout", {
		name: "DICE_TRAY.SETTINGS.popout.name",
		hint: "DICE_TRAY.SETTINGS.popout.hint",
		scope: "user",
		config: true,
		default: "none",
		choices: {
			none: "",
			tokens: game.i18n.localize("CONTROLS.GroupToken"),
			all: game.i18n.localize("DICE_TRAY.SETTINGS.popout.options.all"),
		},
		type: String,
		onChange: async () => await ui.controls.render({ reset: true })
	});

	game.settings.register("dice-calculator", "autoOpenPopout", {
		name: "DICE_TRAY.SETTINGS.autoOpenPopout.name",
		hint: "DICE_TRAY.SETTINGS.autoOpenPopout.hint",
		scope: "user",
		config: true,
		default: false,
		type: Boolean
	});

	game.settings.register("dice-calculator", "popoutPosition", {
		scope: "user",
		config: false,
		default: {},
		type: Object
	});

	game.settings.register("dice-calculator", "rightClickCommand", {
		name: "DICE_TRAY.SETTINGS.rightClickCommand.name",
		hint: "DICE_TRAY.SETTINGS.rightClickCommand.hint",
		scope: "world",
		config: true,
		type: new foundry.data.fields.StringField({
			required: true,
			blank: false,
			choices: {
				decrease: "DICE_TRAY.SETTINGS.rightClickCommand.options.decrease",
				roll: "DICE_TRAY.SETTINGS.rightClickCommand.options.roll"
			},
			initial: "decrease"
		}),
		onChange: (v) => { CONFIG.DICETRAY._rightClickCommand = v; }
	});

	for (const [key, data] of Object.entries(CONFIG.DICETRAY.settings)) {
		game.settings.register("dice-calculator", key, foundry.utils.mergeObject(
			{
				scope: "world",
				config: true
			},
			data
		));
	}
}

// Initialize module
Hooks.once("init", () => {
	foundry.applications.handlebars.loadTemplates(["modules/dice-calculator/templates/tray.html"]);
});

Hooks.once("i18nInit", () => {
	const newMaps = foundry.utils.deepClone(keymaps);

	Hooks.callAll("dice-calculator.keymaps", newMaps, newMaps.Template);
	const supportedSystemMaps = Object.keys(newMaps).join("|");
	const systemMapsRegex = new RegExp(`^(${supportedSystemMaps})$`);
	const providerStringMaps = getProviderString(systemMapsRegex) || "Template";
	CONFIG.DICETRAY = new newMaps[providerStringMaps]();

	registerSettings();
	game.keybindings.register("dice-calculator", "popout", {
		name: "DICE_TRAY.KEYBINGINDS.popout.name",
		onDown: async () => {
			await CONFIG.DICETRAY.togglePopout();
			if (game.settings.get("dice-calculator", "popout") === "none") return;
			const tool = ui.controls.control.tools.diceTray;
			if (tool) {
				tool.active = !tool.active;
				ui.controls.render();
			}
		}
	});
	if (game.settings.get("dice-calculator", "enableDiceTray")) {
		let wasAtBottom = true;
		Hooks.on("dice-calculator.forceRender", () => CONFIG.DICETRAY.render());
		Hooks.once("renderChatLog", () => CONFIG.DICETRAY.render());
		Hooks.on("renderChatLog", (chatlog, html, data, opt) => {
			if (!chatlog.isPopout) return;
			moveDiceTray();
		});
		Hooks.on("closeChatLog", (chatlog, html, data, opt) => {
			if (!chatlog.isPopout) return;
			moveDiceTray();
		});
		Hooks.on("activateChatLog", (chatlog) => {
			if (ui.chat.popout?.rendered && !ui.chat.isPopout) return;
			moveDiceTray();
		});
		Hooks.on("deactivateChatLog", (chatlog) => {
			if (ui.chat.popout?.rendered && !ui.chat.isPopout) return;
			moveDiceTray();
		});
		Hooks.on("collapseSidebar", (sidebar, wasExpanded) => {
			if (ui.chat.popout?.rendered && !ui.chat.isPopout) return;
			moveDiceTray();
			if (!wasExpanded && wasAtBottom) ui.chat.scrollBottom();
			wasAtBottom = ui.chat.isAtBottom;
		});
	}
});

Hooks.once("ready", () => {
	if (game.settings.get("dice-calculator", "autoOpenPopout")) CONFIG.DICETRAY.togglePopout();
});

function getProviderString(regex) {
	const id = game.system.id;
	if (id in KEYS) {
		return KEYS[id];
	} else if (regex.test(id)) {
		return id;
	}
	return "";
}

function moveDiceTray() {
	const inputElement = document.getElementById("chat-message");
	inputElement.insertAdjacentElement("afterend", CONFIG.DICETRAY.element);
}

Hooks.on("getSceneControlButtons", (controls) => {
	const popout = game.settings.get("dice-calculator", "popout");
	if (popout === "none") return;
	const autoOpenPopout = game.settings.get("dice-calculator", "autoOpenPopout");
	const addButton = (control) => {
		control.tools.diceTray = {
			name: "diceTray",
			title: "Dice Tray",
			icon: "fas fa-dice-d20",
			onChange: () => CONFIG.DICETRAY.togglePopout(),
			active: CONFIG.DICETRAY.popout?.rendered || (!game.ready && autoOpenPopout),
			toggle: true,
		};
	};
	if (popout === "tokens") addButton(controls.tokens);
	else Object.keys(controls).forEach((c) => addButton(controls[c]));
});

// Called when a message is sent through chat
Hooks.on("chatMessage", () => CONFIG.DICETRAY.reset());
//# sourceMappingURL=dice-calculator.js.map
