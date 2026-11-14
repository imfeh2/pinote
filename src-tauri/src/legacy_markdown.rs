use log::{error, info};
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager};

const PROGRESS_FILE_NAME: &str = "note-conversion.json";

fn parser_options() -> Options {
    Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS
}

fn is_line_break_tag(text: &str) -> bool {
    matches!(
        text.trim().to_ascii_lowercase().as_str(),
        "<br>" | "<br/>" | "<br />" | "<br >"
    )
}

fn structure(markdown: &str) -> Vec<String> {
    fn flush(tokens: &mut Vec<String>, text: &mut String) {
        let value = text.trim_end_matches('\n');
        if !value.is_empty() {
            tokens.push(format!("Text({value:?})"));
        }
        text.clear();
    }
    let mut tokens = Vec::new();
    let mut text = String::new();
    for event in Parser::new_ext(markdown, parser_options()) {
        match event {
            Event::Start(Tag::Paragraph) => {}
            Event::End(TagEnd::Paragraph) | Event::SoftBreak | Event::HardBreak => text.push('\n'),
            Event::Text(value) => text.push_str(&value),
            other => {
                flush(&mut tokens, &mut text);
                tokens.push(format!("{other:?}"));
            }
        }
    }
    flush(&mut tokens, &mut text);
    tokens
}

enum Line {
    Content(String),
    Blank(String),
    BreakTag(String),
}

fn classify_lines(markdown: &str) -> Vec<Line> {
    let breaks: Vec<_> = Parser::new_ext(markdown, parser_options())
        .into_offset_iter()
        .filter_map(|(event, range)| match event {
            Event::Html(text) | Event::InlineHtml(text) if is_line_break_tag(&text) => {
                Some(range.start)
            }
            _ => None,
        })
        .collect();
    let mut start = 0;
    markdown
        .split('\n')
        .map(|line| {
            let line_start = start;
            start += line.len() + 1;
            if line.chars().all(|c| c == '>' || c.is_whitespace()) {
                return Line::Blank(line.to_string());
            }
            let Some(tag_start) = breaks
                .iter()
                .copied()
                .find(|&position| position >= line_start && position < line_start + line.len())
            else {
                return Line::Content(line.to_string());
            };
            let prefix = &line[..tag_start - line_start];
            if !is_line_break_tag(&line[prefix.len()..]) {
                return Line::Content(line.to_string());
            }
            if prefix.chars().all(|c| c == '>' || c.is_whitespace()) {
                Line::BreakTag(prefix.trim_end().to_string())
            } else {
                Line::Content(prefix.to_string())
            }
        })
        .collect()
}

struct Segment {
    lines: Vec<String>,
    removable: bool,
}

fn segments(lines: Vec<Line>) -> Vec<Segment> {
    let mut segments = Vec::new();
    let mut gap: Vec<Line> = Vec::new();
    let flush = |gap: &mut Vec<Line>, segments: &mut Vec<Segment>| {
        if gap.is_empty() {
            return;
        }
        let breaks: Vec<String> = gap
            .iter()
            .filter_map(|line| match line {
                Line::BreakTag(prefix) => Some(prefix.clone()),
                _ => None,
            })
            .collect();
        let removable = breaks.is_empty();
        let lines = if removable {
            gap.iter()
                .map(|line| match line {
                    Line::Blank(text) | Line::Content(text) | Line::BreakTag(text) => text.clone(),
                })
                .collect()
        } else {
            breaks
        };
        segments.push(Segment { lines, removable });
        gap.clear();
    };
    for line in lines {
        match line {
            Line::Content(text) => {
                flush(&mut gap, &mut segments);
                segments.push(Segment {
                    lines: vec![text],
                    removable: false,
                });
            }
            other => gap.push(other),
        }
    }
    flush(&mut gap, &mut segments);
    segments
}

fn render(segments: &[Segment], removed: &[bool]) -> String {
    segments
        .iter()
        .zip(removed)
        .filter(|(_, removed)| !**removed)
        .flat_map(|(segment, _)| segment.lines.iter().map(String::as_str))
        .collect::<Vec<_>>()
        .join("\n")
}

fn remove_escapes(mut markdown: String) -> String {
    let mut expected = structure(&markdown);
    let mut index = 0;
    while index + 1 < markdown.len() {
        let next = markdown.as_bytes()[index + 1];
        if markdown.as_bytes()[index] != b'\\' || !(next.is_ascii_punctuation() || next == b'\n') {
            index += 1;
            continue;
        }
        let mut candidate = markdown.clone();
        candidate.remove(index);
        let candidate_structure = structure(&candidate);
        if candidate_structure == expected {
            markdown = candidate;
            expected = candidate_structure;
            index += 1;
        } else {
            index += 2;
        }
    }
    markdown
}

