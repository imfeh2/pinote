// @vitest-environment happy-dom

import { forceParsing } from "@codemirror/language";
import { Compartment } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, expect, test, vi } from "vitest";
import { initializeI18n } from "@/i18n";
import noteZh from "@/i18n/resources/zh-CN/note";
import { focusChanged } from "./livePreview";
import { clipboardToMarkdown, htmlToMarkdown } from "./paste";
import { createMarkdownState } from "./setup";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) {
    view.dom.remove();
    view.destroy();
  }
});

function createView(doc: string, onChange = vi.fn(), readOnly = false) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: createMarkdownState({
      doc,
      readOnly: new Compartment(),
      initialReadOnly: readOnly,
      onChange,
    }),
  });
  views.push(view);
  forceParsing(view, view.state.doc.length, 10_000);
  return view;
}

function lineText(view: EditorView, index: number) {
  return view.contentDOM.querySelectorAll(".cm-line")[index]?.textContent;
}

function press(
  view: EditorView,
  key: string,
  modifiers: KeyboardEventInit = {},
) {
  return runScopeHandlers(
    view,
    new KeyboardEvent("keydown", { key, ...modifiers }),
    "editor",
  );
}

test("syntax marks are hidden until the cursor enters the element", () => {
  const view = createView("# Title\n\nsome **bold** text\n");
  expect(lineText(view, 0)).toBe("Title");
  expect(lineText(view, 2)).toBe("some bold text");
  view.dispatch({ effects: focusChanged.of(true), selection: { anchor: 8 } });
  expect(lineText(view, 0)).toBe("Title");
  view.dispatch({ selection: { anchor: 15 } });
  expect(lineText(view, 2)).toBe("some **bold** text");
  view.dispatch({ selection: { anchor: 2 } });
  expect(lineText(view, 0)).toBe("# Title");
  expect(lineText(view, 2)).toBe("some bold text");
});

test("clicking a task checkbox only flips its marker", () => {
  const onChange = vi.fn();
  const view = createView("- [ ] todo\n- [x] done\n", onChange);
  const boxes =
    view.contentDOM.querySelectorAll<HTMLInputElement>(".cm-md-checkbox");
  expect([...boxes].map((box) => box.checked)).toEqual([false, true]);
  boxes[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  expect(onChange).toHaveBeenLastCalledWith("- [x] todo\n- [x] done\n");
  view.contentDOM
    .querySelectorAll<HTMLInputElement>(".cm-md-checkbox")[1]
    .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  expect(onChange).toHaveBeenLastCalledWith("- [x] todo\n- [ ] done\n");
});

test("tables render as a table until the cursor enters them", () => {
  const view = createView("| a | **b** |\n|---|--:|\n| 1 | `2` |\n\nafter\n");
  const table = view.contentDOM.querySelector(".cm-md-table table");
  expect(table?.querySelector("th strong")?.textContent).toBe("b");
  expect(table?.querySelector("td code")?.textContent).toBe("2");
  expect(table?.querySelectorAll<HTMLElement>("td")[1].style.textAlign).toBe(
    "right",
  );
  view.dispatch({ effects: focusChanged.of(true), selection: { anchor: 2 } });
  expect(view.contentDOM.querySelector(".cm-md-table")).toBeNull();
  expect(lineText(view, 0)).toBe("| a | **b** |");
});

test("clicking a table cell places the cursor in its source", () => {
  const doc = "| a | b |\n|---|---|\n| 1 | 2 |\n";
  const view = createView(doc);
  const focus = vi.spyOn(view, "focus").mockImplementation(() => {});
  const cell =
    view.contentDOM.querySelectorAll<HTMLElement>(".cm-md-table td")[1];
  cell.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
  );
  expect(view.state.selection.main.head).toBe(doc.indexOf("2") + 1);
  expect(focus).toHaveBeenCalledOnce();
  view.dispatch({ effects: focusChanged.of(true) });
  expect(view.contentDOM.querySelector(".cm-md-table")).toBeNull();
});

test("editing keeps windows line breaks", () => {
  const onChange = vi.fn();
  const view = createView("a\r\nb\r\n", onChange);
  view.dispatch({ changes: { from: 1, insert: "\nc" } });
  expect(onChange).toHaveBeenLastCalledWith("a\r\nc\r\nb\r\n");
  view.dispatch({ changes: { from: 0, insert: "x\r\ny\n" } });
  expect(onChange).toHaveBeenLastCalledWith("x\r\ny\r\na\r\nc\r\nb\r\n");
});

test("formatting shortcuts wrap and unwrap the selection", () => {
  const onChange = vi.fn();
  const view = createView("word\n", onChange);
  view.dispatch({ selection: { anchor: 0, head: 4 } });
  expect(press(view, "b", { ctrlKey: true })).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("**word**\n");
  expect(press(view, "b", { ctrlKey: true })).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("word\n");
  expect(press(view, "2", { ctrlKey: true, altKey: true })).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("## word\n");
  expect(press(view, "0", { ctrlKey: true, altKey: true })).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("word\n");
  expect(press(view, "8", { ctrlKey: true, altKey: true })).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("- word\n");
});

