use serde::Serialize;
use std::{
    fs::{self, File},
    io::{self, Read},
    path::Path,
};
use tauri::Manager;
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataExport {
    destination_path: String,
    file_count: usize,
}

fn archive_directory(
    zip: &mut ZipWriter<&mut File>,
    root: &Path,
    directory: &Path,
) -> io::Result<usize> {
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let mut count = 0;
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let relative = path.strip_prefix(root).map_err(io::Error::other)?;
        let name = relative
            .to_str()
            .ok_or_else(|| io::Error::other("A file name is not valid UTF-8."))?
            .replace(std::path::MAIN_SEPARATOR, "/");
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            zip.add_directory(name, options)?;
            count += archive_directory(zip, root, &path)?;
        } else if file_type.is_symlink() {
            let target = fs::read_link(&path)?;
            let target = target
                .to_str()
                .ok_or_else(|| io::Error::other("A link target is not valid UTF-8."))?;
            zip.add_symlink(name, target, options)?;
            count += 1;
        } else if file_type.is_file() {
            let file = File::open(&path)?;
            let size = file.metadata()?.len();
            zip.start_file(name, options.large_file(size > u32::MAX as u64))?;
            if io::copy(&mut file.take(size), zip)? != size {
                return Err(io::Error::other(format!(
                    "File changed while exporting: {}",
                    path.display()
                )));
            }
            count += 1;
        } else {
            return Err(io::Error::other(format!(
                "Unsupported file type: {}",
                path.display()
            )));
        }
    }
    Ok(count)
}

fn export_to_path(source: &Path, destination: &Path) -> io::Result<DataExport> {
    let root = source.canonicalize()?;
    let parent = destination
        .parent()
        .ok_or_else(|| io::Error::other("Choose where to save the archive."))?
        .canonicalize()?;
    if crate::document::path_key(&parent).starts_with(crate::document::path_key(&root)) {
        return Err(io::Error::other(
            "Save the archive outside the application data directory.",
        ));
    }
    let destination = parent.join(
        destination
            .file_name()
            .ok_or_else(|| io::Error::other("Choose an archive file name."))?,
    );
    let mut temporary = tempfile::Builder::new().make_in(&parent, |path| {
        let mut options = fs::OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(path)
    })?;
    let mut zip = ZipWriter::new(temporary.as_file_mut());
    let file_count = archive_directory(&mut zip, &root, &root)?;
    zip.finish()?.sync_all()?;
    fs::rename(temporary.path(), &destination)?;
    temporary.disable_cleanup(true);
    Ok(DataExport {
        destination_path: destination.to_string_lossy().into_owned(),
        file_count,
    })
}

#[tauri::command]
pub async fn export_app_data(
    app: tauri::AppHandle,
    destination_path: String,
) -> Result<DataExport, String> {
    let source = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        export_to_path(&source, Path::new(&destination_path)).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::ZipArchive;

    #[test]
    fn exports_all_files_and_empty_directories_without_changing_sources() {
        let directory = crate::storage::test_directory();
        let source = directory.path().join("data");
        fs::create_dir_all(source.join("notes/nested/empty")).unwrap();
        fs::create_dir_all(source.join("logs")).unwrap();
        let files = [
            ("settings.json", b"{\"theme\":\"dark\"}".as_slice()),
            ("history.json", b"[]".as_slice()),
            ("windows.json", b"{}".as_slice()),
            ("notes/nested/便签.md", "正文\n😀".as_bytes()),
            ("logs/pinote.log", b"log entry".as_slice()),
            (".hidden", &[0, 255, 10]),
        ];
        for (name, content) in files {
            fs::write(source.join(name), content).unwrap();
        }
        let destination = directory.path().join("backup.zip");
        fs::write(&destination, b"old archive").unwrap();
        let result = export_to_path(&source, &destination).unwrap();
        assert_eq!(result.file_count, files.len());
        let mut archive = ZipArchive::new(File::open(&destination).unwrap()).unwrap();
        for (name, content) in files {
            let mut actual = Vec::new();
            archive
                .by_name(name)
                .unwrap()
                .read_to_end(&mut actual)
                .unwrap();
            assert_eq!(actual, content);
            assert_eq!(fs::read(source.join(name)).unwrap(), content);
        }
        assert!(archive.by_name("notes/nested/empty/").unwrap().is_dir());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
    }

    #[test]
    fn rejects_destinations_inside_data_and_preserves_existing_files() {
        let directory = crate::storage::test_directory();
        let source = directory.path().join("data");
        fs::create_dir_all(source.join("notes")).unwrap();
        let destination = source.join("notes/backup.zip");
        fs::write(&destination, b"existing data").unwrap();
        assert!(export_to_path(&source, &destination).is_err());
        assert_eq!(fs::read(destination).unwrap(), b"existing data");
        assert_eq!(fs::read_dir(source.join("notes")).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn preserves_links_and_cleans_up_an_incomplete_export() {
        use std::os::unix::fs::symlink;
        let directory = crate::storage::test_directory();
        let source = directory.path().join("data");
        fs::create_dir(&source).unwrap();
        symlink("../missing", source.join("link")).unwrap();
        let destination = directory.path().join("backup.zip");
        export_to_path(&source, &destination).unwrap();
        let mut archive = ZipArchive::new(File::open(&destination).unwrap()).unwrap();
        let mut link = archive.by_name("link").unwrap();
        assert!(link.is_symlink());
        let mut target = String::new();
        link.read_to_string(&mut target).unwrap();
        assert_eq!(target, "../missing");
        drop(link);
        drop(archive);
        let previous = fs::read(&destination).unwrap();
        nix::unistd::mkfifo(&source.join("pipe"), nix::sys::stat::Mode::S_IRWXU).unwrap();
        assert!(export_to_path(&source, &destination).is_err());
        assert_eq!(fs::read(&destination).unwrap(), previous);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
    }
}
