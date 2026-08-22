use std::{env, fs, path::PathBuf};

use zed_extension_api::{self as zed, Result};

const GITHUB_REPOSITORY: &str = "ebool/zed-surface";
const SERVER_ASSET: &str = "server.mjs";

struct SurfaceExtension {
    cached_server_path: Option<PathBuf>,
}

impl SurfaceExtension {
    fn server_path(&mut self, language_server_id: &zed::LanguageServerId) -> Result<PathBuf> {
        if let Some(path) = self
            .cached_server_path
            .as_ref()
            .filter(|path| fs::metadata(path).is_ok_and(|metadata| metadata.is_file()))
        {
            return Ok(path.clone());
        }

        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );

        let release = zed::latest_github_release(
            GITHUB_REPOSITORY,
            zed::GithubReleaseOptions {
                require_assets: true,
                pre_release: false,
            },
        )?;
        let asset = release
            .assets
            .iter()
            .find(|asset| asset.name == SERVER_ASSET)
            .ok_or_else(|| {
                format!(
                    "release {} does not contain {SERVER_ASSET}",
                    release.version
                )
            })?;
        let version_directory = format!("surface-language-server-{}", release.version);
        let install_directory = env::current_dir()
            .map_err(|error| format!("failed to find the extension work directory: {error}"))?
            .join(version_directory);
        let path = install_directory.join(SERVER_ASSET);

        if !fs::metadata(&path).is_ok_and(|metadata| metadata.is_file()) {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            fs::create_dir_all(&install_directory).map_err(|error| {
                format!("failed to create the language server directory: {error}")
            })?;
            zed::download_file(
                &asset.download_url,
                &path.to_string_lossy(),
                zed::DownloadedFileType::Uncompressed,
            )
            .map_err(|error| format!("failed to download the Surface language server: {error}"))?;
        }

        self.cached_server_path = Some(path.clone());
        Ok(path)
    }
}

impl zed::Extension for SurfaceExtension {
    fn new() -> Self {
        Self {
            cached_server_path: None,
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![self
                .server_path(language_server_id)?
                .to_string_lossy()
                .into_owned()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(SurfaceExtension);
