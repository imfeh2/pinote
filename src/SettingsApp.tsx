import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { exists, mkdir } from "@tauri-apps/plugin-fs";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AboutSection } from "@/components/settings/AboutSection";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { HistorySection } from "@/components/settings/HistorySection";
import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { ShortcutsSection } from "@/components/settings/ShortcutsSection";
import {
  dragMouseButtonOptions,
  type GlobalShortcutKey,
  type SettingsSection,
  type ShortcutKey,
  sections,
  wheelResizeModifierOptions,
} from "@/components/settings/shared";
import { UpdateDialog } from "@/components/settings/UpdateDialog";
import { WindowSection } from "@/components/settings/WindowSection";
import { useSettings } from "@/hooks/useSettings";
import { useTheme } from "@/hooks/useTheme";
import { saveDiagnosticReport } from "@/lib/diagnostics";
import {
  type NoteHistorySearchResult,
  searchNoteHistory,
} from "@/lib/noteHistory";
import { resolveDefaultNotesDirectory } from "@/lib/notes";
import { normalizeShortcut } from "@/lib/shortcuts";
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  subscribeUpdateState,
  type UpdateSnapshot,
} from "@/lib/updater";
import {
  bringNoteWindowsBackOnScreen,
  getDefaultMarkdownOpenEnabled,
  getOpenWithPinoteEnabled,
  getRuntimePlatform,
  type RuntimePlatform,
  setDefaultMarkdownOpenEnabled,
  setGlobalShortcuts,
  setNoteWindowsSkipTaskbar,
  setOpenWithPinoteEnabled,
} from "@/lib/windowApi";
import { openAndTrackNoteWindow } from "@/lib/windowManager";

const REPOSITORY_URL = "https://github.com/imfeh2/pinote";
const HISTORY_SEARCH_DEBOUNCE_MS = 120;
const settingsSections = new Set<SettingsSection>(
  sections.map((section) => section.id),
);
const emptyGlobalShortcutRegistration: Record<
  GlobalShortcutKey,
  boolean | null
> = {
  newNote: null,
  restoreWindow: null,
  showAllHiddenWindows: null,
  toggleVisibleWindows: null,
};

function getErrorMessage(error: unknown, t: TFunction<"settings">) {
  void error;
  return t("errors.unknown");
}

