export const MODE_STAIRWAY = 'stairway'

export const injectControls = (controls) => {
  // determine wall's position in the top level controls
  const wallOrder = controls.walls.order

  // increase order of other controls to place stairways in the position after walls
  for (const key in controls) {
    const val = controls[key]
    if (val?.order > wallOrder) val.order++
  }

  // create and add the stairways control
  controls.stairways = {
    name: 'stairways',
    title: 'stairways.ui.controls.group',
    layer: 'stairways',
    icon: 'far fa-building',
    visible: game.user.isGM,
    order: wallOrder + 1,
    onChange: (event, active) => {
      if (active) canvas.stairways.activate()
    },
    onToolChange: () => canvas.stairways.setAllRenderFlags({ refreshState: true }),
    activeTool: MODE_STAIRWAY,
    tools: {
      stairway: {
        name: MODE_STAIRWAY,
        title: 'stairways.ui.controls.stairway',
        icon: 'fas fa-building',
        interaction: true,
        control: true
      },
      disabled: {
        name: 'disabled',
        title: 'stairways.ui.controls.disabled',
        icon: 'fas fa-lock',
        toggle: true,
        active: !!canvas?.stairways?._disabled,
        onChange: toggled => { canvas.stairways._disabled = toggled }
      },
      hidden: {
        name: 'hidden',
        title: 'stairways.ui.controls.hidden',
        icon: 'fas fa-eye-slash',
        toggle: true,
        active: !!canvas?.stairways?._hidden,
        onChange: toggled => { canvas.stairways._hidden = toggled }
      },
      animate: {
        name: 'animate',
        title: 'stairways.ui.controls.animate',
        icon: 'fas fa-walking',
        toggle: true,
        active: !!canvas?.stairways?._animate,
        onChange: toggled => { canvas.stairways._animate = toggled }
      },
      clear: {
        name: 'clear',
        title: 'stairways.ui.controls.clear',
        icon: 'fas fa-trash',
        onChange: () => canvas.stairways.deleteAll(),
        button: true
      }
    }
  }
}
