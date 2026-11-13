// @vitest-environment happy-dom

import {
  defaultValueCtx,
  Editor as MilkdownEditorCore,
  rootCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { getMarkdown } from "@milkdown/kit/utils";
import { beforeAll, expect, test } from "vitest";
import { initializeI18n } from "@/i18n";
import noteZh from "@/i18n/resources/zh-CN/note";
import { alert } from "@/lib/markdownAlert";

beforeAll(() => initializeI18n("zh-CN"));

async function load(markdown: string) {
  const root = document.createElement("div");
  const editor = await MilkdownEditorCore.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
    })
    .use(commonmark)
    .use(gfm)
    .use(alert)
    .create();
  const result = {
    root: root.cloneNode(true) as HTMLElement,
    markdown: editor.action(getMarkdown()),
  };
  await editor.destroy();
  return result;
}

test("alert blocks show their type and keep their markdown", async () => {
  const markdown = [
    "> [!WARNING]",
    "> Back up your notes **first**.",
    ">",
    "> * Settings",
    "",
    "> [!tip]",
    "> Short tip",
    "",
    "> Plain quote",
    "",
  ].join("\n");
  const { root, markdown: saved } = await load(markdown);
  const alerts = root.querySelectorAll(".pinote-alert");
  expect(
    Array.from(alerts, (node) => node.getAttribute("data-alert-type")),
  ).toEqual(["warning", "tip"]);
  expect(alerts[0].querySelector(".pinote-alert-title")?.textContent).toBe(
    noteZh.alerts.warning,
  );
  expect(alerts[0].querySelector(".pinote-alert-content")?.textContent).toBe(
    "Back up your notes first.Settings",
  );
  expect(root.querySelectorAll("blockquote")).toHaveLength(1);
  expect(saved).toBe(markdown.replace("[!tip]", "[!TIP]"));
});

test("an alert marker without content stays a quote", async () => {
  const { root } = await load("> [!NOTE]\n");
  expect(root.querySelector(".pinote-alert")).toBeNull();
  expect(root.querySelector("blockquote")).not.toBeNull();
});
