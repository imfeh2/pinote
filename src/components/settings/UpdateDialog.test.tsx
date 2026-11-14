// @vitest-environment happy-dom

import { createInstance } from "i18next";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { UpdateDialog } from "@/components/settings/UpdateDialog";
import { initializeI18n } from "@/i18n";
import noteZh from "@/i18n/resources/zh-CN/note";
import settingsZh from "@/i18n/resources/zh-CN/settings";
import { formatReleaseBody } from "@/lib/releaseNotes";
import type { UpdateSnapshot } from "@/lib/updater";

const cleanups: (() => Promise<void>)[] = [];

beforeAll(() => initializeI18n("zh-CN"));

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function renderDialog(
  snapshot: Partial<UpdateSnapshot>,
  error: string | null = null,
) {
  const i18n = createInstance();
  await i18n.init({
    lng: "zh-CN",
    resources: { "zh-CN": { settings: settingsZh } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <I18nextProvider i18n={i18n}>
        <UpdateDialog
          snapshot={
            {
              state: "available",
              available: true,
              currentVersion: "0.6.5",
              latestVersion: "0.6.6",
              downloadProgress: null,
              ...snapshot,
            } as UpdateSnapshot
          }
          busy={false}
          error={error}
          onDownload={async () => {}}
          onInstall={async () => {}}
          onLater={() => {}}
        />
      </I18nextProvider>,
    ),
  );
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return container;
}

test("the update dialog shows the new version's notes in the interface language", async () => {
  const container = await renderDialog({
    notes: formatReleaseBody({
      "en-US": "> [!WARNING]\n> Back up first.\n\n- English change",
      "zh-CN": "> [!WARNING]\n> 请先备份。\n\n- 中文改动",
    }),
  });
  await vi.waitFor(() =>
    expect(
      Array.from(
        container.querySelectorAll(".cm-line"),
        (line) => line.textContent,
      ),
    ).toEqual([noteZh.alerts.warning, "请先备份。", "", "• 中文改动"]),
  );
  expect(
    Array.from(container.querySelectorAll(".cm-md-alert-warning")),
  ).toHaveLength(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

test("the download button fills up with the download progress", async () => {
  const container = await renderDialog({
    state: "downloading",
    downloadProgress: 45,
  });
  const buttons = container.querySelectorAll("button");
  const action = buttons[buttons.length - 1];
  expect(action.disabled).toBe(true);
  expect(action.textContent).toContain("正在下载 45%");
  expect(
    action.querySelector<HTMLElement>('span[aria-hidden="true"]')?.style
      .clipPath,
  ).toBe("inset(0 55% 0 0)");
});

test("errors are shown above the buttons", async () => {
  const container = await renderDialog({}, "更新失败");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "更新失败",
  );
});
