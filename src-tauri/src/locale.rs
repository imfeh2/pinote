use std::sync::RwLock;

use serde::Deserialize;
use tauri::Manager;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq)]
pub enum LanguagePreference {
    #[default]
    #[serde(rename = "system")]
    System,
    #[serde(rename = "en-US")]
    EnUs,
    #[serde(rename = "zh-CN")]
    ZhCn,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum AppLocale {
    #[default]
    EnUs,
    ZhCn,
}

pub struct NativeLocaleState(RwLock<AppLocale>);

impl NativeLocaleState {
    pub fn new(locale: AppLocale) -> Self {
        Self(RwLock::new(locale))
    }

    fn get(&self) -> AppLocale {
        self.0.read().map(|locale| *locale).unwrap_or_default()
    }

    fn set(&self, locale: AppLocale) {
        if let Ok(mut current) = self.0.write() {
            *current = locale;
        }
    }
}

#[derive(Clone, Copy)]
pub struct NativeText {
    pub exit_failed: &'static str,
    pub restore_hidden: &'static str,
    pub open_settings: &'static str,
    pub quit: &'static str,
    #[cfg(target_os = "windows")]
    pub open_with_pinote: &'static str,
    #[cfg(target_os = "windows")]
    pub markdown_file_type: &'static str,
}

const EN_US_TEXT: NativeText = NativeText {
    exit_failed: "Some notes could not be saved. Check the open notes and try again.",
    restore_hidden: "Show note",
    open_settings: "Settings",
    quit: "Quit",
    #[cfg(target_os = "windows")]
    open_with_pinote: "Open with Pinote",
    #[cfg(target_os = "windows")]
    markdown_file_type: "Pinote Markdown File",
};

const ZH_CN_TEXT: NativeText = NativeText {
    exit_failed: "部分便签未能保存，请检查便签后重试。",
    restore_hidden: "显示便签",
    open_settings: "设置",
    quit: "退出",
    #[cfg(target_os = "windows")]
    open_with_pinote: "使用 Pinote 打开",
    #[cfg(target_os = "windows")]
    markdown_file_type: "Pinote Markdown 文档",
};

fn normalize_system_locale(value: Option<&str>) -> AppLocale {
    if value
        .map(str::trim)
        .is_some_and(|locale| locale.to_ascii_lowercase().starts_with("zh"))
    {
        AppLocale::ZhCn
    } else {
        AppLocale::EnUs
    }
}

pub fn resolve_preference(preference: LanguagePreference) -> AppLocale {
    match preference {
        LanguagePreference::System => normalize_system_locale(tauri_plugin_os::locale().as_deref()),
        LanguagePreference::EnUs => AppLocale::EnUs,
        LanguagePreference::ZhCn => AppLocale::ZhCn,
    }
}

pub fn parse_stored_preference(value: Option<&str>) -> LanguagePreference {
    match value {
        Some("en-US") => LanguagePreference::EnUs,
        Some("zh-CN") => LanguagePreference::ZhCn,
        _ => LanguagePreference::System,
    }
}

pub fn current(app: &tauri::AppHandle) -> AppLocale {
    app.try_state::<NativeLocaleState>()
        .map(|state| state.get())
        .unwrap_or_default()
}

pub fn set(app: &tauri::AppHandle, locale: AppLocale) {
    if let Some(state) = app.try_state::<NativeLocaleState>() {
        state.set(locale);
    }
}

pub fn text(locale: AppLocale) -> &'static NativeText {
    match locale {
        AppLocale::EnUs => &EN_US_TEXT,
        AppLocale::ZhCn => &ZH_CN_TEXT,
    }
}

pub fn current_text(app: &tauri::AppHandle) -> &'static NativeText {
    text(current(app))
}

#[cfg(test)]
mod tests {
    use super::{AppLocale, LanguagePreference, normalize_system_locale, parse_stored_preference};

    #[test]
    fn resolves_chinese_system_locales() {
        assert_eq!(normalize_system_locale(Some("zh-CN")), AppLocale::ZhCn);
        assert_eq!(normalize_system_locale(Some("zh_Hant_TW")), AppLocale::ZhCn);
        assert_eq!(normalize_system_locale(Some(" ZH-hans ")), AppLocale::ZhCn);
    }

    #[test]
    fn falls_back_to_english_for_other_system_locales() {
        assert_eq!(normalize_system_locale(Some("en-US")), AppLocale::EnUs);
        assert_eq!(normalize_system_locale(Some("ja-JP")), AppLocale::EnUs);
        assert_eq!(normalize_system_locale(None), AppLocale::EnUs);
    }

    #[test]
    fn deserializes_supported_preferences() {
        assert_eq!(
            serde_json::from_str::<LanguagePreference>("\"system\"").unwrap(),
            LanguagePreference::System
        );
        assert_eq!(
            serde_json::from_str::<LanguagePreference>("\"en-US\"").unwrap(),
            LanguagePreference::EnUs
        );
        assert_eq!(
            serde_json::from_str::<LanguagePreference>("\"zh-CN\"").unwrap(),
            LanguagePreference::ZhCn
        );
    }

    #[test]
    fn sanitizes_stored_preferences() {
        assert_eq!(
            parse_stored_preference(Some("en-US")),
            LanguagePreference::EnUs
        );
        assert_eq!(
            parse_stored_preference(Some("zh-CN")),
            LanguagePreference::ZhCn
        );
        assert_eq!(
            parse_stored_preference(Some("unsupported")),
            LanguagePreference::System
        );
        assert_eq!(parse_stored_preference(None), LanguagePreference::System);
    }
}
