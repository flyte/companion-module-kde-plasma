const { InstanceBase, runEntrypoint, InstanceStatus } = require('@companion-module/base')
const { KWinDbus } = require('./lib/dbus')
const { defineVariables, setDesktopValues, setDesktopNameValues } = require('./lib/variables')
const { defineActions } = require('./lib/actions')
const { defineFeedbacks } = require('./lib/feedbacks')
const { definePresets } = require('./lib/presets')

class KWinDesktopInstance extends InstanceBase {
  async init(config) {
    this.config = config
    this.updateStatus(InstanceStatus.Connecting)
    this.dbus = new KWinDbus((lvl, msg) => this.log(lvl, msg))
    defineActions(this)
    defineFeedbacks(this)
    await this.connectWithRetry()
  }

  async connectWithRetry() {
    try {
      await this.dbus.connect()
      const current = await this.dbus.getCurrentDesktop()
      const count = await this.dbus.getDesktopCount()
      const ids = await this.dbus.getDesktopIds()
      this.currentDesktop = current
      defineVariables(this, ids)
      setDesktopValues(this, current, count)
      setDesktopNameValues(this, ids)
      definePresets(this, ids)
      this.dbus.onDesktopsChanged = async () => {
        const freshIds = await this.dbus.getDesktopIds()
        const freshCount = await this.dbus.getDesktopCount()
        defineVariables(this, freshIds)
        setDesktopValues(this, this.currentDesktop, freshCount)
        setDesktopNameValues(this, freshIds)
        definePresets(this, freshIds)
        this.log('debug', `desktops changed → ${freshIds.length} desktops`)
      }
      try {
        this.locked = await this.dbus.getLocked()
      } catch (_) {
        this.locked = false
      }
      this.setVariableValues({ locked: this.locked })
      this.dbus.onLockChanged = (active) => {
        this.locked = active
        this.log('debug', `screen ${active ? 'locked' : 'unlocked'}`)
        this.setVariableValues({ locked: active })
        this.checkFeedbacks('is_locked')
      }
      this.dbus.onDesktopChanged = (n) => {
        this.currentDesktop = n
        this.log('debug', `currentDesktopChanged → ${n}`)
        setDesktopValues(this, n)
        this.checkFeedbacks('on_desktop')
      }
      this.log('info', `KWin connected: desktop ${current}/${count}`)
      this.updateStatus(InstanceStatus.Ok)
    } catch (err) {
      this.log('error', `KWin DBus connect failed: ${err.message}`)
      this.updateStatus(InstanceStatus.ConnectionFailure, err.message)
      this.reconnectTimer = setTimeout(() => this.connectWithRetry(), 5000)
    }
  }

  async destroy() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.dbus) this.dbus.disconnect()
    this.log('info', 'KWin desktop module destroyed')
  }

  async configUpdated(config) {
    this.config = config
  }

  getConfigFields() {
    return []
  }
}

runEntrypoint(KWinDesktopInstance, [])
