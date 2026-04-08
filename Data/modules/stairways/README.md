# Stairways (Teleporter)

Stairways is a module to easily create and maintain stairways which can teleport tokens between two stairways.

From a player perspective these look similar to doors but will teleport on a click instead of open/close:

![stairways-player](https://gitlab.com/SWW13/foundryvtt-stairways/-/raw/media/stairways-player-3.mp4)

For a GM they work similar to light/sound sources:
- They can be created by simple clicking on the map.
- They can be moved with click and drag.
- They snap to half-grid, except when `shift` is pressed.
- They can be deleted when highlighted by pressing the `delete` key.
- They can be copied and pasted (`ctrl+c` / `ctrl+v`).
- They have a configuration sheet that can be opened by `double-click`.
- Connection of stairways is shown by a line between them.

![stairways-gm](https://gitlab.com/SWW13/foundryvtt-stairways/-/raw/media/stairways-gm-3.mp4)

They use a name to pair with another stairway. These names are automatically generated when created by a `click`, but can be manually changed in the configuration sheet:

![stairway-main-configuration](https://gitlab.com/SWW13/foundryvtt-stairways/-/raw/media/stairway-configuration-4-main.webp)
![stairway-label-configuration](https://gitlab.com/SWW13/foundryvtt-stairways/-/raw/media/stairway-configuration-4-label.webp)

## Usage

They are similar to light/sound sources and should have the same functionality.

If something isn't setup correct they will show a colored border indicating the problem, you can open the configuration sheet with `double click` for a detailed message or look up the colors below.

### Player View

Players + GM:
- Left click: Teleport (works without Token for GM)

GM:
- Right click: Disable stairway for players (lock)
- Alt + right click: Hide stairway from

### Create new stairway pair

Within Scene:
1. Create first stairway by a click (should now be highlighted as connection target)
2. Create second stairway by a click (should show a connection line)

Between Scenes
1. Create first stairway by a click (should now be highlighted as connection target)
2. Switch to target scene
3. Create second stairway by a click (should now have a blue background for multi-scene)
    - This will automatically update the first stairways target scene

### Connect existing stairways

Note: If you have more than one unconnected stairway you probably want delete them.

1. Make sure the stairway you want to connect to is the connection target (highlighted)
    - If no stairway is the connection target (highlighted) you can choose one by hovering them
    - If another stairway is the connection target (highlighted) you need to delete it first
2. Create second stairway by a click (either within scene or on another scene)

### Follow Stairway (GM View)

You can follow a stairway by right click.
This will switch the scene (if necessary) and then pan to the target stairway (if available).

## Icon

You can change the icon of each stairway in the configuration sheet (`double click`). Choose between a set of preselected foundry icons (`click` to select) or choose a custom icon with the image browser.

![stairway-icons](https://gitlab.com/SWW13/foundryvtt-stairways/-/raw/media/stairway-icons.webp)

## Status Colors

![stairways-gm-status-color](https://gitlab.com/SWW13/foundryvtt-stairways/-/raw/media/stairways-gm-status-color.webp)

## Translations

You can help translate Stairways using Weblate on Foundry Hub:

<a href="https://weblate.foundryvtt-hub.com/engage/stairways/">
<img src="https://weblate.foundryvtt-hub.com/widgets/stairways/-/multi-auto.svg" alt="Translation status" />
</a>

## Integrations

### FoundryVTT Arms Reach

Since `v0.5.3` the usage range of stairways can be limited to nearby tokens with [FoundryVTT Arms Reach](https://github.com/p4535992/foundryvtt-arms-reach) (`v1.0.11`).

## Hooks (for Developers)
Hooks are only executed for the user using the stairway.

`PreStairwayTeleport` is called before a teleport is executed. When any of executed hooks return `false` the teleport is aborted.

`StairwayTeleport` is called after a teleport.

### Data
```js
const data = {
    /// scene id of the stairway used (source scene of teleport)
    sourceSceneId,
    /// stairway data of the source stairway (WARNING: this data may change in the future)
    sourceData,
    /// id's of all selected token (tokens beeing teleported)
    selectedTokenIds,
    /// target scene id of the stairway or `null` (target scene of the teleport of `null` if current scene)
    targetSceneId,
    /// stairway data of the target stairway (WARNING: this data may change in the future)
    targetData,
    /// id of the user using the stairway (current user)
    userId
}

/// WARNING: internal data - do not use if possible
// sourceData and targetData schema is defined in: src/StairwayData.js
```

### Example
```js
Hooks.on('PreStairwayTeleport', (data) => {
    const { sourceSceneId, sourceData, selectedTokenIds, targetSceneId, targetData, userId } = data

    // disallow multi-scene teleport
    if (targetSceneId !== null) {
        ui.notifications.info('You Shall Not Pass!')
        return false
    }
})
Hooks.on('StairwayTeleport', console.log)
```

### Future Compatibility
Future development tries to only extend `data` and `sourceData` / `targetData` with new fields, but this is not guaranteed and breaking changes may arise.

#### Changes

- `0.5.3`: added `sourceData`

## Technical details

Stairways are implemented with their own layer similar to existing controls like light/sound.
They are stored as an `EmbeddedEntity` of a scene.

There are a bunch of unintended hooks involved as layers are hardcoded in foundry and a new layer needs to be added in many places.
This also comes with a big technical complexity as the backend doesn't allow adding a custom `EmbeddedEntity` and rejects saving them.
So there needs to be some backend logic emulated for data mutation, data save location needs to be redirected and wrapping of `modifyEmbeddedDocument` events in own events.

This is due to foundry lacking intended ways of adding own layers and own embedded entities.
Adding own embedded entities would require patching the backend, which isn't possible from a module.

## Development

For pull requests please make sure your code is probably formatted.

You can install the linter with `yarn`:
```sh
yarn
```

Run linter:
```sh
yarn lint
```

Format code:
```sh
yarn format
```
