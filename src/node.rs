use super::{Result, command_output};
use serde::{Deserialize, Serialize};
use std::env;
use std::ffi::{CString, c_char, c_int};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::os::unix::{ffi::OsStrExt, fs::OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct NodeProfile {
    executable: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum ResolutionScope {
    SavedProfile,
    ProcessPath,
}

#[derive(Serialize)]
pub(super) struct NodeObservation {
    pub(super) version: String,
    executable: PathBuf,
    resolution_scope: ResolutionScope,
    observed_at_unix_ms: u64,
}

pub(super) fn is_local_version_request(request: &str) -> bool {
    let request = request.to_ascii_lowercase();
    let words = request
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty());
    words.clone().next() != Some("how")
        && words.clone().any(|word| matches!(word, "node" | "nodejs"))
        && words.clone().any(|word| word == "version")
        && !words.clone().any(|word| {
            matches!(
                word,
                "npm"
                    | "npx"
                    | "latest"
                    | "newest"
                    | "online"
                    | "command"
                    | "tutorial"
                    | "instructions"
            )
        })
}

fn profile_path() -> Result<PathBuf> {
    let dir = match env::var_os("CUQE_CONFIG_DIR") {
        Some(path) if path.is_empty() => return Err("CUQE_CONFIG_DIR must name a directory".into()),
        Some(path) => PathBuf::from(path),
        None => PathBuf::from(
            env::var_os("HOME")
                .filter(|home| !home.is_empty())
                .ok_or("Set HOME or CUQE_CONFIG_DIR")?,
        )
        .join("Library/Application Support/Cuqe"),
    };
    Ok(dir.join("node.json"))
}

unsafe extern "C" {
    fn access(path: *const c_char, mode: c_int) -> c_int;
}

fn is_executable(path: &Path) -> bool {
    const X_OK: c_int = 1;
    path.is_file()
        && CString::new(path.as_os_str().as_bytes())
            .is_ok_and(|path| unsafe { access(path.as_ptr(), X_OK) == 0 })
}

fn discover() -> Result<PathBuf> {
    let path =
        env::var_os("PATH").ok_or("PATH is not set. Activate your Node.js install first.")?;
    let executable = env::split_paths(&path)
        .map(|dir| dir.join("node"))
        .find(|path| is_executable(path))
        .ok_or("No executable Node.js found on PATH. Activate your Node.js install first.")?;
    Ok(executable.canonicalize()?)
}

fn probe(executable: PathBuf, resolution_scope: ResolutionScope) -> Result<NodeObservation> {
    let program = executable.to_str().ok_or("Node.js path must be UTF-8")?;
    let output = command_output(program, &["--version"])?;
    let version = output.trim();
    let core = version.split(['-', '+']).next().unwrap_or_default();
    let valid_core = core.strip_prefix('v').is_some_and(|core| {
        core.split('.').count() == 3
            && core
                .split('.')
                .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
    });
    if !valid_core
        || !version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'))
    {
        return Err("Node.js --version returned an invalid version".into());
    }
    Ok(NodeObservation {
        version: version.into(),
        executable,
        resolution_scope,
        observed_at_unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)?
            .as_millis()
            .try_into()?,
    })
}

fn read_profile(path: &Path) -> Result<Option<NodeProfile>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() => Ok(Some(serde_json::from_reader(File::open(path)?)?)),
        Ok(_) => Err("Expected a regular profile file".into()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub(super) fn observe() -> Result<NodeObservation> {
    let path = profile_path()?;
    let refresh = |error| {
        format!(
            "Saved Node.js profile at {} is invalid or stale. {error}. Run `cuqe --onboard-node` to refresh it.",
            path.display()
        )
    };
    let Some(profile) = read_profile(&path).map_err(refresh)? else {
        return probe(discover()?, ResolutionScope::ProcessPath);
    };
    let executable = profile.executable;
    if !executable.is_absolute()
        || executable.canonicalize().ok().as_ref() != Some(&executable)
        || !is_executable(&executable)
    {
        return Err(refresh("Expected the saved, executable absolute path".into()).into());
    }
    probe(executable, ResolutionScope::SavedProfile).map_err(|error| refresh(error).into())
}

pub(super) fn onboard() -> Result<NodeObservation> {
    let path = profile_path()?;
    let observation = probe(discover()?, ResolutionScope::SavedProfile)?;
    let bytes = serde_json::to_vec(&NodeProfile {
        executable: observation.executable.clone(),
    })?;

    fs::create_dir_all(path.parent().ok_or("Invalid Node.js profile path")?)?;
    let temp = path.with_file_name(format!(
        ".node.json.{}.{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temp)?;
    let result = file
        .write_all(&bytes)
        .and_then(|()| file.sync_all())
        .and_then(|()| fs::rename(&temp, &path));
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result?;
    Ok(observation)
}
