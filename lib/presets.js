const { combineRgb } = require('@companion-module/base')

function definePresets(self, desktops) {
  const presets = {}
  const sorted = [...desktops].sort((a, b) => a.position - b.position)

  for (const d of sorted) {
    const n = d.position + 1
    presets[`goto_${n}`] = {
      type: 'button',
      category: 'Virtual desktops',
      name: `Go to ${d.name}`,
      style: {
        text: `$(${self.label}:desktop_${n}_name)`,
        size: 'auto',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(0, 0, 0),
      },
      steps: [
        {
          down: [{ actionId: 'desktop_goto', options: { n } }],
          up: [],
        },
      ],
      feedbacks: [
        {
          feedbackId: 'on_desktop',
          options: { n },
          style: {
            bgcolor: combineRgb(0, 200, 0),
            color: combineRgb(0, 0, 0),
          },
        },
      ],
    }
  }

  self.setPresetDefinitions(presets)
}

module.exports = { definePresets }
