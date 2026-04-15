const { spawn } = require('child_process')
const { combineRgb } = require('@companion-module/base')

const SINK = '@DEFAULT_SINK@'
const SOURCE = '@DEFAULT_SOURCE@'
const VOL_STEP_DEFAULT = 5
const DEBOUNCE_MS = 100
const BACKOFF_INITIAL_MS = 500
const BACKOFF_MAX_MS = 30_000

// Matches 'Event '<name>' on sink', 'on source', 'on server', 'on sink #N',
// 'on source #N'. Intentionally excludes sink-input, source-output, client,
// module, card.
const RELEVANT_EVENT_RE = /^Event '\w+' on (sink|source|server)(?: #\d+)?$/

function pactl(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('pactl', args)
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => { out += d })
    proc.stderr.on('data', (d) => { err += d })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `pactl ${args[0]} exited ${code}`))
      resolve(out)
    })
  })
}

function parseMute(out) {
  const m = /Mute:\s*(yes|no)/.exec(out)
  if (!m) throw new Error(`unexpected mute output: ${out.trim()}`)
  return m[1] === 'yes'
}

function parseVolume(out) {
  // Volume: front-left: 45875 /  70% / -9.16 dB, front-right: ...
  // Take the first channel percentage; channels are near-identical in practice.
  const m = /(\d+)%/.exec(out)
  if (!m) throw new Error(`unexpected volume output: ${out.trim()}`)
  return Number(m[1])
}

async function fetchAll() {
  const [
    sinkMuteOut,
    sinkVolOut,
    sinkDefaultOut,
    srcMuteOut,
    srcVolOut,
    srcDefaultOut,
    sinksJson,
    sourcesJson,
  ] = await Promise.all([
    pactl(['get-sink-mute', SINK]),
    pactl(['get-sink-volume', SINK]),
    pactl(['get-default-sink']),
    pactl(['get-source-mute', SOURCE]),
    pactl(['get-source-volume', SOURCE]),
    pactl(['get-default-source']),
    pactl(['--format=json', 'list', 'sinks']),
    pactl(['--format=json', 'list', 'sources']),
  ])
  const sinks = JSON.parse(sinksJson)
  const sources = JSON.parse(sourcesJson)
  const defaultSinkName = sinkDefaultOut.trim()
  const defaultSourceName = srcDefaultOut.trim()
  const sinkEntry = sinks.find((s) => s.name === defaultSinkName)
  const sourceEntry = sources.find((s) => s.name === defaultSourceName)
  return {
    speakerMuted: parseMute(sinkMuteOut),
    speakerVolume: parseVolume(sinkVolOut),
    speakerDevice: (sinkEntry && sinkEntry.description) || defaultSinkName,
    micMuted: parseMute(srcMuteOut),
    micVolume: parseVolume(srcVolOut),
    micDevice: (sourceEntry && sourceEntry.description) || defaultSourceName,
  }
}

