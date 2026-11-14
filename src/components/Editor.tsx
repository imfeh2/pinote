import { Compartment, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type CSSProperties, useCallback, useEffect, useRef } from "react";
import { createMarkdownState, readOnlyExtension } from "@/editor/setup";

interface MarkdownViewOptions {
  defaultValue: string;
  readOnly: boolean;
  onChange?: (markdown: string) => void;
}

function useMarkdownView({
  defaultValue,
  readOnly,
  onChange,
}: MarkdownViewOptions) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyRef = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const initialRef = useRef({ defaultValue, readOnly });

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const initial = initialRef.current;
    const view = new EditorView({
      parent: host,
      state: createMarkdownState({
        doc: initial.defaultValue,
        readOnly: readOnlyRef.current,
        initialReadOnly: initial.readOnly,
        onChange: (markdown) => onChangeRef.current?.(markdown),
      }),
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyRef.current.reconfigure(readOnlyExtension(readOnly)),
    });
  }, [readOnly]);

  return { hostRef, viewRef };
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
  const { hostRef, viewRef } = useMarkdownView({
    defaultValue,
    readOnly,
    onChange,
  });

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

  const handleBlankClick = useCallback(
    (event: React.MouseEvent) => {
      const view = viewRef.current;
      if (readOnly || !view) return;
      const contentBottom = view.contentDOM.getBoundingClientRect().bottom;
      if (event.detail !== 0 && event.clientY <= contentBottom) return;
      const linesToAdd =
        event.detail === 0
          ? 1
          : Math.max(
              1,
              Math.ceil(
                (event.clientY - contentBottom) / view.defaultLineHeight,
              ),
            );
      const end = view.state.doc.length;
      view.dispatch({
        changes: { from: end, insert: "\n".repeat(linesToAdd) },
        selection: EditorSelection.cursor(end + linesToAdd),
        scrollIntoView: true,
      });
      view.focus();
    },
    [readOnly, viewRef],
  );

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="note-editor pinote-scrollbar min-h-0 flex-1"
      style={style}
    >
      <div className="mx-1 flex min-h-0 flex-1 cursor-text flex-col">
        <div ref={hostRef} />
        <button
          type="button"
          aria-label="Add paragraph"
          disabled={readOnly}
          onClick={handleBlankClick}
          className="min-h-6 flex-1 cursor-text border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        />
      </div>
    </div>
  );
}

export function MarkdownPreview({ markdown }: { markdown: string }) {
  const { hostRef } = useMarkdownView({
    defaultValue: markdown,
    readOnly: true,
  });
  return <div ref={hostRef} />;
}
