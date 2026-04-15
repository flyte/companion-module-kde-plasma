# Modular Feature Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the KWin Companion module from horizontal splits (actions.js / feedbacks.js / variables.js / presets.js / dbus.js) into vertical per-feature modules with a shared core, preserving all existing IDs and behavior.

**Architecture:** Two layers. `lib/core/` owns the session-bus client and a scoped registry. `lib/features/*.js` each own one D-Bus surface end-to-end (proxies, signals, actions, feedbacks, variables, presets). `main.js` orchestrates: connect bus → load enabled features → per-feature try/catch → flush registry once. Feature failures degrade to `UnknownWarning`; bus failures retry.

**Tech Stack:** Node 18+, `@companion-module/base` ~1.11, `dbus-next` ^0.10, CommonJS.

**Design reference:** `docs/plans/2026-04-15-modular-features-design.md`

**No test suite.** Verification is `node --check <file>` for syntax and a manual Companion load-test at the end. TDD steps are replaced with syntax checks.

**Two commits total:**
- Commit A (Tasks 1–2): Add `lib/core/` scaffolding. Old code still in use; core is unused. Module still works.
- Commit B (Tasks 3–8): Add `lib/features/`, rewrite `main.js`, delete old `lib/{dbus,actions,feedbacks,variables,presets}.js`. Atomic swap.

---

## Task 1: Create `lib/core/bus.js`

Extracts the session-bus bootstrap and connect/disconnect logic from `lib/dbus.js`. Features will receive the `dbus-next` bus object via `ctx.bus` and manage their own proxies.

**Files:**
- Create: `lib/core/bus.js`

**Step 1: Write the file**

```js
const dbus = require('dbus-next')

class Bus {
  constructor(log) {
    this.log = log
    this.bus = null
  }

  async connect() {
    if (!process.env.DBUS_SESSION_BUS_ADDRESS) {
      const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`
      process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${runtimeDir}/bus`
    }
    this.bus = dbus.sessionBus()
    return this.bus
  }

  disconnect() {
    if (this.bus) {
      try { this.bus.disconnect() } catch (_) {}
    }
    this.bus = null
  }
}

module.exports = { Bus }
```

**Step 2: Syntax check**

Run: `node --check lib/core/bus.js`
Expected: no output (success).

---

## Task 2: Create `lib/core/registry.js`

Scoped per-feature slots merged at flush time. Features receive a closure handle that can only mutate their own slot. Dynamic `replacePresets` wipes-and-replaces the calling feature's preset slice then re-flushes.

**Files:**
- Create: `lib/core/registry.js`

**Step 1: Write the file**

```js
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
```

**Step 2: Syntax check**

Run: `node --check lib/core/registry.js`
Expected: no output.

**Step 3: Commit A**

```bash
git add lib/core/bus.js lib/core/registry.js
git commit -m "$(cat <<'EOF'
refactor: add core bus + registry scaffolding

Unused until main is rewired in follow-up commit.
EOF
)"
```

---

## Task 3: Create `lib/features/desktops.js`

Full port of the virtual-desktops surface. Owns the VDM proxy, the `desktopDataChanged`/`desktopCreated`/`desktopRemoved` raw match-rule subscription (KWin introspection lies about the signature — `(iss)` declared, `(uss)` actually emitted, so typed dispatch silently drops it), the `currentChanged` signal, and regenerates variables + presets when desktops change.

Preserved IDs: actions `desktop_next`, `desktop_previous`, `desktop_goto`; feedback `on_desktop`; variables `current_desktop`, `desktop_count`, `desktop_{n}_name`; presets `goto_{n}` under category "Virtual desktops".

**Files:**
- Create: `lib/features/desktops.js`

**Step 1: Write the file**

