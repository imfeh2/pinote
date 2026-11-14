import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import i18n from "i18next";
import {
  AlertTitleWidget,
  BulletWidget,
  CheckboxWidget,
  CodeInfoWidget,
  ImageWidget,
  RuleWidget,
  TableWidget,
  tableData,
} from "./widgets";

export const focusChanged = StateEffect.define<boolean>();

const focusField = StateField.define<boolean>({
  create: () => false,
  update(focused, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(focusChanged)) return effect.value;
    }
    return focused;
  },
});

const hidden = Decoration.replace({});
const markCache = new Map<string, Decoration>();

function mark(className: string) {
  let decoration = markCache.get(className);
  if (!decoration) {
    decoration = Decoration.mark({ class: className });
    markCache.set(className, decoration);
  }
  return decoration;
}

class Builder {
  readonly ranges: Range<Decoration>[] = [];
  private readonly lineClasses = new Map<number, Set<string>>();
  private readonly reveal: boolean;

  constructor(readonly state: EditorState) {
    this.reveal = state.field(focusField) && !state.readOnly;
  }

  touches(from: number, to: number) {
    if (!this.reveal) return false;
    return this.state.selection.ranges.some(
      (range) => range.from <= to && range.to >= from,
    );
  }

  touchesLines(from: number, to: number) {
    const doc = this.state.doc;
    return this.touches(doc.lineAt(from).from, doc.lineAt(to).to);
  }

  withinLine(from: number, to: number) {
    return this.state.doc.lineAt(from).to >= to;
  }

  hide(from: number, to: number) {
    if (to > from && this.withinLine(from, to))
      this.ranges.push(hidden.range(from, to));
  }

  mark(from: number, to: number, className: string) {
    if (to > from) this.ranges.push(mark(className).range(from, to));
  }

  widget(
    from: number,
    to: number,
    widget: Parameters<typeof Decoration.replace>[0],
  ) {
    if (this.withinLine(from, to))
      this.ranges.push(Decoration.replace(widget).range(from, to));
  }

  lineClass(from: number, to: number, className: string) {
    const doc = this.state.doc;
    for (
      let line = doc.lineAt(from).number;
      line <= doc.lineAt(to).number;
      line++
    ) {
      const start = doc.line(line).from;
      let classes = this.lineClasses.get(start);
      if (!classes) {
        classes = new Set();
        this.lineClasses.set(start, classes);
      }
      classes.add(className);
    }
  }

  finish() {
    for (const [start, classes] of this.lineClasses) {
      this.ranges.push(
        Decoration.line({ class: [...classes].join(" ") }).range(start),
      );
    }
    return Decoration.set(this.ranges, true);
  }
}

function hideMarks(builder: Builder, node: SyntaxNode, name: string) {
  for (const child of node.getChildren(name))
    builder.hide(child.from, child.to);
}

function followingSpace(builder: Builder, position: number) {
  const next = builder.state.doc.sliceString(position, position + 1);
  return next === " " || next === "\t" ? position + 1 : position;
}

function atxHeading(builder: Builder, node: SyntaxNode, level: number) {
  builder.lineClass(node.from, node.to, `cm-md-heading cm-md-h${level}`);
  if (builder.touchesLines(node.from, node.to)) return;
  for (const headerMark of node.getChildren("HeaderMark")) {
    if (headerMark.from === node.from) {
      builder.hide(headerMark.from, followingSpace(builder, headerMark.to));
    } else {
      const text = builder.state.doc.sliceString(node.from, headerMark.from);
      builder.hide(node.from + text.trimEnd().length, headerMark.to);
    }
  }
}

function setextHeading(builder: Builder, node: SyntaxNode, level: number) {
  const underline = node.getChild("HeaderMark");
  if (!underline) return;
  const underlineLine = builder.state.doc.lineAt(underline.from);
  builder.lineClass(
    node.from,
    underlineLine.from - 1,
    `cm-md-heading cm-md-h${level}`,
  );
  if (builder.touchesLines(node.from, node.to))
    builder.lineClass(
      underlineLine.from,
      underlineLine.to,
      "cm-md-syntax-line",
    );
}

