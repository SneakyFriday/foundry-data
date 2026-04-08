
import { log, setting, i18n, patchFunc } from '../monks-scene-navigation.js';
export class MonksNavigation extends CONFIG.ui.nav {
    constructor(folder, options = {}) {
        super(options);
    }

    dragEntity;

    dropTarget;

    static DEFAULT_OPTIONS = {
        classes: ["monks-navigation"],
        actions: {
            showPrevious: MonksNavigation.showPrevious,
            toggleFolder: MonksNavigation.toggleFolder
        }
    };

    static PARTS = {
        scenes: {
            root: true,
            template: "./modules/monks-scene-navigation/templates/navigation.hbs",
            templates: ["modules/monks-scene-navigation/templates/navigation-menu-partial.hbs"]
        }
    };

    async _onFirstRender(_context, _options) {
        await super._onFirstRender(_context, _options);
        if (!game.user.isGM) return;
        // Set the previous scene to the current viewed scene
        this._createContextMenu(this._getFolderContextMenuOptions, ".folder", {
            fixed: true,
            hookName: "getSceneFolderContextOptions",
            parentClassHooks: false
        });
    }

    async _onRender(_context, _options) {
        this.setCollapseTooltip(`SCENE_NAVIGATION.${this.expanded ? "COLLAPSE" : "EXPAND"}`);

        // Set the previous tooltip to empty if no scene is active
        this.setPreviousTooltip(this._lastScene ? `Return to: ${this._lastScene.navName || this._lastScene.name}` : "No previous scene");

        let canGoBack = setting("add-back-button") == "everyone" || (setting("add-back-button") == "true" && game.user.isGM);
        if (canGoBack)
            $(this.element).addClass("allow-previous");

        if (!game.user.isGM) return;

        // Drag and Drop
        new foundry.applications.ux.DragDrop.implementation({
            dragSelector: ".scene,.folder",
            dropSelector: "#scene-navigation-inactive",
            callbacks: {
                dragstart: this.onDragStart.bind(this),
                dragover: this.onDragOver.bind(this),
                drop: this.onDragDrop.bind(this)
            }
        }).bind(this.element);

        const scenes = $(this.element).find('.scene.view:not(.active)');
        scenes.dblclick(this._onClickScene2.bind(this));
    }

    async _prepareContext(_options) {
        const scenes = this.prepareMenuItems();
        return {
            scenes,
            canExpand: scenes.inactive.scenes.length || scenes.inactive.folders.length,
            canGoBack: setting("add-back-button") == "everyone" || (setting("add-back-button") == "true" && game.user.isGM),
            useFolders: setting("navigation-folders") == "everyone" || (setting("navigation-folders") == "gm" && game.user.isGM)
        };
    }

    prepareMenuItems() {
        const userScenes = game.users.reduce((obj, u) => {
            if (!u.active) return obj;
            obj[u.viewedScene] ||= [];
            obj[u.viewedScene].push({ name: u.name, letter: u.name[0], color: u.color.multiply(0.5).css, border: u.color, self: u.isSelf });
            return obj;
        }, {});
        const scenes = {
            active: [], inactive: { folders: [], scenes: [] }
        };

        let useFolders = setting("navigation-folders") == "everyone" || (setting("navigation-folders") == "gm" && game.user.isGM);

        for (const scene of game.scenes.filter(s => s.folder == null || !useFolders)) {
            this.prepareScene(scene, scenes.active, scenes.inactive.scenes, userScenes);
        }

        if (useFolders) {
            for (const folder of game.scenes.folders.filter(f => f.folder == null)) {
                let f = this.prepareFolder(folder, scenes.active, userScenes);
                if (f) {
                    scenes.inactive.folders.push(f);
                }
            }
        }
        
        scenes.active.sort((a, b) => (b.isView - a.isView) || (b.active - a.active) || (a.navOrder - b.navOrder));
        scenes.inactive.scenes.sort((a, b) => a.navOrder - b.navOrder);
        scenes.inactive.folders.sort((a, b) => a.navOrder - b.navOrder);
        
        return scenes;
    }

    prepareScene(scene, activeScenes, inactiveScenes, userScenes) {
        const { active, isView } = scene;
        const visible = active || isView || (scene.navigation && scene.visible);
        if (!visible) return;

        const hasUser = userScenes[scene.id] && userScenes[scene.id].filter(u => !u.self).length > 0;

        let tooltip = (game.user.isGM && scene.navName) ? scene.name : "";
        let name = scene.navName || scene.name;

        if (setting("display-realname") && game.user.isGM) {
            let temp = name;
            name = tooltip || name;
            tooltip = temp;
        }

        const s = {
            id: scene.id,
            active,
            isView,
            navOrder: scene.navOrder,
            name,
            tooltip: tooltip != name ? tooltip : null,
            users: userScenes[scene.id],
            cssClass: [
                isView ? "view" : null,
                active ? "active" : null,
                hasUser ? "user": null,
                scene.ownership.default === 0 ? "gm" : null,
                tooltip != name && game.user.isGM ? "italic" : null
            ].filterJoin(" ")
        };
        let addToActive = active || isView || s.users?.length;
        if (addToActive) activeScenes.push(s);
        if (setting("include-active") || !addToActive)
            inactiveScenes.push(s);
    }

