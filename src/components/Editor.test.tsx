// @vitest-environment happy-dom

import {
  EditorStatus,
  editorViewCtx,
  Editor as MilkdownEditorCore,
} from "@milkdown/kit/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { WorkingCopy } from "@/lib/workingCopy";
import { Editor } from "./Editor";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

test("closing immediately after an editor transaction saves its final text", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  invoke.mockResolvedValueOnce({ content: "Initial", version: "v0" });
  const copy = new WorkingCopy();
  await copy.load();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const creation = vi.spyOn(MilkdownEditorCore, "make");
  try {
    await act(async () =>
      root.render(
        <Editor defaultValue="Initial" onChange={(text) => copy.edit(text)} />,
      ),
    );
    await vi.waitFor(() => expect(creation).toHaveBeenCalledOnce());
    const editor = creation.mock.results[0].value as MilkdownEditorCore;
    await act(async () => {
      await vi.waitFor(() => expect(editor.status).toBe(EditorStatus.Created));
    });
    const view = editor.action((ctx) => ctx.get(editorViewCtx));
    invoke.mockResolvedValueOnce({ ended: true, version: "v1", error: null });
    await act(async () => {
      view.dispatch(view.state.tr.insertText(" 最后输入😀", 8));
      await copy.end("close");
    });
    expect(invoke).toHaveBeenLastCalledWith("end_note", {
      kind: "close",
      save: { content: "Initial 最后输入😀\n", version: "v0" },
    });
    expect(copy.dirty).toBe(false);
  } finally {
    await act(async () => root.unmount());
    creation.mockRestore();
    copy.disconnect();
    container.remove();
  }
});
