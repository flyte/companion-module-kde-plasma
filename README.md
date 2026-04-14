# companion-module-kwin-desktop

Bitfocus Companion module exposing the current KWin virtual desktop via DBus.

Requires KDE Plasma with KWin running on the same host as Companion (session DBus).

## Variables

| Variable | Description |
|---|---|
| `$(kwin-desktop:current_desktop)` | Current virtual desktop number (1-based) |
| `$(kwin-desktop:desktop_count)` | Total number of virtual desktops |

## Actions

| Action | Description |
|---|---|
| Next desktop | Switch to next virtual desktop |
| Previous desktop | Switch to previous virtual desktop |
| Go to desktop N | Switch to desktop N (1-based) |

## Feedbacks

| Feedback | Description |
|---|---|
| On desktop | Boolean — active when current desktop matches configured number |

## Status

MVP — zero-config, session DBus only. Reconnects automatically on failure.

See `docs/plans/` for design and implementation plan.
