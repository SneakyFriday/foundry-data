export const registerSettings = function () {
	// Register any custom module settings here
	let modulename = "monks-scene-navigation";

	let backbuttonOptions = {
		'true': game.i18n.localize("MonksSceneNavigation.backbutton.gm"),
		'everyone': game.i18n.localize("MonksSceneNavigation.backbutton.everyone"),
		'false': game.i18n.localize("MonksSceneNavigation.backbutton.none"),
	};

	let scenesizeOptions = {
		'false': game.i18n.localize("MonksSceneNavigation.scene-size.normal"),
		'true': game.i18n.localize("MonksSceneNavigation.scene-size.smaller"),
		'side': game.i18n.localize("MonksSceneNavigation.scene-size.side"),
		'none': game.i18n.localize("MonksSceneNavigation.scene-size.none"),
	};

	let folderOptions = {
		'none': game.i18n.localize("MonksSceneNavigation.folder-option.none"),
		'gm': game.i18n.localize("MonksSceneNavigation.folder-option.gm"),
		'everyone': game.i18n.localize("MonksSceneNavigation.folder-option.everyone")
	};
	
	game.settings.register(modulename, "click-to-view", {
		name: game.i18n.localize("MonksSceneNavigation.click-to-view.name"),
		hint: game.i18n.localize("MonksSceneNavigation.click-to-view.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean
	});
	game.settings.register(modulename, "scene-indicator", {
		name: game.i18n.localize("MonksSceneNavigation.scene-indicator.name"),
		hint: game.i18n.localize("MonksSceneNavigation.scene-indicator.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean
	});
	game.settings.register(modulename, "directory-background", {
		name: game.i18n.localize("MonksSceneNavigation.directory-background.name"),
		hint: game.i18n.localize("MonksSceneNavigation.directory-background.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean
	});
	
	game.settings.register(modulename, "modify-scene-bar", {
		name: game.i18n.localize("MonksSceneNavigation.modify-scene-bar.name"),
		hint: game.i18n.localize("MonksSceneNavigation.modify-scene-bar.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true
	});
	game.settings.register(modulename, "add-back-button", {
		name: game.i18n.localize("MonksSceneNavigation.add-back-button.name"),
		hint: game.i18n.localize("MonksSceneNavigation.add-back-button.hint"),
		scope: "world",
		config: true,
		default: "true",
		type: String,
		choices: backbuttonOptions,
		requiresReload: true
	});
	game.settings.register(modulename, "navigation-folders", {
		name: game.i18n.localize("MonksSceneNavigation.navigation-folders.name"),
		hint: game.i18n.localize("MonksSceneNavigation.navigation-folders.hint"),
		scope: "world",
		config: true,
		default: "gm",
		type: String,
		choices: folderOptions,
		requiresReload: true
	});
	game.settings.register(modulename, "include-active", {
		name: game.i18n.localize("MonksSceneNavigation.include-active.name"),
		hint: game.i18n.localize("MonksSceneNavigation.include-active.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true
	});
	game.settings.register(modulename, "display-realname", {
		name: game.i18n.localize("MonksSceneNavigation.display-realname.name"),
		hint: game.i18n.localize("MonksSceneNavigation.display-realname.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true
	});
	game.settings.register(modulename, "quick-navigation", {
		name: game.i18n.localize("MonksSceneNavigation.quick-navigation.name"),
		hint: game.i18n.localize("MonksSceneNavigation.quick-navigation.hint"),
		scope: "world",
		config: true,
		default: false,
		type: Boolean,
		requiresReload: true
	});
	game.settings.register(modulename, "doubleclick-activate", {
		name: game.i18n.localize("MonksSceneNavigation.doubleclick-activate.name"),
		hint: game.i18n.localize("MonksSceneNavigation.doubleclick-activate.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
		requiresReload: true
	});
	game.settings.register(modulename, "minimize-activate", {
		name: game.i18n.localize("MonksSceneNavigation.minimize-activate.name"),
		hint: game.i18n.localize("MonksSceneNavigation.minimize-activate.hint"),
		scope: "world",
		config: true,
		default: false,
		type: Boolean,
	});
	game.settings.register(modulename, "minimize-combat", {
		name: game.i18n.localize("MonksSceneNavigation.minimize-combat.name"),
		hint: game.i18n.localize("MonksSceneNavigation.minimize-combat.hint"),
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
	});
	game.settings.register(modulename, "smaller-directory", {
		name: game.i18n.localize("MonksSceneNavigation.smaller-directory.name"),
		hint: game.i18n.localize("MonksSceneNavigation.smaller-directory.hint"),
		scope: "world",
		config: true,
		default: "false",
		type: String,
		choices: scenesizeOptions,
		requiresReload: true
	});

	game.settings.register(modulename, "restore", {
		scope: "client",
		config: false,
		default: false,
		type: Boolean,
	});
};
