use std::{
    env,
    ffi::OsString,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process,
    time::{SystemTime, UNIX_EPOCH},
};

/// Checked-in TypeScript contract paths. Both must match
/// `wire::typescript::render()` under `--check`; `--write` updates both.
const GENERATED_TYPES: &[&str] = &[
    "crates/wire/generated/types.ts",
    "frontend/src/lib/wire/types.ts",
];
const USAGE: &str = "usage: export_types --check|--write";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mode = Mode::parse(env::args().skip(1))?;
    let root = workspace_root()?;
    let rendered = wire::typescript::render();
    let paths: Vec<PathBuf> = GENERATED_TYPES
        .iter()
        .map(|relative| root.join(relative))
        .collect();

    match mode {
        Mode::Check => {
            for path in &paths {
                let checked_in = fs::read_to_string(path).map_err(|error| {
                    format!(
                        "failed to read {}: {error}; run `cargo run -p wire --bin export_types -- --write`",
                        path.display()
                    )
                })?;
                if checked_in != rendered {
                    return Err(format!(
                        "{} drifted; run `cargo run -p wire --bin export_types -- --write`",
                        path.display()
                    )
                    .into());
                }
                println!("ok: checked {}", path.display());
            }
        }
        Mode::Write => {
            for path in &paths {
                write_atomic(path, rendered.as_bytes())?;
                println!("ok: wrote {}", path.display());
            }
        }
    }

    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Check,
    Write,
}

impl Mode {
    fn parse<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut args = args.into_iter();
        match (args.next().as_deref(), args.next()) {
            (Some("--check"), None) => Ok(Self::Check),
            (Some("--write"), None) => Ok(Self::Write),
            _ => Err(USAGE.to_owned()),
        }
    }
}

fn workspace_root() -> io::Result<PathBuf> {
    let current = env::current_dir()?;
    current
        .ancestors()
        .find(|candidate| {
            candidate.join("Cargo.toml").is_file()
                && candidate.join("crates/wire/Cargo.toml").is_file()
        })
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                format!("could not find fmarch workspace from {}", current.display()),
            )
        })
}

fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{} has no parent directory", path.display()),
        )
    })?;
    fs::create_dir_all(parent)?;
    let temporary = temporary_path_for(path);

    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        fs::File::open(parent)?.sync_all()?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn temporary_path_for(path: &Path) -> PathBuf {
    let mut file_name = path
        .file_name()
        .map(OsString::from)
        .unwrap_or_else(|| OsString::from("types.ts"));
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    file_name.push(format!(".tmp-{}-{nonce}", process::id()));
    path.with_file_name(file_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modes_are_explicit_and_mutually_exclusive() {
        assert_eq!(Mode::parse(["--check".to_owned()]), Ok(Mode::Check));
        assert_eq!(Mode::parse(["--write".to_owned()]), Ok(Mode::Write));
        assert_eq!(Mode::parse(Vec::<String>::new()), Err(USAGE.to_owned()));
        assert_eq!(
            Mode::parse(["--check".to_owned(), "--write".to_owned()]),
            Err(USAGE.to_owned())
        );
    }

    #[test]
    fn generated_paths_cover_crate_and_spa() {
        assert_eq!(
            GENERATED_TYPES,
            &[
                "crates/wire/generated/types.ts",
                "frontend/src/lib/wire/types.ts",
            ]
        );
    }

    #[test]
    fn atomic_write_replaces_the_complete_artifact_without_a_leftover() {
        let directory = env::temp_dir().join(format!(
            "fmarch-export-types-{}-{}",
            process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("types.ts");
        fs::write(&path, b"old").unwrap();

        write_atomic(&path, b"new contract\n").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"new contract\n");
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_dir_all(directory).unwrap();
    }
}
