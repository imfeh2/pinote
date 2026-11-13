import { $nodeSchema, $remark } from "@milkdown/kit/utils";
import i18n from "i18next";
import type { BlockContent, DefinitionContent, Parent, Root } from "mdast";
import type { Handle, Options } from "mdast-util-to-markdown";
import type { Processor } from "unified";
import { visit } from "unist-util-visit";

type AlertType = "note" | "tip" | "important" | "warning" | "caution";

interface Alert extends Parent {
  type: "alert";
  alertType: AlertType;
  children: (BlockContent | DefinitionContent)[];
}

declare module "mdast" {
  interface RootContentMap {
    alert: Alert;
  }
}

const MARKER =
  /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n[ \t]*|$)/i;

const handleAlert: Handle = (node: Alert, _, state, info) => {
  const exit = state.enter("blockquote");
  const tracker = state.createTracker(info);
  tracker.move("> ");
  tracker.shift(2);
  const content = state.containerFlow(node, tracker.current());
  const value = state.indentLines(
    `[!${node.alertType.toUpperCase()}]${content ? `\n${content}` : ""}`,
    (line, _, blank) => `>${blank ? "" : " "}${line}`,
  );
  exit();
  return value;
};

function remarkAlert(this: Processor) {
  const data = this.data() as { toMarkdownExtensions?: Options[] };
  data.toMarkdownExtensions ??= [];
  data.toMarkdownExtensions.push({ handlers: { alert: handleAlert } });
  return (tree: Root) => {
    visit(tree, "blockquote", (node, index, parent) => {
      const paragraph = node.children[0];
      if (!parent || index === undefined || paragraph?.type !== "paragraph") {
        return;
      }
      const text = paragraph.children[0];
      const match = text?.type === "text" ? text.value.match(MARKER) : null;
      if (!match || text?.type !== "text") return;
      const rest = text.value.slice(match[0].length);
      const inline = rest
        ? [{ ...text, value: rest }, ...paragraph.children.slice(1)]
        : paragraph.children.slice(1);
      if (!rest && inline[0]?.type === "break") inline.shift();
      const children = [
        ...(inline.length > 0 ? [{ ...paragraph, children: inline }] : []),
        ...node.children.slice(1),
      ];
      if (children.length === 0) return;
      parent.children[index] = {
        type: "alert",
        alertType: match[1].toLowerCase() as AlertType,
        children,
        position: node.position,
      };
    });
  };
}

export const alertRemark = $remark("remarkAlert", () => remarkAlert);

export const alertSchema = $nodeSchema("alert", () => ({
  content: "block+",
  group: "block",
  defining: true,
  attrs: {
    alertType: { default: "note", validate: "string" },
  },
  parseDOM: [
    {
      tag: "div[data-alert-type]",
      contentElement: ".pinote-alert-content",
      getAttrs: (dom) => ({
        alertType: (dom as HTMLElement).dataset.alertType,
      }),
    },
  ],
  toDOM: (node) => {
    const alertType = node.attrs.alertType as AlertType;
    return [
      "div",
      {
        class: `pinote-alert pinote-alert-${alertType}`,
        "data-alert-type": alertType,
      },
      [
        "div",
        { class: "pinote-alert-title", contenteditable: "false" },
        i18n.t(`note:alerts.${alertType}`),
      ],
      ["div", { class: "pinote-alert-content" }, 0],
    ];
  },
  parseMarkdown: {
    match: (node) => node.type === "alert",
    runner: (state, node, type) => {
      state
        .openNode(type, { alertType: node.alertType as AlertType })
        .next(node.children)
        .closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "alert",
    runner: (state, node) => {
      state
        .openNode("alert", undefined, { alertType: node.attrs.alertType })
        .next(node.content)
        .closeNode();
    },
  },
}));

export const alert = [alertRemark, alertSchema].flat();
