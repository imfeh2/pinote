use font_kit::source::SystemSource;

pub fn installed_font_families() -> Result<Vec<String>, String> {
    let families = SystemSource::new()
        .all_families()
        .map_err(|error| format!("Could not list installed fonts: {error}"))?;
    Ok(clean_font_families(families))
}

fn clean_font_families(families: Vec<String>) -> Vec<String> {
    let mut families = families
        .into_iter()
        .map(|family| family.trim().to_string())
        .filter(|family| !family.is_empty() && !family.starts_with('.'))
        .collect::<Vec<_>>();
    families.sort_by_cached_key(|family| family.to_lowercase());
    families.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    families
}

#[tauri::command]
pub async fn list_font_families() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(installed_font_families)
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn font_families_are_trimmed_sorted_and_unique() {
        let families = clean_font_families(
            [
                " Noto Sans ",
                ".SF NS",
                "arial",
                "",
                "Arial",
                "Noto Sans",
                "LXGW WenKai",
            ]
            .map(String::from)
            .to_vec(),
        );
        assert_eq!(families, ["arial", "LXGW WenKai", "Noto Sans"]);
    }
}
