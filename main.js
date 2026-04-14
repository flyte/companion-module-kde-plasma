const { InstanceBase, runEntrypoint, InstanceStatus } = require('@companion-module/base')

class KWinDesktopInstance extends InstanceBase {
  async init(config) {
    this.config = config
    this.updateStatus(InstanceStatus.Connecting)
    this.log('info', 'KWin desktop module initializing')
    this.updateStatus(InstanceStatus.Ok, 'Scaffold only')
  }

  async destroy() {
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
