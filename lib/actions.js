function defineActions(self) {
  self.setActionDefinitions({
    desktop_next: {
      name: 'Next desktop',
      options: [],
      callback: async () => {
        try { await self.dbus.next() }
        catch (e) { self.log('error', `next failed: ${e.message}`) }
      },
    },
    desktop_previous: {
      name: 'Previous desktop',
      options: [],
      callback: async () => {
        try { await self.dbus.previous() }
        catch (e) { self.log('error', `previous failed: ${e.message}`) }
      },
    },
    desktop_goto: {
      name: 'Go to desktop N',
      options: [
        {
          type: 'number',
          id: 'n',
          label: 'Desktop number (1-based)',
          default: 1,
          min: 1,
          max: 64,
        },
      ],
      callback: async (event) => {
        const n = Number(event.options.n)
        try { await self.dbus.gotoIndex(n) }
        catch (e) { self.log('error', `goto ${n} failed: ${e.message}`) }
      },
    },
  })
}

module.exports = { defineActions }
