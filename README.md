# Pinote

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![Tauri](https://img.shields.io/badge/Tauri-2-24c8db?logo=tauri&logoColor=white)](https://github.com/tauri-apps/tauri)
[![Release](https://img.shields.io/github/v/release/imfeh2/pinote?display_name=tag&sort=semver)](https://github.com/imfeh2/pinote/releases/latest)
[![CI](https://github.com/imfeh2/pinote/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/imfeh2/pinote/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/imfeh2/pinote)](./LICENSE)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-24292f)](#installation)

Pinote is a lightweight floating Markdown note app for desktop. Keep multiple notes close at hand for TODOs, code snippets, and temporary ideas without leaving your current workspace.

https://github.com/user-attachments/assets/69cefbd0-77a1-4144-973d-2c21055058da

## Installation

Download the latest version from [GitHub Releases](https://github.com/imfeh2/pinote/releases/latest).

| Platform | Recommended Package               |
| -------- | --------------------------------- |
| Windows  | WinGet, `.msi`, or `.exe`         |
| macOS    | `.dmg` for Apple Silicon or Intel |
| Linux    | `.AppImage`, `.deb`, or `.rpm`    |

Windows users can install Pinote with WinGet:

```powershell
winget install ImFeH2.Pinote
```

Pinote checks for updates when it starts.

## Features

- **Markdown Notes** — Edit Markdown in lightweight WYSIWYG windows, with multiple notes open at once.
- **File Sync** — Detect external file changes and reload them when it is safe.
- **Window States** — Set always-on-top, read-only, opacity, position, size, and visibility for each note.
- **Window Shortcuts** — Create notes, restore hidden notes, show all hidden notes, or toggle the current visible set.
- **Custom Controls** — Change keyboard shortcuts, wheel modifiers, and the mouse button used to move windows.
- **Session Restore** — Restore window state, scroll position, and the last visible set after restarting Pinote.
- **History Search** — Find and reopen previous notes by path or content.
- **Appearance** — Choose the interface language and theme, then adjust typography, spacing, and glass effects.
- **Desktop Integration** — Use tray controls, launch at startup, and open files from the command line. Windows also supports File Explorer context menus and Markdown file association.
- **Updates** — Check for updates automatically at startup or manually from Settings.

## Keyboard Shortcuts

| Default Shortcut | Action                |
| ---------------- | --------------------- |
| `Alt+S`          | Restore hidden notes  |
| `Alt+Shift+H`    | Show all hidden notes |
| `Alt+D`          | Show or hide notes    |
| `Alt+C`          | New note              |
| `Alt+A`          | Toggle always on top  |
| `Alt+R`          | Toggle read-only mode |
| `Ctrl+Shift+D`   | Toggle theme          |
| `Esc`            | Hide note             |
| `Ctrl+Shift+W`   | Close note            |

Shortcuts can be changed in Settings. New note, restore hidden notes, show all hidden notes, and show or hide notes are global shortcuts that work from other apps.

## Mouse Interactions

| Default Interaction | Action                               |
| ------------------- | ------------------------------------ |
| `Alt + Wheel`       | Resize the window around the pointer |
| `Ctrl + Wheel`      | Adjust note opacity                  |
| Middle click        | Toggle always on top                 |
| Middle drag         | Move the note window                 |
| Right click         | Open the note menu                   |

Wheel modifiers and the mouse button used to move windows can be changed in Settings. When right drag is selected, a right click still opens the note menu.

## CLI

```bash
pinote /path/to/note.md
pinote ./daily.markdown
```

Each `.md` or `.markdown` path opens in its own note window. If the file is already open, Pinote focuses the existing window.

## Development

```bash
pnpm install
pnpm tauri dev
pnpm tauri build
```
