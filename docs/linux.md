# Linux launchers and Wayland shortcuts

These optional examples do not change Pinote's defaults, install packages, edit your compositor configuration, or start a watchdog. They require Bash; saved-note lookup also requires `jq`. Use a native executable or an executable AppImage, not a shell command with embedded arguments.

## Install the helpers

From this repository's root:

```bash
install -Dm755 scripts/linux/pinote-launcher "$HOME/.local/bin/pinote-launcher"
install -Dm755 scripts/linux/pinote-open-last "$HOME/.local/bin/pinote-open-last"
config_home=${XDG_CONFIG_HOME:-"$HOME/.config"}
mkdir -p -- "$config_home/pinote-launcher"
read -r -p 'Absolute path to the installed Pinote executable or AppImage: ' pinote_executable
[[ $pinote_executable == /* && -f $pinote_executable && -x $pinote_executable ]] &&
    printf '%s\n' "$pinote_executable" > "$config_home/pinote-launcher/executable"
```

The configuration file contains one literal absolute path on its first line, without quotes, shell variables, or extra arguments. Spaces in that path are supported. It is never sourced or evaluated. Update the path if you move or replace a versioned AppImage. `PINOTE_EXECUTABLE=/absolute/path/to/pinote` overrides the file for one invocation. Do not point it back to either helper.

Launch a specific note with:

```bash
"$HOME/.local/bin/pinote-launcher" "/path/with spaces/daily.md"
```

The launcher forwards every argument unchanged and replaces itself with the executable (`exec`), preserving normal signal delivery and exit status. With no arguments it preserves Pinote's normal session-restore/new-note behavior. It does not force Wayland or X11, alter the WebKit sandbox, or disable accessibility.

## Blank windows and affected WebKitGTK versions

If WebKit's renderer stops, Pinote shows a native dialog rather than relying on
the stopped web page to display an error. **Reload saved version** reads the last
saved note again; **Close window** closes the failed window without waiting for
its save acknowledgement. Changes that never reached disk may be lost. Recovery
is explicit, not an automatic restart loop, and does not prevent engine bugs.

First update Pinote and your distribution's WebKitGTK packages. AppImages may bundle their own WebKitGTK version, so updating only the host library might not update the runtime actually in use. Try one workaround at a time, after exiting Pinote normally; a second invocation forwards requests to the existing process and cannot change that process's environment.

For rendering/compositing problems only:

```bash
PINOTE_SOFTWARE_COMPOSITING=1 "$HOME/.local/bin/pinote-launcher" "/path/to/note.md"
```

This sets `WEBKIT_DISABLE_COMPOSITING_MODE=1` for Pinote and its children. It disables WebKit's accelerated compositing path, potentially increasing CPU use or changing rendering performance. It is not a fix for accessibility crashes.

