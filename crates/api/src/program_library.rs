//! Checked-in, content-addressed DayProgram library adapter.
//!
//! The manifest is the only discovery surface. Every referenced document is
//! validated against its typed identity, version, and canonical BLAKE3 hash;
//! every program document on disk must be present in the manifest.

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

use game_platform::{DayProgram, DayProgramRef};
use serde::{Deserialize, Serialize};

pub const PROGRAM_LIBRARY_SCHEMA_VERSION: u16 = 1;
pub const PROGRAM_LIBRARY_MANIFEST: &str = "catalog.json";
pub const PROGRAM_DOCUMENT_SUFFIX: &str = ".program.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProgramAudience {
    Product,
    Acceptance,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProgramArtifact {
    pub program_ref: DayProgramRef,
    pub audience: ProgramAudience,
    pub file: String,
    pub document: DayProgram,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProgramLibrary {
    artifacts: Vec<ProgramArtifact>,
}

impl ProgramLibrary {
    pub fn artifacts(&self) -> &[ProgramArtifact] {
        &self.artifacts
    }

    pub fn for_audience(
        &self,
        audience: ProgramAudience,
    ) -> impl Iterator<Item = &ProgramArtifact> {
        self.artifacts
            .iter()
            .filter(move |artifact| artifact.audience == audience)
    }

    pub fn resolve(
        &self,
        program_ref: &DayProgramRef,
        audience: ProgramAudience,
    ) -> Result<&ProgramArtifact, ProgramLibraryError> {
        self.artifacts
            .iter()
            .find(|artifact| artifact.audience == audience && artifact.program_ref == *program_ref)
            .ok_or_else(|| ProgramLibraryError::UnknownReference {
                id: program_ref.id.as_str().to_string(),
                version: program_ref.version,
                content_hash: program_ref.content_hash.to_string(),
                audience,
            })
    }

    pub fn resolve_identity(
        &self,
        id: &str,
        version: u32,
        audience: ProgramAudience,
    ) -> Result<&ProgramArtifact, ProgramLibraryError> {
        self.artifacts
            .iter()
            .find(|artifact| {
                artifact.audience == audience
                    && artifact.program_ref.id.as_str() == id
                    && artifact.program_ref.version == version
            })
            .ok_or_else(|| ProgramLibraryError::UnknownIdentity {
                id: id.to_string(),
                version,
                audience,
            })
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProgramLibraryManifest {
    schema_version: u16,
    programs: Vec<ProgramLibraryManifestEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProgramLibraryManifestEntry {
    program_ref: DayProgramRef,
    audience: ProgramAudience,
    file: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ProgramLibraryError {
    #[error("read program library {path}: {source}")]
    Read {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("decode program library {path}: {source}")]
    Decode {
        path: PathBuf,
        source: serde_json::Error,
    },
    #[error("program library schema version {actual} is unsupported; expected {expected}")]
    SchemaVersion { actual: u16, expected: u16 },
    #[error("program library file must be one local `{suffix}` filename: {file}")]
    UnsafeFile { file: String, suffix: &'static str },
    #[error("duplicate program library reference: {id}@{version}#{content_hash}")]
    DuplicateReference {
        id: String,
        version: u32,
        content_hash: String,
    },
    #[error("duplicate program library file: {0}")]
    DuplicateFile(String),
    #[error(
        "program document identity drift in {file}: manifest={expected_id}@{expected_version}, document={actual_id}@{actual_version}"
    )]
    IdentityDrift {
        file: String,
        expected_id: String,
        expected_version: u32,
        actual_id: String,
        actual_version: u32,
    },
    #[error("program document hash drift in {file}: manifest={expected}, canonical={actual}")]
    HashDrift {
        file: String,
        expected: String,
        actual: String,
    },
    #[error("program library manifest/file inventory drift: {details}")]
    InventoryDrift { details: String },
    #[error("unknown {audience:?} program reference {id}@{version}#{content_hash}")]
    UnknownReference {
        id: String,
        version: u32,
        content_hash: String,
        audience: ProgramAudience,
    },
    #[error("unknown {audience:?} program identity {id}@{version}")]
    UnknownIdentity {
        id: String,
        version: u32,
        audience: ProgramAudience,
    },
    #[error("invalid program document {file}: {message}")]
    InvalidDocument { file: String, message: String },
}

pub fn checked_in_program_library_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../programs")
}

pub fn load_checked_in_program_library() -> Result<ProgramLibrary, ProgramLibraryError> {
    load_program_library(&checked_in_program_library_root())
}

pub fn load_program_library(root: &Path) -> Result<ProgramLibrary, ProgramLibraryError> {
    let manifest_path = root.join(PROGRAM_LIBRARY_MANIFEST);
    let raw = read(&manifest_path)?;
    let manifest: ProgramLibraryManifest =
        serde_json::from_str(&raw).map_err(|source| ProgramLibraryError::Decode {
            path: manifest_path,
            source,
        })?;
    if manifest.schema_version != PROGRAM_LIBRARY_SCHEMA_VERSION {
        return Err(ProgramLibraryError::SchemaVersion {
            actual: manifest.schema_version,
            expected: PROGRAM_LIBRARY_SCHEMA_VERSION,
        });
    }

    let mut reference_keys = BTreeSet::new();
    let mut manifest_files = BTreeSet::new();
    let mut artifacts = Vec::with_capacity(manifest.programs.len());
    for entry in manifest.programs {
        validate_file_name(&entry.file)?;
        let reference_key = (
            entry.program_ref.id.as_str().to_string(),
            entry.program_ref.version,
            entry.program_ref.content_hash.to_string(),
        );
        if !reference_keys.insert(reference_key.clone()) {
            return Err(ProgramLibraryError::DuplicateReference {
                id: reference_key.0,
                version: reference_key.1,
                content_hash: reference_key.2,
            });
        }
        if !manifest_files.insert(entry.file.clone()) {
            return Err(ProgramLibraryError::DuplicateFile(entry.file));
        }
        let path = root.join(&entry.file);
        let raw = read(&path)?;
        let document: DayProgram = serde_json::from_str(&raw)
            .map_err(|source| ProgramLibraryError::Decode { path, source })?;
        let actual_ref =
            document
                .artifact_ref()
                .map_err(|error| ProgramLibraryError::InvalidDocument {
                    file: entry.file.clone(),
                    message: error.to_string(),
                })?;
        if actual_ref.id != entry.program_ref.id || actual_ref.version != entry.program_ref.version
        {
            return Err(ProgramLibraryError::IdentityDrift {
                file: entry.file,
                expected_id: entry.program_ref.id.as_str().to_string(),
                expected_version: entry.program_ref.version,
                actual_id: actual_ref.id.as_str().to_string(),
                actual_version: actual_ref.version,
            });
        }
        if actual_ref.content_hash != entry.program_ref.content_hash {
            return Err(ProgramLibraryError::HashDrift {
                file: entry.file,
                expected: entry.program_ref.content_hash.to_string(),
                actual: actual_ref.content_hash.to_string(),
            });
        }
        artifacts.push(ProgramArtifact {
            program_ref: entry.program_ref,
            audience: entry.audience,
            file: entry.file,
            document,
        });
    }

    let entries = std::fs::read_dir(root).map_err(|source| ProgramLibraryError::Read {
        path: root.to_path_buf(),
        source,
    })?;
    let mut disk_files = BTreeSet::new();
    for entry in entries {
        let entry = entry.map_err(|source| ProgramLibraryError::Read {
            path: root.to_path_buf(),
            source,
        })?;
        let file =
            entry
                .file_name()
                .into_string()
                .map_err(|_| ProgramLibraryError::InventoryDrift {
                    details: "program library contains a non-UTF-8 filename".to_string(),
                })?;
        if file.ends_with(".json") && file != PROGRAM_LIBRARY_MANIFEST {
            disk_files.insert(file);
        }
    }
    if disk_files != manifest_files {
        let missing = manifest_files
            .difference(&disk_files)
            .cloned()
            .collect::<Vec<_>>();
        let unlisted = disk_files
            .difference(&manifest_files)
            .cloned()
            .collect::<Vec<_>>();
        return Err(ProgramLibraryError::InventoryDrift {
            details: format!("missing={missing:?}, unlisted={unlisted:?}"),
        });
    }

    artifacts.sort_by(|left, right| {
        left.program_ref
            .id
            .cmp(&right.program_ref.id)
            .then(left.program_ref.version.cmp(&right.program_ref.version))
            .then(left.audience.cmp(&right.audience))
    });
    Ok(ProgramLibrary { artifacts })
}

fn validate_file_name(file: &str) -> Result<(), ProgramLibraryError> {
    let mut components = Path::new(file).components();
    let safe = matches!(components.next(), Some(Component::Normal(_)))
        && components.next().is_none()
        && file.ends_with(PROGRAM_DOCUMENT_SUFFIX);
    if safe {
        Ok(())
    } else {
        Err(ProgramLibraryError::UnsafeFile {
            file: file.to_string(),
            suffix: PROGRAM_DOCUMENT_SUFFIX,
        })
    }
}

fn read(path: &Path) -> Result<String, ProgramLibraryError> {
    std::fs::read_to_string(path).map_err(|source| ProgramLibraryError::Read {
        path: path.to_path_buf(),
        source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn checked_in_library_is_closed_content_addressed_and_audience_partitioned() {
        let library = load_checked_in_program_library().unwrap();
        assert_eq!(
            library
                .for_audience(ProgramAudience::Product)
                .map(|artifact| artifact.program_ref.id.as_str())
                .collect::<Vec<_>>(),
            vec!["host-judged-showcase", "opt-in-quest", "raffle"]
        );
        assert_eq!(
            library
                .for_audience(ProgramAudience::Acceptance)
                .map(|artifact| artifact.program_ref.id.as_str())
                .collect::<Vec<_>>(),
            vec!["mash-scale-acceptance"]
        );
    }

    #[test]
    fn library_rejects_hash_drift_and_unlisted_json() {
        let source_root = checked_in_program_library_root();
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        fs::copy(
            source_root.join("raffle.v1.program.json"),
            root.join("raffle.v1.program.json"),
        )
        .unwrap();
        fs::write(
            root.join(PROGRAM_LIBRARY_MANIFEST),
            r#"{
              "schema_version": 1,
              "programs": [{
                "program_ref": {
                  "id": "raffle",
                  "version": 1,
                  "content_hash": "0000000000000000000000000000000000000000000000000000000000000000"
                },
                "audience": "product",
                "file": "raffle.v1.program.json"
              }]
            }"#,
        )
        .unwrap();
        assert!(matches!(
            load_program_library(root),
            Err(ProgramLibraryError::HashDrift { .. })
        ));

        fs::copy(
            source_root.join(PROGRAM_LIBRARY_MANIFEST),
            root.join(PROGRAM_LIBRARY_MANIFEST),
        )
        .unwrap();
        for file in [
            "opt-in-quest.v1.program.json",
            "host-judged-showcase.v1.program.json",
            "mash-scale-acceptance.v1.program.json",
        ] {
            fs::copy(source_root.join(file), root.join(file)).unwrap();
        }
        fs::write(root.join("loose.json"), "{}").unwrap();
        assert!(matches!(
            load_program_library(root),
            Err(ProgramLibraryError::InventoryDrift { .. })
        ));
    }
}
