import { getCurrentWindow } from "@tauri-apps/api/window";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { logError } from "@/lib/logger";

function CrashScreen({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div
      role="alert"
      data-tauri-drag-region
      className="flex h-screen flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border border-border bg-background p-4 text-center text-foreground"
    >
      <h1 className="text-sm font-semibold">{t("crash.title")}</h1>
      <p className="max-h-24 max-w-full select-text overflow-y-auto break-words text-xs text-muted-foreground">
        {message}
      </p>
      <div className="flex gap-2">
        <Button onClick={() => window.location.reload()}>
          {t("crash.reload")}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            getCurrentWindow()
              .destroy()
              .catch((closeError: unknown) => {
                logError("frontend", "crash_close_failed", closeError);
              });
          }}
        >
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: unknown; failed: boolean }
> {
  state = { error: null as unknown, failed: false };

  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    logError("frontend", "render_failed", error, {
      componentStack: info.componentStack ?? "",
    });
  }

  render() {
    if (this.state.failed) return <CrashScreen error={this.state.error} />;
    return this.props.children;
  }
}
