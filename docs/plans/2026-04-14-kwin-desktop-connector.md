# KWin Desktop Connector Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship an MVP Bitfocus Companion module that exposes the current KWin virtual desktop as a variable, offers next/previous/goto actions, and highlights active desktop via feedback.

**Architecture:** Single-instance `@companion-module/base` module. On init, connect to session DBus, read current desktop from `org.kde.KWin`, subscribe to `currentDesktopChanged` signal, and mirror state into Companion variables/feedbacks. Actions invoke KWin DBus methods directly.

**Tech Stack:** Node.js, `@companion-module/base`, `dbus-next`.

**Note on testing:** Per the design doc, MVP uses **manual verification only** — DBus mocking is not worth the effort. Each task includes a manual verification step instead of automated tests. A live KWin (Plasma) session is required.

---

## Prerequisites

- Plasma/KWin session running (session DBus available at `$DBUS_SESSION_BUS_ADDRESS`)
- Node.js ≥ 18
- `busctl` or `qdbus` available for manual DBus poking
- Companion dev environment for loading the module (`companion` CLI or dev build)

---

### Task 1: Scaffold module package

**Files:**
- Create: `package.json`
- Create: `companion/manifest.json`
- Create: `main.js`
- Create: `.gitignore`
- Create: `README.md`

**Step 1: Write `package.json`**

```json
{
  "name": "companion-module-kwin-desktop",
  "version": "0.1.0",
  "main": "main.js",
  "type": "commonjs",
  "scripts": {
    "dev": "companion-module-build",
    "lint": "node -e \"require('./main.js')\""
  },
  "dependencies": {
    "@companion-module/base": "~1.11.0",
    "dbus-next": "^0.10.2"
  },
  "engines": {
    "node": ">=18"
  }
}
```

**Step 2: Write `companion/manifest.json`**

```json
{
  "id": "kwin-desktop",
  "name": "kwin-desktop",
  "shortname": "KWin Desktop",
  "description": "Exposes KWin current virtual desktop via DBus",
  "version": "0.1.0",
  "license": "MIT",
  "repository": "",
  "bugs": "",
  "maintainers": [
    { "name": "flyte", "email": "" }
  ],
  "legacyIds": [],
  "runtime": {
    "type": "node18",
    "api": "nodejs-ipc",
    "apiVersion": "1.11.0",
    "entrypoint": "main.js"
  },
  "manufacturer": "KDE",
  "products": ["KWin"],
  "keywords": ["kwin", "kde", "desktop", "dbus", "linux"]
}
```

**Step 3: Write skeleton `main.js`**

```js
const { InstanceBase, runEntrypoint, InstanceStatus } = require('@companion-module/base')

class KWinDesktopInstance extends InstanceBase {
  async init(config) {
    this.config = config
    this.updateStatus(InstanceStatus.Connecting)
    this.log('info', 'KWin desktop module initializing')
    this.updateStatus(InstanceStatus.Ok, 'Scaffold only')
  }

  async destroy() {
    this.log('info', 'KWin desktop module destroyed')
  }

  async configUpdated(config) {
    this.config = config
  }

  getConfigFields() {
    return []
  }
}

runEntrypoint(KWinDesktopInstance, [])
```

**Step 4: Write `.gitignore`**

```
node_modules/
*.log
.DS_Store
pkg/
```

**Step 5: Write minimal `README.md`**

```markdown
# companion-module-kwin-desktop

Bitfocus Companion module exposing the current KWin virtual desktop via DBus.

MVP — see `docs/plans/` for design and implementation plan.
```

**Step 6: Install dependencies**

Run: `npm install`
Expected: `node_modules/` populated, no errors.

**Step 7: Smoke-load the module**