pub fn convert(markdown: &str) -> String {
    let crlf = markdown.contains("\r\n");
    let source = markdown.replace("\r\n", "\n");
    let trailing_newline = source.ends_with('\n');
    let body = source.strip_suffix('\n').unwrap_or(&source);
    let segments = segments(classify_lines(body));
    let mut removed = vec![false; segments.len()];
    let expected = structure(&render(&segments, &removed));
    for index in 0..segments.len() {
        if !segments[index].removable {
            continue;
        }
        removed[index] = true;
        if structure(&render(&segments, &removed)) != expected {
            removed[index] = false;
        }
    }
    let mut result = remove_escapes(render(&segments, &removed));
    if trailing_newline {
        result.push('\n');
    }
    if crlf {
        result = result.replace('\n', "\r\n");
    }
    result
}

fn collect_notes(notes_directory: Option<&Path>) -> io::Result<BTreeMap<PathBuf, PathBuf>> {
    let mut notes = BTreeMap::new();
    if let Some(directory) = notes_directory.filter(|directory| directory.is_dir()) {
        for path in crate::data_export::generated_notes(directory)? {
            notes.insert(crate::document::path_key(&path), path);
        }
    }
    Ok(notes)
}

#[derive(Debug, Deserialize, PartialEq, Serialize)]
struct PlannedNote {
    path: PathBuf,
    converted: String,
}

fn digest(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

fn scan_notes(notes_directory: Option<&Path>) -> io::Result<Vec<PlannedNote>> {
    let mut planned = Vec::new();
    for path in collect_notes(notes_directory)?.into_values() {
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) => {
                error!(
                    "legacy_markdown_note_failed path={} error={error}",
                    path.display()
                );
                continue;
            }
        };
        let Ok(original) = String::from_utf8(bytes) else {
            continue;
        };
        let converted = convert(&original);
        if converted != original {
            planned.push(PlannedNote {
                path,
                converted: digest(&converted),
            });
        }
    }
    Ok(planned)
}

fn read_progress(path: &Path) -> io::Result<Vec<PlannedNote>> {
    serde_json::from_slice(&fs::read(path)?).map_err(io::Error::other)
}

