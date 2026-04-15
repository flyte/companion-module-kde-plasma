const dbus = require('dbus-next')

class Bus {
  constructor(log) {
    this.log = log
    this.bus = null
  }

  async connect() {
    if (!process.env.DBUS_SESSION_BUS_ADDRESS) {
      const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`
      process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${runtimeDir}/bus`
    }
    this.bus = dbus.sessionBus()
    return this.bus
  }

  disconnect() {
    if (this.bus) {
      try { this.bus.disconnect() } catch (_) {}
    }
    this.bus = null
  }
}

module.exports = { Bus }
