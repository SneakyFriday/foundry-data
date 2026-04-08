export const SETTINGS_KEY = 'stairways'

export function registerSettings () {
  game.settings.register(SETTINGS_KEY, 'dataVersion', {
    scope: 'world',
    config: false,
    type: String,
    default: 'fresh install'
  })

  game.settings.register(SETTINGS_KEY, 'promptPlayer', {
    name: 'stairways.settings.prompt-player.name',
    hint: 'stairways.settings.prompt-player.hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false
  })
}
