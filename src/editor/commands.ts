import { indentLess, indentMore } from "@codemirror/commands";
import { getIndentUnit, indentString, syntaxTree } from "@codemirror/language";
import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type SelectionRange,
  type StateCommand,
} from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";

function toggleInline(marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const size = marker.length;
    const transaction = state.changeByRange((range) => {
      const before = state.doc.sliceString(range.from - size, range.from);
      const after = state.doc.sliceString(range.to, range.to + size);
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: range.from - size, to: range.from },
            { from: range.to, to: range.to + size },
          ],
          range: EditorSelection.range(range.from - size, range.to - size),
        };
      }
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + size, range.to + size),
      };
    });
    dispatch(state.update(transaction, { userEvent: "input.format" }));
    return true;
  };
}

function lastSelectedLine(state: EditorState, range: SelectionRange) {
  const end = state.doc.lineAt(range.to);
  return !range.empty && end.from === range.to
    ? state.doc.line(end.number - 1)
    : end;
}

function selectedLines(state: EditorState) {
  const lines = new Map<number, { from: number; text: string }>();
  for (const range of state.selection.ranges) {
    const last = lastSelectedLine(state, range).number;
    for (
      let number = state.doc.lineAt(range.from).number;
      number <= last;
      number++
    ) {
      const line = state.doc.line(number);
      lines.set(line.from, { from: line.from, text: line.text });
    }
  }
  return [...lines.values()];
}

function replaceLinePrefixes(
  state: EditorState,
  dispatch: Parameters<StateCommand>[0]["dispatch"],
  pattern: RegExp,
  prefix: (index: number, allMatch: boolean, text: string) => string,
  replaced: RegExp = pattern,
) {
  const selected = selectedLines(state);
  const content = selected.filter((line) => line.text.trim() !== "");
  const lines = content.length > 0 ? content : selected;
  const allMatch = lines.every((line) => pattern.test(line.text));
  const changes: ChangeSpec[] = lines.map((line, index) => {
    const indentation = /^\s*/.exec(line.text)?.[0] ?? "";
    const existing = replaced.exec(line.text)?.[0].length ?? indentation.length;
    return {
      from: line.from + indentation.length,
      to: line.from + existing,
      insert: prefix(index, allMatch, line.text),
    };
  });
  dispatch(state.update({ changes, userEvent: "input.format" }));
  return true;
}

const HEADING_MARKER = /^\s*#{1,6}[ \t]+/;

function toggleHeading(level: number): StateCommand {
  return ({ state, dispatch }) =>
    replaceLinePrefixes(
      state,
      dispatch,
      new RegExp(`^\\s*#{${level}}[ \\t]+`),
      (_index, allMatch) =>
        level === 0 || allMatch ? "" : `${"#".repeat(level)} `,
      HEADING_MARKER,
    );
}

function toggleLinePrefix(
  pattern: RegExp,
  prefix: (index: number, text: string) => string,
  replaced: RegExp = pattern,
): StateCommand {
  return ({ state, dispatch }) =>
    replaceLinePrefixes(
      state,
      dispatch,
      pattern,
      (index, allMatch, text) => (allMatch ? "" : prefix(index, text)),
      replaced,
    );
}

const LIST_MARKER = /^\s*([-*+]|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?/;
const toggleBlockquote = toggleLinePrefix(/^\s*>[ \t]?/, () => "> ");
const toggleBulletList = toggleLinePrefix(
  /^\s*[-*+][ \t]+(?!\[[ xX]\][ \t])/,
  () => "- ",
  LIST_MARKER,
);
const TASK_MARKER = /^\s*[-*+][ \t]+\[([ xX])\][ \t]+/;
const toggleTaskList = toggleLinePrefix(
  TASK_MARKER,
  (_index, text) => `- [${TASK_MARKER.exec(text)?.[1] ?? " "}] `,
  LIST_MARKER,
);
const toggleOrderedList = toggleLinePrefix(
  /^\s*\d+[.)][ \t]+/,
  (index) => `${index + 1}. `,
  LIST_MARKER,
);

const wrapCodeBlock: StateCommand = ({ state, dispatch }) => {
  const first = state.doc.lineAt(state.selection.main.from);
  const last = lastSelectedLine(state, state.selection.main);
  dispatch(
    state.update({
      changes: [
        { from: first.from, insert: "```\n" },
        { from: last.to, insert: "\n```" },
      ],
      selection: EditorSelection.cursor(first.from + 3),
      userEvent: "input.format",
    }),
  );
  return true;
};

function inListItem(state: EditorState) {
  const tree = syntaxTree(state);
  return state.selection.ranges.every((range) => {
    for (
      let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(
        range.head,
        -1,
      );
      node;
      node = node.parent
    ) {
      if (node.name === "ListItem") return true;
    }
    return false;
  });
}

const indentTab: StateCommand = (target) => {
  const { state, dispatch } = target;
  if (inListItem(state)) return indentMore(target);
  dispatch(
    state.update(
      state.replaceSelection(indentString(state, getIndentUnit(state))),
      { scrollIntoView: true, userEvent: "input" },
    ),
  );
  return true;
};

export const formattingKeymap: readonly KeyBinding[] = [
  { key: "Mod-b", run: toggleInline("**") },
  { key: "Mod-i", run: toggleInline("_") },
  { key: "Mod-e", run: toggleInline("`") },
  { key: "Mod-Alt-x", run: toggleInline("~~") },
  ...[0, 1, 2, 3, 4, 5, 6].map((level) => ({
    key: `Mod-Alt-${level}`,
    run: toggleHeading(level),
  })),
  { key: "Mod-Shift-b", run: toggleBlockquote },
  { key: "Mod-Alt-7", run: toggleOrderedList },
  { key: "Mod-Alt-8", run: toggleBulletList },
  { key: "Mod-Alt-9", run: toggleTaskList },
  { key: "Mod-Alt-c", run: wrapCodeBlock },
  { key: "Tab", run: indentTab, shift: indentLess },
];
