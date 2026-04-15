# CLAUDE.md

Bitfocus Companion module for KDE Plasma. CommonJS, Node 18+, no test suite.

## Verification

- `npm run lint` runs `node --check main.js`. Syntax-check new files the same way: `node --check lib/features/foo.js`.
- No automated tests. Runtime verification means loading the module in Companion and exercising it manually.
- Manifest id is `kde-plasma`; previous id `kwin-desktop` is preserved in `companion/manifest.json` `legacyIds` so existing Companion configs resolve.

## Architecture

- Vertical per-feature split. Each file in `lib/features/` owns its D-Bus proxies, signals, actions, feedbacks, variables, presets, and teardown end-to-end.
- `lib/core/bus.js` owns the shared session bus; `lib/core/registry.js` collects per-feature slots and flushes them to Companion as a single definition set. Features get a scoped handle via `ctx.registry` that can only touch their own slot.
- Adding a feature = drop a file in `lib/features/`, add one line to `lib/features/index.js`. A checkbox per feature appears automatically in Companion's config via `getConfigFields()`.
- Feature `init()` throwing is the standard isolation signal: main catches it, logs, marks the feature failed, and reports `UnknownWarning` naming the failures while other features keep running.

## Companion API gotchas

- `setVariableValues` silently drops values for variables Companion hasn't seen via `setVariableDefinitions`. **Flush definitions before setting values.** Inside a feature's `init()`, call `registry.flush()` (or `registry.replacePresets(...)`, which flushes transitively) **before** `setVariableValues(...)`, because main's final flush only runs after every feature's `init()` returns.
- `setActionDefinitions` / `setFeedbackDefinitions` / `setVariableDefinitions` / `setPresetDefinitions` all replace wholesale. Any re-call clobbers previous contents. This is why the registry collects then flushes once instead of letting features call Companion directly.
- Checkbox `default: true` in `getConfigFields()` only applies to freshly-created instances. An existing instance gets a new field as `undefined`, not as the default. `main.js:backfillFeatureDefaults()` handles this via `saveConfig()` on init.

## D-Bus gotchas

- `DBUS_SESSION_BUS_ADDRESS` is not guaranteed to be set inside Companion's node process. `lib/core/bus.js` falls back to `unix:path=$XDG_RUNTIME_DIR/bus`.
- **KWin `desktopDataChanged`** introspection lies: declared `(iss)`, actually emits `(uss)`, so `dbus-next`'s typed proxy silently drops the signal. `lib/features/desktops.js` subscribes via a raw match rule (`bus._addMatch` + `bus.on('message', ...)` with manual filtering). `bus._removeMatch` returns a Promise — always `.catch(() => {})` it during teardown to avoid unhandled rejections.
- **KGlobalAccel interface casing is inconsistent and intentional.** Daemon is `org.kde.KGlobalAccel` (capital K/A), per-component is `org.kde.kglobalaccel.Component` (lowercase). Swap them and you get "method not found".
- **KGlobalAccel `allShortcutInfos()` returns `a(ssssssaiai)`** — 8-field tuples: `[shortcutUnique, shortcutFriendly, componentUnique, componentFriendly, contextUnique, contextFriendly, currentKeys, defaultKeys]`. Components lazily register when their owning app first runs in the session.
- **`invokeShortcut(s)` takes a single string**, not a QStringList. Plasma 4 docs you might find online are wrong for Plasma 5/6.

## Non-D-Bus surfaces

- **Mic mute state is not exposed on D-Bus** on modern KDE/PipeWire. `lib/features/mic.js` spawns `pactl subscribe` as a long-lived child and re-reads `pactl get-source-mute @DEFAULT_SOURCE@` on source-change events. `pactl` must be on `$PATH`.