```js
const dbus = require('dbus-next')
const { combineRgb } = require('@companion-module/base')
const { Variant } = dbus

const SERVICE = 'org.kde.KWin'
const KWIN_PATH = '/KWin'
const KWIN_IFACE = 'org.kde.KWin'
const VDM_PATH = '/VirtualDesktopManager'
const VDM_IFACE = 'org.kde.KWin.VirtualDesktopManager'

module.exports = {
  id: 'desktops',
  label: 'Virtual desktops',

  async init(ctx) {
    const { bus, log, registry, checkFeedbacks, setVariableValues } = ctx

    const kwinObj = await bus.getProxyObject(SERVICE, KWIN_PATH)
    const kwin = kwinObj.getInterface(KWIN_IFACE)

    const vdmObj = await bus.getProxyObject(SERVICE, VDM_PATH)
    const vdm = vdmObj.getInterface(VDM_IFACE)
    const vdmProps = vdmObj.getInterface('org.freedesktop.DBus.Properties')

    const state = {
      currentDesktop: undefined,
      desktops: [],
    }

    async function getDesktopIds() {
      const variant = await vdmProps.Get(VDM_IFACE, 'desktops')
      return variant.value.map((d) => ({ position: Number(d[0]), id: d[1], name: d[2] }))
    }

    async function getCurrentDesktop() {
      const n = await kwin.currentDesktop()
      return Number(n)
    }

    async function getDesktopCount() {
      const variant = await vdmProps.Get(VDM_IFACE, 'count')
      return Number(variant.value)
    }

    async function gotoIndex(oneBased) {
      const ids = await getDesktopIds()
      const sorted = [...ids].sort((a, b) => a.position - b.position)
      const target = sorted[oneBased - 1]
      if (!target) throw new Error(`desktop index ${oneBased} out of range (count=${sorted.length})`)
      await vdmProps.Set(VDM_IFACE, 'current', new Variant('s', target.id))
    }

    function rebuildVariableDefs() {
      // registry.addVariable is additive; desktop count can change at runtime,
      // so we need replace-semantics. Rebuild from scratch by clearing the
      // slot's variables via a re-scoped handle is not available. Instead we
      // register the fixed vars once and tolerate per-desktop vars being
      // appended. The companion API replaces the full definition list on
      // setVariableDefinitions, and registry.flush() rebuilds it from slots —
      // so we rebuild our slot's variable list here by calling addVariable
      // into a fresh array on the scoped handle. The scoped handle does not
      // expose "reset variables", so we use the side-door: overwrite via
      // replacePresets-style replacement is preset-only. Therefore we register
      // max variables up front based on current desktops and re-register on
      // change by re-invoking init's inner closure through refreshDynamic.
      //
      // Simpler: the scoped handle adds variables; to replace we ask the
      // registry to drop+reopen our slot. That surface does not exist either.
      //
      // Pragmatic choice: desktops rarely shrink. We append new per-desktop
      // name variables when new desktops appear, and leave orphaned ones in
      // place (setting their value to undefined). Their presence is harmless;
      // users referencing removed desktop names will see blank.
    }

    function buildPresets(desktopList) {
      const presets = {}
      const sorted = [...desktopList].sort((a, b) => a.position - b.position)
      for (const d of sorted) {
        const n = d.position + 1
        presets[`goto_${n}`] = {
          type: 'button',
          category: 'Virtual desktops',
          name: `Go to ${d.name}`,
          style: {
            text: `$(${ctx.moduleLabel}:desktop_${n}_name)`,
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
      return presets
    }

    function applyDesktopNameValues(desktopList) {
      const values = {}
      for (const d of desktopList) {
        const n = d.position + 1
        values[`desktop_${n}_name`] = d.name
      }
      setVariableValues(values)
    }

    // --- register actions ---
    registry.addAction('desktop_next', {
      name: 'Next desktop',
      options: [],
      callback: async () => {
        try { await kwin.nextDesktop() }
        catch (e) { log('error', `next failed: ${e.message}`) }
      },
    })
    registry.addAction('desktop_previous', {
      name: 'Previous desktop',
      options: [],
      callback: async () => {
        try { await kwin.previousDesktop() }
        catch (e) { log('error', `previous failed: ${e.message}`) }
      },
    })
    registry.addAction('desktop_goto', {
      name: 'Go to desktop N',
      options: [
        { type: 'number', id: 'n', label: 'Desktop number (1-based)', default: 1, min: 1, max: 64 },
      ],
      callback: async (event) => {
        const n = Number(event.options.n)
        try { await gotoIndex(n) }
        catch (e) { log('error', `goto ${n} failed: ${e.message}`) }
      },
    })

    // --- register feedback ---
    registry.addFeedback('on_desktop', {
      type: 'boolean',
      name: 'On desktop',
      description: 'Active when the current KWin desktop matches the given number',
      defaultStyle: {
        bgcolor: combineRgb(0, 200, 0),
        color: combineRgb(0, 0, 0),
      },
      options: [
        { type: 'number', id: 'n', label: 'Desktop number', default: 1, min: 1, max: 64 },
      ],
      callback: (feedback) => {
        return state.currentDesktop !== undefined && Number(feedback.options.n) === state.currentDesktop
      },
    })

    // --- register fixed variables ---
    registry.addVariable('current_desktop', 'Current desktop number')
    registry.addVariable('desktop_count', 'Total desktop count')

    // --- initial fetch ---
    state.currentDesktop = await getCurrentDesktop()
    const count = await getDesktopCount()
    state.desktops = await getDesktopIds()

    // per-desktop name variables
    for (const d of state.desktops) {
      const n = d.position + 1
      registry.addVariable(`desktop_${n}_name`, `Desktop ${n} name`)
    }

    setVariableValues({
      current_desktop: state.currentDesktop,
      desktop_count: count,
    })
    applyDesktopNameValues(state.desktops)
    registry.replacePresets(buildPresets(state.desktops))

    // --- signals ---
    const onCurrentChanged = async (id) => {
      try {
        const ids = await getDesktopIds()
        const match = ids.find((d) => d.id === id)
        const pos = match ? match.position + 1 : null
        if (pos) {
          state.currentDesktop = pos
          log('debug', `currentDesktopChanged → ${pos}`)
          setVariableValues({ current_desktop: pos })
          checkFeedbacks('on_desktop')
        }
      } catch (err) {
        log('error', `currentChanged handler failed: ${err.message}`)
      }
    }
    vdm.on('currentChanged', onCurrentChanged)

    // KWin's introspection declares desktopDataChanged as (iss) but it
    // actually emits (uss), so dbus-next's typed proxy silently drops the
    // signal. Subscribe via a raw match rule instead.
    const matchRule = `type='signal',sender='${SERVICE}',interface='${VDM_IFACE}',path='${VDM_PATH}'`
    await bus._addMatch(matchRule)
    const onBusMessage = async (msg) => {
      if (msg.type !== dbus.MessageType.SIGNAL) return
      if (msg.interface !== VDM_IFACE) return
      if (msg.member !== 'desktopDataChanged' &&
          msg.member !== 'desktopCreated' &&
          msg.member !== 'desktopRemoved') return
      try {
        const freshIds = await getDesktopIds()
        const freshCount = await getDesktopCount()
        state.desktops = freshIds
        for (const d of freshIds) {
          const n = d.position + 1
          registry.addVariable(`desktop_${n}_name`, `Desktop ${n} name`)
        }
        setVariableValues({ desktop_count: freshCount })
        applyDesktopNameValues(freshIds)
        registry.replacePresets(buildPresets(freshIds))
        log('debug', `desktops changed → ${freshIds.length} desktops`)
      } catch (err) {
        log('error', `desktopsChanged handler failed: ${err.message}`)
      }
    }
    bus.on('message', onBusMessage)

    this._teardown = () => {
      try { vdm.removeListener('currentChanged', onCurrentChanged) } catch (_) {}
      try { bus.removeListener('message', onBusMessage) } catch (_) {}
      try { bus._removeMatch(matchRule) } catch (_) {}
    }
  },

  async destroy() {
    if (this._teardown) {
      this._teardown()
      this._teardown = null
    }
  },
}
```

