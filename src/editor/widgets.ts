import type { Text } from "@codemirror/state";
import { WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

export class BulletWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-md-bullet";
    element.textContent = "•";
    return element;
  }
}

export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }

  toDOM() {
    const element = document.createElement("input");
    element.type = "checkbox";
    element.className = "cm-md-checkbox";
    element.checked = this.checked;
    element.tabIndex = -1;
    return element;
  }

  ignoreEvent() {
    return false;
  }
}

export class RuleWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-md-rule";
    return element;
  }
}

export class AlertTitleWidget extends WidgetType {
  constructor(readonly title: string) {
    super();
  }

  eq(other: AlertTitleWidget) {
    return other.title === this.title;
  }

  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-md-alert-title";
    element.textContent = this.title;
    return element;
  }
}

export class CodeInfoWidget extends WidgetType {
  constructor(readonly info: string) {
    super();
  }

  eq(other: CodeInfoWidget) {
    return other.info === this.info;
  }

  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-md-code-info";
    element.textContent = this.info;
    return element;
  }
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }

  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM() {
    const element = document.createElement("img");
    element.className = "cm-md-image";
    element.src = this.src;
    element.alt = this.alt;
    return element;
  }
}

const INLINE_TAGS: Record<string, string> = {
  Emphasis: "em",
  StrongEmphasis: "strong",
  Strikethrough: "del",
  InlineCode: "code",
  Link: "a",
};
const HIDDEN_MARKS = new Set([
  "EmphasisMark",
  "CodeMark",
  "StrikethroughMark",
  "LinkMark",
  "LinkTitle",
  "LinkLabel",
]);

type InlinePart = string | { tag: string; children: InlinePart[] };

interface TableData {
  alignments: string[];
  rows: { header: boolean; cells: { parts: InlinePart[]; offset: number }[] }[];
}

function inlineParts(doc: Text, node: SyntaxNode) {
  const parts: InlinePart[] = [];
  let position = node.from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from > position)
      parts.push(doc.sliceString(position, child.from));
    position = child.to;
    if (HIDDEN_MARKS.has(child.name)) continue;
    if (child.name === "Escape") {
      parts.push(doc.sliceString(child.from + 1, child.to));
      continue;
    }
    if (child.name === "URL") {
      if (node.name !== "Link")
        parts.push({
          tag: "a",
          children: [doc.sliceString(child.from, child.to)],
        });
      continue;
    }
    const tag =
      child.name === "Link" && !child.getChild("URL")
        ? undefined
        : INLINE_TAGS[child.name];
    parts.push(
      tag
        ? { tag, children: inlineParts(doc, child) }
        : doc.sliceString(child.from, child.to),
    );
  }
  if (node.to > position) parts.push(doc.sliceString(position, node.to));
  return parts;
}

function cellAlignments(delimiter: string) {
  return delimiter
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => {
      const value = cell.trim();
      if (value.startsWith(":") && value.endsWith(":")) return "center";
      if (value.endsWith(":")) return "right";
      if (value.startsWith(":")) return "left";
      return "";
    });
}

function rowCells(doc: Text, row: SyntaxNode, start: number) {
  const cells = row.getChildren("TableCell");
  const delimiters = row.getChildren("TableDelimiter");
  const bounds = [
    row.from,
    ...delimiters.flatMap((delimiter) => [delimiter.from, delimiter.to]),
    row.to,
  ];
  const segments: { from: number; to: number }[] = [];
  for (let index = 0; index < bounds.length; index += 2) {
    segments.push({ from: bounds[index], to: bounds[index + 1] });
  }
  const isEmpty = (segment: { from: number; to: number }) =>
    doc.sliceString(segment.from, segment.to).trim() === "";
  if (delimiters.length > 0 && isEmpty(segments[0])) segments.shift();
  if (delimiters.length > 0 && isEmpty(segments[segments.length - 1]))
    segments.pop();
  return segments.map((segment) => {
    const cell = cells.find(
      (candidate) =>
        candidate.from >= segment.from && candidate.to <= segment.to,
    );
    return {
      parts: cell ? inlineParts(doc, cell) : [],
      offset: (cell ? cell.to : Math.min(segment.from + 1, segment.to)) - start,
    };
  });
}

export function tableData(doc: Text, node: SyntaxNode, start: number) {
  const data: TableData = { alignments: [], rows: [] };
  for (let row = node.firstChild; row; row = row.nextSibling) {
    if (row.name === "TableDelimiter") {
      data.alignments = cellAlignments(doc.sliceString(row.from, row.to));
    } else if (row.name === "TableHeader" || row.name === "TableRow") {
      data.rows.push({
        header: row.name === "TableHeader",
        cells: rowCells(doc, row, start),
      });
    }
  }
  return data;
}

function appendParts(parent: HTMLElement, parts: InlinePart[]) {
  for (const part of parts) {
    if (typeof part === "string") {
      parent.append(part);
      continue;
    }
    const element = document.createElement(part.tag);
    appendParts(element, part.children);
    parent.append(element);
  }
}

export class TableWidget extends WidgetType {
  private readonly key: string;

  constructor(readonly data: TableData) {
    super();
    this.key = JSON.stringify(data);
  }

  eq(other: TableWidget) {
    return other.key === this.key;
  }

  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-table";
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const body = document.createElement("tbody");
    for (const row of this.data.rows) {
      const tr = document.createElement("tr");
      row.cells.forEach((cell, column) => {
        const element = document.createElement(row.header ? "th" : "td");
        appendParts(element, cell.parts);
        element.dataset.sourceOffset = String(cell.offset);
        const alignment = this.data.alignments[column];
        if (alignment) element.style.textAlign = alignment;
        tr.append(element);
      });
      (row.header ? head : body).append(tr);
    }
    table.append(head, body);
    wrapper.append(table);
    return wrapper;
  }

  ignoreEvent() {
    return false;
  }
}
