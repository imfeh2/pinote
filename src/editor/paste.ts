import { type Extension, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { gfm } from "@joplin/turndown-plugin-gfm";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
  strongDelimiter: "**",
});
turndown.use(gfm);

export function htmlToMarkdown(html: string) {
  return turndown.turndown(html);
}

function isPreformatted(html: string) {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  if (body.querySelector("pre")) return false;
  return [...body.querySelectorAll<HTMLElement>("[style]")].some((element) =>
    element.style.whiteSpace.startsWith("pre"),
  );
}

export function clipboardToMarkdown(clipboard: Pick<DataTransfer, "getData">) {
  const text = clipboard.getData("text/plain");
  const vscode = clipboard.getData("vscode-editor-data");
  if (vscode && text) {
    const language: unknown = JSON.parse(vscode).mode;
    if (typeof language === "string" && language) {
      return `\`\`\`${language}\n${text.replace(/\r\n?/g, "\n")}\n\`\`\``;
    }
  }
  const html = clipboard.getData("text/html");
  if (!html || isPreformatted(html)) return null;
  return htmlToMarkdown(html);
}

export function htmlPaste(): Extension {
  let plain = false;
  return Prec.high(
    EditorView.domEventHandlers({
      keydown(event) {
        plain =
          (event.ctrlKey || event.metaKey) &&
          event.shiftKey &&
          event.key.toLowerCase() === "v";
        return false;
      },
      keyup() {
        plain = false;
        return false;
      },
      paste(event, view) {
        if (plain || view.state.readOnly || !event.clipboardData) return false;
        const markdown = clipboardToMarkdown(event.clipboardData);
        if (markdown === null) return false;
        event.preventDefault();
        const { from, to } = view.state.selection.main;
        const doc = view.state.doc;
        const block = markdown.startsWith("```");
        const before = block && from > doc.lineAt(from).from ? "\n" : "";
        const after = block && to < doc.lineAt(to).to ? "\n" : "";
        view.dispatch(view.state.replaceSelection(before + markdown + after), {
          scrollIntoView: true,
          userEvent: "input.paste",
        });
        return true;
      },
    }),
  );
}