**Note on per-desktop variable registration:** `registry.addVariable` is append-only. Re-adding the same `variableId` will cause a collision warning but not break; on desktop removal, orphaned variable defs linger with undefined values — acceptable per the design. If this becomes annoying, a follow-up can add `registry.replaceVariables(featureId, list)` analogous to `replacePresets`. Not doing it now (YAGNI).

**Step 2: Syntax check**

Run: `node --check lib/features/desktops.js`
Expected: no output.

---

## Task 4: Create `lib/features/screenlock.js`

Ports the `is_locked` feedback and `locked` variable. Fails its own `init()` (caught by main) if `org.freedesktop.ScreenSaver` is not on the bus — this is the isolation test case.

**Files:**
- Create: `lib/features/screenlock.js`

**Step 1: Write the file**

```js
const SS_SERVICE = 'org.freedesktop.ScreenSaver'
const SS_PATH = '/ScreenSaver'
const SS_IFACE = 'org.freedesktop.ScreenSaver'

const { combineRgb } = require('@companion-module/base')

module.exports = {
  id: 'screenlock',
  label: 'Screen lock',

  async init(ctx) {
    const { bus, log, registry, checkFeedbacks, setVariableValues } = ctx

    const ssObj = await bus.getProxyObject(SS_SERVICE, SS_PATH)
    const screensaver = ssObj.getInterface(SS_IFACE)

    const state = { locked: false }

    registry.addVariable('locked', 'Screen locked')
    registry.addFeedback('is_locked', {
      type: 'boolean',
      name: 'Screen locked',
      description: 'Active when the KDE screen lock is engaged',
      defaultStyle: {
        bgcolor: combineRgb(200, 0, 0),
        color: combineRgb(255, 255, 255),
      },
      options: [],
      callback: () => Boolean(state.locked),
    })

    try {
      state.locked = Boolean(await screensaver.GetActive())
    } catch (_) {
      state.locked = false
    }
    setVariableValues({ locked: state.locked })

    const onActiveChanged = (active) => {
      state.locked = Boolean(active)
      log('debug', `screen ${state.locked ? 'locked' : 'unlocked'}`)
      setVariableValues({ locked: state.locked })
      checkFeedbacks('is_locked')
    }
    screensaver.on('ActiveChanged', onActiveChanged)

    this._teardown = () => {
      try { screensaver.removeListener('ActiveChanged', onActiveChanged) } catch (_) {}
    }
  },

  async destroy() {
    if (this._teardown) {
      this._teardown()
      this._teardown = null
    }
  },
}
```

