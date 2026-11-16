import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownPreview } from "@/components/Editor";
import { normalizeAppLocale } from "@/i18n/locale";
import { changelog, unreleasedNotes } from "@/lib/changelog";
import type { ReleaseNotes } from "@/lib/releaseNotes";

function ChangelogEntry({
  title,
  badge,
  notes,
}: {
  title: string;
  badge: ReactNode;
  notes: ReleaseNotes;
}) {
  const { i18n } = useTranslation("settings");
  const locale = normalizeAppLocale(i18n.resolvedLanguage);
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3"
    >
      <h2 className="flex items-center gap-2 text-xs font-semibold text-foreground">
        {title}
        {badge}
      </h2>
      <div
        className="note-editor text-muted-foreground"
        style={
          {
            "--editor-font-size": "12px",
            "--editor-line-height": "1.5",
            "--editor-padding-x": "0px",
            "--editor-padding-y": "0px",
          } as CSSProperties
        }
      >
        <MarkdownPreview key={locale} markdown={notes[locale]} />
      </div>
    </section>
  );
}

export function ChangelogSection({
  appVersion,
}: {
  appVersion: string | null;
}) {
  const { t } = useTranslation("settings");

  return (
    <div className="flex flex-col gap-4">
      {unreleasedNotes ? (
        <ChangelogEntry
          title={t("changelog.unreleased")}
          badge={null}
          notes={unreleasedNotes}
        />
      ) : null}
      {changelog.map((entry) => (
        <ChangelogEntry
          key={entry.version}
          title={`v${entry.version}`}
          badge={
            entry.version === appVersion ? (
              <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {t("changelog.current")}
              </span>
            ) : null
          }
          notes={entry.notes}
        />
      ))}
    </div>
  );
}
