import { useEffect } from "react";
import { useSettings } from "@/hooks/useSettings";
import { resolveEditorFontFamily } from "@/stores/settings";

export function useInterfaceFont() {
  const { settings } = useSettings();
  const family = settings.interfaceFollowEditorFont
    ? resolveEditorFontFamily(settings.editorFontFamily)
    : null;
  const weight = settings.interfaceFollowEditorFont
    ? settings.editorFontWeight.toString()
    : null;

  useEffect(() => {
    const style = document.documentElement.style;
    if (family === null || weight === null) {
      style.removeProperty("--interface-font-family");
      style.removeProperty("--interface-font-weight");
      return;
    }
    style.setProperty("--interface-font-family", family);
    style.setProperty("--interface-font-weight", weight);
  }, [family, weight]);
}