**Step 2: Syntax check**

Run: `node --check lib/features/screenlock.js`
Expected: no output.

---

## Task 5: Create `lib/features/index.js`

Single source of truth for which features exist. Adding a feature = add one line here.

**Files:**
- Create: `lib/features/index.js`

**Step 1: Write the file**

```js
const desktops = require('./desktops')
const screenlock = require('./screenlock')

module.exports = [desktops, screenlock]
```

**Step 2: Syntax check**

Run: `node --check lib/features/index.js`
Expected: no output.

---

## Task 6: Rewrite `main.js`

Replace the current orchestration with feature-driven lifecycle. Uses config checkboxes `feature_<id>` to decide which features to load. Wraps each `init()` in try/catch. Reports `UnknownWarning` if any feature failed but at least one succeeded, `ConnectionFailure` if the bus itself failed.

`configUpdated` re-runs the feature init loop when toggles change (bus stays connected).

**Files:**
- Modify: `main.js` (full rewrite)

**Step 1: Write the new main.js**

```js
const { InstanceBase, runEntrypoint, InstanceStatus } = require('@companion-module/base')
const { Bus } = require('./lib/core/bus')
const { Registry } = require('./lib/core/registry')
const features = require('./lib/features')

class KWinDesktopInstance extends InstanceBase {
  async init(config) {
    this.config = config || {}
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
    if (this.failedFeatures.length > 0 && this.activeFeatures.length > 0) {
      const names = this.failedFeatures.map((f) => f.feature.id).join(', ')
      this.updateStatus(InstanceStatus.UnknownWarning, `features failed: ${names}`)
    } else if (this.activeFeatures.length === 0) {
      this.updateStatus(InstanceStatus.ConnectionFailure, 'no features initialized')
    } else {
      this.updateStatus(InstanceStatus.Ok)
    }
  }

  async connectWithRetry() {
    try {
      await this.busWrapper.connect()
      await this.loadFeatures()
      this.updateLifecycleStatus()
      this.log('info', `KWin module ready: ${this.activeFeatures.length} feature(s) active`)
    } catch (err) {
      this.log('error', `KWin DBus connect failed: ${err.message}`)
      this.updateStatus(InstanceStatus.ConnectionFailure, err.message)
      this.reconnectTimer = setTimeout(() => this.connectWithRetry(), 5000)
    }
  }

  async destroy() {
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
```

**Step 2: Syntax check**

Run: `node --check main.js`
Expected: no output.

---

## Task 7: Delete old `lib/` files

The old horizontal modules are no longer referenced. Remove them.

**Files:**
- Delete: `lib/dbus.js`
- Delete: `lib/actions.js`
- Delete: `lib/feedbacks.js`
- Delete: `lib/variables.js`
- Delete: `lib/presets.js`