    prepareFolder(folder, active, userScenes) {
        if (!folder) return;

        let navopen = game.user.getFlag("monks-scene-navigation", "navopen" + folder.id) || false;

        const f = {
            id: folder.id,
            uuid: folder.uuid,
            name: folder.name,
            navopen,
            cssClass: [
                "folder",
                navopen ? "expanded" : null
            ].filterJoin(" "),
            color: folder.color,
            scenes: [],
            folders: []
        };

        for (let scene of folder.contents) {
            this.prepareScene(scene, active, f.scenes, userScenes);
        }
        for (let subfolder of folder.children) {
            let subf = this.prepareFolder(subfolder.folder, active, userScenes);
            if (subf) {
                f.folders.push(subf);
            }
        }

        f.scenes.sort((a, b) => a.navOrder - b.navOrder);
        f.folders.sort((a, b) => a.navOrder - b.navOrder);

        if (f.scenes.length > 0 || f.folders.length > 0) 
            return f;

        // If no scenes or folders, return null
        return null;
    }

    setPreviousTooltip(tooltip) {
        const button = this.element.querySelector("#scene-navigation-previous");
        if (!button) return;
        button.dataset.tooltip = tooltip;
        button.setAttribute("aria-label", game.i18n.localize(tooltip));
    }

    _getContextMenuOptions() {
        let contextmenu = super._getContextMenuOptions();

        let toggleNav = contextmenu.find(o => o.name === "SCENE.ToggleNav");
        toggleNav.name = "MonksSceneNavigation.RemoveNav";

        contextmenu.push(...[
            {
                name: "MonksSceneNavigation.SetViewPosition",
                icon: '<i class="fas fa-crop-alt"></i>',
                condition: li => game.user.isGM && game.scenes.get(li.dataset.sceneId)._view,
                callback: li => {
                    let scene = game.scenes.get(li.dataset.sceneId);
                    let x = parseInt(canvas.stage.pivot.x);
                    let y = parseInt(canvas.stage.pivot.y);
                    let scale = canvas.stage.scale.x;
                    scene.update({ initial: { x: x, y: y, scale: scale } }, { diff: false });
                    ui.notifications.info("Captured canvas position as initial view.")
                }
            },
            {
                name: "MonksSceneNavigation.PullAllPlayers",
                icon: '<i class="fa-solid fa-diamond-turn-right"></i>',
                condition: li => game.user.isGM && (game.scenes.get(li.dataset.sceneId)._view || game.scenes.get(li.dataset.sceneId).active),
                callback: li => {
                    let scene = game.scenes.get(li.dataset.sceneId);
                    const users = game.users.filter(u => u.active && u.isGM === false && !u.isSelf);
                    if (users.length !== 0 && scene)
                        scene.pullUsers(users);
                }
            }
        ]);

        return contextmenu;
    }

    _getFolderContextMenuOptions() {
        let contextmenu = [
            {
                name: "FOLDER.Edit",
                icon: '<i class="fa-solid fa-pen-to-square"></i>',
                condition: game.user.isGM,
                callback: async header => {
                    const li = header.closest(".folder");
                    const folder = await fromUuid(li.dataset.uuid);
                    const { top, left } = li.getBoundingClientRect();
                    return folder.sheet.render({
                        force: true,
                        position: { top, left: left - FolderConfig.DEFAULT_OPTIONS.position.width - 10 }
                    });
                }
            }
        ];

        return contextmenu;
    }
    /*
    _onDragStart(event) {
        const folderId = event.currentTarget.dataset.folderId;
        if (folderId) {
            const folder = game.folders.get(folderId);
            event.dataTransfer.setData("text/plain", JSON.stringify(folder.toDragData()));
        } else
            super._onDragStart(event);
    }

    async _onDrop(event) {
        if (!setting('modify-scene-bar'))
            return super._onDrop(event);

        let dropTarget = ($(event.target).hasClass('scene-list') ? $('.scene:last', event.target).get(0) : event.target.closest(".scene")) || null;

        // Process drop data
        const data = TextEditor.getDragEventData(event);
        if (data.type == "Scene") {
            // Identify the document, the drop target, and the set of siblings
            const scene = await Scene.implementation.fromDropData(data);
            const sibling = dropTarget ? game.scenes.get(dropTarget.dataset.sceneId) : null;
            if (sibling && (sibling.id === scene.id)) return;
            const siblings = this.scenes.filter(s => s.id !== scene.id && s.folder == scene.folder && s instanceof Scene);

            // Update the navigation sorting for each Scene
            return scene.sortRelative({
                target: sibling,
                siblings: siblings,
                sortKey: "navOrder"
            });
        } else if (data.type == "Folder") {
            const folder = await Folder.implementation.fromDropData(data);
            const sibling = dropTarget ? game.folders.get(dropTarget.dataset.folderId) : null;
            if (sibling && (sibling.id === folder.id)) return;
            const siblings = game.folders.filter(f => f.id !== folder.id && f.folder == folder.folder && f.type == "Scene");

            // Update the navigation sorting for each Scene
            return folder.sortRelative({
                target: sibling,
                siblings: siblings,
                sortKey: "sort"
            });
        }
    }
    */

