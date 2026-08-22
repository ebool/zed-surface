use std::{env, fs, path::PathBuf};

use zed_extension_api::{self as zed, Result};

const SERVER_FILE: &str = "surface-language-server.mjs";
const SERVER_SOURCE: &str = include_str!("../language-server/server.mjs");

struct SurfaceExtension;

impl SurfaceExtension {
    fn server_path(&self) -> Result<PathBuf> {
        let path = env::current_dir()
            .map_err(|error| format!("failed to find the extension work directory: {error}"))?
            .join(SERVER_FILE);

        let current = fs::read_to_string(&path).ok();
        if current.as_deref() != Some(SERVER_SOURCE) {
            fs::write(&path, SERVER_SOURCE).map_err(|error| {
                format!("failed to install the Surface language server: {error}")
            })?;
        }

        Ok(path)
    }
}

impl zed::Extension for SurfaceExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![self.server_path()?.to_string_lossy().into_owned()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(SurfaceExtension);