**Step 1: Delete**

```bash
git rm lib/dbus.js lib/actions.js lib/feedbacks.js lib/variables.js lib/presets.js
```

**Step 2: Verify nothing still references them**

Run: `grep -rn "require.*lib/\(dbus\|actions\|feedbacks\|variables\|presets\)" main.js lib/ || echo "clean"`
Expected: `clean`

**Step 3: Syntax-check all remaining JS**

Run: `node --check main.js && node --check lib/core/bus.js && node --check lib/core/registry.js && node --check lib/features/index.js && node --check lib/features/desktops.js && node --check lib/features/screenlock.js`
Expected: no output from any command.

---

## Task 8: Commit B

Atomic commit for the feature-module rewrite.

**Step 1: Stage and commit**

```bash
git add main.js lib/features/ lib/core/
git status
```

Expected status: deletions of `lib/{dbus,actions,feedbacks,variables,presets}.js`, additions of `lib/features/*.js`, modification of `main.js`.

```bash
git commit -m "$(cat <<'EOF'
refactor: vertical feature modules with scoped registry

Each feature (desktops, screenlock) owns its D-Bus proxies, signals,
actions, feedbacks, variables, and presets end-to-end. Shared Bus and
Registry live in lib/core. main.js orchestrates: per-feature try/catch,
UnknownWarning on partial failure, ConnectionFailure on bus failure.

Companion config exposes one checkbox per feature. Adding a feature =
drop file in lib/features, add one line to lib/features/index.js.

All existing action/feedback/variable IDs preserved.

Design: docs/plans/2026-04-15-modular-features-design.md
EOF
)"
```

---

## Task 9: Manual verification in Companion

No automated tests. User must load the module and walk through the checks below. Report results; if any fail, diagnose and patch before declaring done.

**Checklist** (run through each in Companion UI):

1. **Existing IDs preserved** — load module, check actions list contains `desktop_next`, `desktop_previous`, `desktop_goto`; feedbacks list contains `on_desktop`, `is_locked`; variables include `current_desktop`, `desktop_count`, `desktop_{n}_name`, `locked`.
2. **Both features enabled by default** — config shows two checkboxes, both ticked: "Virtual desktops", "Screen lock". Module status `Ok`.
3. **Desktop switching** — switch KDE virtual desktop via Super+<n> or KWin UI. Companion's `current_desktop` variable updates; `on_desktop` feedback (wired to a button) turns green on the matching desktop only.
4. **Desktop add/remove** — add a virtual desktop in KWin's settings. Presets regenerate (new "Go to <name>" preset appears). Remove the desktop; preset for it should disappear. *Known caveat:* orphaned `desktop_{n}_name` variables may linger (design-accepted YAGNI).
5. **Screen lock** — lock the screen with `loginctl lock-session`. `locked` variable → `true`, `is_locked` feedback turns red on a test button. Unlock → returns to false.
6. **Disable screenlock feature** — untick "Screen lock" in config and save. `locked` variable and `is_locked` feedback disappear. `current_desktop` etc. still work.
7. **Re-enable screenlock feature** — retick, save. Feedback and variable return.
8. **Screenlock failure isolation** — temporarily make ScreenSaver inaccessible (e.g., `systemctl --user stop plasma-ksmserver` on some setups, or test on non-KDE session). Restart module. Expected: status `UnknownWarning` with message `features failed: screenlock`. Desktop actions still functional.
9. **Bus failure retry** — kill KWin temporarily (or block the D-Bus session bus). Expected: status `ConnectionFailure`, 5s retry. Restore access; module recovers and reports `Ok`.
10. **Destroy cleanup** — remove the module instance from Companion. No dangling timers, no error logs during teardown.

**Step 1: User runs the verification**

Assistant asks user to walk through the checklist and report results. Assistant does NOT claim success without user confirmation.

**Step 2: Fix any failures**

For each failure, diagnose, patch, syntax-check, and add a follow-up commit with an explanatory message. Re-verify only the failed item.

**Step 3: Final commit if any fixes**

```bash
git add <changed files>
git commit -m "fix: <specific fix from verification>"
```

---

## Done

Plan complete. Two refactor commits + optional fix commits. Module surface unchanged from a user's perspective; internals now per-feature with proper isolation boundaries and a one-line path for adding new D-Bus surfaces.