    static showPrevious() {
        if (this._lastScene)
            this._lastScene.view();
    }

    _onClickScene(event) {
        //delay for a bit just in case we're double clicking
        let that = this;
        let clickScene = super._onClickScene;
        window.setTimeout(function () {
            if (!that.doubleclick && !canvas.loading)
                clickScene.call(that, event);
            delete that.doubleclick;
        }, 400);
    }

    _onClickScene2(event) {
        if (setting("doubleclick-activate")) {
            this.doubleclick = true;
            event.preventDefault();
            let sceneId = event.currentTarget.dataset.sceneId;
            game.scenes.get(sceneId).activate();
        }
    }

    onDragStart(event) {
        const target = event.target.closest(".scene,.folder");
        this.dragEntity = target.dataset.sceneId ? game.scenes.get(target.dataset.sceneId) : game.folders.get(target.dataset.folderId);
    }

    onDragOver(event) {
        const target = event.target.closest(".scene,.folder");
        if (target === this.dropTarget) return;

        // Remove drop target highlight
        if (this.dropTarget) this.dropTarget.classList.remove("drop-target-before", "drop-target-after");
        this.dropTarget = target;
        let entityId = target?.dataset.sceneId || target?.dataset.folderId;
        if (!target || (entityId === this.dragEntity.id)) return;

        // Add drop target highlight
        const entity = target.dataset.sceneId ? game.scenes.get(target.dataset.sceneId) : game.folders.get(target.dataset.folderId);
        if (target.collectionName != entity?.collectionName) return;
        const dropClass = this.dragEntity.navOrder < entity.navOrder ? "drop-target-after" : "drop-target-before";
        target.classList.add(dropClass);
    }

    async onDragDrop(event) {
        if (this.dropTarget) {
            this.dropTarget.classList.remove("drop-target-before", "drop-target-after");
            this.dropTarget = undefined;
        }

        // Retrieve the drag target Scene
        const entity = this.dragEntity;
        this.dragEntity = undefined;
        if (!entity) return;

        // Retrieve the drop target Scene
        const li = event.target.closest(".scene,.folder");
        const target = li?.dataset.sceneId ? game.scenes.get(li?.dataset.sceneId) : game.folders.get(li?.dataset.folderId);
        if (!target || (target === entity) || !["scenes", "folders"].includes(target.collectionName) || !["scenes", "folders"].includes(entity.collectionName)) return;

        // Sort Scenes on navOrder relative to siblings
        let usingFolder = setting("navigation-folders") == "everyone" || (setting("navigation-folders") == "gm" && game.user.isGM);
        const siblings = game.scenes.filter(s => s !== entity && (s.folder?.id === (li?.dataset.sceneId ? target.folder?.id : target.id) || !usingFolder));
        await entity.sortRelative({ sortKey: "navOrder", target, siblings, updateData: { folder: target.collectionName == "folders" ? target.id : target.folder?.id } });
    }

    static toggleFolder(event, target) {
        let folderId = target.closest(".folder").dataset.folderId;

        let navopen = game.user.getFlag("monks-scene-navigation", "navopen" + folderId) || false;
        navopen = !navopen;

        if (navopen) {
            // Collapse all other expanded folders
            $(target.closest(".folder")).siblings(".folder.expanded").each(function () {
                MonksNavigation.toggleFolder(event, this);
            });
        }

        $(target.closest(".folder")).toggleClass("expanded", navopen);

        let updates = {};
        updates["navopen" + folderId] = navopen;

        game.user.update({ flags: { 'monks-scene-navigation': updates } });
    }

    setCollapseTooltip(tooltip) {
        const button = this.element.querySelector("#scene-navigation-expand");
        if (!button) return;
        button.dataset.tooltip = tooltip;
        button.setAttribute("aria-label", game.i18n.localize(tooltip));
    }

    toggleExpanded(expanded) {
        expanded ??= !this.expanded;
        this.element.classList.toggle("expanded", expanded);
        this.setCollapseTooltip(`SCENE_NAVIGATION.${expanded ? "COLLAPSE" : "EXPAND"}`);
        Hooks.callAll("collapseSceneNavigation", this, !expanded);

        game.user.setFlag("monks-scene-navigation", "expanded", expanded);
    }
}