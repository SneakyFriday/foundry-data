# 0.12.0
- FoundryVTT v14 support

# 0.11.1

- Fix an issue where activating scenes could fail/produce an error.

# 0.11.0

- Foundry v13 support. Please note due to incorrectly stored data in previous versions of stairways,  if you wish to keep your previous stairways data, you must install v0.10.8 and log into the world to migrate the data before upgrading to Foundry v13.

# 0.10.8

- Migration script for existing stairways documents did not run.

# 0.10.7
- Final v12 version. Please note due to incorrectly stored data in previous versions of stairways,  you need to update to 0.10.7 and load your world to migrate data before upgrading to v13 of Foundry or data will be lost.

# 0.10.6
- Added optional teleporter prompt (thanks to @blairmcmillan)
- Fixed stairways with custom colored labels not rendering
- Fixed stairway icon picker
- Fixed compatibility with ArmsReach module

# 0.10.5
- Fixed pre-existing worlds not launching with mod enabled
- Fixed GM stairway operations only getting synced to clients after a reload

# 0.10.4
- FoundryVTT 11.x support (thanks to @aresius423)

# 0.10.3
- Fixed FoundryVTT 11.x issues (thanks to @aresius423)
- Added target scene label for GM

# 0.10.2
- Apply v0.9.5 Fixes

# 0.10.1
- Apply v0.9.4 Fixes

# 0.10.0
- FoundryVTT 11.x support

# 0.9.5
- Fixed stairway model validation: allow position `0`

# 0.9.4
- Fixed document get for Scene

# 0.9.3
- Fixed stairways on scene import / duplicate

# 0.9.2
- Added portuguese (brazil) language (thanks to @mclemente)
- Added polish language (thanks to Jakub)
- Updated spanish translation

# 0.9.1
- Added german language (thanks to kagedansa)
- Updated spanish translation

# 0.9.0
- FoundryVTT 10.x support
- Added french language (thanks to @rectulo)

# 0.8.99-rc2
- Fixed cross-scene teleport (should work now without refresh)
- Fixed errors on new scene

# 0.8.99-rc1
- Fixed cross-scene teleport
- Fixed stairway config preview (GM Layer)

# 0.8.99-alpha2
- Fixed GM Layer visibility
- Fixed deprecation warnings

# 0.8.99-alpha1
- WiP FoundryVTT 10.x support
- Fixed stairway config window size update

# 0.8.7
- Clean up donation and issue links (thanks to @ghost91-)

# 0.8.6
- Fixed compatiblity with Lib: Document Sheet Registrar

# 0.8.5
- Fixed label position update
- Fixed reset defaults of stairway config

# 0.8.4
- Fixed hide from players when token vision is disabled (thanks to @scapegoat57)
- Fixed stairway data update race condition (thanks to @scapegoat57)

# 0.8.3
- Added custom icon width / height
- Added using partner scene name as label

# 0.8.2
- Fixed stairway status display in configuration sheet
- Fixed icon updates for players
- Fixed error on icon drag

# 0.8.1
- Fixed right click issue (thanks to @scapegoat57)
- Fixed compatibility warning (thanks to @dawciupotter)

# 0.8.0
- WiP FoundryVTT 0.9.x support (thanks to @scapegoat57 and @farling42)

# 0.7.5
- Add spanish language (contributed by @WallaceMcGregor)

# 0.7.4
- Improve compatibility with layer injection of other modules

# 0.7.3
- Fixed reload loop on data migration (again)

# 0.7.2
- Fixed reload loop on data migration

# 0.7.1
- Added donation and issue report link
- Added data migration when required fields are missing
- Workaround for incompatibility with incomplete layer injection of other modules

# 0.7.0
- FoundryVTT 0.8.x support

# 0.6.0
- Added label text style config
- Improved stairway paste (GM View)

# 0.5.3
- Added sourceData to hooks
- Fixed data in StairwayTeleport hook

# 0.5.2
- Improved teleport within scene performance
- Fixed label text stroke
- Fixed line draw order
- Fixed "position fixed" bug

# 0.5.1
- Added 'hide' shortcut (alt + right click) in player view
- Fixed Icon drawing issue (Cannot read property 'scale' of null)
- Fixed Stairway connection wasn't always updated on configuration change
- Fixed GM teleport between scenes with no token selected
- Fixed other placeables where shown on drag and drop (GM layer)

# 0.5.0
- Improved teleport handling when multiple GMs are connected
- Added Hooks `PreStairwayTeleport` and `StairwayTeleport` for developers

# 0.4.2
- Fixed missing tokens after teleport between scenes

# 0.4.1
- Improved teleport between scenes:
    - no more scene reloading on teleport
    - fixes "No token on scene" warning for players

# 0.4.0
- Added stairway (text) labels
- Added option to disable (lock) stairways
- Added option to hide stairways from players
- Allow stairway usage without a selected token for GM
- Fixed SightLayer not updated on all changes. This should fix missing / missplaced stairway icons for players.

# 0.3.0
- Allow custom stairway icons

# 0.2.0
- Stairways between two scenes
- Colored stairway status in GM tool
- Configuration: move animation instead of teleport within scene

# 0.1.0
First release.
