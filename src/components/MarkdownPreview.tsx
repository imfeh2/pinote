import {
  defaultValueCtx,
  editorViewOptionsCtx,
  Editor as MilkdownEditorCore,
  rootCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { nord } from "@milkdown/theme-nord";
import { alert } from "@/lib/markdownAlert";

function MarkdownPreviewInner({ markdown }: { markdown: string }) {
  useEditor(
    (root) =>
      MilkdownEditorCore.make()
        .config(nord)
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, markdown);
          ctx.update(editorViewOptionsCtx, (prev) => ({
            ...prev,
            editable: () => false,
          }));
        })
        .use(commonmark)
        .use(gfm)
        .use(alert),
    [],
  );
  return <Milkdown />;
}

export function MarkdownPreview({ markdown }: { markdown: string }) {
  return (
    <MilkdownProvider>
      <MarkdownPreviewInner markdown={markdown} />
    </MilkdownProvider>
  );
}
