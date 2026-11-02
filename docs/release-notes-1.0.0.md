# Release notes — 1.0.0 (2026-11-02)

Copy-ready text for the GitHub repository, npm and the awesome-dsh-plugin
listing.

## Basic information

| Field            | Value                                               |
| ---------------- | --------------------------------------------------- |
| Repository       | `https://github.com/LittleLemonJam/dsh-quick-notes` |
| npm package      | `dsh-quick-notes`                                   |
| Version          | `1.0.0`                                             |
| Release date     | 2026-11-02                                          |
| Author / license | LittleLemonJam / MIT                                |
| DSH requirement  | `>= 0.2.0`                                          |
| Node.js (build)  | `>= 22.13`                                          |

## GitHub repository description

> A floating sticky-note pad for the DeepSeek Harness Web GUI with a note
> directory, text editing, pasted images and local persistence.

(One sentence, 138 characters.)

## Suggested GitHub topics

```text
dsh
dsh-plugin
deepseek-harness
sticky-notes
notes
overlay
ui
```

## npm description

> A floating sticky-note pad for the DeepSeek Harness Web GUI: multiple notes,
> text editing, pasted images and local persistence.

## awesome-dsh-plugin entry

Suggested file: `data/plugins/LittleLemonJam__dsh-quick-notes.yml`

```yaml
description:
  en: A floating sticky-note pad for the DeepSeek Harness Web GUI with a note directory, text editing, pasted images and local persistence.
  zh: DeepSeek Harness Web 界面的悬浮便签本，支持便签目录、文本编辑、粘贴图片和本地持久化。
```

Both are one sentence, describe only what the plugin does, and end with a
full stop.

## GitHub Release v1.0.0 notes

```markdown
## Quick Notes 1.0.0

The first stable release of Quick Notes, a floating sticky-note pad for the
DeepSeek Harness Web GUI.

### Features

- Floating note window with a note directory: create, rename, pin, reorder
  (drag or `Alt` + `↑`/`↓`), delete and restore from the recycle bin.
- Simple text editing: bold / italic / underline, copy / cut / paste and clear
  formatting from the right-click menu.
- Paste or drag a picture into a note; it is scaled down to fit the window.
- Move and resize the window, switch to notes-only mode, minimize it to a small
  floating ball, or reset it to the default size / position.
- Settings for font size, line height, theme (follow system / light / dark),
  ruled paper, and JSON export / import.
- Notes are stored locally and saved automatically; no account, no upload.

### Install

- DSH UI: **Plugins** page → **Add plugin → Install a third-party plugin** →
  enter `dsh-quick-notes`.
- Plugin market: **Plugins → Discover** (with an index source configured) or the
  community dshmarket plugin under **Settings → Plugin market**.
- CLI: `dsh plugin add dsh-quick-notes`
- Local checkout: `dsh plugin add link:/absolute/path/to/dsh-quick-notes`

### Data

Notes are stored at `~/.dsh/quick-notes/notes.json`
(`%USERPROFILE%\.dsh\quick-notes\notes.json` on Windows), or under
`$DSH_QUICK_NOTES_DIR` when it is set.

### Requirements

- DeepSeek Harness 0.2.0 or newer.
- Node.js 22.13 or newer when building from source.
```

## Short introduction for users (Chinese)

随想随记是给 DeepSeek Harness 用的悬浮便签本。它会在界面上放一个小窗口，可以随手
记下想法、待办、临时命令之类的短内容，也可以放多条便签随时切换。窗口能移动、能收起，
还可以缩成一个小圆球；内容会自动保存在你自己的电脑上，刷新或重启后都还在。可以在
DSH 的插件市场里搜索「随想随记」安装，也可以用 `dsh plugin add dsh-quick-notes`
命令安装。

## Release checklist (maintainer)

The repository, npm entry, GitHub Release and plugin-market listing are prepared
from the text above. The day-to-day release procedure (version bump, build,
verify, publish, listing) is documented in
[`docs/development.md`](development.md#发布流程).