test("enter continues a task list", () => {
  const onChange = vi.fn();
  const view = createView("- [ ] one", onChange);
  view.dispatch({ selection: { anchor: 9 } });
  expect(press(view, "Enter")).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("- [ ] one\n- [ ] ");
});

test("pasted html becomes markdown", () => {
  expect(
    htmlToMarkdown(
      "<h2>Title</h2><ul><li>one</li></ul><p><strong>bold</strong> <del>gone</del></p>",
    ),
  ).toBe("## Title\n\n-   one\n\n**bold** ~~gone~~");
});

test("tables inside quotes and list items render and map clicks to their source", () => {
  const doc =
    "> | a | b |\n> |---|---|\n> | 1 | 2 |\n\n- | c | d |\n  |---|---|\n  | 3 | 4 |\n";
  const view = createView(doc);
  vi.spyOn(view, "focus").mockImplementation(() => {});
  const tables = view.contentDOM.querySelectorAll(".cm-md-table");
  expect(tables).toHaveLength(2);
  expect(tables[1].querySelector("td")?.textContent).toBe("3");
  tables[0]
    .querySelectorAll<HTMLElement>("td")[1]
    .dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
  expect(view.state.selection.main.head).toBe(doc.indexOf("2") + 1);
});

test("list shortcuts skip blank lines in the selection", () => {
  const onChange = vi.fn();
  const view = createView("- a\n\n- b\n", onChange);
  view.dispatch({ selection: { anchor: 0, head: 8 } });
  expect(press(view, "8", { ctrlKey: true, altKey: true })).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("a\n\nb\n");
  expect(press(view, "7", { ctrlKey: true, altKey: true })).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("1. a\n\n2. b\n");
  view.dispatch({ selection: { anchor: 5 } });
  expect(press(view, "8", { ctrlKey: true, altKey: true })).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("1. a\n- \n2. b\n");
});

function clipboard(data: Record<string, string>) {
  return { getData: (type: string) => data[type] ?? "" };
}

test("vscode copies become code blocks and preformatted html stays plain text", () => {
  expect(
    clipboardToMarkdown(
      clipboard({
        "text/plain": "a_b = c * d\r\n  e",
        "text/html": "<div>a_b</div>",
        "vscode-editor-data": JSON.stringify({ mode: "python" }),
      }),
    ),
  ).toBe("```python\na_b = c * d\n  e\n```");
  expect(
    clipboardToMarkdown(
      clipboard({
        "text/plain": "    a_b",
        "text/html": '<div style="white-space: pre"><span>    a_b</span></div>',
      }),
    ),
  ).toBeNull();
  expect(
    clipboardToMarkdown(clipboard({ "text/html": "<p><em>x</em></p>" })),
  ).toBe("_x_");
});

test("a plain paste shortcut without a paste does not affect the next paste", () => {
  const onChange = vi.fn();
  const view = createView("", onChange);
  const paste = () => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.assign(event, {
      clipboardData: clipboard({ "text/html": "<strong>x</strong>" }),
    });
    view.contentDOM.dispatchEvent(event);
  };
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "v",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    }),
  );
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keyup", { key: "v", bubbles: true }),
  );
  paste();
  expect(onChange).toHaveBeenLastCalledWith("**x**");
});

test("tables keep empty cells in place and show bare links", () => {
  const view = createView(
    "| a | b | c |\n|---|---|---|\n| x |   | z |\n| https://x.com | 2 | 3 |\n",
  );
  const cells = [...view.contentDOM.querySelectorAll("td")].map(
    (cell) => cell.textContent,
  );
  expect(cells).toEqual(["x", "", "z", "https://x.com", "2", "3"]);
  expect(view.contentDOM.querySelector("td a")?.textContent).toBe(
    "https://x.com",
  );
});

test("square brackets without a link target stay visible", () => {
  const view = createView("see a[0] and [TODO] here\n");
  expect(lineText(view, 0)).toBe("see a[0] and [TODO] here");
});

test("read-only checkboxes keep their state when clicked", () => {
  const view = createView("- [ ] todo\n", vi.fn(), true);
  const box =
    view.contentDOM.querySelector<HTMLInputElement>(".cm-md-checkbox");
  if (!box) throw new Error("Missing checkbox");
  box.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
  );
  box.click();
  expect(box.checked).toBe(false);
  expect(view.state.doc.toString()).toBe("- [ ] todo\n");
});

test("code blocks inside quotes hide the quote marks", () => {
  const view = createView("> quote\n> ```\n> code\n> ```\n");
  expect(lineText(view, 2)).toBe("code");
});

test("list shortcuts switch between bullet and ordered lists", () => {
  const onChange = vi.fn();
  const view = createView("- a\n- b\n", onChange);
  view.dispatch({ selection: { anchor: 0, head: 7 } });
  expect(press(view, "7", { ctrlKey: true, altKey: true })).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("1. a\n2. b\n");
  expect(press(view, "8", { ctrlKey: true, altKey: true })).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("- a\n- b\n");
});

