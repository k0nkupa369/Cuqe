#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
compile_error!("Cuqe supports Apple silicon macOS.");

use std::env;
use std::error::Error;
use std::num::NonZeroU64;
use std::process::{Command, ExitCode};

mod model;
mod node;

type Result<T> = std::result::Result<T, Box<dyn Error>>;

const HELP: &str = "Usage: cuqe --read <disk_space|node_version>
       cuqe --onboard-node
       cuqe --verified 'startup disk request'
       cuqe --verified-node[-json] 'local Node.js version request'
       cuqe --version";

#[derive(Clone, Copy)]
enum Read {
    Disk,
    Node,
}

impl Read {
    fn id(self) -> &'static str {
        match self {
            Self::Disk => "disk_free",
            Self::Node => "node_version",
        }
    }

    fn candidate(self) -> &'static str {
        match self {
            Self::Disk => "Report free space on the Mac's startup data volume.",
            Self::Node => "Read the installed Node.js runtime version.",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Disk => "disk space",
            Self::Node => "Node.js version",
        }
    }

    fn run(self, json: bool) -> Result<()> {
        match self {
            Self::Disk => read_disk(),
            Self::Node => {
                let observation = node::observe()?;
                if json {
                    println!("{}", serde_json::to_string(&observation)?);
                } else {
                    println!("{}", observation.version);
                }
                Ok(())
            }
        }
    }

    fn verify(self, request: &str) -> Result<()> {
        if request.is_empty() || request.len() > 1024 || request.starts_with("--") {
            return Err("Enter one quoted request of up to 1024 UTF-8 bytes".into());
        }
        let in_scope = match self {
            Self::Disk => {
                let request = request.to_ascii_lowercase();
                !request
                    .split(|c: char| !c.is_ascii_alphanumeric())
                    .any(|word| matches!(word, "external" | "usb" | "removable" | "network"))
            }
            Self::Node => node::is_local_version_request(request),
        };
        if !in_scope || model::route(request)? != self.id() {
            return Err(format!("Verified mode only supports {}", self.id()).into());
        }
        if !model::verify_candidate(request, self.candidate())? {
            return Err(format!("Cuqe verifier declined the {} request", self.label()).into());
        }
        Ok(())
    }
}

fn command_output(program: &str, args: &[&str]) -> Result<String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| format!("Could not run {program}. {error}"))?;
    if !output.status.success() {
        return Err(format!("{program} failed with {}", output.status).into());
    }
    Ok(String::from_utf8(output.stdout)?)
}

fn read_disk() -> Result<()> {
    let mount = "/System/Volumes/Data";
    let report = command_output("/bin/df", &["-k", mount])?;
    let mut fields = report
        .lines()
        .nth(1)
        .ok_or("Could not read startup volume space")?
        .split_whitespace()
        .skip(1);
    let total = fields
        .next()
        .ok_or("Missing total disk space")?
        .parse::<NonZeroU64>()?
        .get();
    let available = fields
        .nth(1)
        .ok_or("Missing available disk space")?
        .parse::<u64>()?;
    let kib_per_gib = 1_048_576.0;
    let percent_free = available as f64 / total as f64 * 100.0;
    println!(
        "{percent_free:.1}% free ({:.1} GiB available of {:.1} GiB total) on {mount}",
        available as f64 / kib_per_gib,
        total as f64 / kib_per_gib
    );
    Ok(())
}

fn run() -> Result<()> {
    let args = env::args_os().skip(1).collect::<Vec<_>>();
    match args.as_slice() {
        [] => println!("{HELP}"),
        [flag] if flag == "--help" || flag == "-h" => println!("{HELP}"),
        [flag] if flag == "--version" || flag == "-V" => {
            println!("cuqe {}", env!("CARGO_PKG_VERSION"));
        }
        [flag] if flag == "--onboard-node" => {
            println!("{}", serde_json::to_string(&node::onboard()?)?);
        }
        [flag, action] if flag == "--read" => {
            let selected = match action.to_str() {
                Some("disk_space") => Read::Disk,
                Some("node_version") => Read::Node,
                _ => return Err("Read action must be disk_space or node_version".into()),
            };
            selected.run(true)?;
        }
        [flag, request]
            if flag == "--verified"
                || flag == "--verified-node"
                || flag == "--verified-node-json" =>
        {
            let selected = if flag == "--verified" {
                Read::Disk
            } else {
                Read::Node
            };
            selected.verify(request.to_str().ok_or("Request must be UTF-8")?.trim())?;
            selected.run(flag == "--verified-node-json")?;
        }
        _ => return Err("Invalid arguments. Run cuqe --help.".into()),
    }
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("cuqe: {error}");
            ExitCode::FAILURE
        }
    }
}
