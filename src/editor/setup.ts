import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { indentUnit, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import {
  type Compartment,
  EditorState,
  type Extension,
  Facet,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { formattingKeymap } from "./commands";
import { livePreview } from "./livePreview";
import { htmlPaste } from "./paste";

const lineEnding = Facet.define<string, string>({
  combine: (values) => values[0] ?? "\n",
});

export function markdownText(state: EditorState) {
  return state.doc.sliceString(0, state.doc.length, state.facet(lineEnding));
}

export function readOnlyExtension(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

interface MarkdownStateOptions {
  doc: string;
  readOnly: Compartment;
  initialReadOnly: boolean;
  onChange?: (markdown: string) => void;
}

export function createMarkdownState({
  doc,
  readOnly,
  initialReadOnly,
  onChange,
}: MarkdownStateOptions) {
  return EditorState.create({
    doc,
    extensions: [
      lineEnding.of(doc.includes("\r\n") ? "\r\n" : "\n"),
      history(),
      keymap.of([...formattingKeymap, ...defaultKeymap, ...historyKeymap]),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(classHighlighter),
      indentUnit.of("    "),
      EditorView.lineWrapping,
      livePreview(),
      htmlPaste(),
      readOnly.of(readOnlyExtension(initialReadOnly)),
      onChange
        ? EditorView.updateListener.of((update) => {
            if (update.docChanged) onChange(markdownText(update.state));
          })
        : [],
    ],
  });
}
