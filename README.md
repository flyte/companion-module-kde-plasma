# companion-module-kde-plasma

Bitfocus Companion module for KDE Plasma, exposing virtual desktops, screen lock, global shortcuts, and microphone mute state over the session DBus (and `pactl` for audio).

Requires KDE Plasma running on the same host as Companion. `pactl` (PulseAudio/PipeWire) must be on `$PATH` for the microphone feature.

## Features

Each feature can be toggled independently in the module config. A feature that fails to initialize (e.g. its backing service is absent) is skipped and the module continues with the rest, reporting an `UnknownWarning`.

| Feature | Toggle | Backing service |
|---|---|---|
| Virtual desktops | `Virtual desktops` | `org.kde.KWin` / `org.kde.KWin.VirtualDesktopManager` |
| Screen lock | `Screen lock` | `org.freedesktop.ScreenSaver` |
| KDE global shortcuts | `KDE global shortcuts` | `org.kde.kglobalaccel` |
| Microphone mute | `Microphone mute` | `pactl subscribe` (PulseAudio / PipeWire) |

## Variables

| Variable | Description |
|---|---|
| `$(kde-plasma:current_desktop)` | Current virtual desktop number (1-based) |
| `$(kde-plasma:desktop_count)` | Total number of virtual desktops |
| `$(kde-plasma:desktop_N_name)` | Name of desktop N (one variable per desktop) |
| `$(kde-plasma:locked)` | Screen lock state (`true` / `false`) |
| `$(kde-plasma:mic_muted)` | Default audio source mute state (`true` / `false`) |

## Actions

| Action | Description |
|---|---|
| Next desktop | Switch to next virtual desktop |
| Previous desktop | Switch to previous virtual desktop |
| Go to desktop N | Switch to desktop N (1-based) |
| Trigger KDE global shortcut | Invoke any KGlobalAccel-registered shortcut (dropdown populated at init from every component — works on X11 and Wayland, no key-press synthesis) |

## Feedbacks

| Feedback | Description |
|---|---|
| On desktop | Active when the current desktop matches a configured number |
| Screen locked | Active when the KDE screen lock is engaged |
| Microphone muted | Active when the default audio source is muted |

## Presets

Auto-generated "Go to *&lt;desktop name&gt;*" buttons — one per virtual desktop, regenerating live when desktops are added, removed, or renamed. Each button uses the `on_desktop` feedback to highlight the active desktop.

## Architecture

Each feature lives in its own file under `lib/features/` and owns its DBus proxies, signal subscriptions, actions, feedbacks, variables, presets, and teardown end-to-end. Shared bus and a scoped registry live in `lib/core/`. Adding a new feature is a matter of dropping a file in `lib/features/` and adding one line to `lib/features/index.js`.

## Caveats

- **KGlobalAccel lazy registration** — an application only appears in the shortcut dropdown after it has run at least once in the current session. Launch the app, then reload the module.
- **Desktop name variables are append-only** — if you shrink the desktop count, orphaned `desktop_N_name` variables linger with blank values until Companion restarts the module.
- **Microphone feature shells out** — it's the only feature that doesn't go through DBus. Modern Plasma talks to PipeWire directly and doesn't expose an audio mute service on the session bus, so `pactl subscribe` is the cleanest push source.

See `docs/plans/` for design and implementation history.
