# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-15

Initial public release. Module covers four KDE Plasma surfaces via a modular per-feature architecture.

### Added

- **Virtual desktops** (KWin VirtualDesktopManager) — `Next`, `Previous`, `Go to desktop N` actions; `On desktop` feedback; `current_desktop`, `desktop_count`, and per-desktop `desktop_N_name` variables; auto-generated "Go to *&lt;name&gt;*" presets that regenerate live when desktops are added, removed, or renamed.
- **Screen lock** (`org.freedesktop.ScreenSaver`) — `Screen locked` feedback and `locked` variable, driven by the `ActiveChanged` signal.
- **KDE global shortcuts** (KGlobalAccel) — `Trigger KDE global shortcut` action with a dropdown populated at init from every component's `allShortcutInfos()`. Dispatches via `invokeShortcut` so it works on X11 and Wayland without key synthesis.
- **Microphone mute** — `mic_muted` variable and `mic_is_muted` feedback, pushed by a long-lived `pactl subscribe` child process re-reading `pactl get-source-mute @DEFAULT_SOURCE@` on source-change events.
- **Bundled presets** — ready-to-drop buttons across six categories (Audio, Brightness, Media, Session, Screenshots, Windows) plus a Microphone mute toggle. The Lock Session preset wires in the `is_locked` feedback for visual state.
- **Per-feature toggles** — each feature can be enabled/disabled independently via Companion's instance config. Disabled features contribute nothing; failed features (missing service, absent binary) are skipped individually and the module reports `UnknownWarning` naming which ones failed.
- **Modular architecture** — `lib/core/` owns the shared bus and a scoped registry; each feature under `lib/features/` owns its proxies, signals, actions, feedbacks, variables, presets, and teardown end-to-end. Adding a feature is a drop-in-file plus a one-line index edit.

[1.0.0]: https://github.com/flyte/companion-module-kde-plasma/releases/tag/v1.0.0
