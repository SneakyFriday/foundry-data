'use strict'

import { handleTeleportRequestGM, handleTokenSelectRequestPlayer } from './teleport.js'
import { hookModifyDocument, handleModifyEmbeddedDocument } from './dataQuirks.js'
import { injectControls } from './toolbar.js'
import { injectStairways } from './injection.js'
import { performMigrations, migrationNeeded } from './migration.js'
import { registerSettings } from './settings.js'
import { Stairway } from './Stairway.js'
import { StairwayLayer } from './StairwayLayer.js'

Hooks.once('init', () => {
  // stairway settings
  registerSettings()

  // inject stairway layer / embedded document in hardcoded places
  // but skip this if there is a migration to run
  if (migrationNeeded()) return

  injectStairways()
})

Hooks.on('setup', async () => {
  if (migrationNeeded()) return

  // redirect modifyDocument events for Stairway
  hookModifyDocument()

  // handle own events
  game.socket.on('module.stairways', (message) => {
    const { eventName, data } = message

    if (eventName === 'modifyDocument') {
      handleModifyEmbeddedDocument(data)
    } else if (eventName === 'teleportRequestGM') {
      handleTeleportRequestGM(data)
    } else if (eventName === 'tokenSelectRequestPlayer') {
      handleTokenSelectRequestPlayer(data)
    } else {
      console.error('unknown eventName:', eventName, data)
    }
  })
})

Hooks.once('ready', async () => {
  // migrate data and settings
  await performMigrations()
})

Hooks.on('getSceneControlButtons', (controls) => {
  if (!game.user.isGM) return
  injectControls(controls)
})

Hooks.on('sightRefresh', (sightLayer) => {
  if (migrationNeeded()) return

  // Stairway Icons (filtered by current level)
  const currentLevelId = canvas.level?.id ?? foundry.documents.BaseScene.metadata.defaultLevelId
  for (const sw of canvas.controls.stairways.children) {
    const stairwayLevelId = sw.stairway.document.level ?? foundry.documents.BaseScene.metadata.defaultLevelId
    const onCurrentLevel = stairwayLevelId === currentLevelId
    sw.visible = onCurrentLevel && (!sw.stairway.document.hidden || game.user.isGM)
    if (sightLayer.tokenVision) {
      sw.visible &&= sw.isVisible
    }
  }
})

Hooks.on(`paste${Stairway.embeddedName}`, StairwayLayer.onPasteStairway)

Hooks.on('renderModuleManagement', async (moduleManagement, html) => {
  if (!game.modules.get('module-credits')?.active) {
    const tags = await renderTemplate('modules/stairways/templates/module-management-tags.hbs')
    html.find('li[data-module-name="stairways"] .package-overview .package-title').after(tags)
  }
})
