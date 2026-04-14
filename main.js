const { InstanceBase, runEntrypoint, InstanceStatus } = require('@companion-module/base')
const { KWinDbus } = require('./lib/dbus')
const { defineVariables, setDesktopValues } = require('./lib/variables')

class KWinDesktopInstance extends InstanceBase {
  async init(config) {
    this.config = config
    this.updateStatus(InstanceStatus.Connecting)
    this.dbus = new KWinDbus((lvl, msg) => this.log(lvl, msg))
    try {
      await this.dbus.connect()
      const current = await this.dbus.getCurrentDesktop()
      const count = await this.dbus.getDesktopCount()
      this.log('info', `KWin connected: desktop ${current}/${count}`)
      defineVariables(this)
      setDesktopValues(this, current, count)
      this.updateStatus(InstanceStatus.Ok)
    } catch (err) {
      this.log('error', `KWin DBus connect failed: ${err.message}`)
      this.updateStatus(InstanceStatus.ConnectionFailure, err.message)
    }
  }

  async destroy() {
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
