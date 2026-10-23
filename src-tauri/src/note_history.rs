use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Instant,
};
use tauri::Manager;
use tempfile::NamedTempFile;
use uuid::Uuid;

const HISTORY_VERSION: u32 = 1;

pub struct NoteHistoryStore {
    path: PathBuf,
    mutex: Mutex<()>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteHistoryEntry {
    note_path: String,
    note_id: String,
    window_id: String,
    last_opened_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordNoteParams {
    note_path: String,
    note_id: String,
    window_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryFile {
    version: u32,
    updated_at: String,
    entries: HashMap<String, NoteHistoryEntry>,
    order: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDeleteFailure {
    note_path: String,
    reason: String,
}

#[derive(Debug, Default, Serialize)]
pub struct NoteDeleteResult {
    deleted: Vec<String>,
    failures: Vec<NoteDeleteFailure>,
}

fn timestamp_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

impl HistoryFile {
    fn empty() -> Self {
        Self {
            version: HISTORY_VERSION,
            updated_at: timestamp_now(),
            entries: HashMap::new(),
            order: Vec::new(),
        }
    }

    fn validate(&mut self) -> Result<(), String> {
        if self.version != HISTORY_VERSION {
            return Err(format!("Unsupported history version: {}", self.version));
        }
        for (key, entry) in &self.entries {
            if key.trim().is_empty()
                || entry.note_path.trim().is_empty()
                || entry.note_id.trim().is_empty()
                || entry.window_id.trim().is_empty()
                || entry.last_opened_at.trim().is_empty()
            {
                return Err(format!("Invalid history entry: {key:?}"));
            }
        }
        let mut seen = HashSet::new();
        self.order
            .retain(|key| self.entries.contains_key(key) && seen.insert(key.clone()));
        let mut remaining: Vec<_> = self
            .entries
            .keys()
            .filter(|key| !seen.contains(*key))
            .cloned()
            .collect();
        remaining.sort_by(|left, right| {
            self.entries[right]
                .last_opened_at
                .cmp(&self.entries[left].last_opened_at)
                .then_with(|| left.cmp(right))
        });
        self.order.extend(remaining);
        Ok(())
    }
}

impl NoteHistoryStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            mutex: Mutex::new(()),
        }
    }

    fn read(&self) -> Result<(HistoryFile, usize), String> {
        let content = match fs::read(&self.path) {
            Ok(content) => content,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok((HistoryFile::empty(), 0));
            }
            Err(error) => return Err(format!("Could not read history: {error}")),
        };
        let json = content.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&content);
        let mut history: HistoryFile = serde_json::from_slice(json).map_err(|error| {
            format!("Could not parse history ({} bytes): {error}", content.len())
        })?;
        history.validate()?;
        Ok((history, content.len()))
    }

    fn save(&self, history: &HistoryFile, operation_id: &str) -> Result<(), String> {
        let result = (|| {
            let parent = self.path.parent().ok_or("History path has no parent")?;
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create history directory: {error}"))?;
            let content = serde_json::to_vec_pretty(history)
                .map_err(|error| format!("Could not serialize history: {error}"))?;
            let mut file = NamedTempFile::new_in(parent)
                .map_err(|error| format!("Could not create history temporary file: {error}"))?;
            file.write_all(&content)
                .map_err(|error| format!("Could not write history: {error}"))?;
            file.as_file()
                .sync_all()
                .map_err(|error| format!("Could not synchronize history: {error}"))?;
            file.persist(&self.path)
                .map_err(|error| format!("Could not replace history: {}", error.error))?;
            log::info!(
                "history_saved operation_id={operation_id} entries={} bytes={}",
                history.entries.len(),
                content.len()
            );
            Ok(())
        })();
        if let Err(error) = &result {
            log::error!("history_save_failed operation_id={operation_id} error={error}");
        }
        result
    }

    fn access<T>(
        &self,
        operation: &str,
        window_label: &str,
        action: impl FnOnce(&mut HistoryFile, &str) -> Result<T, String>,
    ) -> Result<T, String> {
        let operation_id = Uuid::new_v4();
        let started = Instant::now();
        log::info!(
            "history_operation_started operation_id={operation_id} operation={operation} window={window_label:?}"
        );
        let result = (|| {
            let _guard = self
                .mutex
                .lock()
                .map_err(|_| String::from("Could not lock history"))?;
            let waited_ms = started.elapsed().as_millis();
            let (mut history, bytes) = self.read()?;
            log::info!(
                "history_read operation_id={operation_id} wait_ms={waited_ms} entries={} bytes={bytes}",
                history.entries.len()
            );
            action(&mut history, &operation_id.to_string())
        })();
        match &result {
            Ok(_) => log::info!(
                "history_operation_finished operation_id={operation_id} elapsed_ms={}",
                started.elapsed().as_millis()
            ),
            Err(error) => log::error!(
                "history_operation_failed operation_id={operation_id} operation={operation} window={window_label:?} elapsed_ms={} error={error}",
                started.elapsed().as_millis()
            ),
        }
        result
    }

    fn list(&self, window_label: &str) -> Result<Vec<NoteHistoryEntry>, String> {
        self.access("list", window_label, |history, _| {
            Ok(history
                .order
                .iter()
                .map(|key| history.entries[key].clone())
                .collect())
        })
    }

    fn record(&self, params: RecordNoteParams, window_label: &str) -> Result<(), String> {
        let note_path = params.note_path.trim().to_string();
        let note_id = params.note_id.trim().to_string();
        let window_id = params.window_id.trim().to_string();
        if note_path.is_empty() || note_id.is_empty() || window_id.is_empty() {
            return Err(String::from(
                "Note path, note ID, and window ID must not be empty.",
            ));
        }
        self.access("record", window_label, |history, operation_id| {
            let key = crate::hash_fnv1a_utf16(&note_path.to_lowercase());
            let now = timestamp_now();
            history.entries.insert(
                key.clone(),
                NoteHistoryEntry {
                    note_path,
                    note_id,
                    window_id,
                    last_opened_at: now.clone(),
                },
            );
            history.order.retain(|item| item != &key);
            history.order.insert(0, key);
            history.updated_at = now;
            self.save(history, operation_id)
        })
    }

    fn delete(
        &self,
        note_paths: Vec<String>,
        window_label: &str,
    ) -> Result<NoteDeleteResult, String> {
        self.remove(note_paths, true, window_label)
    }

    fn remove(
        &self,
        note_paths: Vec<String>,
        delete_files: bool,
        window_label: &str,
    ) -> Result<NoteDeleteResult, String> {
        let operation = if delete_files {
            "delete"
        } else {
            "remove_records"
        };
        self.access(operation, window_label, |history, operation_id| {
            let known_paths: HashSet<_> = history
                .entries
                .values()
                .map(|entry| entry.note_path.clone())
                .collect();
            let mut seen = HashSet::new();
            let mut result = NoteDeleteResult::default();
            for note_path in note_paths {
                if !seen.insert(note_path.clone()) {
                    continue;
                }
                let deletion = if !known_paths.contains(&note_path) {
                    Err(String::from("Note is no longer in history."))
                } else if delete_files {
                    delete_note_file(Path::new(&note_path)).map_err(|error| error.to_string())
                } else {
                    Ok(())
                };
                match deletion {
                    Ok(()) => result.deleted.push(note_path),
                    Err(reason) => {
                        log::error!(
                            "history_delete_failed operation_id={operation_id} note_path={note_path:?} reason={reason}"
                        );
                        result.failures.push(NoteDeleteFailure { note_path, reason });
                    }
                }
            }
            if !result.deleted.is_empty() {
                let deleted: HashSet<_> = result.deleted.iter().collect();
                history.entries.retain(|_, entry| !deleted.contains(&entry.note_path));
                history.order.retain(|key| history.entries.contains_key(key));
                history.updated_at = timestamp_now();
                if let Err(error) = self.save(history, operation_id) {
                    let reason = format!("Could not update history: {error}");
                    result.failures.extend(result.deleted.drain(..).map(|note_path| {
                        NoteDeleteFailure {
                            note_path,
                            reason: reason.clone(),
                        }
                    }));
                }
            }
            log::info!(
                "history_delete_finished operation_id={operation_id} delete_files={delete_files} deleted={} failed={}",
                result.deleted.len(),
                result.failures.len()
            );
            Ok(result)
        })
    }
}

