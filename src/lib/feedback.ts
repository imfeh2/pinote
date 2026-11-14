import { arch, platform, version } from "@tauri-apps/plugin-os";

export function feedbackUrl(repositoryUrl: string, appVersion: string) {
  const body = [
    "",
    "",
    "---",
    `Pinote: ${appVersion}`,
    `OS: ${platform()} ${version()} (${arch()})`,
  ].join("\n");
  return `${repositoryUrl}/issues/new?body=${encodeURIComponent(body)}`;
}
