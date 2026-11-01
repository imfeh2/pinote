import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";

export interface DataExport {
  destinationPath: string;
  fileCount: number;
}

export async function exportAppData() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destinationPath = await save({
    title: i18n.t("dataExport.dialogTitle", { ns: "settings" }),
    defaultPath: `pinote-data-${timestamp}.zip`,
    filters: [
      {
        name: i18n.t("diagnostics.dialog.zipArchive", { ns: "settings" }),
        extensions: ["zip"],
      },
    ],
  });
  if (!destinationPath) return null;
  return invoke<DataExport>("export_app_data", {
    destinationPath,
  });
}
