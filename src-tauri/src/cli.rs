use clap::{Parser, Subcommand};
use log::error;

use crate::{
    open_new_note_window,
    window::{restore_hidden_window, show_all_hidden_windows, toggle_visible_note_windows},
};

#[derive(Debug, Parser)]
#[command(
    name = "pinote",
    bin_name = "pinote",
    version,
    about = "A lightweight floating Markdown scratchpad",
    args_conflicts_with_subcommands = true
)]
pub struct Cli {
    #[command(subcommand)]
    pub action: Option<CliAction>,
    #[arg(value_name = "FILE", help = "Markdown files to open as notes")]
    pub files: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Subcommand)]
pub enum CliAction {
    #[command(about = "Create a new note")]
    New,
    #[command(about = "Restore the most recently hidden note")]
    Restore,
    #[command(about = "Show all hidden notes")]
    ShowAll,
    #[command(about = "Show or hide notes")]
    Toggle,
}

pub fn parse_startup() -> Cli {
    Cli::try_parse().unwrap_or_else(|error| {
        attach_parent_console();
        error.exit()
    })
}

pub fn parse_forwarded(argv: &[String]) -> Option<Cli> {
    match Cli::try_parse_from(argv) {
        Ok(cli) => Some(cli),
        Err(error) => {
            error!("cli_arguments_invalid error={error}");
            None
        }
    }
}

#[cfg(target_os = "windows")]
fn attach_parent_console() {
    use windows_sys::Win32::{
        Foundation::INVALID_HANDLE_VALUE,
        System::Console::{ATTACH_PARENT_PROCESS, AttachConsole, GetStdHandle, STD_OUTPUT_HANDLE},
    };
    unsafe {
        let handle = GetStdHandle(STD_OUTPUT_HANDLE);
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            AttachConsole(ATTACH_PARENT_PROCESS);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn attach_parent_console() {}

pub fn run(app: &tauri::AppHandle, action: CliAction) {
    match action {
        CliAction::New => open_new_note_window(app),
        CliAction::Restore => restore_hidden_window(app),
        CliAction::ShowAll => show_all_hidden_windows(app),
        CliAction::Toggle => toggle_visible_note_windows(app),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::{CommandFactory, error::ErrorKind};

    fn parse(values: &[&str]) -> Result<Cli, clap::Error> {
        Cli::try_parse_from(values)
    }

    #[test]
    fn the_command_line_definition_is_valid() {
        Cli::command().debug_assert();
    }

    #[test]
    fn files_and_actions_are_read() {
        let cli = parse(&["pinote", "a.md", "b.markdown"]).unwrap();
        assert_eq!(cli.files, ["a.md", "b.markdown"]);
        assert_eq!(cli.action, None);
        for (name, action) in [
            ("new", CliAction::New),
            ("restore", CliAction::Restore),
            ("show-all", CliAction::ShowAll),
            ("toggle", CliAction::Toggle),
        ] {
            let cli = parse(&["pinote", name]).unwrap();
            assert_eq!(cli.action, Some(action));
            assert!(cli.files.is_empty());
        }
        assert!(parse(&["pinote"]).unwrap().files.is_empty());
    }

    #[test]
    fn help_version_and_mistakes_are_reported() {
        for args in [
            &["pinote", "help"][..],
            &["pinote", "--help"],
            &["pinote", "help", "new"],
        ] {
            assert_eq!(parse(args).unwrap_err().kind(), ErrorKind::DisplayHelp);
        }
        assert_eq!(
            parse(&["pinote", "--version"]).unwrap_err().kind(),
            ErrorKind::DisplayVersion
        );
        assert_eq!(
            parse(&["pinote", "--bogus"]).unwrap_err().kind(),
            ErrorKind::UnknownArgument
        );
        assert!(parse(&["pinote", "new", "a.md"]).is_err());
    }
}
