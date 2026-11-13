import { useTranslation } from "react-i18next";
import changelog from "@/changelog.json";
import { normalizeAppLocale } from "@/i18n/locale";
import type { ChangelogEntry } from "@/lib/releaseNotes";

const entries: ChangelogEntry[] = changelog;

export function ChangelogSection({
  appVersion,
}: {
  appVersion: string | null;
}) {
  const { t, i18n } = useTranslation("settings");
  const locale = normalizeAppLocale(i18n.resolvedLanguage);

  return (
    <div className="flex flex-col gap-4">
      {entries.map((entry) => (
        <section
          key={entry.version}
          aria-label={`v${entry.version}`}
          className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3"
        >
          <h2 className="flex items-center gap-2 text-xs font-semibold text-foreground">
            v{entry.version}
            {entry.version === appVersion ? (
              <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {t("changelog.current")}
              </span>
            ) : null}
          </h2>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
            {entry.changes[locale].map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
