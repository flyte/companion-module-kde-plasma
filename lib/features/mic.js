const { spawn } = require('child_process')
const { combineRgb } = require('@companion-module/base')

const SOURCE = '@DEFAULT_SOURCE@'
const SOURCE_EVENT_RE = /^Event '\w+' on source #\d+$/

function fetchMuted() {
  return new Promise((resolve, reject) => {
    const proc = spawn('pactl', ['get-source-mute', SOURCE])
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => { out += d })
    proc.stderr.on('data', (d) => { err += d })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `pactl exited ${code}`))
      const m = /Mute:\s*(yes|no)/.exec(out)
      if (!m) return reject(new Error(`unexpected pactl output: ${out.trim()}`))
      resolve(m[1] === 'yes')
    })
  })
}

module.exports = {
  id: 'mic',
  label: 'Microphone mute',

  async init(ctx) {
    const { log, registry, checkFeedbacks, setVariableValues } = ctx

    const cleanups = []
    this._teardown = () => {
      while (cleanups.length) {
        const fn = cleanups.pop()
        try { fn() } catch (_) {}
      }
    }

    const state = { muted: await fetchMuted() }

    registry.addVariable('mic_muted', 'Microphone muted')
    registry.addFeedback('mic_is_muted', {
      type: 'boolean',
      name: 'Microphone muted',
      description: 'Active when the default audio source is muted',
      defaultStyle: {
        bgcolor: combineRgb(200, 0, 0),
        color: combineRgb(255, 255, 255),
      },
      options: [],
      callback: () => Boolean(state.muted),
    })

    registry.flush()
    setVariableValues({ mic_muted: state.muted })

    const sub = spawn('pactl', ['subscribe'])
    let buffer = ''
    const onStdout = async (chunk) => {
      buffer += chunk.toString()
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        if (!SOURCE_EVENT_RE.test(line)) continue
        try {
          const muted = await fetchMuted()
          if (muted === state.muted) continue
          state.muted = muted
          log('debug', `mic ${muted ? 'muted' : 'unmuted'}`)
          setVariableValues({ mic_muted: muted })
          checkFeedbacks('mic_is_muted')
        } catch (err) {
          log('error', `mic fetch failed: ${err.message}`)
        }
      }
    }
    sub.stdout.on('data', onStdout)
    sub.on('error', (err) => log('error', `pactl subscribe error: ${err.message}`))
    sub.on('close', (code) => log('warn', `pactl subscribe exited (code ${code})`))

    cleanups.push(() => {
      sub.stdout.removeListener('data', onStdout)
      try { sub.kill() } catch (_) {}
    })
  },

  async destroy() {
    if (this._teardown) {
      this._teardown()
      this._teardown = null
    }
  },
}
