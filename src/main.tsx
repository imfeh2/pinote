import { getCurrentWindow } from "@tauri-apps/api/window";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import ContextMenuApp from "@/ContextMenuApp";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SettingsProvider } from "@/hooks/useSettings";
import { initializeI18n } from "@/i18n";
import { LocaleSync } from "@/i18n/LocaleSync";
import { resolveAppLocale } from "@/i18n/locale";
import { logError } from "@/lib/logger";
import { setupLogging } from "@/lib/logging";
import { getNoteIdFromPath, normalizeNoteId } from "@/lib/notes";
import { checkForUpdates, getUpdateState } from "@/lib/updater";
import { openSettingsWindow } from "@/lib/windowApi";
import { SettingsApp } from "@/SettingsApp";
import {
  ensureSettingsStoreReady,
  getSettingsSnapshot,
  updateSettingsStore,
} from "@/stores/settingsStore";

setupLogging(window.location.href);

let hasRunStartupUpdateCheck = false;

function getView() {
  const params = new URLSearchParams(window.location.search);
  return params.get("view") ?? "";
}

function getNoteContext() {
  const params = new URLSearchParams(window.location.search);
  const notePath = params.get("notePath")?.trim() ?? "";
  if (!notePath) return null;
  const rawNoteId = params.get("noteId");
  const rawScrollTop = Number(params.get("noteScrollTop"));
  const rawOpacity = Number.parseFloat(params.get("noteOpacity") ?? "");
  const initialOpacity = Number.isFinite(rawOpacity)
    ? Math.min(Math.max(rawOpacity, 0), 1)
    : undefined;
  return {
    noteId: rawNoteId
      ? normalizeNoteId(rawNoteId)
      : getNoteIdFromPath(notePath),
    notePath,
    initialOpacity,
    initialReadOnly: params.get("noteReadOnly") === "true",
    initialScrollTop: Number.isFinite(rawScrollTop)
      ? Math.max(0, rawScrollTop)
      : 0,
  };
}

function getContextMenuContext() {
  const params = new URLSearchParams(window.location.search);
  const targetWindowLabel = params.get("targetWindowLabel")?.trim() ?? "";
  const noteId = params.get("noteId")?.trim() ?? "";
  const notePath = params.get("notePath")?.trim() ?? "";
  if (!targetWindowLabel || !noteId || !notePath) return null;
  const rawAnchorX = Number.parseInt(params.get("anchorX") ?? "", 10);
  const rawAnchorY = Number.parseInt(params.get("anchorY") ?? "", 10);
  const rawOpacity = Number.parseFloat(params.get("noteOpacity") ?? "");
  return {
    targetWindowLabel,
    noteId,
    notePath,
    anchorX: Number.isFinite(rawAnchorX) ? rawAnchorX : 0,
    anchorY: Number.isFinite(rawAnchorY) ? rawAnchorY : 0,
    noteOpacity: Number.isFinite(rawOpacity)
      ? Math.min(Math.max(rawOpacity, 0), 1)
      : 1,
    noteReadOnly: params.get("noteReadOnly") === "true",
    maximized: params.get("maximized") === "true",
  };
}

function StartupUpdateCheck() {
  useEffect(() => {
    if (hasRunStartupUpdateCheck) return;
    hasRunStartupUpdateCheck = true;

    const closeStartupWindow = async () => {
      try {
        await getCurrentWindow().destroy();
      } catch {
        return;
      }
    };

    void ensureSettingsStoreReady()
      .then(() => checkForUpdates("silent"))
      .then(async (result) => {
        const settings = getSettingsSnapshot();
        const lastCheckedAt = getUpdateState().lastCheckedAt;
        if (!result.available || !result.latestVersion) {
          if (lastCheckedAt) {
            await updateSettingsStore({ lastUpdateCheckAt: lastCheckedAt });
          }
          return;
        }
        if (settings?.dismissedUpdateVersion === result.latestVersion) {
          if (lastCheckedAt) {
            await updateSettingsStore({ lastUpdateCheckAt: lastCheckedAt });
          }
          return;
        }
        await updateSettingsStore({
          lastUpdateCheckAt: lastCheckedAt ?? settings?.lastUpdateCheckAt,
          pendingUpdatePromptVersion: result.latestVersion,
        });
        await openSettingsWindow("about");
      })
      .catch((error) => {
        logError("settings", "startup_update_failed", error);
      })
      .finally(() => {
        void closeStartupWindow();
      });
  }, []);

  return null;
}

function Root() {
  const view = getView();

  if (view === "settings") {
    return <SettingsApp />;
  }
  if (view === "startup-update") {
    return <StartupUpdateCheck />;
  }
  const contextMenuContext = getContextMenuContext();
  if (view === "context-menu" && contextMenuContext) {
    return <ContextMenuApp {...contextMenuContext} />;
  }
  const noteContext = getNoteContext();
  if (view === "note" && noteContext) {
    return (
      <App
        noteId={noteContext.noteId}
        notePath={noteContext.notePath}
        initialOpacity={noteContext.initialOpacity}
        initialReadOnly={noteContext.initialReadOnly}
        initialScrollTop={noteContext.initialScrollTop}
      />
    );
  }
  return (
    <div className="flex h-screen items-center justify-center bg-background text-muted-foreground" />
  );
}

async function bootstrap() {
  await ensureSettingsStoreReady();
  const locale = await resolveAppLocale(
    getSettingsSnapshot()?.language ?? "system",
  );
  await initializeI18n(locale);
  document.documentElement.lang = locale;
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <SettingsProvider>
          <LocaleSync />
          <Root />
        </SettingsProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

void bootstrap().catch((error) => {
  logError("frontend", "bootstrap_failed", error);
});
