const dbus = require('dbus-next')
const { Variant } = dbus

const SERVICE = 'org.kde.KWin'
const KWIN_PATH = '/KWin'
const KWIN_IFACE = 'org.kde.KWin'
const VDM_PATH = '/VirtualDesktopManager'
const VDM_IFACE = 'org.kde.KWin.VirtualDesktopManager'

const SS_SERVICE = 'org.freedesktop.ScreenSaver'
const SS_PATH = '/ScreenSaver'
const SS_IFACE = 'org.freedesktop.ScreenSaver'

class KWinDbus {
  constructor(logger) {
    this.log = logger
    this.bus = null
    this.kwin = null
    this.vdm = null
    this.vdmProps = null
    this.screensaver = null
    this.onDesktopChanged = null
    this.onDesktopsChanged = null
    this.onLockChanged = null
    this._onCurrentChanged = null
    this._onDesktopsChanged = null
    this._onActiveChanged = null
  }

  async connect() {
    try {
      if (!process.env.DBUS_SESSION_BUS_ADDRESS) {
        const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`
        process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${runtimeDir}/bus`
      }
      this.bus = dbus.sessionBus()
      const obj = await this.bus.getProxyObject(SERVICE, KWIN_PATH)
      this.kwin = obj.getInterface(KWIN_IFACE)

      const vdmObj = await this.bus.getProxyObject(SERVICE, VDM_PATH)
      this.vdm = vdmObj.getInterface(VDM_IFACE)
      this.vdmProps = vdmObj.getInterface('org.freedesktop.DBus.Properties')

      this._onCurrentChanged = async (id) => {
        try {
          const ids = await this.getDesktopIds()
          const match = ids.find((d) => d.id === id)
          const pos = match ? match.position + 1 : null
          if (pos && this.onDesktopChanged) this.onDesktopChanged(pos)
        } catch (err) {
          this.log('error', `currentChanged handler failed: ${err.message}`)
        }
      }
      this.vdm.on('currentChanged', this._onCurrentChanged)

      this._onDesktopsChanged = () => {
        if (this.onDesktopsChanged) {
          Promise.resolve(this.onDesktopsChanged()).catch((err) =>
            this.log('error', `onDesktopsChanged failed: ${err.message}`)
          )
        }
      }

      // KWin's introspection declares desktopDataChanged as (iss) but it
      // actually emits (uss), so dbus-next's typed proxy silently drops
      // the signal. Subscribe via a raw match rule instead.
      const matchRule =
        `type='signal',sender='${SERVICE}',interface='${VDM_IFACE}',path='${VDM_PATH}'`
      await this.bus._addMatch(matchRule)
      this._matchRule = matchRule
      this._onBusMessage = (msg) => {
        if (msg.type !== dbus.MessageType.SIGNAL) return
        if (msg.interface !== VDM_IFACE) return
        if (msg.member !== 'desktopDataChanged' &&
            msg.member !== 'desktopCreated' &&
            msg.member !== 'desktopRemoved') return
        this._onDesktopsChanged()
      }
      this.bus.on('message', this._onBusMessage)

      try {
        const ssObj = await this.bus.getProxyObject(SS_SERVICE, SS_PATH)
        this.screensaver = ssObj.getInterface(SS_IFACE)
        this._onActiveChanged = (active) => {
          if (this.onLockChanged) this.onLockChanged(Boolean(active))
        }
        this.screensaver.on('ActiveChanged', this._onActiveChanged)
      } catch (err) {
        this.log('warn', `ScreenSaver subscribe failed: ${err.message}`)
      }
    } catch (err) {
      this.disconnect()
      throw err
    }
  }

  async getCurrentDesktop() {
    const n = await this.kwin.currentDesktop()
    return Number(n)
  }

  async getDesktopCount() {
    const variant = await this.vdmProps.Get(VDM_IFACE, 'count')
    return Number(variant.value)
  }

  async getDesktopIds() {
    const variant = await this.vdmProps.Get(VDM_IFACE, 'desktops')
    return variant.value.map((d) => ({ position: Number(d[0]), id: d[1], name: d[2] }))
  }

  async getLocked() {
    if (!this.screensaver) return false
    return Boolean(await this.screensaver.GetActive())
  }

  async next() { await this.kwin.nextDesktop() }
  async previous() { await this.kwin.previousDesktop() }

  async gotoIndex(oneBased) {
    const ids = await this.getDesktopIds()
    const sorted = [...ids].sort((a, b) => a.position - b.position)
    const target = sorted[oneBased - 1]
    if (!target) throw new Error(`desktop index ${oneBased} out of range (count=${sorted.length})`)
    await this.vdmProps.Set(VDM_IFACE, 'current', new Variant('s', target.id))
  }

  disconnect() {
    if (this.vdm && this._onCurrentChanged) {
      try { this.vdm.removeListener('currentChanged', this._onCurrentChanged) } catch (_) {}
    }
    if (this.bus) {
      if (this._onBusMessage) {
        try { this.bus.removeListener('message', this._onBusMessage) } catch (_) {}
      }
      if (this._matchRule) {
        try { this.bus._removeMatch(this._matchRule) } catch (_) {}
      }
    }
    if (this.screensaver && this._onActiveChanged) {
      try { this.screensaver.removeListener('ActiveChanged', this._onActiveChanged) } catch (_) {}
    }
    this._onCurrentChanged = null
    this._onDesktopsChanged = null
    this._onActiveChanged = null
    this._onBusMessage = null
    this._matchRule = null
    if (this.bus) {
      try { this.bus.disconnect() } catch (_) {}
    }
    this.bus = null
    this.kwin = null
    this.vdm = null
    this.vdmProps = null
    this.screensaver = null
  }
}

module.exports = { KWinDbus }
