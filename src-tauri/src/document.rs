use crate::{
    OpenNoteWindowOptions,
    note_history::{NoteDeleteFailure, NoteDeleteResult, NoteHistoryStore, RecordNoteParams},
    window_state,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs, io,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, Weak},
};
use tauri::{
    Emitter, Manager,
    async_runtime::{Mutex as AsyncMutex, spawn_blocking},
};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSnapshot {
    pub content: String,
    pub version: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DocumentError {
    Ended,
    Missing,
    Conflict { snapshot: FileSnapshot },
    Io { message: String },
}

impl std::fmt::Display for DocumentError {
    fn fmt(&self, output: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Ended => output.write_str("The editing session has ended."),
            Self::Missing => output.write_str("The note file no longer exists."),
            Self::Conflict { .. } => output.write_str("The note was changed outside Pinote."),
            Self::Io { message } => output.write_str(message),
        }
    }
}

impl From<String> for DocumentError {
    fn from(message: String) -> Self {
        Self::Io { message }
    }
}

impl From<std::io::Error> for DocumentError {
    fn from(error: std::io::Error) -> Self {
        if error.kind() == std::io::ErrorKind::NotFound {
            Self::Missing
        } else {
            Self::Io {
                message: error.to_string(),
            }
        }
    }
}

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum EndKind {
    Close,
    Delete,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndResult {
    pub ended: bool,
    pub version: Option<String>,
    pub error: Option<DocumentError>,
    #[serde(skip)]
    pub window_labels: Vec<String>,
}

pub(crate) fn path_key(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from(
            crate::normalize_windows_cli_note_path(path.to_path_buf())
                .to_string_lossy()
                .to_lowercase()
                .replace('/', "\\"),
        )
    }
    #[cfg(not(windows))]
    {
        path.to_path_buf()
    }
}

pub(crate) fn storage_key(path: &str) -> String {
    path_key(Path::new(path.trim()))
        .to_string_lossy()
        .into_owned()
}

fn entry_path(path: &Path) -> io::Result<PathBuf> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("The path has no parent."))?;
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::other("The path has no file name."))?;
    Ok(soft_canonicalize::soft_canonicalize(parent)?.join(name))
}

fn matches_path(path: &str, target: &Path, follow_link: bool) -> bool {
    let path = Path::new(path);
    let resolved = if follow_link {
        soft_canonicalize::soft_canonicalize(path)
    } else {
        entry_path(path)
    };
    resolved.is_ok_and(|resolved| path_key(&resolved) == path_key(target))
}