function inlineWithMarks(
  builder: Builder,
  node: SyntaxNode,
  className: string,
  markName: string,
) {
  builder.mark(node.from, node.to, className);
  if (!builder.touches(node.from, node.to)) hideMarks(builder, node, markName);
}

function link(builder: Builder, node: SyntaxNode) {
  const marks = node.getChildren("LinkMark");
  if (marks.length < 2 || !node.getChild("URL")) return;
  const textFrom = marks[0].to;
  const textTo = marks[1].from;
  builder.mark(textFrom, textTo, "cm-md-link");
  if (
    builder.touches(node.from, node.to) ||
    !builder.withinLine(textTo, node.to)
  )
    return;
  builder.hide(node.from, textFrom);
  builder.hide(textTo, node.to);
}

function image(builder: Builder, node: SyntaxNode) {
  if (
    builder.touches(node.from, node.to) ||
    !builder.withinLine(node.from, node.to)
  )
    return false;
  const marks = node.getChildren("LinkMark");
  const url = node.getChild("URL");
  if (marks.length < 2 || !url) return false;
  const doc = builder.state.doc;
  builder.widget(node.from, node.to, {
    widget: new ImageWidget(
      doc.sliceString(url.from, url.to),
      doc.sliceString(marks[0].to, marks[1].from),
    ),
  });
  return true;
}

function listMark(builder: Builder, node: SyntaxNode) {
  const doc = builder.state.doc;
  const item = node.parent;
  const task = item?.getChild("Task");
  const taskMarker = task?.getChild("TaskMarker");
  const text = doc.sliceString(node.from, node.to);
  const bullet = text === "-" || text === "*" || text === "+";
  if (task && taskMarker) {
    const checked =
      doc.sliceString(taskMarker.from + 1, taskMarker.to - 1) !== " ";
    if (checked)
      builder.mark(
        followingSpace(builder, taskMarker.to),
        task.to,
        "cm-md-task-done",
      );
    const from = bullet ? node.from : taskMarker.from;
    if (!bullet) builder.mark(node.from, node.to, "cm-md-list-mark");
    if (builder.touches(from, taskMarker.to)) return;
    builder.widget(from, taskMarker.to, {
      widget: new CheckboxWidget(checked),
    });
    return;
  }
  if (!bullet) {
    builder.mark(node.from, node.to, "cm-md-list-mark");
    return;
  }
  if (builder.touches(node.from, node.to)) return;
  builder.widget(node.from, node.to, { widget: new BulletWidget() });
}

const ALERT_MARKER =
  /^>[ \t]?(\[!(note|tip|important|warning|caution)\])[ \t]*$/i;

function blockquote(builder: Builder, node: SyntaxNode) {
  builder.lineClass(node.from, node.to, "cm-md-quote");
  const doc = builder.state.doc;
  const first = doc.lineAt(node.from);
  if (doc.lineAt(node.to).number === first.number) return;
  const text = doc.sliceString(node.from, first.to);
  const match = ALERT_MARKER.exec(text);
  if (!match) return;
  const type = match[2].toLowerCase();
  builder.lineClass(node.from, node.to, `cm-md-alert cm-md-alert-${type}`);
  if (builder.touchesLines(node.from, node.from)) return;
  const from = node.from + text.indexOf("[");
  builder.widget(from, from + match[1].length, {
    widget: new AlertTitleWidget(i18n.t(`note:alerts.${type}`)),
  });
}

function quoteMark(builder: Builder, node: SyntaxNode) {
  builder.mark(node.from, node.to, "cm-md-syntax");
  if (builder.touchesLines(node.from, node.to)) return;
  builder.hide(node.from, followingSpace(builder, node.to));
}

function horizontalRule(builder: Builder, node: SyntaxNode) {
  if (builder.touchesLines(node.from, node.to)) return;
  builder.widget(node.from, node.to, { widget: new RuleWidget() });
}

