//! Hermetic, startup-validated registry for product rule packs and day programs.
//!
//! Product binaries carry their content as bytes in the executable. Production
//! resolution therefore cannot depend on a source checkout, a current working
//! directory, or mutable files beside the process. Debug builds additionally
//! embed test packs so command and acceptance tests use the same resolver seam.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::sync::{Arc, Mutex, OnceLock};

use domain::Pack;
use game_platform::{DayProgram, DayProgramRef};
use serde::{de::Error as _, Deserialize, Deserializer, Serialize};

const PACK_CATALOG: &str = include_str!("../../../packs/catalog.json");
const PROGRAM_CATALOG: &str = include_str!("../../../programs/catalog.json");

const PRODUCT_PACK_SOURCES: &[(&str, &str)] = &[
    (
        "chinese_structured/pack.json",
        include_str!("../../../packs/chinese_structured/pack.json"),
    ),
    (
        "default_open/pack.json",
        include_str!("../../../packs/default_open/pack.json"),
    ),
    (
        "epicmafia/pack.json",
        include_str!("../../../packs/epicmafia/pack.json"),
    ),
    (
        "mafia_universe/pack.json",
        include_str!("../../../packs/mafia_universe/pack.json"),
    ),
    (
        "mafiascum/pack.json",
        include_str!("../../../packs/mafiascum/pack.json"),
    ),
];

const PROGRAM_SOURCES: &[(&str, &str)] = &[
    (
        "host-judged-showcase.v1.program.json",
        include_str!("../../../programs/host-judged-showcase.v1.program.json"),
    ),
    (
        "mash-scale-acceptance.v1.program.json",
        include_str!("../../../programs/mash-scale-acceptance.v1.program.json"),
    ),
    (
        "opt-in-quest.v1.program.json",
        include_str!("../../../programs/opt-in-quest.v1.program.json"),
    ),
    (
        "private-opt-in-circle.v1.program.json",
        include_str!("../../../programs/private-opt-in-circle.v1.program.json"),
    ),
    (
        "raffle.v1.program.json",
        include_str!("../../../programs/raffle.v1.program.json"),
    ),
];

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct ContentHash(String);

