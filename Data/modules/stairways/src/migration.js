import { SETTINGS_KEY } from './settings.js'

export const CURRENT_VERSION = '0.12.0'

export const migrationNeeded = () => {
  return foundry.utils.isNewerVersion(CURRENT_VERSION, game.settings.get(SETTINGS_KEY, 'dataVersion'))
}

export const performMigrations = async () => {
  // only run migrations as GM
  if (!game.user.isGM) {
    return
  }

  // data version
  const dataVersion = game.settings.get(SETTINGS_KEY, 'dataVersion')

  // set data version on first install
  if (dataVersion === 'fresh install') {
    await setCurrentVersion()
  } else if (dataVersion === '0.3.0') {
    await updateDataSchema030()
  } else if (foundry.utils.isNewerVersion('0.10.8', dataVersion)) {
    await updateDataSchema0108()
  } else if (foundry.utils.isNewerVersion('0.12.0', dataVersion)) {
    await updateDataSchema0120()
  }
}

const setCurrentVersion = async () => {
  await game.settings.set(SETTINGS_KEY, 'dataVersion', CURRENT_VERSION)
}

const updateDataSchema0108 = async () => {
  for (const scene of game.scenes) {
    // previously flag data was stored as an array, this is not allowed in v13, covert to object
    // this won't work mostly, as it looks like this is often lost during migration
    const data = Array.isArray(scene.flags.stairways)
      ? foundry.utils.duplicate(scene.flags.stairways)
      : Array.isArray(scene.flags.stairways?.data)
        ? foundry.utils.duplicate(scene.flags.stairways.data)
        : []

    await scene.update({
      _id: scene._id,
      flags: {
        stairways: {
          data
        }
      }
    })

    scene.stairways = data
  }

  await setCurrentVersion()
  window.location.reload()
}

const updateDataSchema0120 = async () => {
  // add level field to existing stairways (null = default level)
  for (const scene of game.scenes) {
    const data = scene.flags.stairways?.data
    if (!Array.isArray(data) || data.length === 0) continue

    let needsUpdate = false
    for (const stairway of data) {
      if (!('level' in stairway)) {
        stairway.level = null
        needsUpdate = true
      }
    }

    if (needsUpdate) {
      await scene.update({ 'flags.stairways.data': data })
    }
  }

  await setCurrentVersion()
}

const updateDataSchema030 = async () => {
  const sceneErrors = []

  // make sure required fields are present
  for (const scene of game.scenes) {
    const stairways = foundry.utils.duplicate(scene.flags.stairways?.data ?? [])

    for (const stairway of stairways) {
      const errors = []

      // document id is required
      if (typeof stairway._id !== 'string') {
        stairway._id = foundry.utils.randomID(16)
        errors.push('_id')
      }

      // name is required
      if (typeof stairway.name !== 'string') {
        stairway.name = 'sw-' + foundry.utils.randomID(8)
        errors.push('name')
      }

      // position must be a number
      if (typeof stairway.x !== 'number') {
        stairway.x = 0
        errors.push('x')
      }
      if (typeof stairway.y !== 'number') {
        stairway.y = 0
        errors.push('y')
      }

      // log errors
      if (errors.length > 0) {
        sceneErrors.push(scene.id)
        console.error('Invalid stairway data detected!')
        console.log(errors, stairway, scene)
      }
    }

    // update data when fixed
    if (sceneErrors.includes(scene.id)) {
      await scene.update({ 'flags.stairways.data': stairways })
    }
  }

  await setCurrentVersion()

  // reload page when data was fixed
  if (sceneErrors.length > 0) {
    window.location.reload()
  }
}
