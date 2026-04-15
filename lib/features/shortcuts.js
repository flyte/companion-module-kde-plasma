const DAEMON_SERVICE = 'org.kde.kglobalaccel'
const DAEMON_PATH = '/kglobalaccel'
const DAEMON_IFACE = 'org.kde.KGlobalAccel'
const COMPONENT_IFACE = 'org.kde.kglobalaccel.Component'

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
  },

  async destroy() {
    if (this._teardown) {
      this._teardown()
      this._teardown = null
    }
  },
}