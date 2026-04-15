# companion-module-kde-plasma

Bitfocus Companion module for KDE Plasma, exposing virtual desktops, screen lock, global shortcuts, and audio (speakers + mic) over the session DBus and `pactl`.

Requires KDE Plasma running on the same host as Companion. `pactl` (PulseAudio or `pipewire-pulse`) must be on `$PATH` for the audio feature.

## Features

Each feature can be toggled independently in the module config. A feature that fails to initialize (e.g. its backing service is absent) is skipped and the module continues with the rest, reporting an `UnknownWarning`.

| Feature | Toggle | Backing |
|---|---|---|
| Virtual desktops | `Virtual desktops` | `org.kde.KWin` / `org.kde.KWin.VirtualDesktopManager` |
| Screen lock | `Screen lock` | `org.freedesktop.ScreenSaver` |
| KDE global shortcuts | `KDE global shortcuts` | `org.kde.kglobalaccel` |
| Audio | `Audio (PulseAudio / PipeWire)` | `pactl subscribe` with a supervisor that auto-restarts on failure |

## Variables

| Variable | Description |
|---|---|
| `$(kde-plasma:current_desktop)` | Current virtual desktop number (1-based) |
| `$(kde-plasma:desktop_count)` | Total number of virtual desktops |
| `$(kde-plasma:desktop_N_name)` | Name of desktop N (one variable per desktop) |
| `$(kde-plasma:locked)` | Screen lock state (`true` / `false`) |
| `$(kde-plasma:mic_muted)` | Default audio source mute state (`true` / `false`) |
| `$(kde-plasma:mic_volume)` | Default audio source volume, 0–100 |
| `$(kde-plasma:mic_device)` | Friendly name of the default audio source |
| `$(kde-plasma:speaker_muted)` | Default audio sink mute state (`true` / `false`) |
| `$(kde-plasma:speaker_volume)` | Default audio sink volume, 0–100 |
| `$(kde-plasma:speaker_device)` | Friendly name of the default audio sink |

## Actions

| Action | Description |
|---|---|
| Next desktop / Previous desktop | Switch virtual desktop |
| Go to desktop N | Switch to desktop N (1-based) |
| Trigger KDE global shortcut | Invoke any KGlobalAccel-registered shortcut (dropdown populated at init from every component — works on X11 and Wayland, no key-press synthesis) |
| Toggle speaker mute / Toggle microphone mute | Direct `pactl set-*-mute ... toggle` |
| Speaker volume up / down | `set-sink-volume @DEFAULT_SINK@ ±N%` (step configurable per button, default 5) |
| Microphone volume up / down | `set-source-volume @DEFAULT_SOURCE@ ±N%` |

## Feedbacks

| Feedback | Description |
|---|---|
| On desktop | Active when the current desktop matches a configured number |
| Screen locked | Active when the KDE screen lock is engaged |
| Microphone muted | Active when the default audio source is muted |
| Speaker muted | Active when the default audio sink is muted |

## Presets

- **Virtual desktops** — one "Go to *&lt;desktop name&gt;*" button per desktop, regenerating live when desktops are added, removed, or renamed. Each uses the `on_desktop` feedback.
- **Audio** — Speaker/Mic mute toggles (with mute feedback) and volume up/down buttons.
- **Brightness / Media / Session / Screenshots / Windows** — bundled `kde_shortcut_trigger` presets for the standard KDE shortcuts in each area. Session → Lock additionally shows the screen-lock feedback.

## Architecture

Each feature lives in its own file under `lib/features/` and owns its DBus proxies (or child processes), signals, actions, feedbacks, variables, presets, and teardown end-to-end. Shared bus and a scoped registry live in `lib/core/`. Adding a new feature is a matter of dropping a file in `lib/features/` and adding one line to `lib/features/index.js`; a Companion config checkbox for it appears automatically.

Features declare `legacyIds` to migrate stored config when they are renamed — existing instances keep their enabled/disabled state across renames.

## Caveats

- **KGlobalAccel lazy registration** — an application only appears in the shortcut dropdown after it has run at least once in the current session. Launch the app, then reload the module.
- **Desktop name variables are append-only** — shrinking the desktop count leaves orphaned `desktop_N_name` variables with blank values until the module is reloaded.
- **Audio shells out to `pactl`** — it's the only feature that doesn't use DBus. Modern Plasma talks to PipeWire directly and doesn't expose an audio mute service on the session bus, so `pactl subscribe` is the cleanest push source. The subscriber is supervised and restarts with exponential backoff if it dies.

See `docs/plans/` for design and implementation history, and `CHANGELOG.md` for release notes.