fn conversion_of(note: &PlannedNote) -> io::Result<Option<String>> {
    let current = match fs::read(&note.path) {
        Ok(current) => current,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let Ok(current) = String::from_utf8(current) else {
        return Ok(None);
    };
    if digest(&current) == note.converted {
        return Ok(None);
    }
    let converted = convert(&current);
    Ok((digest(&converted) == note.converted).then_some(converted))
}

fn pending_count(data_directory: &Path, notes_directory: Option<&Path>) -> io::Result<usize> {
    let progress = data_directory.join(PROGRESS_FILE_NAME);
    if !progress.exists() {
        return Ok(scan_notes(notes_directory)?.len());
    }
    let mut count = 0;
    for note in read_progress(&progress)? {
        if conversion_of(&note)?.is_some() {
            count += 1;
        }
    }
    Ok(count)
}

struct Migration {
    converted: usize,
    failed: usize,
}

fn migrate_notes(data_directory: &Path, notes_directory: Option<&Path>) -> io::Result<Migration> {
    let progress = data_directory.join(PROGRESS_FILE_NAME);
    if !progress.exists() {
        let planned = scan_notes(notes_directory)?;
        crate::storage::replace_file(
            &progress,
            &serde_json::to_vec(&planned).map_err(io::Error::other)?,
        )?;
    }
    let mut count = 0;
    let mut failed = 0;
    for note in read_progress(&progress)? {
        let result = conversion_of(&note).and_then(|converted| match converted {
            Some(converted) => {
                crate::storage::replace_file(&note.path, converted.as_bytes())?;
                Ok(true)
            }
            None => Ok(false),
        });
        match result {
            Ok(true) => count += 1,
            Ok(false) => {}
            Err(error) => {
                failed += 1;
                error!(
                    "legacy_markdown_note_failed path={} error={error}",
                    note.path.display()
                );
            }
        }
    }
    Ok(Migration {
        converted: count,
        failed,
    })
}

fn finish(data_directory: &Path) -> io::Result<()> {
    match fs::remove_file(data_directory.join(PROGRESS_FILE_NAME)) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

#[derive(Default)]
pub struct LegacyNotes(Mutex<usize>);

impl LegacyNotes {
    fn set(&self, count: usize) {
        *self.0.lock().expect("Legacy notes lock poisoned") = count;
    }
}

struct Locations {
    data_directory: PathBuf,
    notes_directory: Option<PathBuf>,
}

fn locations(app: &tauri::AppHandle) -> io::Result<Locations> {
    Ok(Locations {
        data_directory: app.path().app_data_dir().map_err(io::Error::other)?,
        notes_directory: crate::resolve_managed_notes_directory(app),
    })
}

fn record_version(app: &tauri::AppHandle) -> io::Result<()> {
    let version = app.package_info().version.to_string();
    let mut patch = Map::new();
    patch.insert("lastRunVersion".into(), Value::String(version));
    let snapshot = app
        .state::<crate::settings::SettingsStore>()
        .update(patch)
        .map_err(io::Error::other)?;
    app.emit("settings-updated", &snapshot)
        .map_err(io::Error::other)
}

pub fn prepare(app: &tauri::AppHandle) -> io::Result<()> {
    let last_version = app
        .state::<crate::settings::SettingsStore>()
        .snapshot()
        .settings
        .get("lastRunVersion")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if last_version.is_empty() {
        let locations = locations(app)?;
        let count = pending_count(
            &locations.data_directory,
            locations.notes_directory.as_deref(),
        )?;
        info!("legacy_markdown_pending count={count}");
        if count > 0 {
            app.state::<LegacyNotes>().set(count);
            return Ok(());
        }
    }
    record_version(app)
}

#[tauri::command]
pub fn get_legacy_note_count(state: tauri::State<'_, LegacyNotes>) -> usize {
    *state.0.lock().expect("Legacy notes lock poisoned")
}

fn complete(app: &tauri::AppHandle, data_directory: &Path) -> io::Result<()> {
    record_version(app)?;
    finish(data_directory)?;
    app.state::<LegacyNotes>().set(0);
    Ok(())
}

#[tauri::command]
pub async fn convert_legacy_notes(app: tauri::AppHandle) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || -> io::Result<usize> {
        let locations = locations(&app)?;
        let migration = migrate_notes(
            &locations.data_directory,
            locations.notes_directory.as_deref(),
        )?;
        info!(
            "legacy_markdown_migrated converted={} failed={}",
            migration.converted, migration.failed
        );
        if migration.failed == 0 {
            complete(&app, &locations.data_directory)?;
        }
        Ok(migration.failed)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn finish_legacy_notes(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> io::Result<()> {
        let locations = locations(&app)?;
        complete(&app, &locations.data_directory)?;
        info!("legacy_markdown_finished");
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn milkdown_paragraph_spacing_becomes_line_breaks() {
        assert_eq!(
            convert("备注\n\n* Chrome\n\n* Apple\n\n* ssh key\n\n<br />\n\n备份\n\n* Heptabase\n"),
            "备注\n* Chrome\n* Apple\n* ssh key\n\n备份\n* Heptabase\n"
        );
        assert_eq!(convert("a\n\n<br />\n\n<br />\n\nb"), "a\n\n\nb");
        assert_eq!(convert("<br />\n\n<br />\n\n<br />\n"), "\n\n\n");
        assert_eq!(convert("* a\n\n* <br />\n\n* b\n"), "* a\n* \n* b\n");
        assert_eq!(convert("> a\n>\n> <br />\n>\n> b\n"), "> a\n>\n> b\n");
        assert_eq!(convert("a\r\n\r\n<br />\r\n\r\nb\r\n"), "a\r\n\r\nb\r\n");
    }

    #[test]
    fn separators_stay_where_removing_them_changes_the_structure() {
        assert_eq!(convert("* a\n\nafter\n"), "* a\n\nafter\n");
        assert_eq!(convert("> quote\n\nafter\n"), "> quote\n\nafter\n");
        assert_eq!(convert("text\n\n---\n"), "text\n\n---\n");
        assert_eq!(
            convert("```\ncode\n\nmore\n```\n\nafter\n"),
            "```\ncode\n\nmore\n```\nafter\n"
        );
        assert_eq!(convert("```\n<br />\n```\n"), "```\n<br />\n```\n");
    }

    #[test]
    fn escapes_and_hard_breaks_are_removed_only_when_harmless() {
        assert_eq!(convert("file\\_name\\_here\n"), "file_name_here\n");
        assert_eq!(convert("line\\\nnext\n"), "line\nnext\n");
        assert_eq!(convert("2\\*3\\*4\n"), "2*3\\*4\n");
        assert_eq!(convert("\\<br />\n"), "\\<br />\n");
        assert_eq!(convert("`a\\_b`\n"), "`a\\_b`\n");
    }

    fn note_directory() -> (tempfile::TempDir, PathBuf) {
        let directory = crate::storage::test_directory();
        let notes = directory.path().join("notes");
        fs::create_dir_all(&notes).unwrap();
        (directory, notes)
    }

    #[test]
    fn migration_converts_only_generated_legacy_notes() {
        let (directory, notes) = note_directory();
        let generated = notes.join("24b2e2f8-37d5-42f8-b5b7-1ad459afb450.md");
        let hex = notes.join("00000000000000001898f7d8237bba0c.md");
        let binary = notes.join("34b2e2f8-37d5-42f8-b5b7-1ad459afb450.md");
        let named = notes.join("todo.md");
        fs::write(&generated, "a\n\nb\n").unwrap();
        fs::write(&hex, "c\n\nd\n").unwrap();
        fs::write(&binary, [0xff, 0xfe, b'\n', b'\n', b'x']).unwrap();
        fs::write(&named, "a\n\nb\n").unwrap();
        assert_eq!(pending_count(directory.path(), Some(&notes)).unwrap(), 2);
        let migration = migrate_notes(directory.path(), Some(&notes)).unwrap();
        assert_eq!((migration.converted, migration.failed), (2, 0));
        assert_eq!(fs::read_to_string(&generated).unwrap(), "a\nb\n");
        assert_eq!(fs::read_to_string(&hex).unwrap(), "c\nd\n");
        assert_eq!(fs::read_to_string(&named).unwrap(), "a\n\nb\n");
        assert_eq!(fs::read(&binary).unwrap(), [0xff, 0xfe, b'\n', b'\n', b'x']);
        finish(directory.path()).unwrap();
        assert!(!directory.path().join(PROGRESS_FILE_NAME).exists());
    }

    #[test]
    fn interrupted_migration_never_converts_a_note_twice() {
        let (directory, notes) = note_directory();
        let done = notes.join("14b2e2f8-37d5-42f8-b5b7-1ad459afb450.md");
        let waiting = notes.join("24b2e2f8-37d5-42f8-b5b7-1ad459afb450.md");
        let edited = notes.join("34b2e2f8-37d5-42f8-b5b7-1ad459afb450.md");
        let later = notes.join("44b2e2f8-37d5-42f8-b5b7-1ad459afb450.md");
        let blank_lines = "a\n\n<br />\n\n<br />\n\nb\n";
        fs::write(&done, blank_lines).unwrap();
        fs::write(&waiting, "c\n\nd\n").unwrap();
        fs::write(&edited, "e\n\nf\n").unwrap();
        let progress = directory.path().join(PROGRESS_FILE_NAME);
        crate::storage::replace_file(
            &progress,
            &serde_json::to_vec(&scan_notes(Some(&notes)).unwrap()).unwrap(),
        )
        .unwrap();
        fs::write(&done, convert(blank_lines)).unwrap();
        fs::write(&edited, "e\n\nchanged\n").unwrap();
        fs::write(&later, "g\n\nh\n").unwrap();
        assert_eq!(pending_count(directory.path(), Some(&notes)).unwrap(), 1);
        let migration = migrate_notes(directory.path(), Some(&notes)).unwrap();
        assert_eq!((migration.converted, migration.failed), (1, 0));
        assert_eq!(fs::read_to_string(&done).unwrap(), "a\n\n\nb\n");
        assert_eq!(fs::read_to_string(&waiting).unwrap(), "c\nd\n");
        assert_eq!(fs::read_to_string(&edited).unwrap(), "e\n\nchanged\n");
        assert_eq!(fs::read_to_string(&later).unwrap(), "g\n\nh\n");
    }

    #[test]
    fn failed_notes_are_counted_and_converted_by_a_retry() {
        let (directory, notes) = note_directory();
        let broken = notes.join("24b2e2f8-37d5-42f8-b5b7-1ad459afb450.md");
        let healthy = notes.join("34b2e2f8-37d5-42f8-b5b7-1ad459afb450.md");
        fs::write(&broken, "a\n\nb\n").unwrap();
        fs::write(&healthy, "c\n\nd\n").unwrap();
        crate::storage::replace_file(
            &directory.path().join(PROGRESS_FILE_NAME),
            &serde_json::to_vec(&scan_notes(Some(&notes)).unwrap()).unwrap(),
        )
        .unwrap();
        fs::remove_file(&broken).unwrap();
        fs::create_dir(&broken).unwrap();
        let migration = migrate_notes(directory.path(), Some(&notes)).unwrap();
        assert_eq!((migration.converted, migration.failed), (1, 1));
        assert_eq!(fs::read_to_string(&healthy).unwrap(), "c\nd\n");
        fs::remove_dir(&broken).unwrap();
        fs::write(&broken, "a\n\nb\n").unwrap();
        let migration = migrate_notes(directory.path(), Some(&notes)).unwrap();
        assert_eq!((migration.converted, migration.failed), (1, 0));
        assert_eq!(fs::read_to_string(&broken).unwrap(), "a\nb\n");
    }
}
