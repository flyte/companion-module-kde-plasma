# KWin Desktop Connector — Design

**Date:** 2026-04-14
**Status:** Approved (MVP)

## Goal

Bitfocus Companion module exposing the current KWin virtual desktop as a variable, with actions to switch desktops and a feedback for highlighting the active desktop.

## Architecture

Standard Companion module using `@companion-module/base` (Node.js). Single instance connects to the user session DBus on init, subscribes to KWin signals, and maintains current desktop state in memory. Zero user configuration — session bus auto-connect.

## DBus Surface

- **Service:** `org.kde.KWin`
- **Path `/KWin`**, interface `org.kde.KWin`
  - Method `currentDesktop() → int` — initial read
  - Method `nextDesktop()` — action
  - Method `previousDesktop()` — action
  - Signal `currentDesktopChanged(int)` — state updates
- **Path `/VirtualDesktopManager`**, interface `org.kde.KWin.VirtualDesktopManager`
  - Property `Count` — total desktops (for goto bounds + variable)
  - Property `desktops` — list with UUIDs, used to map N → UUID
  - Method `setCurrent(string id)` — goto-N action

## Components

| File | Purpose |
|---|---|
| `main.js` | ModuleInstance: init, destroy, configUpdated |
| `dbus.js` | Connect, read current, subscribe signal, invoke methods |
| `variables.js` | `current_desktop` (int), `desktop_count` (int) |
| `actions.js` | `desktop_next`, `desktop_previous`, `desktop_goto` (N) |
| `feedbacks.js` | `on_desktop` boolean (option: desktop number) |

## Data Flow

```
init
 → dbus connect (session bus)
 → read currentDesktop + Count
 → setVariableValues
 → subscribe currentDesktopChanged
 → on signal: setVariableValues + checkFeedbacks
```

## Library

`dbus-next` — pure JS, maintained, promise-based, supports signal subscriptions.

## Error Handling

- DBus connect failure → `InstanceStatus.ConnectionFailure` with message
- Signal/bus disconnect → status `Disconnected`, retry with backoff
- Method call errors → logged; status unchanged
- `desktop_goto` with out-of-range N → log warning, no-op

## Testing

Manual only for MVP:
- Load module in Companion dev environment
- Verify `current_desktop` variable updates when switching desktops in KWin
- Verify all three actions switch desktops correctly
- Verify `on_desktop` feedback highlights correct button

No automated tests — DBus mocking not worth the MVP effort.

## Out of Scope (MVP)

- Desktop names (only numbers)
- Multi-screen / activity awareness
- Window/client info
- Configurable bus (always session)
- Unit tests