fn delete_note_file(path: &Path) -> io::Result<()> {
    match fs::metadata(path) {
        Ok(metadata) if !metadata.is_file() => {
            return Err(io::Error::other("The path is not a file."));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    }
    match fs::remove_file(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

async fn run<T: Send + 'static>(
    app: tauri::AppHandle,
    action: impl FnOnce(&NoteHistoryStore) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || action(&app.state::<NoteHistoryStore>()))
        .await
        .map_err(|error| format!("History task failed: {error}"))?
}

#[tauri::command]
pub async fn list_note_history(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Vec<NoteHistoryEntry>, String> {
    let label = window.label().to_string();
    run(app, move |store| store.list(&label)).await
}

#[tauri::command]
pub async fn record_note_history(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    params: RecordNoteParams,
) -> Result<(), String> {
    let label = window.label().to_string();
    run(app, move |store| store.record(params, &label)).await
}

#[tauri::command]
pub async fn delete_history_notes(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    note_paths: Vec<String>,
) -> Result<NoteDeleteResult, String> {
    let label = window.label().to_string();
    run(app, move |store| store.delete(note_paths, &label)).await
}

#[tauri::command]
pub async fn remove_history_records(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    note_paths: Vec<String>,
) -> Result<NoteDeleteResult, String> {
    let label = window.label().to_string();
    run(app, move |store| store.remove(note_paths, false, &label)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{Arc, Barrier, mpsc},
        thread,
        time::Duration,
    };

    fn directory() -> tempfile::TempDir {
        let parent = std::env::var_os("PINOTE_TEST_DIRECTORY")
            .map(PathBuf::from)
            .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.windows-dev"));
        fs::create_dir_all(&parent).unwrap();
        tempfile::tempdir_in(parent).unwrap()
    }

    fn params(path: &Path) -> RecordNoteParams {
        RecordNoteParams {
            note_path: path.to_str().unwrap().to_string(),
            note_id: String::from("test-note"),
            window_id: String::from("note-test"),
        }
    }

    fn seed(store: &NoteHistoryStore, count: usize) {
        let mut history = HistoryFile::empty();
        for index in 0..count {
            let note_path = store.path.parent().unwrap().join(format!("{index}.md"));
            let note_path = note_path.to_str().unwrap().to_string();
            let key = crate::hash_fnv1a_utf16(&note_path.to_lowercase());
            history.entries.insert(
                key.clone(),
                NoteHistoryEntry {
                    note_path,
                    note_id: index.to_string(),
                    window_id: format!("note-{index}"),
                    last_opened_at: String::from("2026-01-01T00:00:00.000Z"),
                },
            );
            history.order.push(key);
        }
        store.save(&history, "seed").unwrap();
    }

    #[test]
    fn removes_records_without_changing_files_or_directories() {
        let dir = directory();
        let store = NoteHistoryStore::new(dir.path().join("history.json"));
        seed(&store, 4);
        let paths: Vec<_> = (0..4)
            .map(|index| dir.path().join(format!("{index}.md")))
            .collect();
        fs::write(&paths[0], "keep").unwrap();
        fs::create_dir(&paths[2]).unwrap();
        fs::write(&paths[3], "unselected").unwrap();
        let unknown = dir.path().join("unknown.md");
        fs::write(&unknown, "unknown").unwrap();
        let requested = [&paths[0], &paths[1], &paths[2], &paths[0], &unknown]
            .into_iter()
            .map(|path| path.to_str().unwrap().to_string())
            .collect();
        let result = store.remove(requested, false, "settings").unwrap();
        assert_eq!(result.deleted.len(), 3);
        assert_eq!(result.failures.len(), 1);
        assert_eq!(result.failures[0].note_path, unknown.to_str().unwrap());
        let entries = store.list("reader").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].note_path, paths[3].to_str().unwrap());
        assert_eq!(fs::read_to_string(&paths[0]).unwrap(), "keep");
        assert!(!paths[1].exists());
        assert!(paths[2].is_dir());
        assert_eq!(fs::read_to_string(&paths[3]).unwrap(), "unselected");
        assert_eq!(fs::read_to_string(&unknown).unwrap(), "unknown");
    }

    #[test]
    fn reads_legacy_json_and_updates_the_existing_utf16_key() {
        let dir = directory();
        let store = NoteHistoryStore::new(dir.path().join("history.json"));
        let content = r#"{
            "version": 1,
            "updatedAt": "2026-01-01T00:00:00.000Z",
            "entries": {
                "05744db1": {
                    "notePath": "C:\\Notes\\Emoji😀.md",
                    "noteId": "Emoji",
                    "windowId": "note-05744db1",
                    "lastOpenedAt": "2026-01-01T00:00:00.000Z"
                }
            },
            "order": ["05744db1"]
        }"#;
        fs::write(&store.path, content).unwrap();
        let entries = store.list("reader").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].note_path, r"C:\Notes\Emoji😀.md");
        let params = serde_json::from_str::<RecordNoteParams>(
            r#"{"notePath":"C:\\Notes\\Emoji😀.md","noteId":"Emoji","windowId":"note-05744db1"}"#,
        )
        .unwrap();
        store.record(params, "writer").unwrap();
        let saved: serde_json::Value =
            serde_json::from_slice(&fs::read(&store.path).unwrap()).unwrap();
        assert_eq!(saved["version"], 1);
        assert!(saved["updatedAt"].as_str().is_some());
        assert_eq!(saved["entries"].as_object().unwrap().len(), 1);
        assert_eq!(saved["order"], serde_json::json!(["05744db1"]));
    }

    #[test]
    fn reads_records_and_deletes_history_with_or_without_utf8_bom() {
        let dir = directory();
        let store = NoteHistoryStore::new(dir.path().join("history.json"));
        let note = dir.path().join("0.md");
        let new_note = dir.path().join("new.md");
        for prefix in [b"".as_slice(), b"\xef\xbb\xbf".as_slice()] {
            seed(&store, 1);
            fs::write(&note, "content").unwrap();
            let original = fs::read(&store.path).unwrap();
            let encoded = [prefix, original.as_slice()].concat();
            fs::write(&store.path, &encoded).unwrap();
            let entries = store.list("reader").unwrap();
            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0].note_path, note.to_str().unwrap());
            assert_eq!(store.read().unwrap().1, encoded.len());
            assert_eq!(fs::read(&store.path).unwrap(), encoded);

            store.record(params(&new_note), "writer").unwrap();
            let saved = fs::read(&store.path).unwrap();
            let history: HistoryFile = serde_json::from_slice(&saved).unwrap();
            assert_eq!(history.entries.len(), 2);
            assert!(!saved.starts_with(b"\xef\xbb\xbf"));
            assert_eq!(fs::read_to_string(&note).unwrap(), "content");

            fs::write(&store.path, [prefix, saved.as_slice()].concat()).unwrap();
            let result = store
                .delete(vec![note.to_str().unwrap().to_string()], "settings")
                .unwrap();
            assert_eq!(result.deleted, vec![note.to_str().unwrap()]);
            assert!(result.failures.is_empty());
            assert!(!note.exists());
            let entries = store.list("reader").unwrap();
            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0].note_path, new_note.to_str().unwrap());
        }
    }

    #[test]
    fn concurrent_operations_preserve_complete_history_and_valid_json() {
        let dir = directory();
        let store = Arc::new(NoteHistoryStore::new(dir.path().join("history.json")));
        seed(&store, 1001);
        let barrier = Arc::new(Barrier::new(17));
        thread::scope(|scope| {
            for index in 0..16 {
                let store = store.clone();
                let barrier = barrier.clone();
                scope.spawn(move || {
                    barrier.wait();
                    store
                        .record(
                            params(&store.path.with_file_name(format!("new-{index}.md"))),
                            "worker",
                        )
                        .unwrap();
                    assert!(store.list("reader").unwrap().len() >= 1002);
                });
            }
            barrier.wait();
            for _ in 0..100 {
                let content = fs::read(&store.path).unwrap();
                let history: HistoryFile = serde_json::from_slice(&content).unwrap();
                assert!(history.entries.len() >= 1001);
            }
        });
        let history = store.list("reader").unwrap();
        assert_eq!(history.len(), 1017);
        assert_eq!(
            history
                .iter()
                .map(|entry| &entry.note_path)
                .collect::<HashSet<_>>()
                .len(),
            1017
        );
    }

    #[test]
    fn readers_and_writers_wait_for_the_owner_beyond_one_second() {
        let dir = directory();
        let store = Arc::new(NoteHistoryStore::new(dir.path().join("history.json")));
        seed(&store, 1);
        let guard = store.mutex.lock().unwrap();
        let (started_tx, started_rx) = mpsc::channel();
        let (finished_tx, finished_rx) = mpsc::channel();
        thread::scope(|scope| {
            for writing in [false, true] {
                let store = store.clone();
                let started_tx = started_tx.clone();
                let finished_tx = finished_tx.clone();
                scope.spawn(move || {
                    started_tx.send(()).unwrap();
                    if writing {
                        store
                            .record(params(&store.path.with_file_name("new.md")), "writer")
                            .unwrap();
                    } else {
                        assert!(!store.list("reader").unwrap().is_empty());
                    }
                    finished_tx.send(()).unwrap();
                });
            }
            started_rx.recv().unwrap();
            started_rx.recv().unwrap();
            let blocked = finished_rx.recv_timeout(Duration::from_millis(1100));
            drop(guard);
            assert_eq!(blocked, Err(mpsc::RecvTimeoutError::Timeout));
        });
        assert_eq!(store.list("reader").unwrap().len(), 2);
    }

    #[test]
    fn invalid_history_is_preserved_and_prevents_file_deletion() {
        let dir = directory();
        let store = NoteHistoryStore::new(dir.path().join("history.json"));
        let note = dir.path().join("note.md");
        fs::write(&note, "content").unwrap();
        for content in [
            "",
            "{",
            "null",
            r#"{"version":2,"updatedAt":"now","entries":{},"order":[]}"#,
            r#"{"version":1,"updatedAt":"now","entries":{"key":{"notePath":"","noteId":"id","windowId":"window","lastOpenedAt":"now"}},"order":["key"]}"#,
            r#"{"version":1,"updatedAt":"now","order":[]}"#,
            "\u{feff}\u{feff}{\"version\":1,\"updatedAt\":\"now\",\"entries\":{},\"order\":[]}",
            " \u{feff}{\"version\":1,\"updatedAt\":\"now\",\"entries\":{},\"order\":[]}",
        ] {
            for prefix in ["", "\u{feff}"] {
                let content = format!("{prefix}{content}");
                fs::write(&store.path, &content).unwrap();
                assert!(store.list("reader").is_err());
                assert!(store.record(params(&note), "writer").is_err());
                assert!(
                    store
                        .delete(vec![note.to_str().unwrap().to_string()], "settings")
                        .is_err()
                );
                assert_eq!(fs::read_to_string(&store.path).unwrap(), content);
                assert_eq!(fs::read_to_string(&note).unwrap(), "content");
            }
        }
    }

    #[test]
    fn deletion_deduplicates_paths_and_preserves_failed_and_unselected_entries() {
        let dir = directory();
        let store = NoteHistoryStore::new(dir.path().join("history.json"));
        seed(&store, 4);
        let paths: Vec<_> = (0..4)
            .map(|index| dir.path().join(format!("{index}.md")))
            .collect();
        fs::write(&paths[0], "delete").unwrap();
        fs::create_dir(&paths[2]).unwrap();
        fs::write(&paths[3], "keep").unwrap();
        let unknown = dir.path().join("unknown.md");
        fs::write(&unknown, "unknown").unwrap();
        let requested = [&paths[0], &paths[1], &paths[2], &paths[0], &unknown]
            .into_iter()
            .map(|path| path.to_str().unwrap().to_string())
            .collect();
        let result = store.delete(requested, "settings").unwrap();
        assert_eq!(
            result.deleted,
            vec![paths[0].to_str().unwrap(), paths[1].to_str().unwrap()]
        );
        assert_eq!(result.failures.len(), 2);
        assert_eq!(store.list("reader").unwrap().len(), 2);
        assert!(!paths[0].exists());
        assert!(paths[2].is_dir());
        assert_eq!(fs::read_to_string(&paths[3]).unwrap(), "keep");
        assert_eq!(fs::read_to_string(&unknown).unwrap(), "unknown");
    }

    #[cfg(unix)]
    #[test]
    #[ignore = "Run with an unprivileged account and PINOTE_TEST_DIRECTORY"]
    fn inaccessible_files_and_failed_writes_preserve_history() {
        use std::os::unix::fs::PermissionsExt;
        let dir = directory();
        let store = NoteHistoryStore::new(dir.path().join("history.json"));
        let protected = dir.path().join("protected");
        fs::create_dir(&protected).unwrap();
        let note = protected.join("note.md");
        fs::write(&note, "content").unwrap();
        store.record(params(&note), "writer").unwrap();
        let original = fs::read(&store.path).unwrap();
        fs::set_permissions(&protected, fs::Permissions::from_mode(0o000)).unwrap();
        let deletion = store.delete(vec![note.to_str().unwrap().to_string()], "settings");
        fs::set_permissions(&protected, fs::Permissions::from_mode(0o700)).unwrap();
        let deletion = deletion.unwrap();
        assert!(deletion.deleted.is_empty());
        assert_eq!(deletion.failures.len(), 1);
        assert_eq!(fs::read(&store.path).unwrap(), original);
        assert_eq!(fs::read_to_string(&note).unwrap(), "content");
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o500)).unwrap();
        let write = store.record(params(&dir.path().join("new.md")), "writer");
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
        assert!(write.is_err());
        assert_eq!(fs::read(&store.path).unwrap(), original);
    }

    #[cfg(windows)]
    #[test]
    fn replacement_failure_preserves_history_and_allows_deletion_retry() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = directory();
        let store = NoteHistoryStore::new(dir.path().join("history.json"));
        let note = dir.path().join("note.md");
        fs::write(&note, "content").unwrap();
        store.record(params(&note), "writer").unwrap();
        let original = fs::read(&store.path).unwrap();
        let reader = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&store.path)
            .unwrap();
        let error = store
            .record(params(&dir.path().join("new.md")), "writer")
            .unwrap_err();
        assert!(error.contains("Could not replace history:"));
        assert_eq!(fs::read(&store.path).unwrap(), original);
        let result = store
            .remove(vec![note.to_str().unwrap().to_string()], false, "settings")
            .unwrap();
        assert!(result.deleted.is_empty());
        assert_eq!(result.failures.len(), 1);
        assert_eq!(fs::read_to_string(&note).unwrap(), "content");
        assert_eq!(fs::read(&store.path).unwrap(), original);
        let result = store
            .delete(vec![note.to_str().unwrap().to_string()], "settings")
            .unwrap();
        assert!(result.deleted.is_empty());
        assert_eq!(result.failures.len(), 1);
        assert!(!note.exists());
        assert_eq!(fs::read(&store.path).unwrap(), original);
        drop(reader);
        let result = store
            .delete(vec![note.to_str().unwrap().to_string()], "settings")
            .unwrap();
        assert_eq!(result.deleted.len(), 1);
        assert!(store.list("reader").unwrap().is_empty());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