function fencedCode(builder: Builder, node: SyntaxNode) {
  const doc = builder.state.doc;
  const first = doc.lineAt(node.from);
  const last = doc.lineAt(node.to);
  builder.lineClass(node.from, node.to, "cm-md-codeblock");
  builder.lineClass(first.from, first.from, "cm-md-codeblock-start");
  builder.lineClass(last.from, last.from, "cm-md-codeblock-end");
  const marks = node.getChildren("CodeMark");
  if (builder.touches(node.from, node.to)) {
    builder.lineClass(first.from, first.from, "cm-md-syntax-line");
    if (marks.length > 1)
      builder.lineClass(last.from, last.from, "cm-md-syntax-line");
    return;
  }
  for (const quoteMark of node.getChildren("QuoteMark")) {
    builder.hide(quoteMark.from, followingSpace(builder, quoteMark.to));
  }
  const info = node.getChild("CodeInfo");
  builder.widget(node.from, first.to, {
    widget: new CodeInfoWidget(info ? doc.sliceString(info.from, info.to) : ""),
  });
  if (marks.length > 1 && last.number > first.number)
    builder.hide(last.from, last.to);
}

function inlineDecorations(view: EditorView) {
  const state = view.state;
  const builder = new Builder(state);
  const visible = view.visibleRanges;
  if (visible.length === 0) return builder.finish();
  syntaxTree(state).iterate({
    from: visible[0].from,
    to: visible[visible.length - 1].to,
    enter(ref) {
      const node = ref.node;
      const name = node.name;
      const heading = /^ATXHeading(\d)$/.exec(name);
      if (heading) {
        atxHeading(builder, node, Number(heading[1]));
        return;
      }
      const setext = /^SetextHeading(\d)$/.exec(name);
      if (setext) {
        setextHeading(builder, node, Number(setext[1]));
        return;
      }
      switch (name) {
        case "Emphasis":
          inlineWithMarks(builder, node, "cm-md-em", "EmphasisMark");
          return;
        case "StrongEmphasis":
          inlineWithMarks(builder, node, "cm-md-strong", "EmphasisMark");
          return;
        case "Strikethrough":
          inlineWithMarks(builder, node, "cm-md-strike", "StrikethroughMark");
          return;
        case "InlineCode":
          inlineWithMarks(builder, node, "cm-md-inline-code", "CodeMark");
          return false;
        case "Link":
          link(builder, node);
          return;
        case "Image":
          image(builder, node);
          return false;
        case "Autolink":
          inlineWithMarks(builder, node, "cm-md-link", "LinkMark");
          return false;
        case "URL":
          if (
            node.parent?.name === "Paragraph" ||
            node.parent?.name === "TableCell"
          )
            builder.mark(node.from, node.to, "cm-md-link");
          return;
        case "ListMark":
          listMark(builder, node);
          return;
        case "Blockquote":
          blockquote(builder, node);
          return;
        case "QuoteMark":
          quoteMark(builder, node);
          return;
        case "HorizontalRule":
          horizontalRule(builder, node);
          return;
        case "FencedCode":
          fencedCode(builder, node);
          return false;
        case "CodeBlock":
          builder.lineClass(node.from, node.to, "cm-md-codeblock");
          return false;
        case "Table":
          if (builder.touches(node.from, node.to))
            builder.lineClass(node.from, node.to, "cm-md-table-source");
          return false;
        case "HTMLBlock":
        case "HTMLTag":
        case "CommentBlock":
        case "Comment":
          builder.mark(node.from, node.to, "cm-md-html");
          return false;
        case "Escape":
          if (!builder.touches(node.from, node.to))
            builder.hide(node.from, node.from + 1);
          return false;
      }
    },
  });
  return builder.finish();
}

function previewSettingsChanged(update: {
  state: EditorState;
  startState: EditorState;
}) {
  return (
    syntaxTree(update.state) !== syntaxTree(update.startState) ||
    update.state.field(focusField) !== update.startState.field(focusField) ||
    update.state.readOnly !== update.startState.readOnly
  );
}

const inlinePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = inlineDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        previewSettingsChanged(update)
      )
        this.decorations = inlineDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

interface BlockItem {
  from: number;
  to: number;
  decoration: Range<Decoration>;
  table?: { source: string; widget: TableWidget };
}

const CONTAINER_BLOCKS = new Set([
  "Document",
  "Blockquote",
  "BulletList",
  "OrderedList",
  "ListItem",
]);