function formatDateTime(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getUpdateStatusText(
  snapshot: UpdateSnapshot,
  t: TFunction<"settings">,
) {
  if (snapshot.state === "idle") return t("updateStatus.idle");
  if (snapshot.state === "checking") return t("updateStatus.checking");
  if (snapshot.state === "available") {
    return t("updateStatus.available", {
      version: snapshot.latestVersion ?? t("common.unknown"),
    });
  }
  if (snapshot.state === "upToDate") return t("updateStatus.upToDate");
  if (snapshot.state === "downloading") {
    if (snapshot.downloadProgress !== null) {
      return t("updateStatus.downloadingProgress", {
        progress: snapshot.downloadProgress,
      });
    }
    return t("updateStatus.downloading");
  }
  if (snapshot.state === "readyToRestart") {
    return t("updateStatus.readyToRestart");
  }
  if (snapshot.state === "error") return t("updateStatus.failed");
  return t("updateStatus.unavailable");
}

function getInitialSection(): SettingsSection {
  const params = new URLSearchParams(window.location.search);
  const section = params.get("section");
  if (section && settingsSections.has(section as SettingsSection)) {
    return section as SettingsSection;
  }
  return "appearance";
}

export function SettingsApp() {
  useTheme();
  const { t, i18n } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  const settingsWindow = useMemo(() => getCurrentWindow(), []);
  const [activeSection, setActiveSection] = useState<SettingsSection>(() =>
    getInitialSection(),
  );
  const [shortcutInvalid, setShortcutInvalid] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [startupBusy, setStartupBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateActionError, setUpdateActionError] = useState<string | null>(
    null,
  );
  const [updateSnapshot, setUpdateSnapshot] = useState<UpdateSnapshot>(() =>
    getUpdateState(),
  );
  const [updateDialogDismissedVersion, setUpdateDialogDismissedVersion] =
    useState<string | null>(null);
  const pendingUpdateCheckVersionRef = useRef<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [aboutError, setAboutError] = useState<string | null>(null);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [diagnosticFileCount, setDiagnosticFileCount] = useState<number | null>(
    null,
  );
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [notesDirectoryError, setNotesDirectoryError] = useState<string | null>(
    null,
  );
  const [notesDirectoryBusy, setNotesDirectoryBusy] = useState(false);
  const [defaultNotesDirectory, setDefaultNotesDirectory] = useState("");
  const [contextMenuBusy, setContextMenuBusy] = useState(false);
  const [contextMenuError, setContextMenuError] = useState<string | null>(null);
  const [defaultOpenBusy, setDefaultOpenBusy] = useState(false);
  const [defaultOpenError, setDefaultOpenError] = useState<string | null>(null);
  const [taskbarBusy, setTaskbarBusy] = useState(false);
  const [taskbarError, setTaskbarError] = useState<string | null>(null);
  const [bringNotesBackBusy, setBringNotesBackBusy] = useState(false);
  const [bringNotesBackError, setBringNotesBackError] = useState<string | null>(
    null,
  );
  const [bringNotesBackCount, setBringNotesBackCount] = useState<number | null>(
    null,
  );
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyResults, setHistoryResults] = useState<
    NoteHistorySearchResult[]
  >([]);
  const [historyOpeningPath, setHistoryOpeningPath] = useState<string | null>(
    null,
  );
  const [historyReloadToken, setHistoryReloadToken] = useState(0);
  const [runtimePlatform, setRuntimePlatform] =
    useState<RuntimePlatform>("other");
  const [globalShortcutRegistration, setGlobalShortcutRegistration] = useState<{
    signature: string;
    values: Record<GlobalShortcutKey, boolean | null>;
  } | null>(null);

  const canDownloadUpdate =
    updateSnapshot.state === "available" ||
    (updateSnapshot.available && updateSnapshot.state === "error");
  const canInstallUpdate = updateSnapshot.state === "readyToRestart";
  const updateStatusText = getUpdateStatusText(updateSnapshot, t);
  const updateError =
    updateActionError || updateSnapshot.error ? t("updateStatus.failed") : null;
  const isCheckingUpdate = updateSnapshot.state === "checking";
  const isDownloadingUpdate = updateSnapshot.state === "downloading";
  const shouldShowUpdateDialog =
    updateSnapshot.available &&
    updateSnapshot.latestVersion !== undefined &&
    settings.pendingUpdatePromptVersion === updateSnapshot.latestVersion &&
    settings.dismissedUpdateVersion !== updateSnapshot.latestVersion &&
    updateDialogDismissedVersion !== updateSnapshot.latestVersion &&
    (updateSnapshot.state === "available" ||
      updateSnapshot.state === "downloading" ||
      updateSnapshot.state === "readyToRestart" ||
      updateSnapshot.state === "error");
  const activeWheelResizeModifier =
    wheelResizeModifierOptions.find(
      (item) => item.value === settings.wheelResizeModifier,
    ) ?? wheelResizeModifierOptions[0];
  const activeWheelOpacityModifier =
    wheelResizeModifierOptions.find(
      (item) => item.value === settings.wheelOpacityModifier,
    ) ?? wheelResizeModifierOptions[1];
  const activeDragMouseButton =
    dragMouseButtonOptions.find(
      (item) => item.value === settings.dragMouseButton,
    ) ?? dragMouseButtonOptions[0];
  const customNotesDirectory = settings.newNoteDirectory.trim();
  const effectiveNotesDirectory = customNotesDirectory || defaultNotesDirectory;
  const globalShortcutRegistrationSignature = [
    settings.shortcuts.newNote,
    settings.shortcuts.restoreWindow,
    settings.shortcuts.showAllHiddenWindows,
    settings.shortcuts.toggleVisibleWindows,
  ].join("\n");
  const displayedGlobalShortcutRegistration =
    activeSection !== "shortcuts" ||
    globalShortcutRegistration?.signature !==
      globalShortcutRegistrationSignature
      ? emptyGlobalShortcutRegistration
      : globalShortcutRegistration.values;

  const updateShortcut = useCallback(
    (key: ShortcutKey, value: string) => {
      const normalized = normalizeShortcut(value);
      if (!normalized) {
        setShortcutInvalid(true);
        return;
      }

      setShortcutInvalid(false);
      updateSettings({
        shortcuts: {
          [key]: normalized,
        },
      });
    },
    [updateSettings],
  );

  useEffect(() => {
    if (activeSection !== "shortcuts") return;
    let cancelled = false;
    const signature = globalShortcutRegistrationSignature;
    const refresh = async () => {
      try {
        const snapshot = await setGlobalShortcuts({
          newNote: settings.shortcuts.newNote,
          restoreWindow: settings.shortcuts.restoreWindow,
          showAllHiddenWindows: settings.shortcuts.showAllHiddenWindows,
          toggleVisibleWindows: settings.shortcuts.toggleVisibleWindows,
        });
        if (cancelled) return;
        setGlobalShortcutRegistration({
          signature,
          values: {
            newNote: snapshot.newNote,
            restoreWindow: snapshot.restoreWindow,
            showAllHiddenWindows: snapshot.showAllHiddenWindows,
            toggleVisibleWindows: snapshot.toggleVisibleWindows,
          },
        });
      } catch {
        if (cancelled) return;
        setGlobalShortcutRegistration({
          signature,
          values: emptyGlobalShortcutRegistration,
        });
      }
    };
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [
    activeSection,
    globalShortcutRegistrationSignature,
    settings.shortcuts.newNote,
    settings.shortcuts.restoreWindow,
    settings.shortcuts.showAllHiddenWindows,
    settings.shortcuts.toggleVisibleWindows,
  ]);

  const handleLaunchAtStartup = useCallback(async () => {
    const next = !settings.launchAtStartup;
    setStartupBusy(true);
    try {
      if (next) {
        await enable();
      } else {
        await disable();
      }
      setStartupError(null);
      updateSettings({ launchAtStartup: next });
    } catch (error) {
      setStartupError(getErrorMessage(error, t));
    } finally {
      setStartupBusy(false);
    }
  }, [settings.launchAtStartup, t, updateSettings]);

  const handleContextMenuIntegration = useCallback(async () => {
    const next = !settings.openWithPinoteContextMenu;
    setContextMenuBusy(true);
    try {
      const enabled = await setOpenWithPinoteEnabled(next);
      updateSettings({ openWithPinoteContextMenu: enabled });
      setContextMenuError(null);
    } catch (error) {
      setContextMenuError(getErrorMessage(error, t));
    } finally {
      setContextMenuBusy(false);
    }
  }, [settings.openWithPinoteContextMenu, t, updateSettings]);

  const handleDefaultOpenIntegration = useCallback(async () => {
    const next = !settings.defaultMarkdownOpenWithPinote;
    setDefaultOpenBusy(true);
    try {
      const enabled = await setDefaultMarkdownOpenEnabled(next);
      updateSettings({ defaultMarkdownOpenWithPinote: enabled });
      setDefaultOpenError(null);
    } catch (error) {
      setDefaultOpenError(getErrorMessage(error, t));
    } finally {
      setDefaultOpenBusy(false);
    }
  }, [settings.defaultMarkdownOpenWithPinote, t, updateSettings]);

  const handleTaskbarVisibility = useCallback(async () => {
    const next = !settings.hideNoteWindowsFromTaskbar;
    setTaskbarBusy(true);
    try {
      await setNoteWindowsSkipTaskbar(next);
      updateSettings({ hideNoteWindowsFromTaskbar: next });
      setTaskbarError(null);
    } catch (error) {
      setTaskbarError(getErrorMessage(error, t));
    } finally {
      setTaskbarBusy(false);
    }
  }, [settings.hideNoteWindowsFromTaskbar, t, updateSettings]);

  const handleBringNotesBack = useCallback(async () => {
    setBringNotesBackBusy(true);
    setBringNotesBackError(null);
    setBringNotesBackCount(null);
    try {
      const moved = await bringNoteWindowsBackOnScreen();
      setBringNotesBackCount(moved);
    } catch (error) {
      setBringNotesBackError(getErrorMessage(error, t));
    } finally {
      setBringNotesBackBusy(false);
    }
  }, [t]);

  const handleManualUpdateCheck = useCallback(async () => {
    setUpdateBusy(true);
    setUpdateActionError(null);
    try {
      await checkForUpdates("manual");
    } catch (error) {
      setUpdateActionError(getErrorMessage(error, t));
    } finally {
      setUpdateBusy(false);
    }
  }, [t]);

  const handleDownloadUpdate = useCallback(async () => {
    setUpdateBusy(true);
    setUpdateActionError(null);
    try {
      await downloadUpdate();
    } catch (error) {
      setUpdateActionError(getErrorMessage(error, t));
    } finally {
      setUpdateBusy(false);
    }
  }, [t]);

  const handleInstallUpdate = useCallback(async () => {
    setUpdateBusy(true);
    setUpdateActionError(null);
    try {
      await installUpdate();
    } catch (error) {
      setUpdateActionError(getErrorMessage(error, t));
    } finally {
      setUpdateBusy(false);
    }
  }, [t]);

  const handleUpdateLater = useCallback(() => {
    const latestVersion = updateSnapshot.latestVersion;
    if (!latestVersion) return;
    setUpdateDialogDismissedVersion(latestVersion);
    setUpdateActionError(null);
    updateSettings({
      pendingUpdatePromptVersion: "",
      dismissedUpdateVersion: latestVersion,
    });
  }, [updateSettings, updateSnapshot.latestVersion]);

  const handleOpenRepository = useCallback(async () => {
    try {
      await openUrl(REPOSITORY_URL);
      setAboutError(null);
    } catch (error) {
      setAboutError(getErrorMessage(error, t));
    }
  }, [t]);

  const handleSaveDiagnosticReport = useCallback(async () => {
    setDiagnosticBusy(true);
    setDiagnosticFileCount(null);
    setDiagnosticError(null);
    try {
      const result = await saveDiagnosticReport();
      if (!result) return;
      setDiagnosticFileCount(result.logFileCount);
    } catch (error) {
      setDiagnosticError(getErrorMessage(error, t));
    } finally {
      setDiagnosticBusy(false);
    }
  }, [t]);

  const handleChooseNotesDirectory = useCallback(async () => {
    setNotesDirectoryBusy(true);
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        defaultPath: effectiveNotesDirectory || undefined,
      });
      const selectedPath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof selectedPath !== "string" || !selectedPath.trim()) return;
      updateSettings({ newNoteDirectory: selectedPath.trim() });
      setNotesDirectoryError(null);
    } catch (error) {
      setNotesDirectoryError(getErrorMessage(error, t));
    } finally {
      setNotesDirectoryBusy(false);
    }
  }, [effectiveNotesDirectory, t, updateSettings]);

  const handleOpenNotesDirectory = useCallback(async () => {
    const targetDirectory = effectiveNotesDirectory.trim();
    if (!targetDirectory) return;
    setNotesDirectoryBusy(true);
    try {
      if (!customNotesDirectory) {
        const directoryExists = await exists(targetDirectory);
        if (!directoryExists) {
          await mkdir(targetDirectory, { recursive: true });
        }
      }
      await openPath(targetDirectory);
      setNotesDirectoryError(null);
    } catch (error) {
      setNotesDirectoryError(getErrorMessage(error, t));
    } finally {
      setNotesDirectoryBusy(false);
    }
  }, [customNotesDirectory, effectiveNotesDirectory, t]);

  const handleOpenHistoryItem = useCallback(
    async (item: NoteHistorySearchResult) => {
      const notePath = item.notePath.trim();
      if (!notePath) return;
      setHistoryOpeningPath(notePath);
      try {
        await openAndTrackNoteWindow({
          noteId: item.noteId,
          notePath,
          windowId: item.windowId.trim() || undefined,
          visibility: "visible",
          focus: true,
        });
        setHistoryError(null);
        setHistoryReloadToken((value) => value + 1);
      } catch (error) {
        setHistoryError(getErrorMessage(error, t));
      } finally {
        setHistoryOpeningPath(null);
      }
    },
    [t],
  );

  useEffect(() => {
    let active = true;
    isEnabled()
      .then((enabled) => {
        if (!active) return;
        if (settings.launchAtStartup === enabled) return;
        updateSettings({ launchAtStartup: enabled });
      })
      .catch((error) => {
        if (!active) return;
        setStartupError(getErrorMessage(error, t));
      });
    return () => {
      active = false;
    };
  }, [settings.launchAtStartup, t, updateSettings]);

  useEffect(() => {
    let active = true;
    getOpenWithPinoteEnabled()
      .then((enabled) => {
        if (!active) return;
        if (settings.openWithPinoteContextMenu === enabled) return;
        updateSettings({ openWithPinoteContextMenu: enabled });
      })
      .catch((error) => {
        if (!active) return;
        setContextMenuError(getErrorMessage(error, t));
      });
    return () => {
      active = false;
    };
  }, [settings.openWithPinoteContextMenu, t, updateSettings]);

  useEffect(() => {
    let active = true;
    getDefaultMarkdownOpenEnabled()
      .then((enabled) => {
        if (!active) return;
        if (settings.defaultMarkdownOpenWithPinote === enabled) return;
        updateSettings({ defaultMarkdownOpenWithPinote: enabled });
      })
      .catch((error) => {
        if (!active) return;
        setDefaultOpenError(getErrorMessage(error, t));
      });
    return () => {
      active = false;
    };
  }, [settings.defaultMarkdownOpenWithPinote, t, updateSettings]);

  useEffect(() => {
    let active = true;
    resolveDefaultNotesDirectory()
      .then((directory) => {
        if (!active) return;
        setDefaultNotesDirectory(directory);
      })
      .catch((error) => {
        if (!active) return;
        setNotesDirectoryError(getErrorMessage(error, t));
      });
    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => {
    if (activeSection !== "history") return;
    let active = true;
    const requestVersion = historyReloadToken;
    setHistoryLoading(true);
    const timer = window.setTimeout(() => {
      searchNoteHistory(historyQuery)
        .then((results) => {
          if (!active || requestVersion !== historyReloadToken) return;
          setHistoryResults(results);
          setHistoryError(null);
        })
        .catch((error) => {
          if (!active) return;
          setHistoryError(getErrorMessage(error, t));
        })
        .finally(() => {
          if (!active) return;
          setHistoryLoading(false);
        });
    }, HISTORY_SEARCH_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [activeSection, historyQuery, historyReloadToken, t]);

  useEffect(() => {
    return subscribeUpdateState((next) => {
      setUpdateSnapshot(next);
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void settingsWindow
      .listen<{ section: string }>("settings-section-requested", (event) => {
        if (disposed) return;
        const section = event.payload.section;
        if (!settingsSections.has(section as SettingsSection)) return;
        setActiveSection(section as SettingsSection);
      })
      .then((handler) => {
        if (disposed) {
          handler();
          return;
        }
        unlisten = handler;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [settingsWindow]);

  useEffect(() => {
    const pendingVersion = settings.pendingUpdatePromptVersion;
    if (!pendingVersion) return;
    if (pendingUpdateCheckVersionRef.current === pendingVersion) return;
    if (
      updateSnapshot.state === "checking" ||
      updateSnapshot.state === "downloading" ||
      updateSnapshot.state === "readyToRestart"
    ) {
      return;
    }
    if (
      updateSnapshot.available &&
      updateSnapshot.latestVersion === pendingVersion
    )
      return;
    pendingUpdateCheckVersionRef.current = pendingVersion;
    checkForUpdates("silent").catch(() => {});
  }, [
    settings.pendingUpdatePromptVersion,
    updateSnapshot.available,
    updateSnapshot.latestVersion,
    updateSnapshot.state,
  ]);

  useEffect(() => {
    if (!settings.lastUpdateCheckAt && updateSnapshot.state === "idle") {
      checkForUpdates("silent").catch(() => {});
    }
  }, [settings.lastUpdateCheckAt, updateSnapshot.state]);

  useEffect(() => {
    if (!updateSnapshot.lastCheckedAt) return;
    if (settings.lastUpdateCheckAt === updateSnapshot.lastCheckedAt) return;
    updateSettings({ lastUpdateCheckAt: updateSnapshot.lastCheckedAt });
  }, [
    settings.lastUpdateCheckAt,
    updateSettings,
    updateSnapshot.lastCheckedAt,
  ]);

  useEffect(() => {
    let active = true;
    getVersion()
      .then((version) => {
        if (!active) return;
        setAppVersion(version);
      })
      .catch(() => {
        if (!active) return;
        setAppVersion("");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    getRuntimePlatform()
      .then((platform) => {
        if (!active) return;
        setRuntimePlatform(platform);
      })
      .catch(() => {
        if (!active) return;
        setRuntimePlatform("other");
      });
    return () => {
      active = false;
    };
  }, []);

  const sectionContent =
    activeSection === "appearance" ? (
      <AppearanceSection
        settings={settings}
        runtimePlatform={runtimePlatform}
        updateSettings={updateSettings}
      />
    ) : activeSection === "window" ? (
      <WindowSection
        settings={settings}
        defaultNotesDirectory={defaultNotesDirectory}
        effectiveNotesDirectory={effectiveNotesDirectory}
        notesDirectoryBusy={notesDirectoryBusy}
        notesDirectoryError={notesDirectoryError}
        startupBusy={startupBusy}
        startupError={startupError}
        taskbarBusy={taskbarBusy}
        taskbarError={taskbarError}
        bringNotesBackBusy={bringNotesBackBusy}
        bringNotesBackError={bringNotesBackError}
        bringNotesBackResult={
          bringNotesBackCount === null
            ? null
            : bringNotesBackCount > 0
              ? t("window.lostNotes.moved", { count: bringNotesBackCount })
              : t("window.lostNotes.allVisible")
        }
        contextMenuBusy={contextMenuBusy}
        contextMenuError={contextMenuError}
        defaultOpenBusy={defaultOpenBusy}
        defaultOpenError={defaultOpenError}
        updateSettings={updateSettings}
        setNotesDirectoryError={setNotesDirectoryError}
        onChooseNotesDirectory={handleChooseNotesDirectory}
        onOpenNotesDirectory={handleOpenNotesDirectory}
        onLaunchAtStartup={handleLaunchAtStartup}
        onTaskbarVisibility={handleTaskbarVisibility}
        onBringNotesBack={handleBringNotesBack}
        onContextMenuIntegration={handleContextMenuIntegration}
        onDefaultOpenIntegration={handleDefaultOpenIntegration}
      />
    ) : activeSection === "history" ? (
      <HistorySection
        historyQuery={historyQuery}
        historyLoading={historyLoading}
        historyResults={historyResults}
        historyOpeningPath={historyOpeningPath}
        historyError={historyError}
        setHistoryQuery={setHistoryQuery}
        onOpenHistoryItem={handleOpenHistoryItem}
        onDeleted={(paths) => {
          const deleted = new Set(paths);
          setHistoryResults((current) =>
            current.filter((item) => !deleted.has(item.notePath)),
          );
          setHistoryReloadToken((value) => value + 1);
        }}
        formatDateTime={(value) =>
          formatDateTime(value, i18n.resolvedLanguage ?? "en-US")
        }
        editorFontFamily={settings.editorFontFamily}
        editorFontSize={settings.editorFontSize}
        editorLineHeight={settings.editorLineHeight}
      />
    ) : activeSection === "shortcuts" ? (
      <ShortcutsSection
        settings={settings}
        shortcutError={shortcutInvalid ? t("errors.invalidShortcut") : null}
        globalShortcutRegistration={displayedGlobalShortcutRegistration}
        activeWheelResizeModifier={activeWheelResizeModifier}
        activeWheelOpacityModifier={activeWheelOpacityModifier}
        activeDragMouseButton={activeDragMouseButton}
        updateShortcut={updateShortcut}
        updateSettings={updateSettings}
      />
    ) : (
      <AboutSection
        appVersion={
          appVersion === null
            ? t("common.loading")
            : appVersion || t("common.unknown")
        }
        updateBusy={updateBusy}
        isCheckingUpdate={isCheckingUpdate}
        isDownloadingUpdate={isDownloadingUpdate}
        updateStatusText={updateStatusText}
        updateSnapshot={updateSnapshot}
        canDownloadUpdate={canDownloadUpdate}
        canInstallUpdate={canInstallUpdate}
        settings={settings}
        updateError={updateError}
        aboutError={aboutError}
        diagnosticBusy={diagnosticBusy}
        diagnosticMessage={
          diagnosticFileCount === null
            ? null
            : t("diagnostics.saved", { count: diagnosticFileCount })
        }
        diagnosticError={diagnosticError}
        repositoryUrl={REPOSITORY_URL}
        formatDateTime={(value) =>
          formatDateTime(value, i18n.resolvedLanguage ?? "en-US")
        }
        onManualUpdateCheck={handleManualUpdateCheck}
        onDownloadUpdate={handleDownloadUpdate}
        onInstallUpdate={handleInstallUpdate}
        onOpenRepository={handleOpenRepository}
        onSaveDiagnosticReport={handleSaveDiagnosticReport}
      />
    );

  return (
    <div className="pinote-settings relative flex h-screen flex-col bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        <SettingsSidebar
          activeSection={activeSection}
          appVersion={appVersion}
          onSelect={setActiveSection}
        />

        <main className="pinote-scrollbar min-w-0 flex-1 overflow-y-auto px-5 py-4">
          {sectionContent}
        </main>
      </div>

      {shouldShowUpdateDialog ? (
        <UpdateDialog
          snapshot={updateSnapshot}
          busy={updateBusy}
          error={updateError}
          onDownload={handleDownloadUpdate}
          onInstall={handleInstallUpdate}
          onLater={handleUpdateLater}
        />
      ) : null}
    </div>
  );
}
