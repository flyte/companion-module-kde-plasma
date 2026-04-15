const { InstanceBase, runEntrypoint, InstanceStatus } = require('@companion-module/base')
const { Bus } = require('./lib/core/bus')
const { Registry } = require('./lib/core/registry')
const features = require('./lib/features')

class KWinDesktopInstance extends InstanceBase {
  async init(config) {
    this.config = config || {}
    this._destroyed = false
    this.registry = new Registry(this)
    this.busWrapper = new Bus((lvl, msg) => this.log(lvl, msg))
    this.activeFeatures = []
    this.failedFeatures = []
    this.updateStatus(InstanceStatus.Connecting)
    await this.connectWithRetry()
  }

  featureEnabled(feature) {
    const key = `feature_${feature.id}`
    return this.config[key] !== false
  }

  async loadFeatures() {
    this.activeFeatures = []
    this.failedFeatures = []
    for (const feature of features) {
      if (!this.featureEnabled(feature)) continue
      const ctx = {
        bus: this.busWrapper.bus,
        log: (lvl, msg) => this.log(lvl, `[${feature.id}] ${msg}`),
        registry: this.registry.scopedFor(feature.id),
        checkFeedbacks: (id) => this.checkFeedbacks(id),
        setVariableValues: (values) => this.setVariableValues(values),
        moduleLabel: this.label,
      }
      try {
        await feature.init(ctx)
        this.activeFeatures.push(feature)
        this.log('info', `feature ${feature.id} initialized`)
      } catch (err) {
        this.log('error', `feature ${feature.id} init failed: ${err.message}`)
        this.registry.remove(feature.id)
        this.failedFeatures.push({ feature, error: err })
      }
    }
    this.registry.flush()
  }

  async teardownFeatures() {
    for (const feature of this.activeFeatures) {
      try {
        await feature.destroy()
      } catch (err) {
        this.log('error', `feature ${feature.id} destroy failed: ${err.message}`)
      }
    }
    this.activeFeatures = []
    this.registry.clear()
  }

  updateLifecycleStatus() {
    const anyEnabled = features.some((f) => this.featureEnabled(f))
    if (!anyEnabled) {
      this.updateStatus(InstanceStatus.BadConfig, 'no features enabled')
      return
    }
    if (this.failedFeatures.length > 0 && this.activeFeatures.length > 0) {
      const names = this.failedFeatures.map((f) => f.feature.id).join(', ')
      this.updateStatus(InstanceStatus.UnknownWarning, `features failed: ${names}`)
      return
    }
    if (this.activeFeatures.length === 0) {
      const names = this.failedFeatures.map((f) => f.feature.id).join(', ')
      this.updateStatus(InstanceStatus.UnknownWarning, `all features failed: ${names}`)
      return
    }
    this.updateStatus(InstanceStatus.Ok)
  }

  async connectWithRetry() {
    try {
      await this.busWrapper.connect()
      if (this._destroyed) return
      await this.loadFeatures()
      if (this._destroyed) return
      this.updateLifecycleStatus()
      this.log('info', `KWin module ready: ${this.activeFeatures.length} feature(s) active`)
    } catch (err) {
      if (this._destroyed) return
      this.log('error', `KWin DBus connect failed: ${err.message}`)
      this.updateStatus(InstanceStatus.ConnectionFailure, err.message)
      this.reconnectTimer = setTimeout(() => this.connectWithRetry(), 5000)
    }
  }

  async destroy() {
    this._destroyed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    await this.teardownFeatures()
    if (this.busWrapper) this.busWrapper.disconnect()
    this.log('info', 'KWin module destroyed')
  }

  async configUpdated(config) {
    const prev = this.config || {}
    this.config = config || {}
    if (this._destroyed) return
    const toggleChanged = features.some(
      (f) => (prev[`feature_${f.id}`] !== false) !== (this.config[`feature_${f.id}`] !== false)
    )
    if (!toggleChanged) return
    if (!this.busWrapper.bus) return
    this.log('info', 'feature toggles changed, reloading features')
    await this.teardownFeatures()
    await this.loadFeatures()
    this.updateLifecycleStatus()
  }

  getConfigFields() {
    return features.map((f) => ({
      type: 'checkbox',
      id: `feature_${f.id}`,
      label: f.label,
      default: true,
      width: 12,
    }))
  }
}

runEntrypoint(KWinDesktopInstance, [])