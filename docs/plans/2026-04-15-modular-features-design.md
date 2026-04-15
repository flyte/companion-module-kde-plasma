# Modular Feature Architecture — Design

## Motivation

Current layout splits horizontally: `lib/actions.js`, `lib/feedbacks.js`, `lib/variables.js`, `lib/presets.js`, `lib/dbus.js`. Every feature (virtual desktops, screen lock) is smeared across all five files. This refactor addresses four concerns:

1. **Future-proofing** — room to add more D-Bus surfaces (media players, notifications, power, brightness) without reopening central files.
2. **Code clarity** — a feature should be readable end-to-end in one file.
3. **Isolation** — one feature's D-Bus service being absent or broken must not poison others.
4. **Contribution ergonomics** — adding a feature = drop one file, add one line to an index.

Data-driven YAML was considered and rejected: for the current surface (3 actions, 2 feedbacks) the YAML plumbing would exceed the code it replaces, and hard cases (`gotoIndex` Variant construction, `desktopDataChanged` raw match-rule workaround, dynamic per-desktop preset regeneration) don't fit a generic schema cleanly.

## Directory layout

```
lib/
  core/
    bus.js         # session-bus bootstrap (DBUS_SESSION_BUS_ADDRESS fallback), connect/disconnect
    registry.js    # per-feature slots, merged on flush
  features/
    index.js       # ordered feature list
    desktops.js    # VDM proxy, next/prev/goto, on_desktop, desktop vars, presets
    screenlock.js  # ScreenSaver proxy, is_locked, locked var
main.js            # lifecycle orchestration
```

Existing `lib/{dbus,actions,feedbacks,variables,presets}.js` are deleted.

## Feature contract

Each feature module exports:

```js
module.exports = {
  id: 'desktops',              // stable, used as config key and slot key
  label: 'Virtual desktops',   // shown as Companion config checkbox label

  async init(ctx) {
    // ctx = { bus, log, registry, checkFeedbacks, setVariableValues }
    // - acquire proxies via ctx.bus.getProxyObject(...)
    // - subscribe to signals
    // - ctx.registry.addAction / addFeedback / addVariable / replacePresets
    // - throw on unrecoverable failure
  },

  async destroy() {
    // unsubscribe signals, null out proxies
  },
}
```

State ownership: feature keeps its own closure state (`currentDesktop`, `locked`). No more properties dumped on the instance. Callbacks close over the feature's state; other features cannot reach in.

Shared bus: `core/bus.js` owns the single `sessionBus()`. Features receive it via `ctx.bus`. One disconnect tears down everything.

## Registry

Per-feature slots, merged into a single payload on flush. Plain shared mutable dicts were rejected because (a) two features could silently overwrite each other's IDs, and (b) dynamic re-flush (desktops regenerating presets after a desktop was removed) couldn't cleanly replace only its own slice without touching other features' entries.

```js
class Registry {
  constructor(self) {
    this.self = self
    this.slots = new Map()  // featureId → { actions, feedbacks, variables, presets }
  }

  scopedFor(featureId) {
    const slot = { actions: {}, feedbacks: {}, variables: [], presets: {} }
    this.slots.set(featureId, slot)
    return {
      addAction: (id, def) => { slot.actions[id] = def },
      addFeedback: (id, def) => { slot.feedbacks[id] = def },
      addVariable: (variableId, name) => { slot.variables.push({ variableId, name }) },
      replacePresets: (presets) => { slot.presets = presets; this.flush() },
    }
  }

  remove(featureId) { this.slots.delete(featureId) }

  flush() {
    const actions = {}, feedbacks = {}, presets = {}
    const variables = []
    for (const [featureId, slot] of this.slots) {
      for (const [id, def] of Object.entries(slot.actions)) {
        if (actions[id]) this.self.log('warn', `action id collision: ${id} in ${featureId}`)
        actions[id] = def
      }
      // same shape for feedbacks, presets
      variables.push(...slot.variables)
    }
    this.self.setActionDefinitions(actions)
    this.self.setFeedbackDefinitions(feedbacks)
    this.self.setVariableDefinitions(variables)
    this.self.setPresetDefinitions(presets)
  }
}
```