test("setext heading underlines are hidden until the cursor enters the heading", () => {
  const view = createView("Title\n===\n\nafter\n");
  expect(lineText(view, 0)).toBe("Title");
  expect(lineText(view, 2)).toBe("after");
  view.dispatch({ effects: focusChanged.of(true), selection: { anchor: 1 } });
  expect(lineText(view, 1)).toBe("===");
  view.dispatch({ selection: { anchor: 13 } });
  expect(lineText(view, 1)).toBe("");
});

test("code blocks that start on a list item keep the bullet", () => {
  const view = createView("- ```js\n  code\n  ```\n");
  expect(lineText(view, 0)).toBe("• js");
});

test("line shortcuts ignore a line where the selection only reaches its start", () => {
  const onChange = vi.fn();
  const view = createView("a\nb\nc\n", onChange);
  view.dispatch({ selection: { anchor: 0, head: 4 } });
  expect(press(view, "8", { ctrlKey: true, altKey: true })).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("- a\n- b\nc\n");
});

test("heading shortcuts turn a heading of the same level back into text", () => {
  const onChange = vi.fn();
  const view = createView("Title\n", onChange);
  expect(press(view, "2", { ctrlKey: true, altKey: true })).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("## Title\n");
  expect(press(view, "3", { ctrlKey: true, altKey: true })).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("### Title\n");
  expect(press(view, "3", { ctrlKey: true, altKey: true })).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("Title\n");
});

test("the task list shortcut switches lines to and from tasks", () => {
  const onChange = vi.fn();
  const view = createView("a\n- [x] b\n", onChange);
  view.dispatch({ selection: { anchor: 0, head: 9 } });
  expect(press(view, "9", { ctrlKey: true, altKey: true })).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("- [ ] a\n- [x] b\n");
  expect(press(view, "8", { ctrlKey: true, altKey: true })).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("- a\n- b\n");
  expect(press(view, "9", { ctrlKey: true, altKey: true })).toBe(true);
  expect(press(view, "9", { ctrlKey: true, altKey: true })).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("a\nb\n");
});

test("images and links that span lines stay as source text", () => {
  const view = createView(
    "![first\nsecond](a.png)\n\n[text](\nhttps://example.com)\n",
  );
  expect(lineText(view, 0)).toBe("![first");
  expect(lineText(view, 3)).toBe("[text](");
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  expect(lineText(view, 1)).toBe("second](a.png)");
});

test("the code block shortcut leaves out a line the selection only reaches", () => {
  const onChange = vi.fn();
  const view = createView("a\nb\n", onChange);
  view.dispatch({ selection: { anchor: 0, head: 2 } });
  expect(press(view, "c", { ctrlKey: true, altKey: true })).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith("```\na\n```\nb\n");
});

test("right clicks leave checkboxes and tables unchanged", () => {
  const onChange = vi.fn();
  const view = createView("- [ ] todo\n\n| a |\n|---|\n| 1 |\n", onChange);
  const rightClick = () =>
    new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 2 });
  view.contentDOM.querySelector(".cm-md-checkbox")?.dispatchEvent(rightClick());
  view.contentDOM.querySelector(".cm-md-table td")?.dispatchEvent(rightClick());
  expect(onChange).not.toHaveBeenCalled();
  expect(view.state.selection.main.head).toBe(0);
});

test("tables update after their source changes", () => {
  const view = createView("| a |\n|---|\n| 1 |\n\nafter\n");
  const cell = () =>
    view.contentDOM.querySelector(".cm-md-table td")?.textContent;
  view.dispatch({ changes: { from: view.state.doc.length, insert: "x" } });
  expect(cell()).toBe("1");
  view.dispatch({ changes: { from: 14, to: 15, insert: "2" } });
  expect(cell()).toBe("2");
});

test("alert quotes show a colored title until the cursor enters the marker line", async () => {
  await initializeI18n("zh-CN");
  const view = createView(
    "> [!warning]\n> Back up first.\n\n> [!NOTE]\n\n> [!TIP] text\n> more\n",
  );
  const lines = view.contentDOM.querySelectorAll(".cm-line");
  expect(lines[0].classList.contains("cm-md-alert-warning")).toBe(true);
  expect(lines[1].classList.contains("cm-md-alert-warning")).toBe(true);
  expect(lineText(view, 0)).toBe(noteZh.alerts.warning);
  expect(lineText(view, 1)).toBe("Back up first.");
  expect(lines[3].classList.contains("cm-md-alert")).toBe(false);
  expect(lines[5].classList.contains("cm-md-alert")).toBe(false);
  view.dispatch({ effects: focusChanged.of(true), selection: { anchor: 3 } });
  expect(lineText(view, 0)).toBe("> [!warning]");
  expect(
    view.contentDOM
      .querySelectorAll(".cm-line")[0]
      .classList.contains("cm-md-alert-warning"),
  ).toBe(true);
});