Run: `node -e "require('./main.js')"`
Expected: exits 0 with no stack trace (the entrypoint registers but immediately exits without a parent IPC socket — that's fine; we just want the require graph to resolve).

**Step 8: Commit**

```bash
git add package.json package-lock.json companion/manifest.json main.js .gitignore README.md
git commit -m "feat: scaffold companion-module-kwin-desktop"
```

---

### Task 2: DBus wrapper — connect + read current desktop

**Files:**
- Create: `lib/dbus.js`
- Modify: `main.js`

**Step 1: Write `lib/dbus.js`**

```js
const dbus = require('dbus-next')

const SERVICE = 'org.kde.KWin'
const KWIN_PATH = '/KWin'
const KWIN_IFACE = 'org.kde.KWin'
const VDM_PATH = '/VirtualDesktopManager'
const VDM_IFACE = 'org.kde.KWin.VirtualDesktopManager'

class KWinDbus {
  constructor(logger) {
    this.log = logger
    this.bus = null
    this.kwin = null
    this.vdm = null
    this.vdmProps = null
    this.onDesktopChanged = null
  }

  async connect() {
    this.bus = dbus.sessionBus()
    const obj = await this.bus.getProxyObject(SERVICE, KWIN_PATH)
    this.kwin = obj.getInterface(KWIN_IFACE)

    const vdmObj = await this.bus.getProxyObject(SERVICE, VDM_PATH)
    this.vdm = vdmObj.getInterface(VDM_IFACE)
    this.vdmProps = vdmObj.getInterface('org.freedesktop.DBus.Properties')

    this.kwin.on('currentDesktopChanged', (n) => {
      if (this.onDesktopChanged) this.onDesktopChanged(Number(n))
    })
  }

  async getCurrentDesktop() {
    const n = await this.kwin.currentDesktop()
    return Number(n)
  }

  async getDesktopCount() {
    const variant = await this.vdmProps.Get(VDM_IFACE, 'Count')
    return Number(variant.value)
  }

  async getDesktopIds() {
    const variant = await this.vdmProps.Get(VDM_IFACE, 'desktops')
    return variant.value.map((d) => ({ id: d[0], name: d[1], position: Number(d[2]) }))
  }

  async next() { await this.kwin.nextDesktop() }
  async previous() { await this.kwin.previousDesktop() }

  async gotoIndex(oneBased) {
    const ids = await this.getDesktopIds()
    const sorted = [...ids].sort((a, b) => a.position - b.position)
    const target = sorted[oneBased - 1]
    if (!target) throw new Error(`desktop index ${oneBased} out of range (count=${sorted.length})`)
    await this.vdm.setCurrent(target.id)
  }

  disconnect() {
    if (this.bus) {
      try { this.bus.disconnect() } catch (_) {}
    }
    this.bus = null
    this.kwin = null
    this.vdm = null
    this.vdmProps = null
  }
}

module.exports = { KWinDbus }
```

> **Note on `desktops` property signature:** KWin exposes it as `a(sss)` or similar — each entry containing id, name, and position. If the shape differs on your Plasma version, adjust the unpacking in `getDesktopIds()`. Verify in Step 4 below before moving on.

**Step 2: Wire into `main.js` init**

Replace `init()` and `destroy()` in `main.js`:

```js
const { KWinDbus } = require('./lib/dbus')

// inside class:
async init(config) {
  this.config = config
  this.updateStatus(InstanceStatus.Connecting)
  this.dbus = new KWinDbus((lvl, msg) => this.log(lvl, msg))
  try {
    await this.dbus.connect()
    const current = await this.dbus.getCurrentDesktop()
    const count = await this.dbus.getDesktopCount()
    this.log('info', `KWin connected: desktop ${current}/${count}`)
    this.updateStatus(InstanceStatus.Ok)
  } catch (err) {
    this.log('error', `KWin DBus connect failed: ${err.message}`)
    this.updateStatus(InstanceStatus.ConnectionFailure, err.message)
  }
}

async destroy() {
  if (this.dbus) this.dbus.disconnect()
}
```

**Step 3: Install dbus-next if not already**

Run: `npm install dbus-next`
Expected: no errors.

**Step 4: Manual DBus sanity check (independent of Companion)**

Create a throwaway script `scratch-dbus.js`:

```js
const { KWinDbus } = require('./lib/dbus')
;(async () => {
  const k = new KWinDbus((lvl, msg) => console.log(`[${lvl}]`, msg))
  await k.connect()
  console.log('current:', await k.getCurrentDesktop())
  console.log('count:', await k.getDesktopCount())
  console.log('ids:', await k.getDesktopIds())
  k.disconnect()
})().catch((e) => { console.error(e); process.exit(1) })
```

Run: `node scratch-dbus.js`
Expected: prints current desktop number, count, and an array of `{id, name, position}`. If `getDesktopIds()` throws or returns garbage, inspect raw shape with:

```bash
busctl --user call org.kde.KWin /VirtualDesktopManager org.freedesktop.DBus.Properties Get ss org.kde.KWin.VirtualDesktopManager desktops
```

and adjust the unpacking accordingly before proceeding.

**Step 5: Delete the scratch file**

Run: `rm scratch-dbus.js`

**Step 6: Commit**

```bash
git add lib/dbus.js main.js package.json package-lock.json
git commit -m "feat: add dbus wrapper and connect on init"
```

---

### Task 3: Variables — current desktop + count

**Files:**
- Create: `lib/variables.js`
- Modify: `main.js`

**Step 1: Write `lib/variables.js`**

```js
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
```

**Step 2: Wire into `init()` in `main.js`**

Add after successful connect:

```js
const { defineVariables, setDesktopValues } = require('./lib/variables')
// ...
defineVariables(this)
setDesktopValues(this, current, count)
```

**Step 3: Manual verification**

Load the module in Companion dev. Check that `$(kwin-desktop:current_desktop)` and `$(kwin-desktop:desktop_count)` resolve to correct values on a button label.

Expected: label shows e.g. `2` and `4`.

**Step 4: Commit**

```bash
git add lib/variables.js main.js
git commit -m "feat: expose current_desktop and desktop_count variables"
```

---

### Task 4: Subscribe to signal and update live

**Files:**
- Modify: `main.js`

**Step 1: Hook `onDesktopChanged`**

In `init()`, after `defineVariables`, before `updateStatus(Ok)`:

```js
this.dbus.onDesktopChanged = (n) => {
  this.log('debug', `currentDesktopChanged → ${n}`)
  setDesktopValues(this, n)
  this.checkFeedbacks('on_desktop')
}
```

(`checkFeedbacks` is harmless even before feedbacks are registered — it will just match nothing.)

**Step 2: Manual verification**

1. Load module in Companion.
2. Place `$(kwin-desktop:current_desktop)` on a button.
3. Switch desktops in KWin (Meta+F2/F3 or pager).
4. Expected: button text updates instantly (< 100ms perceived).

If nothing updates: check Companion log for `currentDesktopChanged` debug lines. If signal is never fired, run:

```bash
busctl --user monitor org.kde.KWin
```

and switch desktops to confirm KWin actually emits the signal on your Plasma version.

**Step 3: Commit**

```bash
git add main.js
git commit -m "feat: subscribe to currentDesktopChanged for live updates"
```

---

### Task 5: Actions — next, previous, goto

**Files:**
- Create: `lib/actions.js`
- Modify: `main.js`

**Step 1: Write `lib/actions.js`**

```js
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
```

**Step 2: Wire into `init()` in `main.js`**

```js
const { defineActions } = require('./lib/actions')
// after defineVariables:
defineActions(this)
```

**Step 3: Manual verification**

1. In Companion, bind each action to a separate button.
2. Press `Next` → KWin advances one desktop, variable updates.
3. Press `Previous` → goes back one.
4. Press `Goto N` with N=1, 2, 3, 4 — each lands on the correct desktop.
5. Try N=99 → Companion log shows `goto 99 failed: desktop index 99 out of range (count=…)`, no crash.

**Step 4: Commit**

```bash
git add lib/actions.js main.js
git commit -m "feat: add next/previous/goto desktop actions"
```

---

### Task 6: Feedback — on_desktop

**Files:**
- Create: `lib/feedbacks.js`
- Modify: `main.js`

**Step 1: Write `lib/feedbacks.js`**

```js
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
```

**Step 2: Track current desktop on `self`**

In `main.js`, store the value whenever it updates. Modify the signal handler and init:

```js
// after reading current:
this.currentDesktop = current
// signal handler:
this.dbus.onDesktopChanged = (n) => {
  this.currentDesktop = n
  setDesktopValues(this, n)
  this.checkFeedbacks('on_desktop')
}
```

Also call `defineFeedbacks(this)` after `defineActions(this)`:

```js
const { defineFeedbacks } = require('./lib/feedbacks')
defineFeedbacks(this)
```

**Step 3: Manual verification**

1. In Companion, create 4 buttons, each with an `on_desktop` feedback for N=1..4.
2. Switch desktops in KWin.
3. Expected: only the button matching the current desktop goes green; switches instantly as you change desktops.

**Step 4: Commit**

```bash
git add lib/feedbacks.js main.js
git commit -m "feat: add on_desktop boolean feedback"
```

---

### Task 7: Reconnect on disconnect

**Files:**
- Modify: `main.js`

**Step 1: Add reconnect loop**

Wrap connect logic in a helper and retry on bus disconnect events:

```js
async connectWithRetry() {
  try {
    await this.dbus.connect()
    const current = await this.dbus.getCurrentDesktop()
    const count = await this.dbus.getDesktopCount()
    this.currentDesktop = current
    setDesktopValues(this, current, count)
    this.dbus.onDesktopChanged = (n) => {
      this.currentDesktop = n
      setDesktopValues(this, n)
      this.checkFeedbacks('on_desktop')
    }
    this.updateStatus(InstanceStatus.Ok)
  } catch (err) {
    this.log('error', `KWin DBus connect failed: ${err.message}`)
    this.updateStatus(InstanceStatus.ConnectionFailure, err.message)
    this.reconnectTimer = setTimeout(() => this.connectWithRetry(), 5000)
  }
}
```

Call `this.connectWithRetry()` from `init()` after `defineVariables/Actions/Feedbacks`. Clear `this.reconnectTimer` in `destroy()`.

**Step 2: Manual verification**

1. Start Companion with the module loaded.
2. Kill KWin's DBus temporarily: **skip this** — it will crash your session. Instead, simulate by starting the module *before* a scratch bus service exists:
   - Stop KWin DBus service is not practical. Instead: rename `org.kde.KWin` is not possible either.
   - Practical test: change `SERVICE` in `lib/dbus.js` to `org.kde.KWinNope` temporarily → reload module → confirm it logs error and retries every 5s → revert.
3. Revert `SERVICE` constant.

**Step 3: Commit**

```bash
git add main.js
git commit -m "feat: retry DBus connect on failure"
```

---

### Task 8: Final end-to-end verification

**Files:** none (verification only)

**Step 1: Full manual test checklist**

Load the module in a fresh Companion instance and verify:

- [ ] Module status shows OK after init
- [ ] `current_desktop` variable matches actual KWin desktop
- [ ] `desktop_count` variable matches KWin setting
- [ ] Switching desktops via KWin shortcut updates the variable in < 1s
- [ ] `desktop_next` action advances one desktop
- [ ] `desktop_previous` action goes back one desktop
- [ ] `desktop_goto` with valid N switches to that desktop
- [ ] `desktop_goto` with N > count logs an error, no crash
- [ ] `on_desktop` feedback highlights the correct button as you switch
- [ ] Module destroy (remove instance) does not leave zombie dbus connections (`lsof -p <companion-pid> | grep dbus` shrinks)

**Step 2: Update README with usage**

Add a short "Usage" section listing variables, actions, and feedbacks.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document variables, actions, feedbacks"
```

---

## Out of Scope Reminders (Do Not Implement)

- Desktop name variables
- Multiple screens / activities
- Window or client info
- Config fields (zero-config by design)
- Automated tests

If any of these feel tempting mid-execution, stop and propose a follow-up instead of expanding scope.