fn delete_file(path: &Path) -> io::Result<()> {
    match fs::metadata(path) {
        Ok(metadata) if !metadata.is_file() => {
            return Err(io::Error::other("The path is not a file."));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    match fs::remove_file(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

fn version(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
}

struct Session {
    label: String,
    ready: bool,
}

pub struct Document {
    path: PathBuf,
    session: Option<Session>,
}

impl Document {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            session: None,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn session(&self) -> Option<&str> {
        self.session.as_ref().map(|session| session.label.as_str())
    }

    pub fn attach(&mut self, session: String) -> Result<(), DocumentError> {
        if self.session.is_some() {
            return Err(DocumentError::Io {
                message: "The document already has an active session.".into(),
            });
        }
        self.session = Some(Session {
            label: session,
            ready: false,
        });
        Ok(())
    }

    pub fn check(&self, session: &str) -> Result<(), DocumentError> {
        if self.session() == Some(session) {
            Ok(())
        } else {
            Err(DocumentError::Ended)
        }
    }

    pub fn finish(&mut self, session: &str) -> Result<(), DocumentError> {
        self.check(session)?;
        self.session = None;
        Ok(())
    }

    pub fn read(&self) -> Result<FileSnapshot, DocumentError> {
        if !fs::metadata(&self.path)?.is_file() {
            return Err(DocumentError::from(String::from("The path is not a file.")));
        }
        let content = fs::read_to_string(&self.path)?;
        Ok(FileSnapshot {
            version: version(&content),
            content,
        })
    }

    pub fn load(&mut self, session: &str) -> Result<FileSnapshot, DocumentError> {
        self.check(session)?;
        let snapshot = self.read()?;
        self.session
            .as_mut()
            .expect("Validated session changed")
            .ready = true;
        Ok(snapshot)
    }

    pub fn save(
        &self,
        session: &str,
        content: &str,
        expected: &str,
    ) -> Result<String, DocumentError> {
        self.check(session)?;
        let snapshot = self.read()?;
        if snapshot.content == content {
            return Ok(snapshot.version);
        }
        if snapshot.version != expected {
            return Err(DocumentError::Conflict { snapshot });
        }
        fs::OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&self.path)?
            .write_all(content.as_bytes())?;
        Ok(version(content))
    }

    pub fn delete(&mut self) -> Result<(), DocumentError> {
        delete_file(&self.path)?;
        self.session = None;
        Ok(())
    }

    fn end(
        &mut self,
        session: Option<&str>,
        kind: EndKind,
        save: Option<FileSnapshot>,
        requested_path: &Path,
        history: &NoteHistoryStore,
        cache: &window_state::WindowStateStore,
    ) -> EndResult {
        let mut result = EndResult {
            window_labels: session
                .map(str::to_string)
                .or_else(|| self.session().map(str::to_string))
                .into_iter()
                .collect(),
            ..Default::default()
        };
        if let Some(session) = session
            && let Err(error) = self.check(session)
        {
            result.ended = true;
            result.error = Some(error);
            return result;
        }
        if kind == EndKind::Close {
            let session = session.expect("Closing requires an editing session");
            if let Some(save) = save {
                match self.save(session, &save.content, &save.version) {
                    Ok(version) => result.version = Some(version),
                    Err(error) => {
                        result.error = Some(error);
                        return result;
                    }
                }
            }
            if let Err(error) = cache.remove_windows(&[session.to_string()]) {
                result.error = Some(error.into());
                return result;
            }
            self.finish(session).expect("Validated session changed");
            result.ended = true;
            return result;
        }

        let target = match entry_path(requested_path) {
            Ok(path) => path,
            Err(error) => {
                result.error = Some(error.into());
                return result;
            }
        };
        let ends_session = path_key(&target) == path_key(&self.path);
        let history_paths = history.list(session.unwrap_or("settings")).map(|entries| {
            entries
                .into_iter()
                .filter(|entry| {
                    matches_path(&entry.note_path, &target, false)
                        || (ends_session && matches_path(&entry.note_path, &target, true))
                })
                .map(|entry| entry.note_path)
                .collect::<Vec<_>>()
        });
        let window_ids = cache.read().map(|cache| {
            cache
                .windows
                .into_values()
                .filter(|state| {
                    matches_path(&state.note_path, &target, false)
                        || (ends_session && matches_path(&state.note_path, &target, true))
                })
                .map(|state| state.window_id)
                .collect::<Vec<_>>()
        });
        let deletion = if ends_session {
            self.delete()
        } else {
            delete_file(&target).map_err(DocumentError::from)
        };
        if let Err(error) = deletion {
            result.error = Some(error);
            return result;
        }
        result.ended = ends_session;
        if !ends_session {
            result.window_labels.clear();
        }
        let failures: Vec<_> = [
            history_paths.and_then(|paths| history.forget(&paths, session.unwrap_or("settings"))),
            window_ids.and_then(|labels| cache.remove_windows(&labels)),
        ]
        .into_iter()
        .filter_map(Result::err)
        .collect();
        if !failures.is_empty() {
            result.error = Some(DocumentError::from(failures.join("\n")));
        }
        result
    }
}

type SharedDocument = Arc<AsyncMutex<Document>>;

fn collect_ended_windows(
    result: &mut EndResult,
    bindings: &Mutex<HashMap<String, SharedDocument>>,
    document: &SharedDocument,
) {
    if result.ended && !matches!(result.error, Some(DocumentError::Ended)) {
        result.window_labels = bindings
            .lock()
            .expect("Window registry poisoned")
            .iter()
            .filter(|(_, bound)| Arc::ptr_eq(bound, document))
            .map(|(label, _)| label.clone())
            .collect();
    }
}

pub struct DocumentService {
    pub lifecycle: crate::lifecycle::ApplicationLifecycle,
    pub history: Arc<NoteHistoryStore>,
    pub cache: Arc<window_state::WindowStateStore>,
    documents: Mutex<HashMap<PathBuf, Weak<AsyncMutex<Document>>>>,
    windows: Arc<Mutex<HashMap<String, SharedDocument>>>,
}

impl DocumentService {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            lifecycle: Default::default(),
            history: Arc::new(NoteHistoryStore::new(directory.join("history.json"))),
            cache: Arc::new(window_state::WindowStateStore::new(
                directory.join("windows.json"),
            )),
            documents: Mutex::new(HashMap::new()),
            windows: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn for_path(&self, path: String) -> Result<SharedDocument, DocumentError> {
        let path = spawn_blocking(move || soft_canonicalize::soft_canonicalize(path))
            .await
            .expect("Path resolution task panicked")?;
        let mut documents = self.documents.lock().expect("Document registry poisoned");
        documents.retain(|_, document| document.strong_count() > 0);
        let key = path_key(&path);
        if let Some(document) = documents.get(&key).and_then(Weak::upgrade) {
            return Ok(document);
        }
        let document = Arc::new(AsyncMutex::new(Document::new(path.clone())));
        documents.insert(key, Arc::downgrade(&document));
        Ok(document)
    }

    pub async fn open(
        &self,
        app: tauri::AppHandle,
        mut options: OpenNoteWindowOptions,
        create: bool,
    ) -> Result<window_state::CachedWindowState, DocumentError> {
        self.lifecycle.ensure_running()?;
        let _permit = self.lifecycle.operations.read().await;
        self.lifecycle.ensure_running()?;
        let source = options
            .note_path
            .clone()
            .ok_or_else(|| DocumentError::from(String::from("Note path is required.")))?;
        let document = self.for_path(source.clone()).await?;
        let binding = document.clone();
        Self::run(document, move |document| {
            let path = crate::normalize_windows_cli_note_path(document.path().to_path_buf())
                .to_string_lossy()
                .into_owned();
            let service = app.state::<DocumentService>();
            if let Some(label) = document.session().map(str::to_string)
                && app.get_webview_window(&label).is_none()
            {
                document.finish(&label)?;
                service.unbind(&label);
            }
            let fresh = document.session().is_none();
            let label = document
                .session()
                .map(str::to_string)
                .unwrap_or_else(|| format!("note-{}", Uuid::new_v4()));
            let mut previous = window_state::get_window_state_by_note_path(&app, &source)
                .map_err(DocumentError::from)?;
            if previous.is_none() && source != path {
                previous = window_state::get_window_state_by_note_path(&app, &path)
                    .map_err(DocumentError::from)?;
            }
            let cached = if fresh {
                previous.clone()
            } else {
                window_state::get_window_state(&app, &label).map_err(DocumentError::from)?
            };
            if let Some(cached) = cached {
                options.read_only = options.read_only.or(Some(cached.read_only));
                options.opacity = options.opacity.or(Some(cached.opacity));
                options.scroll_top = options.scroll_top.or(Some(cached.scroll_top));
            }
            if fresh {
                if create {
                    fs::create_dir_all(document.path().parent().ok_or_else(|| {
                        DocumentError::from(String::from("Note path has no parent."))
                    })?)?;
                    match fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(document.path())
                    {
                        Ok(_) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                        Err(error) => return Err(error.into()),
                    }
                }
                document.read()?;
                document.attach(label.clone())?;
                service.bind(label.clone(), binding);
            }
            options.window_id = Some(label.clone());
            options.note_path = Some(path.clone());
            let focus = options.focus.unwrap_or(true);
            let mut result = (|| {
                let state = crate::window::build_note_window(
                    app.clone(),
                    crate::extract_note_id_from_path(&path),
                    Some(options),
                )
                .map_err(DocumentError::from)?;
                window_state::register_window(&app, previous.as_ref(), state.clone())
                    .map_err(DocumentError::from)?;
                service
                    .history
                    .record(
                        RecordNoteParams {
                            note_path: state.note_path.clone(),
                            note_id: state.note_id.clone(),
                            window_id: state.window_id.clone(),
                        },
                        &label,
                    )
                    .map_err(DocumentError::from)?;
                Ok(state)
            })();
            if fresh {
                result = result.and_then(|state| {
                    let window = app.get_webview_window(&label).ok_or(DocumentError::Ended)?;
                    bind_window_events(&app, &window);
                    if state.visibility == window_state::WindowVisibility::Visible {
                        window
                            .show()
                            .map_err(|error| DocumentError::from(error.to_string()))?;
                        if focus {
                            window
                                .set_focus()
                                .map_err(|error| DocumentError::from(error.to_string()))?;
                        }
                    }
                    Ok(state)
                });
                if result.is_err() {
                    document.finish(&label)?;
                    service.unbind(&label);
                    if let Some(window) = app.get_webview_window(&label)
                        && let Err(error) = window.destroy()
                    {
                        log::error!("document_open_cleanup_failed window={label:?} error={error}");
                    }
                }
            }
            result
        })
        .await
    }

    async fn request_close<R: tauri::Runtime>(
        &self,
        app: tauri::AppHandle<R>,
        label: String,
    ) -> Result<(), DocumentError> {
        if self.lifecycle.ensure_running().is_err() {
            return Ok(());
        }
        let _permit = self.lifecycle.operations.read().await;
        if self.lifecycle.ensure_running().is_err() {
            return Ok(());
        }
        let document = self.for_window(&label)?;
        let history = self.history.clone();
        let cache = self.cache.clone();
        let handle = app.clone();
        let result = Self::run(document, move |document| {
            if document
                .session
                .as_ref()
                .is_some_and(|session| session.label == label && session.ready)
            {
                let window = handle
                    .get_webview_window(&label)
                    .ok_or(DocumentError::Ended)?;
                window
                    .emit_to(window.label(), "note-close-requested", ())
                    .map_err(|error| DocumentError::from(error.to_string()))?;
                Ok(None)
            } else {
                let path = document.path.clone();
                Ok(Some(document.end(
                    Some(&label),
                    EndKind::Close,
                    None,
                    &path,
                    &history,
                    &cache,
                )))
            }
        })
        .await?;
        if let Some(mut result) = result {
            finish_window(&app, &mut result);
            if let Some(error) = result.error
                && !matches!(error, DocumentError::Ended)
            {
                return Err(error);
            }
        }
        Ok(())
    }

    pub async fn end_session(
        &self,
        label: String,
        kind: EndKind,
        save: Option<FileSnapshot>,
    ) -> Result<EndResult, DocumentError> {
        if let Err(error) = self.lifecycle.ensure_running() {
            return Ok(EndResult {
                error: Some(error.into()),
                ..Default::default()
            });
        }
        let _permit = self.lifecycle.operations.read().await;
        if let Err(error) = self.lifecycle.ensure_running() {
            return Ok(EndResult {
                error: Some(error.into()),
                ..Default::default()
            });
        }
        let document = match self.for_window(&label) {
            Ok(document) => document,
            Err(DocumentError::Ended) => {
                return Ok(EndResult {
                    ended: true,
                    window_labels: vec![label],
                    ..Default::default()
                });
            }
            Err(error) => return Err(error),
        };
        let history = self.history.clone();
        let cache = self.cache.clone();
        let bindings = self.windows.clone();
        let reference = document.clone();
        Self::run(document, move |document| {
            let path = document.path.clone();
            let mut result = document.end(Some(&label), kind, save, &path, &history, &cache);
            if kind == EndKind::Delete {
                collect_ended_windows(&mut result, &bindings, &reference);
            }
            Ok(result)
        })
        .await
    }

    pub async fn delete_history(
        &self,
        paths: Vec<String>,
        label: String,
        mut finish: impl FnMut(&mut EndResult),
    ) -> Result<NoteDeleteResult, String> {
        self.lifecycle.ensure_running()?;
        let _permit = self.lifecycle.operations.read().await;
        self.lifecycle.ensure_running()?;
        let history = self.history.clone();
        let known: HashSet<String> = spawn_blocking(move || history.list(&label))
            .await
            .expect("History read task panicked")?
            .into_iter()
            .map(|entry| entry.note_path)
            .collect();
        let mut result = NoteDeleteResult::default();
        let mut seen = HashSet::new();
        for path in paths.into_iter().filter(|path| seen.insert(path.clone())) {
            if !known.contains(&path) {
                result.failures.push(NoteDeleteFailure {
                    note_path: path,
                    reason: String::from("Note is no longer in history."),
                });
                continue;
            }
            let operation = async {
                let document = self.for_path(path.clone()).await?;
                let history = self.history.clone();
                let cache = self.cache.clone();
                let requested = PathBuf::from(&path);
                let bindings = self.windows.clone();
                let reference = document.clone();
                Self::run(document, move |document| {
                    let mut result =
                        document.end(None, EndKind::Delete, None, &requested, &history, &cache);
                    collect_ended_windows(&mut result, &bindings, &reference);
                    Ok(result)
                })
                .await
            }
            .await;
            let error = match operation {
                Ok(mut outcome) => {
                    finish(&mut outcome);
                    outcome.error
                }
                Err(error) => Some(error),
            };
            if let Some(error) = error {
                result.failures.push(NoteDeleteFailure {
                    note_path: path,
                    reason: error.to_string(),
                });
            } else {
                result.deleted.push(path);
            }
        }
        Ok(result)
    }

    fn active_documents(&self) -> Vec<SharedDocument> {
        self.documents
            .lock()
            .expect("Document registry poisoned")
            .values()
            .filter_map(Weak::upgrade)
            .collect()
    }

    pub async fn ready_sessions(&self) -> Result<Vec<String>, DocumentError> {
        let mut labels = Vec::new();
        for document in self.active_documents() {
            if let Some(label) = Self::run(document, |document| {
                Ok(document
                    .session
                    .as_ref()
                    .filter(|session| session.ready)
                    .map(|session| session.label.clone()))
            })
            .await?
            {
                labels.push(label);
            }
        }
        Ok(labels)
    }

    pub async fn finish_exit(&self) -> Result<(), DocumentError> {
        for document in self.active_documents() {
            Self::run(document, |document| {
                document.session = None;
                Ok(())
            })
            .await?;
        }
        Ok(())
    }

    pub fn for_window(&self, label: &str) -> Result<SharedDocument, DocumentError> {
        self.windows
            .lock()
            .expect("Window registry poisoned")
            .get(label)
            .cloned()
            .ok_or(DocumentError::Ended)
    }

    pub fn bind(&self, label: String, document: SharedDocument) {
        let previous = self
            .windows
            .lock()
            .expect("Window registry poisoned")
            .insert(label, document);
        assert!(previous.is_none(), "Window already bound to a document");
    }

    pub fn unbind(&self, label: &str) -> Option<SharedDocument> {
        self.windows
            .lock()
            .expect("Window registry poisoned")
            .remove(label)
    }

    pub async fn run<T: Send + 'static>(
        document: SharedDocument,
        operation: impl FnOnce(&mut Document) -> Result<T, DocumentError> + Send + 'static,
    ) -> Result<T, DocumentError> {
        let mut document = document.lock_owned().await;
        spawn_blocking(move || operation(&mut document))
            .await
            .expect("Document operation panicked")
    }
}

fn bind_window_events(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let app = app.clone();
    let label = window.label().to_string();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let app = app.clone();
            let label = label.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = app
                    .state::<DocumentService>()
                    .request_close(app.clone(), label)
                    .await
                {
                    log::error!("document_close_request_failed error={error}");
                    crate::lifecycle::show_error(&app, error.to_string());
                }
            });
        }
        tauri::WindowEvent::Destroyed => {
            if let Err(error) = crate::window::destroy_note_context_menu(&app, &label) {
                log::error!("context_menu_destroy_failed window={label:?} error={error}");
            }
            app.state::<DocumentService>()
                .lifecycle
                .acknowledge(&label, None, true);
            if let Some(document) = app.state::<DocumentService>().unbind(&label) {
                let label = label.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = DocumentService::run(document, move |document| {
                        if document.session() == Some(label.as_str()) {
                            document.finish(&label)?;
                        }
                        Ok(())
                    })
                    .await
                    {
                        log::error!("document_release_failed error={error}");
                    }
                });
            }
        }
        _ => {}
    });
}

