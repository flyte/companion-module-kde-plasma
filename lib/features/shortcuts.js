const { combineRgb } = require('@companion-module/base')

const DAEMON_SERVICE = 'org.kde.kglobalaccel'
const DAEMON_PATH = '/kglobalaccel'
const DAEMON_IFACE = 'org.kde.KGlobalAccel'
const COMPONENT_IFACE = 'org.kde.kglobalaccel.Component'

const PRESET_BUNDLE = [
  { id: 'audio_mute',         category: 'Audio',       text: 'Mute',       shortcut: 'kmix::mute' },
  { id: 'audio_vol_up',       category: 'Audio',       text: 'Vol +',      shortcut: 'kmix::increase_volume' },
  { id: 'audio_vol_down',     category: 'Audio',       text: 'Vol -',      shortcut: 'kmix::decrease_volume' },
  { id: 'audio_mic_up',       category: 'Audio',       text: 'Mic +',      shortcut: 'kmix::increase_microphone_volume' },
  { id: 'audio_mic_down',     category: 'Audio',       text: 'Mic -',      shortcut: 'kmix::decrease_microphone_volume' },
  { id: 'brightness_up',      category: 'Brightness',  text: 'Bright +',   shortcut: 'org_kde_powerdevil::Increase Screen Brightness' },
  { id: 'brightness_down',    category: 'Brightness',  text: 'Bright -',   shortcut: 'org_kde_powerdevil::Decrease Screen Brightness' },
  { id: 'media_play_pause',   category: 'Media',       text: 'Play/Pause', shortcut: 'mediacontrol::playpausemedia' },
  { id: 'media_next',         category: 'Media',       text: 'Next',       shortcut: 'mediacontrol::nextmedia' },
  { id: 'media_previous',     category: 'Media',       text: 'Prev',       shortcut: 'mediacontrol::previousmedia' },
  { id: 'session_sleep',      category: 'Session',     text: 'Sleep',      shortcut: 'org_kde_powerdevil::Sleep' },
  { id: 'screenshot_region',  category: 'Screenshots', text: 'Snip',       shortcut: 'org.kde.spectacle.desktop::RectangularRegionScreenShot' },
  { id: 'window_overview',    category: 'Windows',     text: 'Overview',   shortcut: 'kwin::Overview' },
  { id: 'window_grid',        category: 'Windows',     text: 'Grid',       shortcut: 'kwin::Grid View' },
  { id: 'window_peek',        category: 'Windows',     text: 'Peek',       shortcut: 'kwin::Show Desktop' },
]

function buildBundledPresets() {
  const presets = {}
  for (const p of PRESET_BUNDLE) {
    presets[p.id] = {
      type: 'button',
      category: p.category,
      name: p.text,
      style: {
        text: p.text,
        size: 'auto',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(0, 0, 0),
      },
      steps: [
        {
          down: [{ actionId: 'kde_shortcut_trigger', options: { shortcut: p.shortcut } }],
          up: [],
        },
      ],
      feedbacks: [],
    }
  }
  // Lock Session also displays the is_locked feedback (provided by the
  // screenlock feature). If screenlock is disabled the feedback reference
  // is harmlessly dangling.
  presets.session_lock = {
    type: 'button',
    category: 'Session',
    name: 'Lock',
    style: {
      text: 'Lock',
      size: 'auto',
      color: combineRgb(255, 255, 255),
      bgcolor: combineRgb(0, 0, 0),
    },
    steps: [
      {
        down: [{ actionId: 'kde_shortcut_trigger', options: { shortcut: 'ksmserver::Lock Session' } }],
        up: [],
      },
    ],
    feedbacks: [
      {
        feedbackId: 'is_locked',
        options: {},
        style: {
          bgcolor: combineRgb(200, 0, 0),
          color: combineRgb(255, 255, 255),
          text: 'Locked',
        },
      },
    ],
  }
  return presets
}

module.exports = {
  id: 'shortcuts',
  label: 'KDE global shortcuts',

  async init(ctx) {
    const { bus, log, registry } = ctx

    const cleanups = []
    this._teardown = () => {
      while (cleanups.length) {
        const fn = cleanups.pop()
        try { fn() } catch (_) {}
      }
    }

    const daemonObj = await bus.getProxyObject(DAEMON_SERVICE, DAEMON_PATH)
    const daemon = daemonObj.getInterface(DAEMON_IFACE)

    const componentPaths = await daemon.allComponents()

    // id → { componentPath, shortcutUnique }
    const byId = new Map()
    const choices = []

    for (const componentPath of componentPaths) {
      try {
        const compObj = await bus.getProxyObject(DAEMON_SERVICE, componentPath)
        const comp = compObj.getInterface(COMPONENT_IFACE)
        const infos = await comp.allShortcutInfos()
        for (const info of infos) {
          const shortcutUnique = info[0]
          const shortcutFriendly = info[1]
          const componentUnique = info[2]
          const componentFriendly = info[3]
          const id = `${componentUnique}::${shortcutUnique}`
          const label = `${componentFriendly} → ${shortcutFriendly}`
          if (byId.has(id)) continue
          byId.set(id, { componentPath, shortcutUnique })
          choices.push({ id, label })
        }
      } catch (err) {
        log('warn', `skipping component ${componentPath}: ${err.message}`)
      }
    }

    if (choices.length === 0) {
      throw new Error('kglobalaccel returned no shortcuts')
    }

    choices.sort((a, b) => a.label.localeCompare(b.label))

    log('info', `discovered ${choices.length} KDE global shortcuts across ${componentPaths.length} components`)

    registry.addAction('kde_shortcut_trigger', {
      name: 'Trigger KDE global shortcut',
      options: [
        {
          type: 'dropdown',
          id: 'shortcut',
          label: 'Shortcut',
          default: choices.length > 0 ? choices[0].id : '',
          choices,
        },
      ],
      callback: async (event) => {
        const id = event.options.shortcut
        const entry = byId.get(id)
        if (!entry) {
          log('warn', `shortcut not found: ${id}`)
          return
        }
        try {
          const compObj = await bus.getProxyObject(DAEMON_SERVICE, entry.componentPath)
          const comp = compObj.getInterface(COMPONENT_IFACE)
          await comp.invokeShortcut(entry.shortcutUnique)
        } catch (err) {
          log('error', `invokeShortcut failed for ${id}: ${err.message}`)
        }
      },
    })

    registry.replacePresets(buildBundledPresets())
  },

  async destroy() {
    if (this._teardown) {
      this._teardown()
      this._teardown = null
    }
  },
}