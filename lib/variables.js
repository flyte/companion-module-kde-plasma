function defineVariables(self) {
  self.setVariableDefinitions([
    { variableId: 'current_desktop', name: 'Current desktop number' },
    { variableId: 'desktop_count', name: 'Total desktop count' },
  ])
}

function setDesktopValues(self, current, count) {
  const values = {}
  if (current !== undefined) values.current_desktop = current
  if (count !== undefined) values.desktop_count = count
  self.setVariableValues(values)
}

module.exports = { defineVariables, setDesktopValues }