impl ContentHash {
    pub fn new(value: impl Into<String>) -> Result<Self, RegistryError> {
        let value = value.into();
        if value.len() != 64
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(RegistryError::InvalidContentHash);
        }
        Ok(Self(value))
    }

    fn digest(bytes: &[u8]) -> Self {
        Self(blake3::hash(bytes).to_hex().to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for ContentHash {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::new(String::deserialize(deserializer)?).map_err(D::Error::custom)
    }
}

impl fmt::Display for ContentHash {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Immutable address of one validated pack document.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct PackRef {
    pub key: String,
    pub version: u32,
    pub content_hash: ContentHash,
}

pub const PACK_ARTIFACT_SCHEMA_VERSION: u16 = 1;

/// Canonical, portable rule-pack custody attached to `GameCreated`.
///
/// The JSON string is deliberately retained byte-for-byte rather than as a
/// `serde_json::Value`: its BLAKE3 digest is the PackRef content address, and
/// canonical round-trip validation prevents alternate encodings from sharing
/// that identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackArtifactSnapshot {
    pub schema_version: u16,
    pub pack_ref: PackRef,
    pub canonical_json: String,
}

impl PackArtifactSnapshot {
    pub fn from_document(document: &Pack) -> Result<Self, RegistryError> {
        domain::validate_pack(document).map_err(|error| RegistryError::InvalidPackArtifact {
            key: document.name.clone(),
            message: error.to_string(),
        })?;
        let canonical_json = serde_json::to_string(document).map_err(|error| {
            RegistryError::InvalidPackArtifact {
                key: document.name.clone(),
                message: format!("canonical serialization failed: {error}"),
            }
        })?;
        Ok(Self {
            schema_version: PACK_ARTIFACT_SCHEMA_VERSION,
            pack_ref: PackRef {
                key: document.name.clone(),
                version: document.version,
                content_hash: ContentHash::digest(canonical_json.as_bytes()),
            },
            canonical_json,
        })
    }
}

/// The platform already owns the typed content-addressed program reference;
/// this alias names its role at the registry boundary.
pub type ProgramRef = DayProgramRef;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProgramAudience {
    Product,
    Acceptance,
}

#[derive(Debug, Clone)]
pub struct PackArtifact {
    pub pack_ref: PackRef,
    pub document: Pack,
    canonical_json: String,
}

impl PackArtifact {
    pub fn snapshot(&self) -> PackArtifactSnapshot {
        PackArtifactSnapshot {
            schema_version: PACK_ARTIFACT_SCHEMA_VERSION,
            pack_ref: self.pack_ref.clone(),
            canonical_json: self.canonical_json.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProgramArtifact {
    pub program_ref: ProgramRef,
    pub audience: ProgramAudience,
    pub document: DayProgram,
}

#[derive(Debug)]
pub struct ContentRegistry {
    packs: Vec<PackArtifact>,
    programs: Vec<ProgramArtifact>,
    registry_hash: ContentHash,
}

impl ContentRegistry {
    pub fn packs(&self) -> &[PackArtifact] {
        &self.packs
    }

    pub fn programs(&self) -> &[ProgramArtifact] {
        &self.programs
    }

    pub fn registry_hash(&self) -> &ContentHash {
        &self.registry_hash
    }

    pub fn pack(&self, key: &str) -> Result<&PackArtifact, RegistryError> {
        self.packs
            .iter()
            .find(|artifact| artifact.pack_ref.key == key)
            .ok_or_else(|| RegistryError::UnknownPack(key.to_string()))
    }

    pub fn resolve_pack(&self, pack_ref: &PackRef) -> Result<&PackArtifact, RegistryError> {
        self.packs
            .iter()
            .find(|artifact| artifact.pack_ref == *pack_ref)
            .ok_or_else(|| RegistryError::UnknownPackReference {
                key: pack_ref.key.clone(),
                version: pack_ref.version,
                content_hash: pack_ref.content_hash.to_string(),
            })
    }

    pub fn for_audience(
        &self,
        audience: ProgramAudience,
    ) -> impl Iterator<Item = &ProgramArtifact> {
        self.programs
            .iter()
            .filter(move |artifact| artifact.audience == audience)
    }

    pub fn resolve(
        &self,
        program_ref: &ProgramRef,
        audience: ProgramAudience,
    ) -> Result<&ProgramArtifact, RegistryError> {
        self.programs
            .iter()
            .find(|artifact| artifact.audience == audience && artifact.program_ref == *program_ref)
            .ok_or_else(|| RegistryError::UnknownProgramReference {
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
    ) -> Result<&ProgramArtifact, RegistryError> {
        self.programs
            .iter()
            .find(|artifact| {
                artifact.audience == audience
                    && artifact.program_ref.id.as_str() == id
                    && artifact.program_ref.version == version
            })
            .ok_or_else(|| RegistryError::UnknownProgramIdentity {
                id: id.to_string(),
                version,
                audience,
            })
    }
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum RegistryError {
    #[error("embedded content registry failed startup validation: {0}")]
    Initialization(String),
    #[error("unknown embedded pack `{0}`")]
    UnknownPack(String),
    #[error("unknown embedded pack reference {key}@{version}#{content_hash}")]
    UnknownPackReference {
        key: String,
        version: u32,
        content_hash: String,
    },
    #[error("content hash must be 64 lowercase hexadecimal characters")]
    InvalidContentHash,
    #[error("invalid pack artifact `{key}`: {message}")]
    InvalidPackArtifact { key: String, message: String },
    #[error("unknown {audience:?} program reference {id}@{version}#{content_hash}")]
    UnknownProgramReference {
        id: String,
        version: u32,
        content_hash: String,
        audience: ProgramAudience,
    },
    #[error("unknown {audience:?} program identity {id}@{version}")]
    UnknownProgramIdentity {
        id: String,
        version: u32,
        audience: ProgramAudience,
    },
    #[error("embedded debug pack `{key}` is invalid: {message}")]
    InvalidDebugPack { key: String, message: String },
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PackCatalog {
    schema_version: u16,
    packs: Vec<PackCatalogEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PackCatalogEntry {
    key: String,
    file: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProgramCatalog {
    schema_version: u16,
    programs: Vec<ProgramCatalogEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProgramCatalogEntry {
    program_ref: ProgramRef,
    audience: ProgramAudience,
    file: String,
}

static PRODUCT_REGISTRY: OnceLock<Result<ContentRegistry, String>> = OnceLock::new();

/// Resolve the one process-wide product registry. Parsing and semantic
/// validation happen exactly once, on first startup/readiness use.
pub fn product_registry() -> Result<&'static ContentRegistry, RegistryError> {
    PRODUCT_REGISTRY
        .get_or_init(build_product_registry)
        .as_ref()
        .map_err(|message| RegistryError::Initialization(message.clone()))
}

/// Select the immutable identity of an embedded pack at game creation.
/// Selection by key is permitted only before the identity is committed; all
/// subsequent resolution must use [`resolve_pack`].
pub fn pack_ref(key: &str) -> Result<&'static PackRef, RegistryError> {
    if let Ok(artifact) = product_registry()?.pack(key) {
        return Ok(&artifact.pack_ref);
    }
    #[cfg(debug_assertions)]
    {
        debug_pack_entry(key).map(|entry| &entry.pack_ref)
    }
    #[cfg(not(debug_assertions))]
    Err(RegistryError::UnknownPack(key.to_string()))
}

/// Select the canonical artifact attached to a new game's `GameCreated`
/// event. This is the registry's only runtime authority: after creation, the
/// game-owned snapshot and its durable database projection are authoritative.
pub fn select_pack_artifact(key: &str) -> Result<PackArtifactSnapshot, RegistryError> {
    if let Ok(artifact) = product_registry()?.pack(key) {
        return Ok(artifact.snapshot());
    }
    #[cfg(debug_assertions)]
    {
        let entry = debug_pack_entry(key)?;
        let document =
            entry
                .document
                .as_ref()
                .map_err(|message| RegistryError::InvalidDebugPack {
                    key: key.to_string(),
                    message: message.clone(),
                })?;
        PackArtifactSnapshot::from_document(document)
    }
    #[cfg(not(debug_assertions))]
    Err(RegistryError::UnknownPack(key.to_string()))
}

type VerifiedPackArtifact = (String, Arc<domain::ValidatedPack>);
type VerifiedPackArtifactCache = BTreeMap<PackRef, VerifiedPackArtifact>;

static VERIFIED_PACK_ARTIFACTS: OnceLock<Mutex<VerifiedPackArtifactCache>> = OnceLock::new();

/// Authenticate, canonically decode, and semantically validate a game-owned
/// artifact. The cache is content-addressed and compares the exact canonical
/// bytes before reuse, so registry replacement cannot affect a running or
/// archived game and a same-reference byte drift fails closed. The validated
/// artifact (not a bare pack) is what callers keep; after insertion, the cache
/// reuses that one proof-carrying artifact for its content address.
pub fn verify_pack_artifact(
    artifact: &PackArtifactSnapshot,
) -> Result<Arc<domain::ValidatedPack>, RegistryError> {
    if artifact.schema_version != PACK_ARTIFACT_SCHEMA_VERSION {
        return Err(invalid_artifact(
            artifact,
            format!("unsupported schema version {}", artifact.schema_version),
        ));
    }
    let actual_hash = ContentHash::digest(artifact.canonical_json.as_bytes());
    if actual_hash != artifact.pack_ref.content_hash {
        return Err(invalid_artifact(
            artifact,
            format!(
                "content hash mismatch: reference={}, canonical={actual_hash}",
                artifact.pack_ref.content_hash
            ),
        ));
    }

    let cache = VERIFIED_PACK_ARTIFACTS.get_or_init(|| Mutex::new(BTreeMap::new()));
    {
        let cache = cache.lock().map_err(|_| {
            invalid_artifact(artifact, "verified-artifact cache is poisoned".to_string())
        })?;
        if let Some((canonical_json, document)) = cache.get(&artifact.pack_ref) {
            if canonical_json != &artifact.canonical_json {
                return Err(invalid_artifact(
                    artifact,
                    "the same PackRef resolved to different canonical bytes".to_string(),
                ));
            }
            return Ok(Arc::clone(document));
        }
    }

    let document = domain::load_validated_pack_from_json(&artifact.canonical_json)
        .map_err(|error| invalid_artifact(artifact, error.to_string()))?;
    if document.document().name != artifact.pack_ref.key
        || document.document().version != artifact.pack_ref.version
    {
        return Err(invalid_artifact(
            artifact,
            format!(
                "identity drift: reference={}@{}, document={}@{}",
                artifact.pack_ref.key,
                artifact.pack_ref.version,
                document.document().name,
                document.document().version
            ),
        ));
    }
    let canonical = serde_json::to_string(document.document())
        .map_err(|error| invalid_artifact(artifact, error.to_string()))?;
    if canonical != artifact.canonical_json {
        return Err(invalid_artifact(
            artifact,
            "document bytes are not the canonical typed serialization".to_string(),
        ));
    }

    let mut cache = cache.lock().map_err(|_| {
        invalid_artifact(artifact, "verified-artifact cache is poisoned".to_string())
    })?;
    if let Some((canonical_json, cached)) = cache.get(&artifact.pack_ref) {
        if canonical_json != &artifact.canonical_json {
            return Err(invalid_artifact(
                artifact,
                "the same PackRef resolved to different canonical bytes".to_string(),
            ));
        }
        return Ok(Arc::clone(cached));
    }
    cache.insert(
        artifact.pack_ref.clone(),
        (artifact.canonical_json.clone(), Arc::clone(&document)),
    );
    Ok(document)
}

fn invalid_artifact(artifact: &PackArtifactSnapshot, message: String) -> RegistryError {
    RegistryError::InvalidPackArtifact {
        key: artifact.pack_ref.key.clone(),
        message,
    }
}

/// Resolve a previously committed pack identity. Key-only fallback is
/// intentionally absent: a version or content-hash mismatch fails closed.
pub fn resolve_pack(pack_ref: &PackRef) -> Result<&'static Pack, RegistryError> {
    if let Ok(artifact) = product_registry()?.resolve_pack(pack_ref) {
        return Ok(&artifact.document);
    }
    #[cfg(debug_assertions)]
    {
        if let Ok(entry) = debug_pack_entry(&pack_ref.key) {
            if entry.pack_ref == *pack_ref {
                return entry.document.as_ref().map_err(|message| {
                    RegistryError::InvalidDebugPack {
                        key: pack_ref.key.clone(),
                        message: message.clone(),
                    }
                });
            }
        }
        Err(RegistryError::UnknownPackReference {
            key: pack_ref.key.clone(),
            version: pack_ref.version,
            content_hash: pack_ref.content_hash.to_string(),
        })
    }
    #[cfg(not(debug_assertions))]
    Err(RegistryError::UnknownPackReference {
        key: pack_ref.key.clone(),
        version: pack_ref.version,
        content_hash: pack_ref.content_hash.to_string(),
    })
}

#[derive(Debug, Serialize)]
struct ContentCheck<'a> {
    status: &'static str,
    registry_hash: &'a str,
    pack_count: usize,
    program_count: usize,
    packs: Vec<&'a PackRef>,
    programs: Vec<&'a ProgramRef>,
}

/// Deterministic readiness payload used by the exact production-image smoke.
pub fn check_content_json() -> Result<String, RegistryError> {
    let registry = product_registry()?;
    serde_json::to_string(&ContentCheck {
        status: "ok",
        registry_hash: registry.registry_hash().as_str(),
        pack_count: registry.packs().len(),
        program_count: registry.programs().len(),
        packs: registry.packs().iter().map(|item| &item.pack_ref).collect(),
        programs: registry
            .programs()
            .iter()
            .map(|item| &item.program_ref)
            .collect(),
    })
    .map_err(|error| RegistryError::Initialization(error.to_string()))
}

fn build_product_registry() -> Result<ContentRegistry, String> {
    let pack_catalog: PackCatalog = serde_json::from_str(PACK_CATALOG)
        .map_err(|error| format!("decode pack catalog: {error}"))?;
    if pack_catalog.schema_version != 1 {
        return Err(format!(
            "unsupported pack catalog schema {}",
            pack_catalog.schema_version
        ));
    }
    inventory_is_closed(
        "pack",
        pack_catalog.packs.iter().map(|entry| entry.file.as_str()),
        PRODUCT_PACK_SOURCES.iter().map(|(file, _)| *file),
    )?;

    let mut pack_keys = BTreeSet::new();
    let mut packs = Vec::with_capacity(pack_catalog.packs.len());
    for entry in pack_catalog.packs {
        if !pack_keys.insert(entry.key.clone()) {
            return Err(format!("duplicate pack catalog key `{}`", entry.key));
        }
        let raw = embedded(PRODUCT_PACK_SOURCES, &entry.file, "pack")?;
        let document = domain::load_pack_from_json(raw)
            .map_err(|error| format!("validate pack {}: {error}", entry.file))?;
        if document.name != entry.key {
            return Err(format!(
                "pack identity drift in {}: catalog={}, document={}",
                entry.file, entry.key, document.name
            ));
        }
        let canonical_json = serde_json::to_string(&document)
            .map_err(|error| format!("canonicalize pack {}: {error}", entry.key))?;
        packs.push(PackArtifact {
            pack_ref: PackRef {
                key: entry.key,
                version: document.version,
                content_hash: ContentHash::digest(canonical_json.as_bytes()),
            },
            document,
            canonical_json,
        });
    }
    packs.sort_by(|left, right| left.pack_ref.cmp(&right.pack_ref));

    let program_catalog: ProgramCatalog = serde_json::from_str(PROGRAM_CATALOG)
        .map_err(|error| format!("decode program catalog: {error}"))?;
    if program_catalog.schema_version != 1 {
        return Err(format!(
            "unsupported program catalog schema {}",
            program_catalog.schema_version
        ));
    }
    inventory_is_closed(
        "program",
        program_catalog
            .programs
            .iter()
            .map(|entry| entry.file.as_str()),
        PROGRAM_SOURCES.iter().map(|(file, _)| *file),
    )?;

    let mut program_refs = BTreeSet::new();
    let mut programs = Vec::with_capacity(program_catalog.programs.len());
    for entry in program_catalog.programs {
        let raw = embedded(PROGRAM_SOURCES, &entry.file, "program")?;
        let document: DayProgram = serde_json::from_str(raw)
            .map_err(|error| format!("decode program {}: {error}", entry.file))?;
        let actual_ref = document
            .artifact_ref()
            .map_err(|error| format!("validate program {}: {error}", entry.file))?;
        if actual_ref != entry.program_ref {
            return Err(format!(
                "program reference drift in {}: catalog={:?}, canonical={:?}",
                entry.file, entry.program_ref, actual_ref
            ));
        }
        if !program_refs.insert(entry.program_ref.clone()) {
            return Err(format!("duplicate program reference in {}", entry.file));
        }
        programs.push(ProgramArtifact {
            program_ref: entry.program_ref,
            audience: entry.audience,
            document,
        });
    }
    programs.sort_by(|left, right| {
        left.program_ref
            .cmp(&right.program_ref)
            .then(left.audience.cmp(&right.audience))
    });

    let canonical_refs = serde_json::to_vec(&(
        packs
            .iter()
            .map(|artifact| &artifact.pack_ref)
            .collect::<Vec<_>>(),
        programs
            .iter()
            .map(|artifact| (&artifact.program_ref, artifact.audience))
            .collect::<Vec<_>>(),
    ))
    .map_err(|error| format!("canonicalize registry: {error}"))?;
    Ok(ContentRegistry {
        packs,
        programs,
        registry_hash: ContentHash::digest(&canonical_refs),
    })
}

fn inventory_is_closed<'a>(
    kind: &str,
    manifest: impl Iterator<Item = &'a str>,
    embedded_files: impl Iterator<Item = &'a str>,
) -> Result<(), String> {
    let manifest = manifest.map(str::to_string).collect::<BTreeSet<_>>();
    let embedded = embedded_files.map(str::to_string).collect::<BTreeSet<_>>();
    if manifest == embedded {
        Ok(())
    } else {
        Err(format!(
            "{kind} catalog/embed inventory drift: catalog={manifest:?}, embedded={embedded:?}"
        ))
    }
}

fn embedded<'a>(sources: &'a [(&str, &str)], file: &str, kind: &str) -> Result<&'a str, String> {
    sources
        .iter()
        .find_map(|(candidate, raw)| (*candidate == file).then_some(*raw))
        .ok_or_else(|| format!("{kind} catalog references non-embedded file `{file}`"))
}

#[cfg(debug_assertions)]
static DEBUG_PACKS: OnceLock<BTreeMap<&'static str, DebugPackEntry>> = OnceLock::new();

#[cfg(debug_assertions)]
struct DebugPackEntry {
    pack_ref: PackRef,
    document: Result<Pack, String>,
}

#[cfg(debug_assertions)]
fn debug_pack_entry(key: &str) -> Result<&'static DebugPackEntry, RegistryError> {
    let packs = DEBUG_PACKS.get_or_init(|| {
        DEBUG_PACK_SOURCES
            .iter()
            .map(|(fixture_key, raw)| {
                let identity: serde_json::Value = serde_json::from_str(raw)
                    .expect("checked-in debug pack must be syntactically valid JSON");
                let document_key = identity["name"]
                    .as_str()
                    .expect("checked-in debug pack must declare a name");
                assert_eq!(
                    document_key, *fixture_key,
                    "debug pack source identity drift"
                );
                let version = identity["version"]
                    .as_u64()
                    .and_then(|version| u32::try_from(version).ok())
                    .expect("checked-in debug pack must declare a u32 version");
                let document = domain::load_pack_from_json(raw).map_err(|error| error.to_string());
                let content_hash = document
                    .as_ref()
                    .ok()
                    .and_then(|document| serde_json::to_string(document).ok())
                    .map(|canonical| ContentHash::digest(canonical.as_bytes()))
                    .unwrap_or_else(|| ContentHash::digest(raw.as_bytes()));
                (
                    *fixture_key,
                    DebugPackEntry {
                        pack_ref: PackRef {
                            key: (*fixture_key).to_string(),
                            version,
                            // Invalid fixtures still need an immutable identity
                            // so fail-closed runtime validation can be exercised.
                            content_hash,
                        },
                        document,
                    },
                )
            })
            .collect()
    });
    packs
        .get(key)
        .ok_or_else(|| RegistryError::UnknownPack(key.to_string()))
}

#[cfg(debug_assertions)]
const DEBUG_PACK_SOURCES: &[(&str, &str)] = &[
    (
        "dev_test_earliest_reached",
        include_str!("../../../packs/dev_test_earliest_reached/pack.json"),
    ),
    (
        "test_dynamic_vote_effect",
        include_str!("../../../packs/test_dynamic_vote_effect/pack.json"),
    ),
    (
        "test_dynamic_vote_hammer",
        include_str!("../../../packs/test_dynamic_vote_hammer/pack.json"),
    ),
    (
        "test_dynamic_vote_pk",
        include_str!("../../../packs/test_dynamic_vote_pk/pack.json"),
    ),
    (
        "test_dynamic_vote_prompt",
        include_str!("../../../packs/test_dynamic_vote_prompt/pack.json"),
    ),
    (
        "test_guard_witch_killtarget",
        include_str!("../../../packs/test_guard_witch_killtarget/pack.json"),
    ),
    (
        "test_hammer_majority",
        include_str!("../../../packs/test_hammer_majority/pack.json"),
    ),
    (
        "test_instant_window",
        include_str!("../../../packs/test_instant_window/pack.json"),
    ),
    (
        "test_invalid_action_contract",
        include_str!("../../../packs/test_invalid_action_contract/pack.json"),
    ),
    (
        "test_invalid_effect_contract",
        include_str!("../../../packs/test_invalid_effect_contract/pack.json"),
    ),
    (
        "test_invalid_generated_kill_ownership",
        include_str!("../../../packs/test_invalid_generated_kill_ownership/pack.json"),
    ),
    (
        "test_invalid_precedence",
        include_str!("../../../packs/test_invalid_precedence/pack.json"),
    ),
    (
        "test_invalid_reference_contract",
        include_str!("../../../packs/test_invalid_reference_contract/pack.json"),
    ),
    (
        "test_invalid_target_state_policy",
        include_str!("../../../packs/test_invalid_target_state_policy/pack.json"),
    ),
    (
        "test_invalid_target_window_contract",
        include_str!("../../../packs/test_invalid_target_window_contract/pack.json"),
    ),
    (
        "test_invalid_trigger_reference_contract",
        include_str!("../../../packs/test_invalid_trigger_reference_contract/pack.json"),
    ),
    (
        "test_invalid_win_policy_contract",
        include_str!("../../../packs/test_invalid_win_policy_contract/pack.json"),
    ),
    (
        "test_ita_buffered",
        include_str!("../../../packs/test_ita_buffered/pack.json"),
    ),
    (
        "test_no_lynch_forbidden",
        include_str!("../../../packs/test_no_lynch_forbidden/pack.json"),
    ),
    (
        "test_precedence_order_contract",
        include_str!("../../../packs/test_precedence_order_contract/pack.json"),
    ),
    (
        "test_role_tiebreaker_vote",
        include_str!("../../../packs/test_role_tiebreaker_vote/pack.json"),
    ),
    (
        "test_skip_next_day_day_only",
        include_str!("../../../packs/test_skip_next_day_day_only/pack.json"),
    ),
    (
        "test_trigger_loop_cap",
        include_str!("../../../packs/test_trigger_loop_cap/pack.json"),
    ),
    (
        "test_twilight_window",
        include_str!("../../../packs/test_twilight_window/pack.json"),
    ),
    (
        "test_unsupported_ir_version",
        include_str!("../../../packs/test_unsupported_ir_version/pack.json"),
    ),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn product_registry_is_closed_validated_and_deterministic() {
        let registry = product_registry().unwrap();
        assert_eq!(registry.packs().len(), 5);
        assert_eq!(registry.programs().len(), 5);
        assert_eq!(registry.registry_hash().as_str().len(), 64);
        assert_eq!(check_content_json().unwrap(), check_content_json().unwrap());
    }

    #[test]
    fn references_fail_closed_on_content_hash_drift() {
        let registry = product_registry().unwrap();
        let artifact = registry
            .resolve_identity("raffle", 1, ProgramAudience::Product)
            .unwrap();
        let mut wrong = artifact.program_ref.clone();
        wrong.content_hash = game_platform::ProgramContentHash::new("0".repeat(64)).unwrap();
        assert!(matches!(
            registry.resolve(&wrong, ProgramAudience::Product),
            Err(RegistryError::UnknownProgramReference { .. })
        ));
    }

    #[test]
    fn pack_references_fail_closed_on_content_hash_drift() {
        let pack_ref = pack_ref("mafiascum").unwrap();
        assert_eq!(resolve_pack(pack_ref).unwrap().name, "mafiascum");
        let mut wrong = pack_ref.clone();
        wrong.content_hash = ContentHash::new("0".repeat(64)).unwrap();
        assert!(matches!(
            resolve_pack(&wrong),
            Err(RegistryError::UnknownPackReference { .. })
        ));
    }

    #[test]
    fn canonical_pack_artifact_opens_without_registry_resolution() {
        let artifact = select_pack_artifact("mafiascum").unwrap();
        let opened = verify_pack_artifact(&artifact).unwrap();
        let reopened = verify_pack_artifact(&artifact).unwrap();
        assert_eq!(opened.document().name, "mafiascum");
        assert_eq!(opened.document().version, artifact.pack_ref.version);
        assert!(Arc::ptr_eq(&opened, &reopened));
        assert_eq!(
            ContentHash::digest(artifact.canonical_json.as_bytes()),
            artifact.pack_ref.content_hash
        );
    }

    #[test]
    fn same_reference_with_drifted_artifact_bytes_fails_closed() {
        let mut artifact = select_pack_artifact("mafiascum").unwrap();
        artifact.canonical_json = artifact.canonical_json.replacen(
            "\"name\":\"mafiascum\"",
            "\"name\":\"removed_pack\"",
            1,
        );
        assert!(matches!(
            verify_pack_artifact(&artifact),
            Err(RegistryError::InvalidPackArtifact { .. })
        ));
    }

    #[test]
    fn recomputed_hash_cannot_hide_key_or_canonical_encoding_drift() {
        let mut identity_drift = select_pack_artifact("mafiascum").unwrap();
        identity_drift.canonical_json = identity_drift.canonical_json.replacen(
            "\"name\":\"mafiascum\"",
            "\"name\":\"other_pack\"",
            1,
        );
        identity_drift.pack_ref.content_hash =
            ContentHash::digest(identity_drift.canonical_json.as_bytes());
        assert!(matches!(
            verify_pack_artifact(&identity_drift),
            Err(RegistryError::InvalidPackArtifact { .. })
        ));

        let mut noncanonical = select_pack_artifact("mafia_universe").unwrap();
        noncanonical.canonical_json.push(' ');
        noncanonical.pack_ref.content_hash =
            ContentHash::digest(noncanonical.canonical_json.as_bytes());
        assert!(matches!(
            verify_pack_artifact(&noncanonical),
            Err(RegistryError::InvalidPackArtifact { .. })
        ));
    }

    #[test]
    fn debug_fixtures_share_the_embedded_resolution_seam() {
        let debug_ref = pack_ref("test_twilight_window").unwrap();
        assert_eq!(
            resolve_pack(debug_ref).unwrap().name,
            "test_twilight_window"
        );
        let invalid_ref = pack_ref("test_invalid_precedence").unwrap();
        assert!(matches!(
            resolve_pack(invalid_ref),
            Err(RegistryError::InvalidDebugPack { .. })
        ));
    }
}