module.exports = {
  id: 'audio',
  label: 'Audio (PulseAudio / PipeWire)',
  legacyIds: ['mic'],

  async init(ctx) {
    const { log, registry, checkFeedbacks, setVariableValues } = ctx

    const cleanups = []
    this._teardown = () => {
      while (cleanups.length) {
        const fn = cleanups.pop()
        try { fn() } catch (_) {}
      }
    }

    // Initial fetch — also proves pactl is on PATH and the default
    // sink/source exist. A reject here propagates out of init() and
    // main flags the feature as failed.
    const state = await fetchAll()

    registry.addVariable('mic_muted', 'Microphone muted')
    registry.addVariable('mic_volume', 'Microphone volume (%)')
    registry.addVariable('mic_device', 'Microphone device name')
    registry.addVariable('speaker_muted', 'Speaker muted')
    registry.addVariable('speaker_volume', 'Speaker volume (%)')
    registry.addVariable('speaker_device', 'Speaker device name')

    registry.addFeedback('mic_is_muted', {
      type: 'boolean',
      name: 'Microphone muted',
      description: 'Active when the default audio source is muted',
      defaultStyle: {
        bgcolor: combineRgb(200, 0, 0),
        color: combineRgb(255, 255, 255),
      },
      options: [],
      callback: () => Boolean(state.micMuted),
    })
    registry.addFeedback('speaker_is_muted', {
      type: 'boolean',
      name: 'Speaker muted',
      description: 'Active when the default audio sink is muted',
      defaultStyle: {
        bgcolor: combineRgb(200, 0, 0),
        color: combineRgb(255, 255, 255),
      },
      options: [],
      callback: () => Boolean(state.speakerMuted),
    })

    const makeMuteAction = (label, target, kind) => ({
      name: label,
      options: [],
      callback: async () => {
        try {
          await pactl([kind === 'sink' ? 'set-sink-mute' : 'set-source-mute', target, 'toggle'])
        } catch (err) {
          log('error', `${label} failed: ${err.message}`)
        }
      },
    })
    const makeVolumeAction = (label, target, kind, sign) => ({
      name: label,
      options: [
        { type: 'number', id: 'step', label: 'Step %', default: VOL_STEP_DEFAULT, min: 1, max: 100 },
      ],
      callback: async (event) => {
        const step = Number(event.options.step) || VOL_STEP_DEFAULT
        try {
          await pactl([
            kind === 'sink' ? 'set-sink-volume' : 'set-source-volume',
            target,
            `${sign}${step}%`,
          ])
        } catch (err) {
          log('error', `${label} failed: ${err.message}`)
        }
      },
    })

    registry.addAction('audio_speaker_mute_toggle', makeMuteAction('Toggle speaker mute', SINK, 'sink'))
    registry.addAction('audio_mic_mute_toggle',     makeMuteAction('Toggle microphone mute', SOURCE, 'source'))
    registry.addAction('audio_speaker_volume_up',   makeVolumeAction('Speaker volume up', SINK, 'sink', '+'))
    registry.addAction('audio_speaker_volume_down', makeVolumeAction('Speaker volume down', SINK, 'sink', '-'))
    registry.addAction('audio_mic_volume_up',       makeVolumeAction('Microphone volume up', SOURCE, 'source', '+'))
    registry.addAction('audio_mic_volume_down',     makeVolumeAction('Microphone volume down', SOURCE, 'source', '-'))

    const muteButton = (name, text, actionId, feedbackId) => ({
      type: 'button',
      category: 'Audio',
      name,
      style: {
        text,
        size: 'auto',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(0, 0, 0),
      },
      steps: [{ down: [{ actionId, options: {} }], up: [] }],
      feedbacks: [
        {
          feedbackId,
          options: {},
          style: {
            bgcolor: combineRgb(200, 0, 0),
            color: combineRgb(255, 255, 255),
          },
        },
      ],
    })
    const volumeButton = (name, text, actionId) => ({
      type: 'button',
      category: 'Audio',
      name,
      style: {
        text,
        size: 'auto',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(0, 0, 0),
      },
      steps: [{ down: [{ actionId, options: { step: VOL_STEP_DEFAULT } }], up: [] }],
      feedbacks: [],
    })

    registry.replacePresets({
      audio_speaker_mute: muteButton('Speaker mute toggle', 'Spkr', 'audio_speaker_mute_toggle', 'speaker_is_muted'),
      audio_mic_mute:     muteButton('Mic mute toggle', 'Mic', 'audio_mic_mute_toggle', 'mic_is_muted'),
      audio_speaker_vol_up:   volumeButton('Speaker volume up', 'Spk +', 'audio_speaker_volume_up'),
      audio_speaker_vol_down: volumeButton('Speaker volume down', 'Spk -', 'audio_speaker_volume_down'),
      audio_mic_vol_up:       volumeButton('Microphone volume up', 'Mic +', 'audio_mic_volume_up'),
      audio_mic_vol_down:     volumeButton('Microphone volume down', 'Mic -', 'audio_mic_volume_down'),
    })

    function applyStateToVariables() {
      setVariableValues({
        mic_muted: state.micMuted,
        mic_volume: state.micVolume,
        mic_device: state.micDevice,
        speaker_muted: state.speakerMuted,
        speaker_volume: state.speakerVolume,
        speaker_device: state.speakerDevice,
      })
    }

    applyStateToVariables()

    // Debounced refetch — pactl emits bursts of events when volume is held
    let refetchTimer = null
    function scheduleRefetch() {
      if (refetchTimer) return
      refetchTimer = setTimeout(async () => {
        refetchTimer = null
        try {
          const fresh = await fetchAll()
          const prevMic = state.micMuted
          const prevSpeaker = state.speakerMuted
          Object.assign(state, fresh)
          applyStateToVariables()
          if (prevMic !== state.micMuted) checkFeedbacks('mic_is_muted')
          if (prevSpeaker !== state.speakerMuted) checkFeedbacks('speaker_is_muted')
        } catch (err) {
          log('error', `pactl refetch failed: ${err.message}`)
        }
      }, DEBOUNCE_MS)
    }
    cleanups.push(() => {
      if (refetchTimer) {
        clearTimeout(refetchTimer)
        refetchTimer = null
      }
    })

    // Supervisor for `pactl subscribe`. Auto-restarts on exit/error with
    // exponential backoff; backoff resets the moment the child produces
    // any output, so a flapping restart does not escalate.
    let subProc = null
    let supervisorStopped = false
    let restartTimer = null
    let backoffMs = BACKOFF_INITIAL_MS

    function spawnSubscriber() {
      if (supervisorStopped) return
      const proc = spawn('pactl', ['subscribe'])
      subProc = proc
      let buffer = ''
      proc.stdout.on('data', (chunk) => {
        backoffMs = BACKOFF_INITIAL_MS
        buffer += chunk.toString()
        let idx
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 1)
          if (RELEVANT_EVENT_RE.test(line)) scheduleRefetch()
        }
      })
      proc.stderr.on('data', (d) => {
        const msg = d.toString().trim()
        if (msg) log('warn', `pactl subscribe stderr: ${msg}`)
      })
      proc.on('error', (err) => {
        log('error', `pactl subscribe error: ${err.message}`)
      })
      proc.on('close', (code, signal) => {
        if (subProc === proc) subProc = null
        if (supervisorStopped) return
        log('warn', `pactl subscribe exited (code=${code} signal=${signal}); restarting in ${backoffMs}ms`)
        restartTimer = setTimeout(() => {
          restartTimer = null
          spawnSubscriber()
        }, backoffMs)
        backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS)
      })
    }

    spawnSubscriber()

    cleanups.push(() => {
      supervisorStopped = true
      if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = null
      }
      if (subProc) {
        try { subProc.kill() } catch (_) {}
        subProc = null
      }
    })
  },

  async destroy() {
    if (this._teardown) {
      this._teardown()
      this._teardown = null
    }
  },
}
