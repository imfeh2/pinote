// @vitest-environment happy-dom

import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { markdownText } from "@/editor/setup";
import { WorkingCopy } from "@/lib/workingCopy";
import { Editor } from "./Editor";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  invoke.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function editorView() {
  const element = container.querySelector<HTMLElement>(".cm-editor");
  if (!element) throw new Error("Missing editor");
  const view = EditorView.findFromDOM(element);
  if (!view) throw new Error("Missing editor view");
  return view;
}

test("closing immediately after an editor transaction saves its final text", async () => {
  invoke.mockResolvedValueOnce({ content: "Initial", version: "v0" });
  const copy = new WorkingCopy();
  await copy.load();
  try {
    await act(async () =>
      root.render(
        <Editor defaultValue="Initial" onChange={(text) => copy.edit(text)} />,
      ),
    );
    const view = editorView();
    invoke.mockResolvedValueOnce({ ended: true, version: "v1", error: null });
    await act(async () => {
      view.dispatch({ changes: { from: 7, insert: " 最后输入😀" } });
      await copy.end("close");
    });
    expect(invoke).toHaveBeenLastCalledWith("end_note", {
      kind: "close",
      save: { content: "Initial 最后输入😀", version: "v0" },
    });
    expect(copy.dirty).toBe(false);
  } finally {
    copy.disconnect();
  }
});

test("opening a note without editing keeps every byte and reports no change", async () => {
  const markdown = [
    "Title",
    "=====",
    "",
    "- a",
    "- b",
    "  - nested",
    "",
    "1) one",
    "",
    "file_name_here and 2*3*4 and \\_escaped\\_",
    "see https://example.com and <https://example.org>",
    "",
    "",
    "",
    "---",
    "~~~js",
    "const x = 1;",
    "~~~",
    "| a | b |",
    "|---|:-:|",
    "| 1 | 2 |",
    "",
    "- [ ] todo",
    "* [x] done",
    "==mark== $x^2$ a <kbd>Ctrl</kbd> b  ",
    "<br />",
    "",
  ].join("\r\n");
  const onChange = vi.fn();
  await act(async () =>
    root.render(<Editor defaultValue={markdown} onChange={onChange} />),
  );
  expect(markdownText(editorView().state)).toBe(markdown);
  expect(onChange).not.toHaveBeenCalled();
});

test("read-only notes keep their text and ignore checkbox clicks", async () => {
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      <Editor defaultValue={"- [ ] todo\n"} onChange={onChange} readOnly />,
    ),
  );
  const checkbox = container.querySelector<HTMLInputElement>(".cm-md-checkbox");
  if (!checkbox) throw new Error("Missing checkbox");
  await act(async () =>
    checkbox.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })),
  );
  expect(editorView().state.doc.toString()).toBe("- [ ] todo\n");
  expect(onChange).not.toHaveBeenCalled();
  await act(async () =>
    root.render(<Editor defaultValue={"- [ ] todo\n"} onChange={onChange} />),
  );
  expect(editorView().state.readOnly).toBe(false);
});
