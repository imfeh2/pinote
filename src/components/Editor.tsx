import {
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  Editor as MilkdownEditorCore,
  rootCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { history } from "@milkdown/kit/plugin/history";
import { indent } from "@milkdown/kit/plugin/indent";
import { trailing } from "@milkdown/kit/plugin/trailing";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { TextSelection, type Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  Milkdown,
  MilkdownProvider,
  useEditor,
  useInstance,
} from "@milkdown/react";
import { nord } from "@milkdown/theme-nord";
import { type CSSProperties, useCallback, useEffect, useRef } from "react";
import "@milkdown/theme-nord/style.css";

interface EditorInnerProps {
  defaultValue: string;
  readOnly: boolean;
  onChange: (markdown: string) => void;
}

function EditorInner({ defaultValue, readOnly, onChange }: EditorInnerProps) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const [loading, getInstance] = useInstance();

  useEditor(
    (root) =>
      MilkdownEditorCore.make()
        .config(nord)
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, defaultValue);
          ctx.update(editorViewOptionsCtx, (prev) => {
            return {
              ...prev,
              editable: () => !readOnly,
              dispatchTransaction(this: EditorView, transaction: Transaction) {
                const previous = this.state.doc;
                this.updateState(this.state.apply(transaction));
                if (
                  transaction.docChanged &&
                  transaction.getMeta("addToHistory") !== false &&
                  !previous.eq(this.state.doc)
                ) {
                  onChangeRef.current(ctx.get(serializerCtx)(this.state.doc));
                }
              },
            };
          });
        })
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(clipboard)
        .use(indent)
        .use(trailing),
    [],
  );

  useEffect(() => {
    if (loading) return;
    const editor = getInstance();
    if (!editor) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.setProps({
        editable: () => !readOnly,
      });
    });
  }, [getInstance, loading, readOnly]);

  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) return;
      if (loading) return;
      const editor = getInstance();
      if (!editor) return;

      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const editorDom = view.dom as HTMLElement;
        const contentBottom = editorDom.getBoundingClientRect().bottom;
        const clickY = e.clientY;

        if (e.detail !== 0 && clickY <= contentBottom) return;

        const lineHeight =
          parseFloat(getComputedStyle(editorDom).lineHeight) || 20;
        const linesToAdd =
          e.detail === 0
            ? 1
            : Math.max(1, Math.ceil((clickY - contentBottom) / lineHeight));

        const { state, dispatch } = view;
        const { schema } = state;
        let tr = state.tr;

        for (let i = 0; i < linesToAdd; i++) {
          tr = tr.insert(tr.doc.content.size, schema.nodes.paragraph.create());
        }

        const newEndPos = tr.doc.content.size - 1;
        tr = tr.setSelection(TextSelection.create(tr.doc, newEndPos));
        dispatch(tr);
        view.focus();
      });
    },
    [getInstance, loading, readOnly],
  );

  return (
    <div className="mx-1 flex min-h-0 flex-1 cursor-text flex-col">
      <Milkdown />
      <button
        type="button"
        aria-label="Add paragraph"
        disabled={readOnly || loading}
        onClick={handleContainerClick}
        className="min-h-6 flex-1 cursor-text border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      />
    </div>
  );
}

interface EditorProps {
  defaultValue: string;
  onChange: (markdown: string) => void;
  readOnly?: boolean;
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  style?: CSSProperties;
}

export function Editor({
  defaultValue,
  onChange,
  readOnly = false,
  initialScrollTop = 0,
  onScrollTopChange,
  style,
}: EditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!onScrollTopChange) return;
      onScrollTopChange(event.currentTarget.scrollTop);
    },
    [onScrollTopChange],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const nextScrollTop = Math.max(0, initialScrollTop);
    const apply = () => {
      container.scrollTop = nextScrollTop;
    };
    apply();
    const frame = window.requestAnimationFrame(apply);
    const timer = window.setTimeout(apply, 120);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [initialScrollTop]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="milkdown-editor pinote-scrollbar min-h-0 flex-1"
      style={style}
    >
      <MilkdownProvider>
        <EditorInner
          defaultValue={defaultValue}
          readOnly={readOnly}
          onChange={onChange}
        />
      </MilkdownProvider>
    </div>
  );
}
