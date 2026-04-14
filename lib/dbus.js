const dbus = require('dbus-next')
const { Variant } = dbus

const SERVICE = 'org.kde.KWin'
const KWIN_PATH = '/KWin'
const KWIN_IFACE = 'org.kde.KWin'
const VDM_PATH = '/VirtualDesktopManager'
const VDM_IFACE = 'org.kde.KWin.VirtualDesktopManager'

class KWinDbus {
  constructor(logger) {
    this.log = logger
    this.bus = null
    this.kwin = null
    this.vdm = null
    this.vdmProps = null
    this.onDesktopChanged = null
    this._onCurrentDesktopChanged = null
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
    this._onCurrentChanged = null
    if (this.bus) {
      try { this.bus.disconnect() } catch (_) {}
    }
    this.bus = null
    this.kwin = null
    this.vdm = null
    this.vdmProps = null
  }
}

module.exports = { KWinDbus }
