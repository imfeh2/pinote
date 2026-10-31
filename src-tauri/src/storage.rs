use std::{
    fs,
    io::{self, Write},
    path::Path,
};
use tempfile::Builder;

#[cfg(test)]
pub fn test_directory() -> tempfile::TempDir {
    let executable = std::env::current_exe().unwrap();
    tempfile::tempdir_in(executable.parent().unwrap()).unwrap()
}

pub fn replace_file(path: &Path, content: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "File path has no parent"))?;
    fs::create_dir_all(parent)?;
    // 使用普通文件属性，保留 Windows 文件替换行为。
    let mut file = Builder::new().make_in(parent, |path| {
        let mut options = fs::OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(path)
    })?;
    file.write_all(content)?;
    file.as_file().sync_all()?;
    fs::rename(file.path(), path)?;
    file.disable_cleanup(true);
    Ok(())
}
