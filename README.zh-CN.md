# Pinote

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![Tauri](https://img.shields.io/badge/Tauri-2-24c8db?logo=tauri&logoColor=white)](https://github.com/tauri-apps/tauri)
[![Release](https://img.shields.io/github/v/release/imfeh2/pinote?display_name=tag&sort=semver)](https://github.com/imfeh2/pinote/releases/latest)
[![CI](https://github.com/imfeh2/pinote/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/imfeh2/pinote/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/imfeh2/pinote)](./LICENSE)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-24292f)](#安装)

Pinote 是一款轻量的桌面悬浮 Markdown 便签，适合随手记录待办、代码片段和临时想法。每个便签都对应一个独立文件，可以自由摆放，并单独设置置顶、只读和透明度。

https://github.com/user-attachments/assets/69cefbd0-77a1-4144-973d-2c21055058da

## 安装

从 [GitHub Releases](https://github.com/imfeh2/pinote/releases/latest) 下载最新版。

| 平台    | 推荐安装包                       |
| ------- | -------------------------------- |
| Windows | WinGet、`.msi` 或 `.exe`         |
| macOS   | Apple 芯片或 Intel 版本的 `.dmg` |
| Linux   | `.AppImage`、`.deb` 或 `.rpm`    |

Windows 可以通过 WinGet 安装：

```powershell
winget install ImFeH2.Pinote
```

Pinote 启动时会自动检查更新。

## 功能

- **Markdown 便签**：使用轻量的所见即所得编辑器，可以同时打开多个便签。
- **文件同步**：检测文件的外部修改，并在合适的时机重新载入。
- **独立窗口状态**：每个便签单独保存置顶、只读、透明度、位置、大小和显示状态。
- **窗口快捷操作**：通过快捷键新建、收起、找回便签，或一次显示所有已收起的便签。
- **自定义操作**：修改键盘快捷键、滚轮组合键和移动窗口所用的鼠标按键。
- **会话恢复**：重新启动后恢复窗口状态、滚动位置和上次显示的便签。
- **历史记录搜索**：按路径或内容查找并重新打开以前的便签。
- **外观设置**：选择界面语言和主题，并调整字体、字号、行高、边距和玻璃效果。
- **桌面集成**：支持托盘、开机启动和命令行打开文件。Windows 还支持资源管理器右键菜单和 Markdown 文件关联。
- **应用更新**：启动时自动检查更新，也可以在设置中手动检查。

## 键盘快捷键

| 默认快捷键     | 操作                 |
| -------------- | -------------------- |
| `Alt+S`        | 找回已收起的便签     |
| `Alt+Shift+H`  | 显示所有已收起的便签 |
| `Alt+D`        | 显示或收起便签       |
| `Alt+C`        | 新建便签             |
| `Alt+A`        | 切换置顶             |
| `Alt+R`        | 切换只读             |
| `Ctrl+Shift+D` | 切换主题             |
| `Esc`          | 收起便签             |
| `Ctrl+Shift+W` | 关闭便签             |

快捷键可以在设置中修改。新建便签、找回便签、显示所有已收起的便签以及显示或收起便签是全局快捷键，可以在其他应用中使用。

## 鼠标操作

| 默认操作         | 功能                     |
| ---------------- | ------------------------ |
| `Alt + 滚轮`     | 围绕鼠标指针调整窗口大小 |
| `Ctrl + 滚轮`    | 调整便签透明度           |
| 单击鼠标中键     | 切换置顶                 |
| 按住鼠标中键拖动 | 移动便签窗口             |
| 单击鼠标右键     | 打开便签菜单             |

滚轮组合键和移动窗口所用的鼠标按键可以在设置中修改。选择鼠标右键拖动后，单击右键仍会打开便签菜单。

## 命令行

```bash
pinote /path/to/note.md
pinote ./daily.markdown
```

每个 `.md` 或 `.markdown` 文件会在独立的便签窗口中打开。文件已经打开时，Pinote 会切换到现有窗口。

## 开发

```bash
pnpm install
pnpm tauri dev
pnpm tauri build
```