pub fn finish_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>, result: &mut EndResult) {
    if !result.ended {
        return;
    }
    let close = matches!(result.error, None | Some(DocumentError::Ended));
    for label in &result.window_labels {
        let Some(window) = app.get_webview_window(label) else {
            continue;
        };
        if let Err(error) = window.emit_to(window.label(), "note-session-ended", &result.error) {
            log::warn!("document_end_notification_failed window={label:?} error={error}");
        }
        if close && let Err(error) = window.destroy() {
            result.error = Some(DocumentError::from(error.to_string()));
            if let Err(error) = window.emit_to(window.label(), "note-session-ended", &result.error)
            {
                log::warn!("document_end_notification_failed window={label:?} error={error}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        future::Future,
        task::{Context, Waker},
    };

    #[test]
    fn closing_a_window_does_not_notify_other_visible_or_hidden_windows() {
        use tauri::Listener;
        let directory = crate::storage::test_directory();
        let app = tauri::test::mock_app();
        let received = Arc::new(Mutex::new(Vec::new()));
        for label in ["active", "other", "hidden"] {
            let window = tauri::WebviewWindowBuilder::new(&app, label, Default::default())
                .visible(label != "hidden")
                .build()
                .unwrap();
            for event in ["note-close-requested", "note-session-ended"] {
                let received = received.clone();
                window.listen(event, move |_| {
                    received.lock().unwrap().push((label, event));
                });
            }
        }
        tauri::async_runtime::block_on(async {
            let path = directory.path().join("note.md");
            fs::write(&path, "saved").unwrap();
            let service = DocumentService::new(directory.path().to_path_buf());
            let document = service
                .for_path(path.to_string_lossy().into_owned())
                .await
                .unwrap();
            DocumentService::run(document.clone(), |document| {
                document.attach("active".into())?;
                document.load("active")
            })
            .await
            .unwrap();
            service
                .windows
                .lock()
                .unwrap()
                .insert("active".into(), document);
            service
                .request_close(app.handle().clone(), "active".into())
                .await
                .unwrap();
            assert_eq!(
                *received.lock().unwrap(),
                [("active", "note-close-requested")]
            );
            let mut result = service
                .end_session("active".into(), EndKind::Close, None)
                .await
                .unwrap();
            assert!(result.ended);
            finish_window(app.handle(), &mut result);
            assert_eq!(
                *received.lock().unwrap(),
                [
                    ("active", "note-close-requested"),
                    ("active", "note-session-ended"),
                ]
            );
        });
    }

    #[cfg(unix)]
    #[test]
    fn removing_a_link_after_resolution_does_not_delete_its_target() {
        let directory = crate::storage::test_directory();
        let target = directory.path().join("target.md");
        let alias = directory.path().join("alias.md");
        fs::write(&target, "keep target").unwrap();
        std::os::unix::fs::symlink(&target, &alias).unwrap();
        tauri::async_runtime::block_on(async {
            let service = DocumentService::new(directory.path().to_path_buf());
            let document = service
                .for_path(alias.to_string_lossy().into_owned())
                .await
                .unwrap();
            DocumentService::run(document.clone(), |document| {
                document.attach("active".into())
            })
            .await
            .unwrap();
            for path in [&target, &alias] {
                service
                    .history
                    .record(
                        RecordNoteParams {
                            note_path: path.to_string_lossy().into_owned(),
                            note_id: "note".into(),
                            window_id: "active".into(),
                        },
                        "active",
                    )
                    .unwrap();
            }
            fs::remove_file(&alias).unwrap();
            let history = service.history.clone();
            let cache = service.cache.clone();
            let result = DocumentService::run(document.clone(), move |document| {
                Ok(document.end(None, EndKind::Delete, None, &alias, &history, &cache))
            })
            .await
            .unwrap();
            assert_eq!(fs::read_to_string(&target).unwrap(), "keep target");
            assert!(!result.ended);
            assert!(result.error.is_none());
            DocumentService::run(document, |document| document.check("active"))
                .await
                .unwrap();
            let entries = service.history.list("settings").unwrap();
            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0].note_path, target.to_string_lossy());
        });
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn distinct_paths_do_not_share_a_short_hash_identity() {
        assert_ne!(
            storage_key("/notes/abcdefghijKlMNopQRsT.md"),
            storage_key("/notes/abcdEFgHijKLMNOpqrst.md")
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn case_distinct_paths_keep_independent_history_and_recovery() {
        let directory = crate::storage::test_directory();
        let service = DocumentService::new(directory.path().to_path_buf());
        let upper = directory.path().join("A.md");
        let lower = directory.path().join("a.md");
        for (path, label) in [(&upper, "upper"), (&lower, "lower")] {
            fs::write(path, label).unwrap();
            service
                .history
                .record(
                    RecordNoteParams {
                        note_path: path.to_string_lossy().into_owned(),
                        note_id: label.into(),
                        window_id: label.into(),
                    },
                    label,
                )
                .unwrap();
        }
        assert_eq!(service.history.list("settings").unwrap().len(), 2);
        let cache = serde_json::json!({ "version": 1, "windows": {
            "legacy-upper": { "windowId": "upper", "noteId": "upper", "notePath": upper, "visibility": "hidden", "readOnly": true },
            "legacy-lower": { "windowId": "lower", "noteId": "lower", "notePath": lower, "visibility": "hidden", "readOnly": false }
        }, "windowOrder": ["legacy-lower", "legacy-upper"], "hiddenStack": ["legacy-upper", "legacy-lower"], "visibleWindowToggleSnapshot": ["upper", "lower"] });
        fs::write(
            directory.path().join("windows.json"),
            serde_json::to_vec(&cache).unwrap(),
        )
        .unwrap();
        let upper_key = storage_key(upper.to_str().unwrap());
        let lower_key = storage_key(lower.to_str().unwrap());
        assert_ne!(upper_key, lower_key);
        let cache = service.cache.read().unwrap();
        assert_eq!(cache.windows.len(), 2);
        assert!(cache.windows[&upper_key].read_only);
        assert!(!cache.windows[&lower_key].read_only);
        assert_eq!(
            cache.window_order,
            vec![lower_key.clone(), upper_key.clone()]
        );
        assert_eq!(cache.hidden_stack, vec![upper_key, lower_key]);
        service.cache.remove_windows(&["upper".into()]).unwrap();
        let cache = service.cache.read().unwrap();
        assert_eq!(cache.windows.len(), 1);
        assert_eq!(cache.visible_window_toggle_snapshot, vec!["lower"]);
        assert_eq!(fs::read_to_string(lower).unwrap(), "lower");
    }

    #[test]
    fn close_failure_preserves_the_session_and_delete_clears_recovery() {
        let directory = crate::storage::test_directory();
        let path = directory.path().join("note.md");
        fs::write(&path, "initial").unwrap();
        let cache_path = directory.path().join("windows.json");
        let cache = serde_json::to_vec(&serde_json::json!({
            "version": 1,
            "windows": { "entry": { "windowId": "first", "noteId": "note", "notePath": path, "visibility": "hidden" } },
            "windowOrder": ["entry"], "hiddenStack": ["entry"], "visibleWindowToggleSnapshot": ["entry"]
        })).unwrap();
        fs::write(&cache_path, &cache).unwrap();
        tauri::async_runtime::block_on(async {
            let service = DocumentService::new(directory.path().to_path_buf());
            let document = service
                .for_path(path.to_string_lossy().into_owned())
                .await
                .unwrap();
            let snapshot = DocumentService::run(document.clone(), |document| {
                document.attach("first".into())?;
                document.load("first")
            })
            .await
            .unwrap();
            service.bind("first".into(), document.clone());
            service
                .history
                .record(
                    RecordNoteParams {
                        note_path: path.to_string_lossy().into_owned(),
                        note_id: "note".into(),
                        window_id: "first".into(),
                    },
                    "first",
                )
                .unwrap();
            fs::write(&cache_path, "invalid cache").unwrap();
            let result = service
                .end_session(
                    "first".into(),
                    EndKind::Close,
                    Some(FileSnapshot {
                        content: "final draft".into(),
                        version: snapshot.version,
                    }),
                )
                .await
                .unwrap();
            assert!(!result.ended);
            assert!(result.error.is_some());
            assert_eq!(fs::read_to_string(&path).unwrap(), "final draft");
            assert_eq!(fs::read_to_string(&cache_path).unwrap(), "invalid cache");
            DocumentService::run(document.clone(), |document| document.check("first"))
                .await
                .unwrap();
            fs::write(&cache_path, &cache).unwrap();
            let closed = service
                .end_session("first".into(), EndKind::Close, None)
                .await
                .unwrap();
            assert!(closed.ended && closed.error.is_none());
            assert!(path.exists());
            assert_eq!(service.history.list("settings").unwrap().len(), 1);
            assert!(service.cache.read().unwrap().windows.is_empty());
            DocumentService::run(document.clone(), |document| {
                document.attach("second".into())
            })
            .await
            .unwrap();
            service.bind("second".into(), document.clone());
            let mut restored: serde_json::Value = serde_json::from_slice(&cache).unwrap();
            restored["windows"]["entry"]["windowId"] = "second".into();
            fs::write(&cache_path, serde_json::to_vec(&restored).unwrap()).unwrap();
            let result = service
                .end_session("second".into(), EndKind::Delete, None)
                .await
                .unwrap();
            assert!(result.ended);
            assert!(result.error.is_none());
            assert!(!path.exists());
            assert!(service.history.list("settings").unwrap().is_empty());
            let cache = service.cache.read().unwrap();
            assert!(
                cache.windows.is_empty()
                    && cache.window_order.is_empty()
                    && cache.hidden_stack.is_empty()
                    && cache.visible_window_toggle_snapshot.is_empty()
            );
            assert!(matches!(
                DocumentService::run(document, |document| document.save("first", "late", "old"))
                    .await,
                Err(DocumentError::Ended)
            ));
            assert!(!path.exists());
        });
    }

    #[test]
    fn ordered_operations_preserve_content_and_end_old_sessions() {
        let directory = crate::storage::test_directory();
        let path = directory.path().join("note.md");
        fs::write(&path, "initial").unwrap();
        tauri::async_runtime::block_on(async {
            let service = DocumentService::new(directory.path().to_path_buf());
            let document = service
                .for_path(path.to_string_lossy().into_owned())
                .await
                .unwrap();
            let initial = DocumentService::run(document.clone(), |doc| {
                doc.attach("first".into())?;
                doc.read()
            })
            .await
            .unwrap();
            service.bind("first".into(), document.clone());
            #[cfg(unix)]
            {
                let alias = directory.path().join("alias.md");
                std::os::unix::fs::symlink("note.md", &alias).unwrap();
                let linked = service
                    .for_path(alias.to_string_lossy().into_owned())
                    .await
                    .unwrap();
                assert_eq!(
                    DocumentService::run(linked, |doc| Ok(doc.session().map(str::to_string)))
                        .await
                        .unwrap(),
                    Some("first".into())
                );
                service
                    .history
                    .record(
                        RecordNoteParams {
                            note_path: alias.to_string_lossy().into_owned(),
                            note_id: "alias".into(),
                            window_id: "first".into(),
                        },
                        "first",
                    )
                    .unwrap();
                let deleted = service
                    .delete_history(
                        vec![alias.to_string_lossy().into_owned()],
                        "settings".into(),
                        |result| {
                            assert!(!result.ended);
                            assert!(result.window_labels.is_empty());
                        },
                    )
                    .await
                    .unwrap();
                assert_eq!(deleted.deleted.len(), 1);
                assert!(deleted.failures.is_empty());
                assert!(!alias.exists());
                assert!(path.exists());
                DocumentService::run(document.clone(), |document| document.check("first"))
                    .await
                    .unwrap();
            }
            let held = document.clone().lock_owned().await;
            let mut save = Box::pin(DocumentService::run(document.clone(), move |doc| {
                doc.save("first", "saved", &initial.version)
            }));
            let mut delete = Box::pin(DocumentService::run(document.clone(), |doc| doc.delete()));
            {
                let mut context = Context::from_waker(Waker::noop());
                assert!(save.as_mut().poll(&mut context).is_pending());
                assert!(delete.as_mut().poll(&mut context).is_pending());
            }
            drop(held);
            let saved = save.await.unwrap();
            delete.await.unwrap();
            assert!(!path.exists());
            fs::write(&path, "reopened").unwrap();
            DocumentService::run(document.clone(), |doc| doc.attach("second".into()))
                .await
                .unwrap();
            assert!(matches!(
                DocumentService::run(service.for_window("first").unwrap(), move |doc| doc
                    .save("first", "late", &saved))
                .await,
                Err(DocumentError::Ended)
            ));
            assert_eq!(fs::read_to_string(&path).unwrap(), "reopened");
            let loaded = DocumentService::run(document.clone(), |doc| doc.read())
                .await
                .unwrap();
            fs::write(&path, "external").unwrap();
            assert!(matches!(
                DocumentService::run(document.clone(), move |doc| doc.save(
                    "second",
                    "local",
                    &loaded.version
                ))
                .await,
                Err(DocumentError::Conflict { .. })
            ));
            assert_eq!(fs::read_to_string(&path).unwrap(), "external");
            let current = DocumentService::run(document.clone(), |doc| doc.read())
                .await
                .unwrap();
            DocumentService::run(document, move |doc| {
                doc.save("second", "final", &current.version)?;
                doc.finish("second")
            })
            .await
            .unwrap();
            assert_eq!(fs::read_to_string(&path).unwrap(), "final");
        });
    }
}
