const dbus = require('dbus-next')
const { combineRgb } = require('@companion-module/base')
const { Variant } = dbus

const SERVICE = 'org.kde.KWin'
const KWIN_PATH = '/KWin'
const KWIN_IFACE = 'org.kde.KWin'
const VDM_PATH = '/VirtualDesktopManager'
const VDM_IFACE = 'org.kde.KWin.VirtualDesktopManager'

module.exports = {
  id: 'desktops',
  label: 'Virtual desktops',

  async init(ctx) {
    const { bus, log, registry, checkFeedbacks, setVariableValues } = ctx

    const cleanups = []
    this._teardown = () => {
      while (cleanups.length) {
        const fn = cleanups.pop()
        try { fn() } catch (_) {}
      }
    }

    const kwinObj = await bus.getProxyObject(SERVICE, KWIN_PATH)
    const kwin = kwinObj.getInterface(KWIN_IFACE)

    const vdmObj = await bus.getProxyObject(SERVICE, VDM_PATH)
    const vdm = vdmObj.getInterface(VDM_IFACE)
    const vdmProps = vdmObj.getInterface('org.freedesktop.DBus.Properties')

    const state = {
      currentDesktop: undefined,
      desktops: [],
    }

    async function getDesktopIds() {
      const variant = await vdmProps.Get(VDM_IFACE, 'desktops')
      return variant.value.map((d) => ({ position: Number(d[0]), id: d[1], name: d[2] }))
    }

    async function getCurrentDesktop() {
      const n = await kwin.currentDesktop()
      return Number(n)
    }

    async function getDesktopCount() {
      const variant = await vdmProps.Get(VDM_IFACE, 'count')
      return Number(variant.value)
    }

    async function gotoIndex(oneBased) {
      const ids = await getDesktopIds()
      const sorted = [...ids].sort((a, b) => a.position - b.position)
      const target = sorted[oneBased - 1]
      if (!target) throw new Error(`desktop index ${oneBased} out of range (count=${sorted.length})`)
      await vdmProps.Set(VDM_IFACE, 'current', new Variant('s', target.id))
    }

    function buildPresets(desktopList) {
      const presets = {}
      const sorted = [...desktopList].sort((a, b) => a.position - b.position)
      for (const d of sorted) {
        const n = d.position + 1
        presets[`goto_${n}`] = {
          type: 'button',
          category: 'Virtual desktops',
          name: `Go to ${d.name}`,
          style: {
            text: `$(${ctx.moduleLabel}:desktop_${n}_name)`,
            size: 'auto',
            color: combineRgb(255, 255, 255),
            bgcolor: combineRgb(0, 0, 0),
          },
          steps: [
            {
              down: [{ actionId: 'desktop_goto', options: { n } }],
              up: [],
            },
          ],
          feedbacks: [
            {
              feedbackId: 'on_desktop',
              options: { n },
              style: {
                bgcolor: combineRgb(0, 200, 0),
                color: combineRgb(0, 0, 0),
              },
            },
          ],
        }
      }
      return presets
    }

    function applyDesktopNameValues(desktopList) {
      const values = {}
      for (const d of desktopList) {
        const n = d.position + 1
        values[`desktop_${n}_name`] = d.name
      }
      setVariableValues(values)
    }

    // --- register actions ---
    registry.addAction('desktop_next', {
      name: 'Next desktop',
      options: [],
      callback: async () => {
        try { await kwin.nextDesktop() }
        catch (e) { log('error', `next failed: ${e.message}`) }
      },
    })
    registry.addAction('desktop_previous', {
      name: 'Previous desktop',
      options: [],
      callback: async () => {
        try { await kwin.previousDesktop() }
        catch (e) { log('error', `previous failed: ${e.message}`) }
      },
    })
    registry.addAction('desktop_goto', {
      name: 'Go to desktop N',
      options: [
        { type: 'number', id: 'n', label: 'Desktop number (1-based)', default: 1, min: 1, max: 64 },
      ],
      callback: async (event) => {
        const n = Number(event.options.n)
        try { await gotoIndex(n) }
        catch (e) { log('error', `goto ${n} failed: ${e.message}`) }
      },
    })

    // --- register feedback ---
    registry.addFeedback('on_desktop', {
      type: 'boolean',
      name: 'On desktop',
      description: 'Active when the current KWin desktop matches the given number',
      defaultStyle: {
        bgcolor: combineRgb(0, 200, 0),
        color: combineRgb(0, 0, 0),
      },
      options: [
        { type: 'number', id: 'n', label: 'Desktop number', default: 1, min: 1, max: 64 },
      ],
      callback: (feedback) => {
        return state.currentDesktop !== undefined && Number(feedback.options.n) === state.currentDesktop
      },
    })

    // --- register fixed variables ---
    registry.addVariable('current_desktop', 'Current desktop number')
    registry.addVariable('desktop_count', 'Total desktop count')

    // --- initial fetch ---
    state.currentDesktop = await getCurrentDesktop()
    const count = await getDesktopCount()
    state.desktops = await getDesktopIds()

    // Per-desktop name variables are append-only: registry has no replace-scope API,
    // so shrinking desktop count leaves harmless orphaned vars. Accepted YAGNI.
    for (const d of state.desktops) {
      const n = d.position + 1
      registry.addVariable(`desktop_${n}_name`, `Desktop ${n} name`)
    }

    // Flush definitions before setting values — Companion drops values for
    // variables it hasn't been told about yet.
    registry.replacePresets(buildPresets(state.desktops))
    setVariableValues({
      current_desktop: state.currentDesktop,
      desktop_count: count,
    })
    applyDesktopNameValues(state.desktops)

    // --- signals ---
    const onCurrentChanged = async (id) => {
      try {
        const ids = await getDesktopIds()
        const match = ids.find((d) => d.id === id)
        const pos = match ? match.position + 1 : null
        if (pos) {
          state.currentDesktop = pos
          log('debug', `currentDesktopChanged → ${pos}`)
          setVariableValues({ current_desktop: pos })
          checkFeedbacks('on_desktop')
        }
      } catch (err) {
        log('error', `currentChanged handler failed: ${err.message}`)
      }
    }
    vdm.on('currentChanged', onCurrentChanged)
    cleanups.push(() => vdm.removeListener('currentChanged', onCurrentChanged))

    // KWin's introspection declares desktopDataChanged as (iss) but it
    // actually emits (uss), so dbus-next's typed proxy silently drops the
    // signal. Subscribe via a raw match rule instead.
    const matchRule = `type='signal',sender='${SERVICE}',interface='${VDM_IFACE}',path='${VDM_PATH}'`
    await bus._addMatch(matchRule)
    cleanups.push(() => { bus._removeMatch(matchRule).catch(() => {}) })
    const onBusMessage = async (msg) => {
      if (msg.type !== dbus.MessageType.SIGNAL) return
      if (msg.interface !== VDM_IFACE) return
      if (msg.member !== 'desktopDataChanged' &&
          msg.member !== 'desktopCreated' &&
          msg.member !== 'desktopRemoved') return
      try {
        const freshIds = await getDesktopIds()
        const freshCount = await getDesktopCount()
        state.desktops = freshIds
        for (const d of freshIds) {
          const n = d.position + 1
          registry.addVariable(`desktop_${n}_name`, `Desktop ${n} name`)
        }
        registry.replacePresets(buildPresets(freshIds))
        setVariableValues({ desktop_count: freshCount })
        applyDesktopNameValues(freshIds)
        log('debug', `desktops changed → ${freshIds.length} desktops`)
      } catch (err) {
        log('error', `desktopsChanged handler failed: ${err.message}`)
      }
    }
    bus.on('message', onBusMessage)
    cleanups.push(() => bus.removeListener('message', onBusMessage))
  },

  async destroy() {
    if (this._teardown) {
      this._teardown()
      this._teardown = null
    }
  },
}