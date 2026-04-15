function defineVariables(self, desktops = []) {
  const defs = [
    { variableId: 'current_desktop', name: 'Current desktop number' },
    { variableId: 'desktop_count', name: 'Total desktop count' },
    { variableId: 'locked', name: 'Screen locked' },
  ]
  for (const d of desktops) {
    const n = d.position + 1
    defs.push({ variableId: `desktop_${n}_name`, name: `Desktop ${n} name` })
  }
  self.setVariableDefinitions(defs)
}

function setDesktopValues(self, current, count) {
  const values = {}
  if (current !== undefined) values.current_desktop = current
  if (count !== undefined) values.desktop_count = count
  self.setVariableValues(values)
}

function setDesktopNameValues(self, desktops) {
  const values = {}
  for (const d of desktops) {
    const n = d.position + 1
    values[`desktop_${n}_name`] = d.name
  }
  self.setVariableValues(values)
}

module.exports = { defineVariables, setDesktopValues, setDesktopNameValues }
