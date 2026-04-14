const { combineRgb } = require('@companion-module/base')

function defineFeedbacks(self) {
  self.setFeedbackDefinitions({
    on_desktop: {
      type: 'boolean',
      name: 'On desktop',
      description: 'Active when the current KWin desktop matches the given number',
      defaultStyle: {
        bgcolor: combineRgb(0, 200, 0),
        color: combineRgb(0, 0, 0),
      },
      options: [
        {
          type: 'number',
          id: 'n',
          label: 'Desktop number',
          default: 1,
          min: 1,
          max: 64,
        },
      ],
      callback: (feedback) => {
        const current = self.currentDesktop
        return current !== undefined && Number(feedback.options.n) === current
      },
    },
  })
}

module.exports = { defineFeedbacks }
