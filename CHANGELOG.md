# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-02

First public release: a floating sticky-note pad for the DeepSeek Harness Web
GUI.

### Added

- Floating note window above the Harness Web GUI: note directory on the left,
  editor on the right, draggable by the title bar and resizable with 8 handles
  (minimum 320 × 240). The window stays inside the viewport, keeps 64 px clear
  of the Harness title bar, and remembers its size and position.
- Three title-bar buttons: notes-only compact mode, minimize to a 56 px ball,
  and reset to the default size. The ball can be dragged and clicked to restore
  the window.
- Note directory: create a note with an inline name input, rename (double-click),
  pin, drag to reorder with a smooth animation (`Alt` + `↑`/`↓` from the
  keyboard), and soft-delete. Deleted notes go to a recycle bin with restore,
  permanent delete and empty actions, each behind a two-step confirmation.
- Editor: title rename by double-click, character count and updated time;
  bold / italic / underline (`Ctrl`/`Cmd` + `B`/`I`/`U`); right-click menu with
  copy / cut / paste / clear formatting. Pasted and dropped HTML is sanitised.
  An empty note shows a clean paper surface.
- Paste or drag pictures into a note. They are scaled proportionally (longest
  side ≤ 1024 px) and stored as bounded `data:` URLs: PNG when the source may be
  transparent, JPEG otherwise, first frame for GIF, SVG refused. The note HTML
  cap is 600,000 characters and the request body cap is 8 MiB.
- Appearance settings: font size 13–20, line height 1.4–2.0, theme (follow
  system / light / dark), and a ruled-paper background. The notes palette is
  owned by the plugin, so a fixed theme ignores Harness theme changes; the light
  paper is a warm beige.
- Settings panel: appearance controls, reset window position, JSON export /
  import, sync status, version and project link.
- Persistence: `GET` / `PUT /dsh-quick-notes/state`, `GET /dsh-quick-notes/health`
  and `POST /dsh-quick-notes/diagnostic`, with atomic writes to
  `$DSH_HOME/quick-notes/notes.json` (override the folder with
  `DSH_QUICK_NOTES_DIR`). A `localStorage` mirror keeps notes available when the
  Harness route is not, merging by `savedAt` and retrying a failed write.
- Diagnostics: mount pings, theme / mode transitions, ball placement and boot
  reconciliation are appended to `$DSH_HOME/quick-notes/diagnostics.log` (size
  capped) for headless installs and crash triage.
- English and Chinese interface, a sidebar-footer launcher, GitHub Actions CI,
  issue and pull-request templates, and a format-1 plugin-market manifest.

### Removed

- The highlight and font-color features. The right-click menu now only offers
  copy / cut / paste / clear formatting; bold, italic and underline remain.
  Notes that already contain highlighted or colored text still render it.
- The empty-note placeholder text; empty notes now display a clean paper
  surface.

### Fixed

- Minimizing no longer produces an invisible ball: it is placed at the window's
  top-right corner, clamped into the viewport, and promoted above other floating
  widgets. A corrupt saved position falls back to a visible spot, and the ball
  no longer shows a note-count badge.
- Typing in a note no longer inherits formatting from earlier text, and the
  caret stays after the typed character.
- Images smaller than the 1024 px cap but over the data-URL budget are shrunk
  below their natural size instead of being rejected.
- “Reset window size” and “reset window position” clamp the window into the
  viewport, so a window near an edge cannot be rendered outside the frame.
- A window dragged to the very top no longer overlaps the Harness native
  title-bar drag region.
- A fixed light/dark theme no longer changes when the Harness theme changes.
- The editor reloads the active note after a whole-state replacement (a newer
  Harness copy or a JSON import), so stale text cannot overwrite newer data.
- Drag-and-drop and JSON import / export go through the same HTML whitelist as
  paste.
- The format menu stays open with a status line when clipboard access is denied
  instead of appearing to do nothing.
- Replaced two non-existent theme tokens so danger text, hints and the sync dot
  keep their intended colors.
- Declared Node.js `>= 22.13` to match the development toolchain and CI matrix.

### Security

- Whitelist sanitisation of note HTML before it is persisted, including pasted
  content; external images, SVG, scripts, event handlers and external links are
  stripped.
- Same-origin request fence on every Harness route (Host / Origin / Referer /
  `Sec-Fetch-Site` checks) plus `nosniff`, `same-origin` and `no-referrer`
  response headers, request-size caps and atomic state writes. Notes never leave
  the user's machine.

[1.0.0]: https://github.com/LittleLemonJam/dsh-quick-notes/releases/tag/v1.0.0
