use std::{fs, path::Path};

fn domain_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

fn collect_rs_files(dir: &Path, files: &mut Vec<std::path::PathBuf>) {
    for entry in fs::read_dir(dir).unwrap_or_else(|e| panic!("read dir {dir:?}: {e}")) {
        let entry = entry.unwrap_or_else(|e| panic!("read entry in {dir:?}: {e}"));
        let path = entry.path();
        if path.is_dir() {
            collect_rs_files(&path, files);
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("rs") {
            files.push(path);
        }
    }
}

fn uncommented_source(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let mut in_block = false;

    for line in source.lines() {
        let mut rest = line;
        loop {
            if in_block {
                if let Some(end) = rest.find("*/") {
                    rest = &rest[end + 2..];
                    in_block = false;
                } else {
                    break;
                }
            } else if let Some(start) = rest.find("/*") {
                out.push_str(&rest[..start]);
                out.push('\n');
                rest = &rest[start + 2..];
                in_block = true;
            } else {
                if let Some(comment) = rest.find("//") {
                    out.push_str(&rest[..comment]);
                } else {
                    out.push_str(rest);
                }
                out.push('\n');
                break;
            }
        }
    }

    out
}

#[test]
fn domain_source_rejects_ambient_rng_and_wall_clock() {
    let root = domain_root();
    let mut files = Vec::new();
    collect_rs_files(&root.join("src"), &mut files);
    files.push(root.join("Cargo.toml"));

    let forbidden = [
        "std::time",
        "SystemTime",
        "Instant::now",
        "UNIX_EPOCH",
        "chrono::",
        "time::OffsetDateTime",
        "time::SystemTime",
        "rand::",
        "thread_rng",
        "random::<",
        "fastrand",
        "getrandom",
        "OsRng",
    ];

    let mut violations = Vec::new();
    for path in files {
        let source = fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path:?}: {e}"));
        let scanned = if path.extension().and_then(|ext| ext.to_str()) == Some("rs") {
            uncommented_source(&source)
        } else {
            source
        };
        for needle in forbidden {
            if scanned.contains(needle) {
                violations.push(format!(
                    "{} contains forbidden ambient determinism API `{needle}`",
                    path.strip_prefix(root).unwrap_or(&path).display()
                ));
            }
        }
    }

    assert!(
        violations.is_empty(),
        "domain code must stay deterministic; seed randomness through ResolutionInput.seed and use logical_time for timestamps:\n{}",
        violations.join("\n")
    );
}