For an affected WebKitGTK accessibility crash (for example, WebKitGTK 2.50.4's `selectionChanged` / AT-SPI table-index assertion), an **explicit, application-scoped** workaround is:

```bash
PINOTE_DISABLE_WEBKIT_A11Y=1 "$HOME/.local/bin/pinote-launcher" "/path/to/note.md"
```

This exports an **empty** `WEBKIT_A11Y_BUS_ADDRESS`, which prevents the affected WebKit runtime from connecting its web-content accessibility tree to AT-SPI. **Screen readers and other assistive tools lose semantic access to Pinote's editor/web content.** Native GTK controls and other applications are not globally disabled. Do not use this workaround if you depend on that access; use a fixed WebKitGTK runtime instead. Remove the flag after updating and exit/reopen Pinote to restore the default. The launcher never sets `NO_AT_BRIDGE` or disables the sandbox. Both flags are opt-in and independent; absent flags leave inherited WebKit environment values untouched.

## Reopen the last saved note

```bash
"$HOME/.local/bin/pinote-open-last"
```

The helper reads metadata only from `${XDG_DATA_HOME:-$HOME/.local/share}/im.feh2.pinote`; an unset, empty, or relative XDG directory falls back to the standard home directory. It never rewrites metadata or searches note contents. Selection is predictable:

1. Read version-1 `windows.json`, trying entries by descending `updatedAt` (the cache's 20-digit timestamp). A timestamp tie uses descending cache key. This is the **most recently updated cached window**, not necessarily the most recently edited note.
2. If no usable cached path exists, read version-1 `history.json`: try its `order` list first (most recently opened first), then remaining entries by descending `lastOpenedAt` and descending entry key.
3. Skip missing/unreadable files, non-Markdown paths, relative paths, invalid path values, and paths with leading/trailing whitespace (Pinote's CLI trims whitespace). Supported extensions are `.md` and `.markdown`, case-insensitively. Internal spaces and newlines are preserved.
4. If neither file yields a readable existing note, print an error and exit nonzero **without launching Pinote**. Missing, unsupported, or malformed metadata never triggers a no-argument launch or creates an empty note. Open an existing note explicitly, or create one intentionally from Pinote, to establish history.

Malformed JSON is ignored as a whole; malformed entries are skipped. The internal metadata format may change. Lookup and opening are not atomic: deletion after the file check is subject to normal CLI behavior. Explicit arguments bypass lookup unchanged, including normal creation of explicitly requested nonexistent notes. Pinote routes requests to its existing instance without killing or restarting it; native Wayland activation/focus depends on the compositor and package, so focusing an already mapped window is not guaranteed by this helper.

## Desktop entry and startup (optional)

Keep the distribution/package desktop entry unless you need the wrapper. To add a separate user entry, save the following as `pinote-launcher.desktop` under `${XDG_DATA_HOME:-$HOME/.local/share}/applications/`. Replace the executable with its **literal absolute installed path**, keeping double quotes for spaces; desktop entries do not expand `$HOME` or `~`.

```desktop
[Desktop Entry]
Type=Application
Name=Pinote (launcher)
Exec="/absolute/path/to/pinote-launcher" %F
Terminal=false
Categories=Utility;TextEditor;
```

Desktop-entry escaping is not shell escaping: escape reserved characters according to the [Desktop Entry specification](https://specifications.freedesktop.org/desktop-entry-spec/latest/exec-variables.html). Do not add `sh -c`, `eval`, or a sandbox-disabling flag. If a workaround is needed persistently, the `Exec` line can explicitly use, for example, `Exec=env PINOTE_SOFTWARE_COMPOSITING=1 "/absolute/path/to/pinote-launcher" %F`; use `PINOTE_DISABLE_WEBKIT_A11Y=1` only with the accessibility tradeoff above. Environment variables exported in an interactive terminal may not reach desktop launchers or compositor bindings.

For **opt-in** login startup, create `${XDG_CONFIG_HOME:-$HOME/.config}/autostart/pinote-launcher.desktop` with the same fields and an `Exec` pointing to `pinote-open-last` **without `%F`**. This opens a saved note only. Choose this or Pinote's built-in launch-at-startup setting, not both; do not add a duplicate compositor startup command. Remove the autostart entry to undo it.

## Hyprland / native Wayland

Native Wayland does not provide unrestricted global keyboard capture. If Pinote's global shortcuts are unavailable, bind `pinote-open-last` in the compositor. **Esc** in a focused note uses Pinote's Hide note action; customized shortcuts or open dialogs/menus may change that handling. Hiding does not close or delete the note.

For Hyprland **0.57.2's Lua configuration**, this example makes **Super+N** hide a focused Pinote window via Esc, or reopen the saved note otherwise:

```lua
local open_pinote = hl.dsp.exec_cmd('"$HOME/.local/bin/pinote-open-last"')
hl.bind("SUPER + N", function()
    local window = hl.get_active_window()
    if window and window.class == "pinote" then
        hl.dispatch(hl.dsp.send_key_state({ mods = "", key = "Escape", state = "down", window = window }))
        return hl.dispatch(hl.dsp.send_key_state({ mods = "", key = "Escape", state = "up", window = window }))
    end
    return hl.dispatch(open_pinote)
end)
```

Check your package's actual class with read-only `hyprctl -j clients` before adapting `pinote`. The binding sends an explicit Esc press/release only to that focused window, retaining normal dialog/menu handling. If Caps Lock is already remapped to Super, this is also **Caps+N**; it does not change your keymap. Choose an unused key. The shell-quoted executable path preserves home-directory spaces.

These shapes follow Hyprland v0.57.2's [dispatcher implementation](https://github.com/hyprwm/Hyprland/blob/v0.57.2/src/config/lua/bindings/LuaBindingsDispatchers.cpp), [window selector conversion](https://github.com/hyprwm/Hyprland/blob/v0.57.2/src/config/lua/bindings/LuaBindingsInternal.cpp), and [dispatcher invocation API](https://github.com/hyprwm/Hyprland/blob/v0.57.2/src/config/lua/bindings/LuaBindingsDispatcherUtils.cpp). Dispatcher objects require `hl.dispatch`; explicit key states avoid `send_shortcut`'s bind-release handling. This is manually adaptable configuration, not live-tested compositor behavior. Do not probe a running compositor with `eval`/`repl`/`dispatch`; older `hyprland.conf` syntax is not Lua.

## Script regression tests

From the repository root:

```bash
bash scripts/linux/test.sh
```

The tests execute the actual helpers against temporary synthetic XDG metadata and a capture executable. They cover argument/path quoting, independent opt-in flags, inherited defaults, recent-window selection, history fallback, unsupported/malformed metadata, and refusal to launch when no saved note exists. They do not start Pinote, read your notes, or contact a compositor.
