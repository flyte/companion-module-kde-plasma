class Registry {
  constructor(self) {
    this.self = self
    this.slots = new Map()
  }

  scopedFor(featureId) {
    let slot = this.slots.get(featureId)
    if (!slot) {
      slot = { actions: {}, feedbacks: {}, variables: [], presets: {} }
      this.slots.set(featureId, slot)
    }
    const parent = this
    return {
      addAction(id, def) { slot.actions[id] = def },
      addFeedback(id, def) { slot.feedbacks[id] = def },
      addVariable(variableId, name) { slot.variables.push({ variableId, name }) },
      replacePresets(presets) {
        slot.presets = presets
        parent.flush()
      },
    }
  }

  remove(featureId) {
    this.slots.delete(featureId)
  }

  clear() {
    this.slots.clear()
  }

  flush() {
    const actions = {}
    const feedbacks = {}
    const presets = {}
    const variables = []
    for (const [featureId, slot] of this.slots) {
      for (const [id, def] of Object.entries(slot.actions)) {
        if (actions[id]) this.self.log('warn', `action id collision: ${id} in feature ${featureId}`)
        actions[id] = def
      }
      for (const [id, def] of Object.entries(slot.feedbacks)) {
        if (feedbacks[id]) this.self.log('warn', `feedback id collision: ${id} in feature ${featureId}`)
        feedbacks[id] = def
      }
      for (const [id, def] of Object.entries(slot.presets)) {
        if (presets[id]) this.self.log('warn', `preset id collision: ${id} in feature ${featureId}`)
        presets[id] = def
      }
      variables.push(...slot.variables)
    }
    this.self.setActionDefinitions(actions)
    this.self.setFeedbackDefinitions(feedbacks)
    this.self.setVariableDefinitions(variables)
    this.self.setPresetDefinitions(presets)
  }
}

module.exports = { Registry }