function blockItems(state: EditorState, previous: readonly BlockItem[] = []) {
  const doc = state.doc;
  const tables = new Map(
    previous.flatMap((item) =>
      item.table ? [[item.table.source, item.table.widget] as const] : [],
    ),
  );
  const items: BlockItem[] = [];
  syntaxTree(state).iterate({
    enter(ref) {
      const node = ref.node;
      if (node.name === "Table") {
        const from = doc.lineAt(node.from).from;
        const to = doc.lineAt(node.to).to;
        const source = doc.sliceString(from, to);
        const widget =
          tables.get(source) ?? new TableWidget(tableData(doc, node, from));
        items.push({
          from: node.from,
          to: node.to,
          decoration: Decoration.replace({ widget, block: true }).range(
            from,
            to,
          ),
          table: { source, widget },
        });
        return false;
      }
      if (/^SetextHeading\d$/.test(node.name)) {
        const underline = node.getChild("HeaderMark");
        if (underline) {
          const line = doc.lineAt(underline.from);
          items.push({
            from: doc.lineAt(node.from).from,
            to: doc.lineAt(node.to).to,
            decoration: hidden.range(line.from - 1, line.to),
          });
        }
        return false;
      }
      return CONTAINER_BLOCKS.has(node.name);
    },
  });
  return items;
}

function blockDecorations(state: EditorState, items: readonly BlockItem[]) {
  const builder = new Builder(state);
  return Decoration.set(
    items
      .filter((item) => !builder.touches(item.from, item.to))
      .map((item) => item.decoration),
    true,
  );
}

const blockPreview = StateField.define<{
  items: BlockItem[];
  decorations: DecorationSet;
}>({
  create(state) {
    const items = blockItems(state);
    return { items, decorations: blockDecorations(state, items) };
  },
  update(value, transaction) {
    if (
      transaction.docChanged ||
      syntaxTree(transaction.state) !== syntaxTree(transaction.startState)
    ) {
      const items = blockItems(transaction.state, value.items);
      return { items, decorations: blockDecorations(transaction.state, items) };
    }
    if (transaction.selection || previewSettingsChanged(transaction))
      return {
        items: value.items,
        decorations: blockDecorations(transaction.state, value.items),
      };
    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

function toggleTask(view: EditorView, target: HTMLElement) {
  const position = view.posAtDOM(target);
  const tree = syntaxTree(view.state);
  let node: SyntaxNode | null = tree.resolveInner(position, 1);
  while (node && node.name !== "ListItem") node = node.parent;
  const marker = node?.getChild("Task")?.getChild("TaskMarker");
  if (!marker) return false;
  const current = view.state.doc.sliceString(marker.from + 1, marker.to - 1);
  view.dispatch({
    changes: {
      from: marker.from + 1,
      to: marker.to - 1,
      insert: current === " " ? "x" : " ",
    },
  });
  return true;
}

function editTable(view: EditorView, table: HTMLElement, target: HTMLElement) {
  const offset = target.closest<HTMLElement>("[data-source-offset]")?.dataset
    .sourceOffset;
  const anchor = view.posAtDOM(table) + Number(offset ?? 0);
  view.dispatch({ selection: { anchor }, scrollIntoView: true });
  view.focus();
}

export function livePreview(): Extension {
  return [
    focusField,
    EditorView.focusChangeEffect.of((_state, focusing) =>
      focusChanged.of(focusing),
    ),
    blockPreview,
    inlinePreview,
    EditorView.domEventHandlers({
      click(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return false;
        if (!target.classList.contains("cm-md-checkbox")) return false;
        event.preventDefault();
        return true;
      },
      mousedown(event, view) {
        const target = event.target;
        if (event.button !== 0 || !(target instanceof HTMLElement))
          return false;
        if (target.classList.contains("cm-md-checkbox")) {
          event.preventDefault();
          if (view.state.readOnly) return true;
          return toggleTask(view, target);
        }
        const table = target.closest<HTMLElement>(".cm-md-table");
        if (!table || view.state.readOnly) return false;
        event.preventDefault();
        editTable(view, table, target);
        return true;
      },
    }),
  ];
}
