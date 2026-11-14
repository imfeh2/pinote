#!/usr/bin/env bash
# Run from any directory; uses only synthetic data and never starts Pinote.
set -euo pipefail
script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
export HOME=$tmp/home XDG_CONFIG_HOME=$tmp/config XDG_DATA_HOME=$tmp/data
export CAPTURE=$tmp/capture
unset PINOTE_EXECUTABLE PINOTE_SOFTWARE_COMPOSITING PINOTE_DISABLE_WEBKIT_A11Y
unset WEBKIT_DISABLE_COMPOSITING_MODE WEBKIT_A11Y_BUS_ADDRESS
mkdir -p "$HOME" "$XDG_CONFIG_HOME/pinote-launcher" "$XDG_DATA_HOME/im.feh2.pinote" "$tmp/package with spaces"
export PINOTE_EXECUTABLE="$tmp/package with spaces/pinote"
cat > "$PINOTE_EXECUTABLE" <<'SH'
#!/usr/bin/env bash
printf '%s\0' "$@" > "$CAPTURE.args"
printf '%s\n' "${WEBKIT_DISABLE_COMPOSITING_MODE-unset}" "${WEBKIT_A11Y_BUS_ADDRESS-unset}" > "$CAPTURE.env"
SH
chmod +x "$PINOTE_EXECUTABLE"

expect_args() {
    printf '%s\0' "$@" > "$tmp/expected"
    cmp "$tmp/expected" "$CAPTURE.args"
}
expect_env() {
    printf '%s\n' "$@" > "$tmp/expected"
    cmp "$tmp/expected" "$CAPTURE.env"
}
expect_no_note() {
    rm -f "$CAPTURE.args" "$CAPTURE.env"
    if "$script_dir/pinote-open-last" 2> "$tmp/error"; then
        printf '%s\n' 'Expected lookup failure' >&2
        exit 1
    fi
    [[ ! -e $CAPTURE.args && -s $tmp/error ]]
}

"$script_dir/pinote-launcher" 'a note.md' '' '--literal' '$HOME; echo unsafe' $'line\nbreak.markdown'
expect_args 'a note.md' '' '--literal' '$HOME; echo unsafe' $'line\nbreak.markdown'
expect_env unset unset
WEBKIT_DISABLE_COMPOSITING_MODE=0 WEBKIT_A11Y_BUS_ADDRESS=custom "$script_dir/pinote-launcher" keep.md
expect_env 0 custom
PINOTE_SOFTWARE_COMPOSITING=1 "$script_dir/pinote-launcher" software.md
expect_env 1 unset
PINOTE_DISABLE_WEBKIT_A11Y=1 "$script_dir/pinote-launcher" accessible.md
expect_env unset ''
PINOTE_SOFTWARE_COMPOSITING=1 PINOTE_DISABLE_WEBKIT_A11Y=1 "$script_dir/pinote-launcher" both.md
expect_env 1 ''
printf '%s' "$PINOTE_EXECUTABLE" > "$XDG_CONFIG_HOME/pinote-launcher/executable"
unset PINOTE_EXECUTABLE
"$script_dir/pinote-open-last" 'explicit note.md' '' 'second.markdown'
expect_args 'explicit note.md' '' 'second.markdown'

metadata=$XDG_DATA_HOME/im.feh2.pinote
expect_no_note
printf '{broken' > "$metadata/windows.json"
printf '[]' > "$metadata/history.json"
expect_no_note
older=$tmp/older\ note.md
newer=$tmp/newer\ note.MARKDOWN
printf 'old' > "$older"
printf 'new' > "$newer"
jq -n --arg older "$older" --arg newer "$newer" --arg missing "$tmp/missing.md" '{version:1,windows:{old:{notePath:$older,updatedAt:"00000000000000000001"},new:{notePath:$newer,updatedAt:"00000000000000000002"},missing:{notePath:$missing,updatedAt:"00000000000000000003"},bad:{notePath:5,updatedAt:"00000000000000000004"}}}' > "$metadata/windows.json"
"$script_dir/pinote-open-last"
expect_args "$newer"
[[ ! -e $tmp/missing.md ]]

# An unusable window cache falls back to history order, not object key order.
printf '{broken' > "$metadata/windows.json"
jq -n --arg older "$older" --arg newer "$newer" '{version:1,entries:{new:{notePath:$newer,lastOpenedAt:"2026-01-02T00:00:00Z"},old:{notePath:$older,lastOpenedAt:"2026-01-01T00:00:00Z"}},order:[null,"absent","old","new"]}' > "$metadata/history.json"
"$script_dir/pinote-open-last"
expect_args "$older"
# Entries missing from order are ranked by lastOpenedAt.
jq '.order=[]' "$metadata/history.json" > "$tmp/history"
mv "$tmp/history" "$metadata/history.json"
"$script_dir/pinote-open-last"
expect_args "$newer"
# Invalid JSON must not leak a candidate from an earlier valid object.
printf '\n{broken' >> "$metadata/history.json"
expect_no_note
printf '{"version":99,"windows":{}}' > "$metadata/windows.json"
printf '{"version":1,"entries":{"bad":7},"order":["bad"]}' > "$metadata/history.json"
expect_no_note
# Newlines inside a path are not record separators or shell syntax.
unusual=$tmp/$'literal $value;\nsecond line.md'
printf 'note' > "$unusual"
jq -n --arg note "$unusual" '{version:1,windows:{note:{notePath:$note,updatedAt:"00000000000000000001"}}}' > "$metadata/windows.json"
"$script_dir/pinote-open-last"
expect_args "$unusual"
printf '[]' > "$metadata/windows.json"
printf 'null' > "$metadata/history.json"
expect_no_note
printf '%s\n' 'Linux launcher regression tests passed.'
