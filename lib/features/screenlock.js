const SS_SERVICE = 'org.freedesktop.ScreenSaver'
const SS_PATH = '/ScreenSaver'
const SS_IFACE = 'org.freedesktop.ScreenSaver'

const { combineRgb } = require('@companion-module/base')

module.exports = {
  id: 'screenlock',
  label: 'Screen lock',

  async init(ctx) {
    const { bus, log, registry, checkFeedbacks, setVariableValues } = ctx

    const cleanups = []
    this._teardown = () => {
      while (cleanups.length) {
        const fn = cleanups.pop()
        try { fn() } catch (_) {}
      }
    }

    const ssObj = await bus.getProxyObject(SS_SERVICE, SS_PATH)
    const screensaver = ssObj.getInterface(SS_IFACE)

    const state = { locked: false }

    registry.addVariable('locked', 'Screen locked')
    registry.addFeedback('is_locked', {
      type: 'boolean',
      name: 'Screen locked',
      description: 'Active when the KDE screen lock is engaged',
      defaultStyle: {
        bgcolor: combineRgb(200, 0, 0),
        color: combineRgb(255, 255, 255),
      },
      options: [],
      callback: () => Boolean(state.locked),
    })

    try {
      state.locked = Boolean(await screensaver.GetActive())
    } catch (_) {
      state.locked = false
    }
    setVariableValues({ locked: state.locked })

    const onActiveChanged = (active) => {
      state.locked = Boolean(active)
      log('debug', `screen ${state.locked ? 'locked' : 'unlocked'}`)
      setVariableValues({ locked: state.locked })
      checkFeedbacks('is_locked')
    }
    screensaver.on('ActiveChanged', onActiveChanged)
    cleanups.push(() => screensaver.removeListener('ActiveChanged', onActiveChanged))
  },

  async destroy() {
    if (this._teardown) {
      this._teardown()
      this._teardown = null
    }
  },
}