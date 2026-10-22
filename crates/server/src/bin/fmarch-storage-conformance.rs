//! Probe an environment's real buckets for the object-storage behaviour the
//! application depends on (see `server::storage_conformance`). Run with the
//! API's storage configuration, e.g. on an app host:
//!
//! ```sh
//! docker run --rm --env-file api.env <runtime-image@digest> fmarch-storage-conformance
//! ```
//!
//! Prints one JSON line per check and a summary; exits 1 on any failure.

use serde_json::json;
use server::storage_conformance::{create_only_store, deletable_store};
use std::process;

#[tokio::main]
async fn main() {
    match run().await {
        Ok(true) => {}
        Ok(false) => process::exit(1),
        Err(error) => {
            eprintln!("{}", json!({"status": "error", "error": error}));
            process::exit(1);
        }
    }
}

async fn run() -> Result<bool, String> {
    let media = server::media_s3_config_from_environment()?
        .object_store()
        .map_err(|error| error.to_string())?;
    let subject = identity::SubjectAuthorityStorageConfig::from_environment()
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;
    let probe_id = uuid::Uuid::new_v4().to_string();
    let mut checks = deletable_store(&media, "media", &probe_id).await;
    checks.extend(deletable_store(&subject.keys, "subject-keys", &probe_id).await);
    checks.extend(create_only_store(&subject.journal, "subject-journal", &probe_id).await);
    for check in &checks {
        println!("{}", json!(check));
    }
    let passed = checks.iter().all(|check| check.passed);
    println!(
        "{}",
        json!({
            "kind": "fmarch-storage-conformance",
            "probe_id": probe_id,
            "passed": passed,
            "checks": checks.len(),
        })
    );
    Ok(passed)
}