The scoped handle returned to each feature is a closure over its own slot — it cannot touch other features' slots. Collision detection logs a warning naming the offending feature.

Dynamic updates (desktops feature regenerating presets on `desktopDataChanged`): feature calls `ctx.registry.replacePresets(newPresets)`, which wipes-and-replaces its slot's presets then triggers a registry-wide flush. Actions and feedbacks don't change at runtime so re-flushing them is a no-op cost.

## Config & lifecycle

**Config fields** — Companion checkbox per feature, generated from the feature list:

```js
getConfigFields() {
  return features.map(f => ({
    type: 'checkbox',
    id: `feature_${f.id}`,
    label: f.label,
    default: true,
    width: 12,
  }))
}
```

Adding a feature = drop file in `lib/features/`, add one line to `lib/features/index.js`. Checkbox appears automatically.

**Lifecycle:**

```
init(config):
  registry = new Registry(this)
  bus = new Bus(log)
  connectWithRetry()

connectWithRetry:
  try:
    await bus.connect()
    activeFeatures = []
    failedFeatures = []
    for feature in features:
      if !config[`feature_${feature.id}`]: continue
      ctx = { bus, log, registry: registry.scopedFor(feature.id),
              checkFeedbacks: fn, setVariableValues: fn }
      try:
        await feature.init(ctx)
        activeFeatures.push(feature)
      catch e:
        log error
        registry.remove(feature.id)
        failedFeatures.push({ feature, error })
    registry.flush()
    if failedFeatures.length:
      updateStatus(UnknownWarning, `features failed: ${failedFeatures.map(f => f.feature.id).join(', ')}`)
    else:
      updateStatus(Ok)
  catch busError:
    updateStatus(ConnectionFailure, busError.message)
    schedule retry in 5s

destroy:
  cancel reconnect timer
  for feature in activeFeatures: await feature.destroy()
  bus.disconnect()

configUpdated(config):
  if feature toggles changed:
    for feature in activeFeatures: await feature.destroy()
    clear registry slots
    re-run feature init loop (bus stays connected)
```

**Failure semantics:**
- Bus connect failure → whole module `ConnectionFailure`, 5s retry loop (existing behavior).
- Individual feature `init()` throw → logged, feature marked failed, skipped, module still reports `UnknownWarning` naming failed features. Other features proceed.
- Failed features do not individually retry. They stay failed until Companion restart or config change.

## Testing & migration

No automated test suite today; not adding one in this refactor (scope creep). Manual verification:

1. Load module in Companion, confirm existing actions/feedbacks/variables appear with unchanged IDs.
2. Toggle each feature checkbox, confirm its actions/feedbacks/variables appear/disappear.
3. Disable screenlock feature, confirm desktops still works.
4. Simulate non-KDE session (ScreenSaver unavailable), confirm module comes up with `UnknownWarning` and desktops still functional.
5. Switch KDE virtual desktop, confirm `on_desktop` feedback and desktop variables update.
6. Add/remove a virtual desktop, confirm presets regenerate with no stale entries.
7. Lock/unlock screen, confirm `is_locked` feedback and `locked` variable update.

**Migration plan — three commits, each leaves the module working:**

1. Add `lib/core/bus.js` and `lib/core/registry.js` alongside existing files. Not yet wired into main.
2. Port desktops feature to `lib/features/desktops.js`, rewrite `main.js` to use core + features, delete `lib/dbus.js` / `lib/actions.js` / `lib/variables.js` / `lib/presets.js`. Screenlock temporarily moves into desktops feature or a stub.
3. Split screenlock into its own `lib/features/screenlock.js`, delete `lib/feedbacks.js` remainder.

Revised to two commits if the intermediate state in (2) is too ugly:

1. Add core + port both features in one commit; delete old horizontal files; rewrite main.
2. (not needed)

Prefer three if feasible because each commit is independently bisectable.

## ID preservation

All user-visible IDs stay byte-identical so existing Companion button configs keep working:

- Action IDs: `desktop_next`, `desktop_previous`, `desktop_goto`
- Feedback IDs: `on_desktop`, `is_locked`
- Variable IDs: `desktop`, `desktop_count`, `desktop_name_<id>`, `locked`
- Preset category/name strings: unchanged
