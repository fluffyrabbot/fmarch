//! Deterministic, private media variants committed by a manifest installed last.

use std::fmt;
use std::fs::File;
use std::io::{self, Cursor, Read, Write};
use std::path::{Path, PathBuf};

use image::codecs::avif::{AvifEncoder, ColorSpace};
use image::codecs::webp::WebPEncoder;
use image::imageops::FilterType;
use image::{ExtendedColorType, GenericImageView, ImageEncoder, ImageFormat, RgbaImage};
use rustix::fs::{AtFlags, OFlags};
use serde::{Deserialize, Serialize};

use super::*;

/// Any change to dimensions, geometry rounding, resize filter, alpha handling, encoder settings,
/// codec versions, storage layout, or manifest schema must mint a new recipe revision.
pub const VARIANT_RECIPE_REVISION: &str =
    "v1-img02510-ravif0130-q72-s6-t1-webp024-lossless-lanczos3-pmul-floor";
const MANIFEST_SCHEMA: &str = "fmarch.media.variants.v1";
const MANIFEST_NAME: &str = "manifest.json";
const MANIFEST_MAX_BYTES: u64 = 32 * 1024;
const AVIF_SPEED: u8 = 6;
const AVIF_QUALITY: u8 = 72;
const VARIANT_COUNT: usize = 6;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VariantFormat {
    Avif,
    Webp,
}

impl VariantFormat {
    pub const ALL: [Self; 2] = [Self::Avif, Self::Webp];

    pub fn mime_type(self) -> &'static str {
        match self {
            Self::Avif => "image/avif",
            Self::Webp => "image/webp",
        }
    }

    fn component(self) -> &'static str {
        match self {
            Self::Avif => "avif",
            Self::Webp => "webp",
        }
    }
}

impl fmt::Display for VariantFormat {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.component())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VariantKind {
    Thumb,
    Tablet,
    FullBounded,
}

impl VariantKind {
    pub const ALL: [Self; 3] = [Self::Thumb, Self::Tablet, Self::FullBounded];

    pub fn maximum_dimensions(self) -> (u32, u32) {
        match self {
            Self::Thumb => (256, 256),
            Self::Tablet => (1_280, 1_280),
            Self::FullBounded => (2_560, 2_560),
        }
    }

    fn component(self) -> &'static str {
        match self {
            Self::Thumb => "thumb",
            Self::Tablet => "tablet",
            Self::FullBounded => "full-bounded",
        }
    }
}

impl fmt::Display for VariantKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.component())
    }
}

/// A path-safe immutable key derived only from typed policy inputs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct VariantKey {
    source: ContentId,
    format: VariantFormat,
    kind: VariantKind,
}

impl VariantKey {
    pub fn source(self) -> ContentId {
        self.source
    }

    pub fn format(self) -> VariantFormat {
        self.format
    }

    pub fn kind(self) -> VariantKind {
        self.kind
    }
}

impl fmt::Display for VariantKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{}/{VARIANT_RECIPE_REVISION}/{}/{}",
            self.source, self.format, self.kind
        )
    }
}

/// Hard bounds on each resized raster, each encoded member, and the complete encoded set.
/// Codec workspace and total process memory are not strictly capped by these values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VariantLimits {
    max_width: u32,
    max_height: u32,
    max_pixels: u64,
    max_member_encoded_bytes: usize,
    max_total_encoded_bytes: u64,
}

impl VariantLimits {
    pub fn new(
        max_width: u32,
        max_height: u32,
        max_pixels: u64,
        max_member_encoded_bytes: usize,
        max_total_encoded_bytes: u64,
    ) -> Result<Self, MediaError> {
        let limits = Self {
            max_width,
            max_height,
            max_pixels,
            max_member_encoded_bytes,
            max_total_encoded_bytes,
        };
        limits.validate()?;
        Ok(limits)
    }

    pub fn max_width(self) -> u32 {
        self.max_width
    }

    pub fn max_height(self) -> u32 {
        self.max_height
    }

    pub fn max_pixels(self) -> u64 {
        self.max_pixels
    }

    pub fn max_member_encoded_bytes(self) -> usize {
        self.max_member_encoded_bytes
    }

    pub fn max_total_encoded_bytes(self) -> u64 {
        self.max_total_encoded_bytes
    }

    fn validate(self) -> Result<(), MediaError> {
        if self.max_width == 0 {
            return Err(MediaError::InvalidVariantLimits(
                "max_width must be non-zero",
            ));
        }
        if self.max_height == 0 {
            return Err(MediaError::InvalidVariantLimits(
                "max_height must be non-zero",
            ));
        }
        if self.max_pixels == 0 {
            return Err(MediaError::InvalidVariantLimits(
                "max_pixels must be non-zero",
            ));
        }
        if self.max_member_encoded_bytes == 0 {
            return Err(MediaError::InvalidVariantLimits(
                "max_member_encoded_bytes must be non-zero",
            ));
        }
        if self.max_total_encoded_bytes == 0 {
            return Err(MediaError::InvalidVariantLimits(
                "max_total_encoded_bytes must be non-zero",
            ));
        }
        Ok(())
    }
}

impl Default for VariantLimits {
    fn default() -> Self {
        Self {
            max_width: 2_560,
            max_height: 2_560,
            max_pixels: 6_553_600,
            max_member_encoded_bytes: 16 * 1024 * 1024,
            max_total_encoded_bytes: 64 * 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VariantRecord {
    key: VariantKey,
    width: u32,
    height: u32,
    encoded_len: u64,
    blake3: ContentId,
    has_alpha: bool,
}

impl VariantRecord {
    pub fn key(&self) -> VariantKey {
        self.key
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn encoded_len(&self) -> u64 {
        self.encoded_len
    }

    pub fn blake3(&self) -> ContentId {
        self.blake3
    }

    pub fn has_alpha(&self) -> bool {
        self.has_alpha
    }

    pub fn mime_type(&self) -> &'static str {
        self.key.format.mime_type()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VariantSet {
    source: ContentId,
    source_width: u32,
    source_height: u32,
    variants: Vec<VariantRecord>,
}

impl VariantSet {
    pub fn source(&self) -> ContentId {
        self.source
    }

    pub fn source_width(&self) -> u32 {
        self.source_width
    }

    pub fn source_height(&self) -> u32 {
        self.source_height
    }

    pub fn variants(&self) -> &[VariantRecord] {
        &self.variants
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredVariant {
    record: VariantRecord,
    encoded_bytes: Vec<u8>,
}

impl StoredVariant {
    pub fn record(&self) -> &VariantRecord {
        &self.record
    }

    pub fn encoded_bytes(&self) -> &[u8] {
        &self.encoded_bytes
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VariantGenerationStatus {
    Stored,
    AlreadyPresent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VariantGenerationResult {
    set: VariantSet,
    status: VariantGenerationStatus,
}

impl VariantGenerationResult {
    pub fn set(&self) -> &VariantSet {
        &self.set
    }

    pub fn status(&self) -> VariantGenerationStatus {
        self.status
    }
}

struct PreparedVariant {
    record: VariantRecord,
    encoded_bytes: Vec<u8>,
}

struct PreparedVariantSet {
    set: VariantSet,
    members: Vec<PreparedVariant>,
    manifest: Vec<u8>,
}

/// Fully decoded, canonicalized, resized, encoded, and validated upload with no filesystem
/// effects yet. Client-controlled validation failures therefore occur before persistence.
pub struct PreparedMediaUpload {
    handle: MediaHandle,
    canonical_bytes: Vec<u8>,
    variants: PreparedVariantSet,
}

impl fmt::Debug for PreparedMediaUpload {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PreparedMediaUpload")
            .field("handle", &self.handle)
            .field("variant_set", &self.variants.set)
            .finish_non_exhaustive()
    }
}

impl PreparedMediaUpload {
    pub fn handle(&self) -> MediaHandle {
        self.handle
    }

    pub fn variant_set(&self) -> &VariantSet {
        &self.variants.set
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaUploadCommitResult {
    ingest: IngestResult,
    variants: VariantGenerationResult,
}

impl MediaUploadCommitResult {
    pub fn ingest(&self) -> IngestResult {
        self.ingest
    }

    pub fn variants(&self) -> &VariantGenerationResult {
        &self.variants
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct DiskManifest {
    schema: String,
    source_id: String,
    source_width: u32,
    source_height: u32,
    recipe_revision: String,
    variants: Vec<DiskVariant>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct DiskVariant {
    format: VariantFormat,
    kind: VariantKind,
    mime: String,
    width: u32,
    height: u32,
    encoded_len: u64,
    blake3: String,
    has_alpha: bool,
}

struct OpenVariantSnapshot {
    id_directory: File,
    recipe_directory: File,
    manifest_file: File,
    set: VariantSet,
}

struct VerifiedVariantSnapshot {
    set: VariantSet,
    requested: Option<StoredVariant>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VariantLookupStage {
    ManifestOpened,
    MemberVerified(usize),
    MembersVerified,
}

impl MediaStore {
    /// Perform every client-controlled decode, canonicalization, resize, encode, and output-limit
    /// check without creating a content directory or retaining bytes.
    pub fn prepare_upload(
        &self,
        encoded: &[u8],
        limits: VariantLimits,
    ) -> Result<PreparedMediaUpload, MediaError> {
        limits.validate()?;
        let decoded = self.decode_bounded(encoded)?;
        let canonical_bytes = canonical_raster_bytes(decoded)?;
        let id = ContentId::from_bytes(*blake3::hash(&canonical_bytes).as_bytes());
        let (width, height) = parse_canonical_header(&canonical_bytes)
            .map_err(|reason| MediaError::CorruptStoredRaster { id, reason })?;
        let handle = MediaHandle { id, width, height };
        let variants =
            prepare_variant_set(handle, &canonical_bytes[CANONICAL_HEADER_BYTES..], limits)?;
        Ok(PreparedMediaUpload {
            handle,
            canonical_bytes,
            variants,
        })
    }

    /// Persist an already validated upload. The canonical record is installed first and the
    /// precomputed six-member manifest-backed set is committed last.
    pub fn commit_prepared_upload(
        &self,
        prepared: PreparedMediaUpload,
    ) -> Result<MediaUploadCommitResult, MediaError> {
        let PreparedMediaUpload {
            handle,
            canonical_bytes,
            variants,
        } = prepared;
        let ingest_status = self.persist(&handle, &canonical_bytes)?;
        let ingest = IngestResult {
            handle,
            status: ingest_status,
        };
        let id_directory = self.open_id_directory(handle.id, false)?.ok_or_else(|| {
            corrupt_set(handle.id, "id directory vanished after canonical commit")
        })?;
        let variants =
            self.persist_prepared_variant_set(handle.id, &id_directory, variants, false)?;
        Ok(MediaUploadCommitResult { ingest, variants })
    }

    /// Generate the fixed six-member variant set, installing the manifest only after every member
    /// is durably persisted and fully reverified.
    pub fn generate_variants(
        &self,
        id: ContentId,
        limits: VariantLimits,
    ) -> Result<VariantGenerationResult, MediaError> {
        limits.validate()?;
        if let Some(set) = self.lookup_variant_set(id, limits)? {
            return Ok(VariantGenerationResult {
                set,
                status: VariantGenerationStatus::AlreadyPresent,
            });
        }
        // With no manifest there is no committed set. Verified crash leftovers may be reused and
        // missing members may be created, but immutable conflicting bytes fail closed. Only the
        // explicit regeneration API may replace corruption.
        self.generate_variants_inner(id, limits, false)
    }

    /// Remove only the completeness marker, then repair/reuse typed members from the verified
    /// canonical `orig` and atomically commit a fresh manifest. This is safe after process restart.
    pub fn regenerate_variants(
        &self,
        id: ContentId,
        limits: VariantLimits,
    ) -> Result<VariantGenerationResult, MediaError> {
        limits.validate()?;
        self.lookup(id)?
            .ok_or_else(|| corrupt_set(id, "canonical orig is missing"))?;
        self.remove_variant_manifest(id)?;
        self.generate_variants_inner(id, limits, true)
    }

    /// Return a complete set only when the canonical manifest and all six members verify.
    pub fn lookup_variant_set(
        &self,
        id: ContentId,
        limits: VariantLimits,
    ) -> Result<Option<VariantSet>, MediaError> {
        let verified = self.lookup_variant_snapshot_with_hook(id, limits, None, |_| Ok(()))?;
        Ok(verified.map(|snapshot| snapshot.set))
    }

    /// Load one member, but only from a fully verified manifest-backed set.
    pub fn lookup_variant(
        &self,
        id: ContentId,
        format: VariantFormat,
        kind: VariantKind,
        limits: VariantLimits,
    ) -> Result<Option<StoredVariant>, MediaError> {
        let verified =
            self.lookup_variant_snapshot_with_hook(id, limits, Some((format, kind)), |_| Ok(()))?;
        Ok(verified.and_then(|snapshot| snapshot.requested))
    }

    fn lookup_variant_snapshot_with_hook<F>(
        &self,
        id: ContentId,
        limits: VariantLimits,
        requested: Option<(VariantFormat, VariantKind)>,
        mut hook: F,
    ) -> Result<Option<VerifiedVariantSnapshot>, MediaError>
    where
        F: FnMut(VariantLookupStage) -> Result<(), MediaError>,
    {
        limits.validate()?;
        let Some(snapshot) = self.open_variant_snapshot(id)? else {
            return Ok(None);
        };
        hook(VariantLookupStage::ManifestOpened)?;

        let raster = self
            .lookup(id)?
            .ok_or_else(|| corrupt_set(id, "manifest exists without a verified canonical orig"))?;
        if (snapshot.set.source_width, snapshot.set.source_height)
            != (raster.handle().width(), raster.handle().height())
        {
            return Err(corrupt_set(
                id,
                "manifest source dimensions do not match canonical orig",
            ));
        }
        let mut aggregate = 0_u64;
        let mut requested_variant = None;
        for (index, record) in snapshot.set.variants.iter().enumerate() {
            let expected_dimensions = fitted_dimensions(
                raster.handle().width(),
                raster.handle().height(),
                record.key.kind.maximum_dimensions(),
            )?;
            if (record.width, record.height) != expected_dimensions {
                return Err(corrupt_set(
                    id,
                    &format!("{} dimensions do not match the fixed policy", record.key),
                ));
            }
            let bytes = self.read_variant_member_from_snapshot(
                id,
                &snapshot.id_directory,
                &snapshot.recipe_directory,
                record,
                limits,
            )?;
            aggregate = aggregate
                .checked_add(bytes.len() as u64)
                .ok_or_else(|| corrupt_set(id, "variant aggregate encoded length overflow"))?;
            if aggregate > limits.max_total_encoded_bytes {
                return Err(MediaError::VariantAggregateBytesExceeded {
                    id,
                    max: limits.max_total_encoded_bytes,
                });
            }
            if requested == Some((record.key.format, record.key.kind)) {
                requested_variant = Some(StoredVariant {
                    record: record.clone(),
                    encoded_bytes: bytes,
                });
            }
            hook(VariantLookupStage::MemberVerified(index))?;
        }
        if requested.is_some() && requested_variant.is_none() {
            return Err(corrupt_set(
                id,
                "requested role is absent from the fixed manifest",
            ));
        }
        hook(VariantLookupStage::MembersVerified)?;

        // The exact manifest inode opened before the scan is the commit token. These are the final
        // filesystem operations before success: a removed/replaced marker or detached ancestor
        // invalidates the entire snapshot even when all old member descriptors remained readable.
        self.verify_variant_snapshot_attached(id, &snapshot)?;
        Ok(Some(VerifiedVariantSnapshot {
            set: snapshot.set,
            requested: requested_variant,
        }))
    }

    fn open_variant_snapshot(
        &self,
        id: ContentId,
    ) -> Result<Option<OpenVariantSnapshot>, MediaError> {
        let Some(id_directory) = self.open_id_directory(id, false)? else {
            return Ok(None);
        };
        let Some(recipe_directory) = self.open_recipe_directory(id, &id_directory, false)? else {
            return Ok(None);
        };
        let manifest_path = self.recipe_path(id).join(MANIFEST_NAME);
        let Some(manifest_file) =
            open_regular_file(&recipe_directory, MANIFEST_NAME, &manifest_path)?
        else {
            return Ok(None);
        };
        let manifest_bytes = read_capped_attached(
            &recipe_directory,
            MANIFEST_NAME,
            manifest_file.try_clone()?,
            &manifest_path,
            MANIFEST_MAX_BYTES,
            id,
            "manifest",
        )?;
        let set = parse_manifest(id, &manifest_bytes)?;
        Ok(Some(OpenVariantSnapshot {
            id_directory,
            recipe_directory,
            manifest_file,
            set,
        }))
    }

    fn verify_variant_snapshot_attached(
        &self,
        id: ContentId,
        snapshot: &OpenVariantSnapshot,
    ) -> Result<(), MediaError> {
        verify_attached_entry(
            &snapshot.recipe_directory,
            MANIFEST_NAME,
            &snapshot.manifest_file,
            &self.recipe_path(id).join(MANIFEST_NAME),
        )?;
        self.verify_recipe_attached(id, &snapshot.id_directory, &snapshot.recipe_directory)?;
        self.verify_id_attached(id, &snapshot.id_directory)?;
        self.verify_store_attached()
    }

    fn generate_variants_inner(
        &self,
        id: ContentId,
        limits: VariantLimits,
        repair: bool,
    ) -> Result<VariantGenerationResult, MediaError> {
        let raster = self
            .lookup(id)?
            .ok_or_else(|| corrupt_set(id, "canonical orig is missing"))?;
        let id_directory = self
            .open_id_directory(id, false)?
            .ok_or_else(|| corrupt_set(id, "id directory vanished after orig lookup"))?;
        let prepared = prepare_variant_set(raster.handle(), raster.rgba8_pixels(), limits)?;
        self.persist_prepared_variant_set(id, &id_directory, prepared, repair)
    }

    fn persist_prepared_variant_set(
        &self,
        id: ContentId,
        id_directory: &File,
        prepared: PreparedVariantSet,
        repair: bool,
    ) -> Result<VariantGenerationResult, MediaError> {
        let PreparedVariantSet {
            set,
            members,
            manifest,
        } = prepared;
        let recipe_directory = self
            .open_recipe_directory(id, id_directory, true)?
            .expect("create=true always opens recipe directory");
        for member in &members {
            let format_directory = self
                .open_format_directory(id, &recipe_directory, member.record.key.format, true)?
                .expect("create=true always opens format directory");
            self.persist_variant_member(
                id_directory,
                &recipe_directory,
                &format_directory,
                &member.record,
                &member.encoded_bytes,
                repair,
            )?;
        }
        let stored = persist_named_bytes(
            &recipe_directory,
            MANIFEST_NAME,
            &self.recipe_path(id).join(MANIFEST_NAME),
            &manifest,
            false,
            |existing| {
                parse_manifest(id, existing)?;
                if existing != manifest {
                    return Err(corrupt_set(id, "existing manifest bytes differ"));
                }
                Ok(())
            },
        )?;
        sync_fd(&recipe_directory)?;
        self.verify_recipe_attached(id, id_directory, &recipe_directory)?;
        self.verify_id_attached(id, id_directory)?;
        self.verify_store_attached()?;

        Ok(VariantGenerationResult {
            set,
            status: if stored {
                VariantGenerationStatus::Stored
            } else {
                VariantGenerationStatus::AlreadyPresent
            },
        })
    }

    fn persist_variant_member(
        &self,
        id_directory: &File,
        recipe_directory: &File,
        format_directory: &File,
        record: &VariantRecord,
        encoded: &[u8],
        repair: bool,
    ) -> Result<(), MediaError> {
        let id = record.key.source;
        let logical_path = self.variant_path(record.key);
        persist_named_bytes(
            format_directory,
            record.key.kind.component(),
            &logical_path,
            encoded,
            repair,
            |existing| verify_member_bytes(id, record, existing),
        )?;
        let reopened =
            open_regular_file(format_directory, record.key.kind.component(), &logical_path)?
                .ok_or_else(|| corrupt_set(id, "variant vanished immediately after persistence"))?;
        let bytes = read_capped_attached(
            format_directory,
            record.key.kind.component(),
            reopened,
            &logical_path,
            record.encoded_len,
            id,
            "variant",
        )?;
        verify_member_bytes(id, record, &bytes)?;
        self.verify_format_attached(id, recipe_directory, record.key.format, format_directory)?;
        self.verify_recipe_attached(id, id_directory, recipe_directory)
    }

    fn read_variant_member_from_snapshot(
        &self,
        id: ContentId,
        id_directory: &File,
        recipe_directory: &File,
        record: &VariantRecord,
        limits: VariantLimits,
    ) -> Result<Vec<u8>, MediaError> {
        if record.encoded_len > limits.max_member_encoded_bytes as u64 {
            return Err(MediaError::VariantEncodedBytesExceeded {
                key: record.key,
                max: limits.max_member_encoded_bytes,
            });
        }
        check_variant_dimensions(record.key, record.width, record.height, limits)?;
        let format_directory = self
            .open_format_directory(id, recipe_directory, record.key.format, false)?
            .ok_or_else(|| corrupt_set(id, "manifest format directory is missing"))?;
        let logical_path = self.variant_path(record.key);
        let file = open_regular_file(
            &format_directory,
            record.key.kind.component(),
            &logical_path,
        )?
        .ok_or_else(|| corrupt_set(id, &format!("manifest member {} is missing", record.key)))?;
        let bytes = read_capped_attached(
            &format_directory,
            record.key.kind.component(),
            file,
            &logical_path,
            record.encoded_len,
            id,
            "variant",
        )?;
        verify_member_bytes(id, record, &bytes)?;
        self.verify_format_attached(id, recipe_directory, record.key.format, &format_directory)?;
        self.verify_recipe_attached(id, id_directory, recipe_directory)?;
        Ok(bytes)
    }

    fn remove_variant_manifest(&self, id: ContentId) -> Result<(), MediaError> {
        let Some(id_directory) = self.open_id_directory(id, false)? else {
            return Ok(());
        };
        let Some(recipe_directory) = self.open_recipe_directory(id, &id_directory, false)? else {
            return Ok(());
        };
        let path = self.recipe_path(id).join(MANIFEST_NAME);
        if let Some(file) = open_regular_file(&recipe_directory, MANIFEST_NAME, &path)? {
            verify_attached_entry(&recipe_directory, MANIFEST_NAME, &file, &path)?;
            rustix::fs::unlinkat(&recipe_directory, MANIFEST_NAME, AtFlags::empty())
                .map_err(std::io::Error::from)?;
            sync_fd(&recipe_directory)?;
        }
        self.verify_recipe_attached(id, &id_directory, &recipe_directory)
    }

    fn recipe_path(&self, id: ContentId) -> PathBuf {
        self.id_path(id).join(VARIANT_RECIPE_REVISION)
    }

    fn variant_path(&self, key: VariantKey) -> PathBuf {
        self.recipe_path(key.source)
            .join(key.format.component())
            .join(key.kind.component())
    }

    fn open_recipe_directory(
        &self,
        id: ContentId,
        id_directory: &File,
        create: bool,
    ) -> Result<Option<File>, MediaError> {
        let path = self.recipe_path(id);
        let opened = open_child_directory(id_directory, VARIANT_RECIPE_REVISION, &path, create)?;
        if let Some(directory) = &opened {
            self.verify_recipe_attached(id, id_directory, directory)?;
        }
        Ok(opened)
    }

    fn open_format_directory(
        &self,
        id: ContentId,
        recipe_directory: &File,
        format: VariantFormat,
        create: bool,
    ) -> Result<Option<File>, MediaError> {
        let path = self.recipe_path(id).join(format.component());
        let opened = open_child_directory(recipe_directory, format.component(), &path, create)?;
        if let Some(directory) = &opened {
            self.verify_format_attached(id, recipe_directory, format, directory)?;
        }
        Ok(opened)
    }

    fn verify_recipe_attached(
        &self,
        id: ContentId,
        id_directory: &File,
        directory: &File,
    ) -> Result<(), MediaError> {
        verify_attached_entry(
            id_directory,
            VARIANT_RECIPE_REVISION,
            directory,
            &self.recipe_path(id),
        )
    }

    fn verify_format_attached(
        &self,
        id: ContentId,
        recipe_directory: &File,
        format: VariantFormat,
        directory: &File,
    ) -> Result<(), MediaError> {
        verify_attached_entry(
            recipe_directory,
            format.component(),
            directory,
            &self.recipe_path(id).join(format.component()),
        )
    }
}

fn prepare_variant_set(
    handle: MediaHandle,
    rgba8_pixels: &[u8],
    limits: VariantLimits,
) -> Result<PreparedVariantSet, MediaError> {
    limits.validate()?;
    let id = handle.id();
    let mut records = Vec::with_capacity(VARIANT_COUNT);
    let mut members = Vec::with_capacity(VARIANT_COUNT);
    let mut aggregate = 0_u64;
    for format in VariantFormat::ALL {
        for kind in VariantKind::ALL {
            let key = VariantKey {
                source: id,
                format,
                kind,
            };
            let (width, height) =
                fitted_dimensions(handle.width(), handle.height(), kind.maximum_dimensions())?;
            check_variant_dimensions(key, width, height, limits)?;
            let resized =
                resize_premultiplied(rgba8_pixels, handle.width(), handle.height(), width, height)?;
            let has_alpha = resized.chunks_exact(4).any(|pixel| pixel[3] != 255);
            let encoded = encode_variant(key, &resized, width, height, has_alpha, limits)?;
            aggregate = aggregate.checked_add(encoded.len() as u64).ok_or(
                MediaError::VariantAggregateBytesExceeded {
                    id,
                    max: limits.max_total_encoded_bytes,
                },
            )?;
            if aggregate > limits.max_total_encoded_bytes {
                return Err(MediaError::VariantAggregateBytesExceeded {
                    id,
                    max: limits.max_total_encoded_bytes,
                });
            }
            let record = VariantRecord {
                key,
                width,
                height,
                encoded_len: encoded.len() as u64,
                blake3: ContentId::from_bytes(*blake3::hash(&encoded).as_bytes()),
                has_alpha,
            };
            members.push(PreparedVariant {
                record: record.clone(),
                encoded_bytes: encoded,
            });
            records.push(record);
        }
    }
    let set = VariantSet {
        source: id,
        source_width: handle.width(),
        source_height: handle.height(),
        variants: records,
    };
    let manifest = serialize_manifest(&set)?;
    Ok(PreparedVariantSet {
        set,
        members,
        manifest,
    })
}

fn fitted_dimensions(
    width: u32,
    height: u32,
    (max_width, max_height): (u32, u32),
) -> Result<(u32, u32), MediaError> {
    if width == 0 || height == 0 || max_width == 0 || max_height == 0 {
        return Err(MediaError::InvalidVariantLimits(
            "fit dimensions must be non-zero",
        ));
    }
    if width <= max_width && height <= max_height {
        return Ok((width, height));
    }
    let width_limited =
        u64::from(width) * u64::from(max_height) > u64::from(height) * u64::from(max_width);
    if width_limited {
        let fitted_height = (u64::from(height) * u64::from(max_width) / u64::from(width)).max(1);
        Ok((max_width, fitted_height as u32))
    } else {
        let fitted_width = (u64::from(width) * u64::from(max_height) / u64::from(height)).max(1);
        Ok((fitted_width as u32, max_height))
    }
}

fn check_variant_dimensions(
    key: VariantKey,
    width: u32,
    height: u32,
    limits: VariantLimits,
) -> Result<(), MediaError> {
    if width == 0 || height == 0 || width > limits.max_width || height > limits.max_height {
        return Err(MediaError::VariantDimensionsExceeded { key, width, height });
    }
    let pixels = u64::from(width) * u64::from(height);
    if pixels > limits.max_pixels {
        return Err(MediaError::VariantPixelCountExceeded {
            key,
            pixels,
            max_pixels: limits.max_pixels,
        });
    }
    Ok(())
}

fn resize_premultiplied(
    source: &[u8],
    source_width: u32,
    source_height: u32,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, MediaError> {
    let mut premultiplied = Vec::new();
    premultiplied.try_reserve_exact(source.len()).map_err(|_| {
        MediaError::CanonicalAllocationFailed {
            bytes: source.len(),
        }
    })?;
    for pixel in source.chunks_exact(4) {
        let alpha = u16::from(pixel[3]);
        premultiplied.push(((u16::from(pixel[0]) * alpha + 127) / 255) as u8);
        premultiplied.push(((u16::from(pixel[1]) * alpha + 127) / 255) as u8);
        premultiplied.push(((u16::from(pixel[2]) * alpha + 127) / 255) as u8);
        premultiplied.push(pixel[3]);
    }
    let image = RgbaImage::from_raw(source_width, source_height, premultiplied)
        .ok_or_else(|| MediaError::MalformedImage("canonical RGBA length mismatch".to_owned()))?;
    let resized = if source_width == width && source_height == height {
        image
    } else {
        image::imageops::resize(&image, width, height, FilterType::Lanczos3)
    };
    let mut output = resized.into_raw();
    for pixel in output.chunks_exact_mut(4) {
        let alpha = u16::from(pixel[3]);
        if alpha == 0 {
            pixel[..3].fill(0);
        } else {
            for channel in &mut pixel[..3] {
                *channel = (u16::from(*channel) * 255 + alpha / 2)
                    .checked_div(alpha)
                    .expect("the zero-alpha branch was handled")
                    .min(255) as u8;
            }
        }
    }
    Ok(output)
}

fn encode_variant(
    key: VariantKey,
    pixels: &[u8],
    width: u32,
    height: u32,
    has_alpha: bool,
    limits: VariantLimits,
) -> Result<Vec<u8>, MediaError> {
    let mut output = CappedWriter::new(limits.max_member_encoded_bytes);
    let result = match key.format {
        VariantFormat::Avif => {
            AvifEncoder::new_with_speed_quality(&mut output, AVIF_SPEED, AVIF_QUALITY)
                .with_colorspace(ColorSpace::Srgb)
                .with_num_threads(Some(1))
                .write_image(pixels, width, height, ExtendedColorType::Rgba8)
        }
        VariantFormat::Webp => WebPEncoder::new_lossless(&mut output).write_image(
            pixels,
            width,
            height,
            ExtendedColorType::Rgba8,
        ),
    };
    if output.exceeded {
        return Err(MediaError::VariantEncodedBytesExceeded {
            key,
            max: limits.max_member_encoded_bytes,
        });
    }
    result.map_err(|error| MediaError::VariantEncoding {
        key,
        reason: error.to_string(),
    })?;
    let bytes = output.into_inner();
    validate_encoded_variant(key, &bytes, width, height, has_alpha)?;
    Ok(bytes)
}

fn validate_encoded_variant(
    key: VariantKey,
    bytes: &[u8],
    width: u32,
    height: u32,
    has_alpha: bool,
) -> Result<(), MediaError> {
    match key.format {
        VariantFormat::Avif => {
            let parsed = avif_parse::read_avif(&mut Cursor::new(bytes)).map_err(|error| {
                MediaError::VariantEncoding {
                    key,
                    reason: format!("invalid AVIF container: {error}"),
                }
            })?;
            if parsed.primary_item.is_empty() {
                return Err(MediaError::VariantEncoding {
                    key,
                    reason: "AVIF has no primary AV1 item".to_owned(),
                });
            }
            let metadata =
                parsed
                    .primary_item_metadata()
                    .map_err(|error| MediaError::VariantEncoding {
                        key,
                        reason: format!("invalid AVIF AV1 primary item: {error}"),
                    })?;
            if !metadata.still_picture
                || metadata.max_frame_width.get() != width
                || metadata.max_frame_height.get() != height
                || parsed.alpha_item.is_some() != has_alpha
            {
                return Err(MediaError::VariantEncoding {
                    key,
                    reason: "AVIF dimensions/still-picture/alpha contract mismatch".to_owned(),
                });
            }
            if let Some(alpha) =
                parsed
                    .alpha_item_metadata()
                    .map_err(|error| MediaError::VariantEncoding {
                        key,
                        reason: format!("invalid AVIF alpha item: {error}"),
                    })?
            {
                if alpha.max_frame_width.get() != width || alpha.max_frame_height.get() != height {
                    return Err(MediaError::VariantEncoding {
                        key,
                        reason: "AVIF alpha dimensions mismatch".to_owned(),
                    });
                }
            }
        }
        VariantFormat::Webp => {
            if !matches!(image::guess_format(bytes), Ok(ImageFormat::WebP)) {
                return Err(MediaError::VariantEncoding {
                    key,
                    reason: "WebP RIFF/WEBP signature mismatch".to_owned(),
                });
            }
            let decoded =
                image::load_from_memory_with_format(bytes, ImageFormat::WebP).map_err(|error| {
                    MediaError::VariantEncoding {
                        key,
                        reason: format!("WebP decode failed: {error}"),
                    }
                })?;
            if decoded.dimensions() != (width, height) {
                return Err(MediaError::VariantEncoding {
                    key,
                    reason: "WebP decoded dimensions mismatch".to_owned(),
                });
            }
            let decoded_has_alpha = decoded.into_rgba8().pixels().any(|pixel| pixel.0[3] != 255);
            if decoded_has_alpha != has_alpha {
                return Err(MediaError::VariantEncoding {
                    key,
                    reason: "WebP decoded alpha contract mismatch".to_owned(),
                });
            }
        }
    }
    Ok(())
}

fn verify_member_bytes(
    id: ContentId,
    record: &VariantRecord,
    bytes: &[u8],
) -> Result<(), MediaError> {
    if bytes.len() as u64 != record.encoded_len {
        return Err(corrupt_set(id, &format!("{} length mismatch", record.key)));
    }
    let digest = ContentId::from_bytes(*blake3::hash(bytes).as_bytes());
    if digest != record.blake3 {
        return Err(corrupt_set(id, &format!("{} BLAKE3 mismatch", record.key)));
    }
    validate_encoded_variant(
        record.key,
        bytes,
        record.width,
        record.height,
        record.has_alpha,
    )
    .map_err(|error| corrupt_set(id, &error.to_string()))
}

fn serialize_manifest(set: &VariantSet) -> Result<Vec<u8>, MediaError> {
    let disk = DiskManifest {
        schema: MANIFEST_SCHEMA.to_owned(),
        source_id: set.source.to_string(),
        source_width: set.source_width,
        source_height: set.source_height,
        recipe_revision: VARIANT_RECIPE_REVISION.to_owned(),
        variants: set
            .variants
            .iter()
            .map(|record| DiskVariant {
                format: record.key.format,
                kind: record.key.kind,
                mime: record.mime_type().to_owned(),
                width: record.width,
                height: record.height,
                encoded_len: record.encoded_len,
                blake3: record.blake3.to_string(),
                has_alpha: record.has_alpha,
            })
            .collect(),
    };
    serde_json::to_vec(&disk).map_err(|error| corrupt_set(set.source, &error.to_string()))
}

fn parse_manifest(id: ContentId, bytes: &[u8]) -> Result<VariantSet, MediaError> {
    let disk: DiskManifest =
        serde_json::from_slice(bytes).map_err(|error| corrupt_set(id, &error.to_string()))?;
    let canonical =
        serde_json::to_vec(&disk).map_err(|error| corrupt_set(id, &error.to_string()))?;
    if canonical != bytes {
        return Err(corrupt_set(id, "manifest serialization is not canonical"));
    }
    if disk.schema != MANIFEST_SCHEMA
        || disk.source_id != id.to_string()
        || disk.source_width == 0
        || disk.source_height == 0
        || disk.recipe_revision != VARIANT_RECIPE_REVISION
        || disk.variants.len() != VARIANT_COUNT
    {
        return Err(corrupt_set(id, "manifest identity/schema/count mismatch"));
    }
    let mut records = Vec::with_capacity(VARIANT_COUNT);
    for (index, entry) in disk.variants.into_iter().enumerate() {
        let expected_format = VariantFormat::ALL[index / VariantKind::ALL.len()];
        let expected_kind = VariantKind::ALL[index % VariantKind::ALL.len()];
        if entry.format != expected_format
            || entry.kind != expected_kind
            || entry.mime != expected_format.mime_type()
        {
            return Err(corrupt_set(
                id,
                "manifest variant ordering or MIME mismatch",
            ));
        }
        let blake3 = entry
            .blake3
            .parse::<ContentId>()
            .map_err(|error| corrupt_set(id, &error.to_string()))?;
        records.push(VariantRecord {
            key: VariantKey {
                source: id,
                format: entry.format,
                kind: entry.kind,
            },
            width: entry.width,
            height: entry.height,
            encoded_len: entry.encoded_len,
            blake3,
            has_alpha: entry.has_alpha,
        });
    }
    Ok(VariantSet {
        source: id,
        source_width: disk.source_width,
        source_height: disk.source_height,
        variants: records,
    })
}

fn persist_named_bytes<F>(
    directory: &File,
    name: &str,
    logical_path: &Path,
    bytes: &[u8],
    repair: bool,
    verify_existing: F,
) -> Result<bool, MediaError>
where
    F: Fn(&[u8]) -> Result<(), MediaError>,
{
    let (temp_name, mut temp_file) = create_variant_temp(directory)?;
    let mut cleanup = TempCleanup::new(directory, temp_name.clone());
    temp_file.write_all(bytes)?;
    temp_file.sync_all()?;
    verify_attached_entry(directory, &temp_name, &temp_file, Path::new(&temp_name))?;

    loop {
        match rustix::fs::linkat(
            directory,
            temp_name.as_str(),
            directory,
            name,
            AtFlags::empty(),
        ) {
            Ok(()) => {
                let installed = open_regular_file(directory, name, logical_path)?
                    .ok_or_else(|| MediaError::UnsafeStoragePath(logical_path.to_owned()))?;
                if !same_open_file(&temp_file, &installed)? {
                    return Err(MediaError::UnsafeStoragePath(logical_path.to_owned()));
                }
                rustix::fs::fchmod(&installed, FILE_MODE).map_err(std::io::Error::from)?;
                installed.sync_all()?;
                cleanup.remove_and_sync()?;
                sync_fd(directory)?;
                verify_attached_entry(directory, name, &installed, logical_path)?;
                return Ok(true);
            }
            Err(error) if error == rustix::io::Errno::EXIST => {
                let existing = open_regular_file(directory, name, logical_path)?
                    .ok_or_else(|| MediaError::UnsafeStoragePath(logical_path.to_owned()))?;
                let existing_result = if existing.metadata()?.len() != bytes.len() as u64 {
                    verify_existing(&[])
                } else {
                    verify_existing(&read_file_exact(&existing, bytes.len())?)
                };
                match existing_result {
                    Ok(()) => {
                        rustix::fs::fchmod(&existing, FILE_MODE).map_err(std::io::Error::from)?;
                        existing.sync_all()?;
                        cleanup.remove_and_sync()?;
                        sync_fd(directory)?;
                        verify_attached_entry(directory, name, &existing, logical_path)?;
                        return Ok(false);
                    }
                    Err(_error) if repair => {
                        verify_attached_entry(directory, name, &existing, logical_path)?;
                        rustix::fs::unlinkat(directory, name, AtFlags::empty())
                            .map_err(std::io::Error::from)?;
                        sync_fd(directory)?;
                    }
                    Err(error) => return Err(error),
                }
            }
            Err(error) => return Err(MediaError::Io(error.into())),
        }
    }
}

fn create_variant_temp(directory: &File) -> Result<(String, File), MediaError> {
    for _ in 0..TEMP_CREATE_ATTEMPTS {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let name = format!(".variant.tmp.{}.{sequence}", std::process::id());
        let flags =
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC;
        match rustix::fs::openat(directory, name.as_str(), flags, FILE_MODE) {
            Ok(owned) => {
                let file = File::from(owned);
                rustix::fs::fchmod(&file, FILE_MODE).map_err(std::io::Error::from)?;
                verify_attached_entry(directory, &name, &file, Path::new(&name))?;
                return Ok((name, file));
            }
            Err(error) if error == rustix::io::Errno::EXIST => continue,
            Err(error) => return Err(MediaError::Io(error.into())),
        }
    }
    Err(MediaError::Io(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not create a unique variant temporary file",
    )))
}

fn read_file_exact(mut file: &File, length: usize) -> Result<Vec<u8>, MediaError> {
    let mut bytes = Vec::new();
    bytes.try_reserve_exact(length).map_err(|_| {
        MediaError::Io(io::Error::new(
            io::ErrorKind::OutOfMemory,
            "stored file allocation failed",
        ))
    })?;
    Read::by_ref(&mut file)
        .take(length.saturating_add(1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() != length {
        return Err(MediaError::Io(io::Error::new(
            io::ErrorKind::InvalidData,
            "stored file length changed while reading",
        )));
    }
    Ok(bytes)
}

#[allow(clippy::too_many_arguments)]
fn read_capped_attached(
    directory: &File,
    name: &str,
    mut file: File,
    logical_path: &Path,
    max_len: u64,
    id: ContentId,
    label: &str,
) -> Result<Vec<u8>, MediaError> {
    verify_attached_entry(directory, name, &file, logical_path)?;
    let metadata = file.metadata()?;
    if metadata.len() > max_len {
        return Err(corrupt_set(
            id,
            &format!("{label} exceeds its declared cap"),
        ));
    }
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(metadata.len() as usize)
        .map_err(|_| corrupt_set(id, &format!("{label} allocation failed")))?;
    Read::by_ref(&mut file)
        .take(max_len.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max_len {
        return Err(corrupt_set(id, &format!("{label} grew beyond its cap")));
    }
    rustix::fs::fchmod(&file, FILE_MODE).map_err(std::io::Error::from)?;
    file.sync_all()?;
    sync_fd(directory)?;
    verify_attached_entry(directory, name, &file, logical_path)?;
    Ok(bytes)
}

fn corrupt_set(id: ContentId, reason: &str) -> MediaError {
    MediaError::CorruptVariantSet {
        id,
        reason: reason.to_owned(),
    }
}

struct CappedWriter {
    bytes: Vec<u8>,
    max: usize,
    exceeded: bool,
}

impl CappedWriter {
    fn new(max: usize) -> Self {
        Self {
            bytes: Vec::new(),
            max,
            exceeded: false,
        }
    }

    fn into_inner(self) -> Vec<u8> {
        self.bytes
    }
}

impl Write for CappedWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let remaining = self.max.saturating_sub(self.bytes.len());
        if buffer.len() > remaining {
            self.exceeded = true;
            return Err(io::Error::new(
                io::ErrorKind::FileTooLarge,
                "variant encoded-byte cap exceeded",
            ));
        }
        self.bytes.extend_from_slice(buffer);
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::sync::{Arc, Barrier};

    use image::GenericImageView;
    use tempfile::tempdir;

    use super::*;

    fn png_rgba(width: u32, height: u32, pixels: &[u8]) -> Vec<u8> {
        let mut encoded = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut encoded, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(pixels).unwrap();
        }
        encoded
    }

    fn patterned_png(width: u32, height: u32, transparent: bool) -> Vec<u8> {
        let pixels: Vec<u8> = (0..u64::from(width) * u64::from(height))
            .flat_map(|index| {
                let alpha = if transparent && index % 7 == 0 {
                    (index % 253) as u8
                } else {
                    255
                };
                [
                    ((index * 17 + 3) % 251) as u8,
                    ((index * 29 + 5) % 251) as u8,
                    ((index * 43 + 7) % 251) as u8,
                    alpha,
                ]
            })
            .collect();
        png_rgba(width, height, &pixels)
    }

    fn independently_resized_recipe_pixels(
        source: &[u8],
        source_width: u32,
        source_height: u32,
        width: u32,
        height: u32,
    ) -> Vec<u8> {
        let premultiplied: Vec<u8> = source
            .chunks_exact(4)
            .flat_map(|pixel| {
                let alpha = u16::from(pixel[3]);
                [
                    ((u16::from(pixel[0]) * alpha + 127) / 255) as u8,
                    ((u16::from(pixel[1]) * alpha + 127) / 255) as u8,
                    ((u16::from(pixel[2]) * alpha + 127) / 255) as u8,
                    pixel[3],
                ]
            })
            .collect();
        let source_image = RgbaImage::from_raw(source_width, source_height, premultiplied).unwrap();
        let mut resized =
            image::imageops::resize(&source_image, width, height, FilterType::Lanczos3).into_raw();
        for pixel in resized.chunks_exact_mut(4) {
            let alpha = u16::from(pixel[3]);
            if alpha == 0 {
                pixel[..3].fill(0);
            } else {
                for channel in &mut pixel[..3] {
                    *channel = (u16::from(*channel) * 255 + alpha / 2)
                        .checked_div(alpha)
                        .expect("the zero-alpha branch was handled")
                        .min(255) as u8;
                }
            }
        }
        resized
    }

    fn store_with_source(
        root: &Path,
        width: u32,
        height: u32,
        transparent: bool,
    ) -> (MediaStore, ContentId) {
        let store = MediaStore::open(root, MediaLimits::default()).unwrap();
        let result = store
            .ingest(&patterned_png(width, height, transparent))
            .unwrap();
        (store, result.handle().id())
    }

    fn member_bytes(
        store: &MediaStore,
        id: ContentId,
        limits: VariantLimits,
    ) -> BTreeMap<(VariantFormat, VariantKind), Vec<u8>> {
        let mut result = BTreeMap::new();
        for format in VariantFormat::ALL {
            for kind in VariantKind::ALL {
                let variant = store
                    .lookup_variant(id, format, kind, limits)
                    .unwrap()
                    .unwrap();
                result.insert((format, kind), variant.encoded_bytes().to_vec());
            }
        }
        result
    }

    #[test]
    fn variant_generation_emits_six_real_decodable_members_with_alpha() {
        let directory = tempdir().unwrap();
        let (store, id) = store_with_source(directory.path(), 320, 180, true);
        let generated = store
            .generate_variants(id, VariantLimits::default())
            .unwrap();
        assert_eq!(generated.status(), VariantGenerationStatus::Stored);
        assert_eq!(generated.set().variants().len(), VARIANT_COUNT);

        for record in generated.set().variants() {
            let stored = store
                .lookup_variant(
                    id,
                    record.key().format(),
                    record.key().kind(),
                    VariantLimits::default(),
                )
                .unwrap()
                .unwrap();
            let bytes = stored.encoded_bytes();
            match record.key().format() {
                VariantFormat::Avif => {
                    assert_eq!(&bytes[4..12], b"ftypavif");
                    let mut avif_bytes = bytes;
                    let parsed = avif_parse::read_avif(&mut avif_bytes).unwrap();
                    assert!(!parsed.primary_item.is_empty());
                    assert!(parsed.alpha_item.is_some());
                    let decoded = image::load_from_memory_with_format(bytes, ImageFormat::Avif)
                        .expect("native decoder must accept generated AVIF");
                    assert_eq!(decoded.dimensions(), (record.width(), record.height()));
                    if record.key().kind() == VariantKind::Thumb {
                        assert!(
                            decoded.into_rgba8().pixels().any(|pixel| pixel.0[3] != 255),
                            "native AVIF Thumb decode lost its non-opaque alpha"
                        );
                    }
                }
                VariantFormat::Webp => {
                    assert!(bytes.starts_with(b"RIFF"));
                    assert_eq!(&bytes[8..12], b"WEBP");
                    let decoded = image::load_from_memory_with_format(bytes, ImageFormat::WebP)
                        .expect("decoder must accept generated WebP");
                    assert_eq!(decoded.dimensions(), (record.width(), record.height()));
                    assert!(decoded.into_rgba8().pixels().any(|pixel| pixel.0[3] != 255));
                }
            }
        }
    }

    #[test]
    fn variant_opaque_avif_omits_alpha_item_and_webp_preserves_opaque_alpha() {
        let directory = tempdir().unwrap();
        let (store, id) = store_with_source(directory.path(), 7, 5, false);
        store
            .generate_variants(id, VariantLimits::default())
            .unwrap();
        let avif = store
            .lookup_variant(
                id,
                VariantFormat::Avif,
                VariantKind::Thumb,
                VariantLimits::default(),
            )
            .unwrap()
            .unwrap();
        let parsed = avif_parse::read_avif(&mut avif.encoded_bytes()).unwrap();
        assert!(parsed.alpha_item.is_none());
        assert!(!avif.record().has_alpha());

        let webp = store
            .lookup_variant(
                id,
                VariantFormat::Webp,
                VariantKind::Thumb,
                VariantLimits::default(),
            )
            .unwrap()
            .unwrap();
        let decoded = image::load_from_memory_with_format(webp.encoded_bytes(), ImageFormat::WebP)
            .unwrap()
            .into_rgba8();
        assert!(decoded.pixels().all(|pixel| pixel.0[3] == 255));
    }

    #[test]
    fn variant_geometry_never_upscales_preserves_aspect_and_keeps_one_pixel_edges() {
        assert_eq!(fitted_dimensions(100, 50, (256, 256)).unwrap(), (100, 50));
        assert_eq!(fitted_dimensions(400, 200, (256, 256)).unwrap(), (256, 128));
        assert_eq!(fitted_dimensions(200, 400, (256, 256)).unwrap(), (128, 256));
        assert_eq!(fitted_dimensions(10_000, 1, (256, 256)).unwrap(), (256, 1));
        assert_eq!(fitted_dimensions(1, 10_000, (256, 256)).unwrap(), (1, 256));
        assert_eq!(fitted_dimensions(1, 1, (256, 256)).unwrap(), (1, 1));
    }

    #[test]
    fn variant_premultiplied_resize_avoids_transparent_color_halos_and_zeroes_hidden_rgb() {
        let edge = resize_premultiplied(&[255, 0, 0, 255, 0, 0, 255, 0], 2, 1, 1, 1).unwrap();
        assert!(edge[0] > 200, "opaque red should dominate: {edge:?}");
        assert_eq!(edge[1], 0);
        assert_eq!(edge[2], 0, "transparent blue must not bleed: {edge:?}");
        assert!(edge[3] > 0 && edge[3] < 255);

        let hidden = resize_premultiplied(&[31, 47, 251, 0], 1, 1, 1, 1).unwrap();
        assert_eq!(hidden, [0, 0, 0, 0]);
    }

    #[test]
    fn variant_lossless_webp_decodes_to_exact_recipe_pixels() {
        let directory = tempdir().unwrap();
        let limits = VariantLimits::default();
        let width = 300;
        let height = 2;
        let source_pixels: Vec<u8> = (0..height)
            .flat_map(|_| {
                (0..width).flat_map(|x| {
                    if x < width / 2 {
                        [255, 16, 8, 255]
                    } else {
                        [3, 47, 251, 0]
                    }
                })
            })
            .collect();
        let store = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
        let id = store
            .ingest(&png_rgba(width, height, &source_pixels))
            .unwrap()
            .handle()
            .id();
        let raster = store.lookup(id).unwrap().unwrap();
        let (expected_width, expected_height) =
            fitted_dimensions(width, height, VariantKind::Thumb.maximum_dimensions()).unwrap();
        assert_eq!((expected_width, expected_height), (256, 1));
        let expected = independently_resized_recipe_pixels(
            raster.rgba8_pixels(),
            raster.handle().width(),
            raster.handle().height(),
            expected_width,
            expected_height,
        );
        store.generate_variants(id, limits).unwrap();
        let stored = store
            .lookup_variant(id, VariantFormat::Webp, VariantKind::Thumb, limits)
            .unwrap()
            .unwrap();
        let decoded =
            image::load_from_memory_with_format(stored.encoded_bytes(), ImageFormat::WebP)
                .unwrap()
                .into_rgba8();
        assert_eq!(decoded.as_raw(), &expected);
    }

    #[test]
    fn variant_bytes_are_deterministic_across_repeat_restart_and_regeneration() {
        let directory = tempdir().unwrap();
        let limits = VariantLimits::default();
        let (store, id) = store_with_source(directory.path(), 3_000, 3, true);
        let generated = store.generate_variants(id, limits).unwrap();
        for record in generated.set().variants() {
            let expected = match record.key().kind() {
                VariantKind::Thumb => (256, 1),
                VariantKind::Tablet => (1_280, 1),
                VariantKind::FullBounded => (2_560, 2),
            };
            assert_eq!((record.width(), record.height()), expected);
        }
        let first = member_bytes(&store, id, limits);
        for (key, bytes) in &first {
            let expected = match key {
                (VariantFormat::Avif, VariantKind::Thumb) => {
                    "5814350a6b51ed6d57b69ce2b924bf211618c3d82ff08868fc30543e41242b7b"
                }
                (VariantFormat::Avif, VariantKind::Tablet) => {
                    "7e3284982a67372f0d502c0f8ef974bd048889a2e14f6b7da790d42ce6cb5615"
                }
                (VariantFormat::Avif, VariantKind::FullBounded) => {
                    "98649e2cdb64dd80d55116d9565f740e73725158949bfb8549a8287808198303"
                }
                (VariantFormat::Webp, VariantKind::Thumb) => {
                    "390e7afcadb58c49dd5961601c13251e65d35b113f2fe189d1c1212121861220"
                }
                (VariantFormat::Webp, VariantKind::Tablet) => {
                    "c49e0649c6d6e970f3bd0352be65fedc5b10238ae72eca0f7f74fe7252f55608"
                }
                (VariantFormat::Webp, VariantKind::FullBounded) => {
                    "72c89e0f721813be34198759850c7d289972ed3837ab93de148e5d4af730613a"
                }
            };
            assert_eq!(blake3::hash(bytes).to_hex().as_str(), expected);
        }
        let repeated = store.generate_variants(id, limits).unwrap();
        assert_eq!(repeated.status(), VariantGenerationStatus::AlreadyPresent);
        assert_eq!(member_bytes(&store, id, limits), first);
        drop(store);

        let restarted = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
        assert_eq!(member_bytes(&restarted, id, limits), first);
        restarted.regenerate_variants(id, limits).unwrap();
        assert_eq!(member_bytes(&restarted, id, limits), first);
    }

    #[test]
    fn variant_concurrent_generation_installs_one_deterministic_manifest() {
        let directory = tempdir().unwrap();
        let limits = VariantLimits::default();
        let (store, id) = store_with_source(directory.path(), 8, 6, true);
        let store = Arc::new(store);
        let barrier = Arc::new(Barrier::new(4));
        let mut threads = Vec::new();
        for _ in 0..4 {
            let store = Arc::clone(&store);
            let barrier = Arc::clone(&barrier);
            threads.push(std::thread::spawn(move || {
                barrier.wait();
                store.generate_variants(id, limits).unwrap()
            }));
        }
        let results: Vec<_> = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect();
        assert_eq!(
            results
                .iter()
                .filter(|result| result.status() == VariantGenerationStatus::Stored)
                .count(),
            1
        );
        assert!(results
            .iter()
            .all(|result| result.set() == results[0].set()));
        assert!(store.lookup_variant_set(id, limits).unwrap().is_some());
    }

    #[test]
    fn variant_set_lookup_rejects_manifest_removal_during_member_scan() {
        let directory = tempdir().unwrap();
        let limits = VariantLimits::default();
        let (store, id) = store_with_source(directory.path(), 8, 6, true);
        store.generate_variants(id, limits).unwrap();
        let manifest = store.recipe_path(id).join(MANIFEST_NAME);
        let mut removed = false;
        let result = store.lookup_variant_snapshot_with_hook(id, limits, None, |stage| {
            if stage == VariantLookupStage::MemberVerified(1) && !removed {
                fs::remove_file(&manifest)?;
                removed = true;
            }
            Ok(())
        });
        assert!(removed);
        assert!(result.is_err(), "detached commit marker returned a set");
    }

    #[test]
    fn variant_set_lookup_rejects_manifest_replacement_during_member_scan() {
        let directory = tempdir().unwrap();
        let limits = VariantLimits::default();
        let (store, id) = store_with_source(directory.path(), 8, 6, true);
        store.generate_variants(id, limits).unwrap();
        let manifest = store.recipe_path(id).join(MANIFEST_NAME);
        let held = store.recipe_path(id).join("held-manifest");
        let replacement_bytes = fs::read(&manifest).unwrap();
        let mut replaced = false;
        let result = store.lookup_variant_snapshot_with_hook(id, limits, None, |stage| {
            if stage == VariantLookupStage::MemberVerified(2) && !replaced {
                fs::rename(&manifest, &held)?;
                fs::write(&manifest, &replacement_bytes)?;
                replaced = true;
            }
            Ok(())
        });
        assert!(replaced);
        assert!(result.is_err(), "replacement commit marker returned a set");
    }

    #[test]
    fn variant_member_lookup_rejects_explicit_regeneration_after_snapshot_scan() {
        let directory = tempdir().unwrap();
        let limits = VariantLimits::default();
        let (store, id) = store_with_source(directory.path(), 8, 6, true);
        store.generate_variants(id, limits).unwrap();
        let mut regenerated = false;
        let result = store.lookup_variant_snapshot_with_hook(
            id,
            limits,
            Some((VariantFormat::Webp, VariantKind::Tablet)),
            |stage| {
                if stage == VariantLookupStage::MembersVerified && !regenerated {
                    store.regenerate_variants(id, limits)?;
                    regenerated = true;
                }
                Ok(())
            },
        );
        assert!(regenerated);
        assert!(result.is_err(), "member bytes escaped a replaced snapshot");
        assert!(store.lookup_variant_set(id, limits).unwrap().is_some());
    }

    #[test]
    fn variant_set_lookup_rejects_id_directory_detachment_after_scan() {
        let directory = tempdir().unwrap();
        let limits = VariantLimits::default();
        let (store, id) = store_with_source(directory.path(), 8, 6, true);
        store.generate_variants(id, limits).unwrap();
        let id_path = store.id_path(id);
        let held = store.root.join("blobs").join("held-snapshot-id");
        let mut detached = false;
        let result = store.lookup_variant_snapshot_with_hook(id, limits, None, |stage| {
            if stage == VariantLookupStage::MembersVerified && !detached {
                fs::rename(&id_path, &held)?;
                detached = true;
            }
            Ok(())
        });
        assert!(detached);
        assert!(result.is_err(), "detached id directory returned a set");
        assert!(held.exists());
        assert!(!id_path.exists());
    }

    #[test]
    fn variant_absent_manifest_is_incomplete_and_generation_reuses_crash_members() {
        let directory = tempdir().unwrap();
        let limits = VariantLimits::default();
        let (store, id) = store_with_source(directory.path(), 8, 6, true);
        store.generate_variants(id, limits).unwrap();
        let before = member_bytes(&store, id, limits);
        fs::remove_file(store.recipe_path(id).join(MANIFEST_NAME)).unwrap();
        fs::remove_file(store.variant_path(VariantKey {
            source: id,
            format: VariantFormat::Webp,
            kind: VariantKind::FullBounded,
        }))
        .unwrap();
        fs::write(store.recipe_path(id).join(".variant.tmp.crash"), b"partial").unwrap();
        assert!(store.lookup_variant_set(id, limits).unwrap().is_none());
        let regenerated = store.generate_variants(id, limits).unwrap();
        assert_eq!(regenerated.status(), VariantGenerationStatus::Stored);
        assert_eq!(member_bytes(&store, id, limits), before);
    }

    #[test]
    fn variant_manifest_with_missing_or_corrupt_member_is_typed_corruption_and_repairs() {
        let directory = tempdir().unwrap();
        let limits = VariantLimits::default();
        let (store, id) = store_with_source(directory.path(), 8, 6, true);
        store.generate_variants(id, limits).unwrap();
        let key = VariantKey {
            source: id,
            format: VariantFormat::Avif,
            kind: VariantKind::Thumb,
        };
        let path = store.variant_path(key);
        fs::remove_file(&path).unwrap();
        assert!(matches!(
            store.lookup_variant_set(id, limits).unwrap_err(),
            MediaError::CorruptVariantSet { .. }
        ));
        store.regenerate_variants(id, limits).unwrap();
        assert!(store.lookup_variant_set(id, limits).unwrap().is_some());

        fs::write(&path, b"fake-avif-wrapper").unwrap();
        assert!(matches!(
            store.lookup_variant_set(id, limits).unwrap_err(),
            MediaError::CorruptVariantSet { .. }
        ));
        store.regenerate_variants(id, limits).unwrap();
        assert!(store.lookup_variant_set(id, limits).unwrap().is_some());
    }

    #[test]
    fn variant_absent_manifest_fails_closed_on_conflicting_member_until_explicit_repair() {
        let directory = tempdir().unwrap();
        let limits = VariantLimits::default();
        let (store, id) = store_with_source(directory.path(), 8, 6, true);
        store.generate_variants(id, limits).unwrap();
        fs::remove_file(store.recipe_path(id).join(MANIFEST_NAME)).unwrap();
        let path = store.variant_path(VariantKey {
            source: id,
            format: VariantFormat::Avif,
            kind: VariantKind::Thumb,
        });
        fs::write(&path, b"conflicting immutable bytes").unwrap();
        assert!(matches!(
            store.generate_variants(id, limits).unwrap_err(),
            MediaError::CorruptVariantSet { .. }
        ));
        assert!(!store.recipe_path(id).join(MANIFEST_NAME).exists());
        store.regenerate_variants(id, limits).unwrap();
        assert!(store.lookup_variant_set(id, limits).unwrap().is_some());
    }

    #[test]
    fn variant_noncanonical_or_source_mismatched_manifest_is_typed_corruption() {
        let directory = tempdir().unwrap();
        let limits = VariantLimits::default();
        let (store, id) = store_with_source(directory.path(), 8, 6, false);
        store.generate_variants(id, limits).unwrap();
        let path = store.recipe_path(id).join(MANIFEST_NAME);
        let mut bytes = fs::read(&path).unwrap();
        bytes.push(b'\n');
        fs::write(&path, bytes).unwrap();
        assert!(matches!(
            store.lookup_variant_set(id, limits).unwrap_err(),
            MediaError::CorruptVariantSet { .. }
        ));

        store.regenerate_variants(id, limits).unwrap();
        let mut disk: DiskManifest = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        disk.source_width += 1;
        fs::write(&path, serde_json::to_vec(&disk).unwrap()).unwrap();
        assert!(matches!(
            store.lookup_variant_set(id, limits).unwrap_err(),
            MediaError::CorruptVariantSet { .. }
        ));
    }

    #[test]
    fn variant_fake_codec_wrappers_are_rejected() {
        let id = ContentId::from_bytes([7; CONTENT_ID_BYTES]);
        let avif_key = VariantKey {
            source: id,
            format: VariantFormat::Avif,
            kind: VariantKind::Thumb,
        };
        let fake_avif = b"\0\0\0\x18ftypavif\0\0\0\0avifmif1";
        assert!(validate_encoded_variant(avif_key, fake_avif, 1, 1, false).is_err());
        let webp_key = VariantKey {
            source: id,
            format: VariantFormat::Webp,
            kind: VariantKind::Thumb,
        };
        let fake_webp = b"RIFF\x08\0\0\0WEBPfake";
        assert!(validate_encoded_variant(webp_key, fake_webp, 1, 1, false).is_err());
    }

    #[test]
    fn variant_prepared_upload_limit_failure_has_no_filesystem_effects() {
        let directory = tempdir().unwrap();
        let store = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
        let limits = VariantLimits::new(2_560, 2_560, 6_553_600, 8, 48).unwrap();

        assert!(matches!(
            store
                .prepare_upload(&patterned_png(1, 1, true), limits)
                .unwrap_err(),
            MediaError::VariantEncodedBytesExceeded { .. }
        ));
        assert_eq!(fs::read_dir(store.root.join("blobs")).unwrap().count(), 0);
    }

    #[test]
    fn variant_prepared_upload_commits_idempotently_and_survives_restart() {
        let directory = tempdir().unwrap();
        let limits = VariantLimits::default();
        let encoded = patterned_png(9, 7, true);
        let store = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
        let prepared = store.prepare_upload(&encoded, limits).unwrap();
        let id = prepared.handle().id();
        assert_eq!(prepared.variant_set().variants().len(), VARIANT_COUNT);
        assert_eq!(fs::read_dir(store.root.join("blobs")).unwrap().count(), 0);

        let first = store.commit_prepared_upload(prepared).unwrap();
        assert_eq!(first.ingest().status(), IngestStatus::Stored);
        assert_eq!(first.variants().status(), VariantGenerationStatus::Stored);
        let repeated = store
            .commit_prepared_upload(store.prepare_upload(&encoded, limits).unwrap())
            .unwrap();
        assert_eq!(repeated.ingest().status(), IngestStatus::AlreadyPresent);
        assert_eq!(
            repeated.variants().status(),
            VariantGenerationStatus::AlreadyPresent
        );
        drop(store);

        let restarted = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
        assert!(restarted.lookup(id).unwrap().is_some());
        assert!(restarted.lookup_variant_set(id, limits).unwrap().is_some());
    }

    #[test]
    fn variant_dimension_member_and_aggregate_caps_leave_no_complete_manifest() {
        let directory = tempdir().unwrap();
        let (store, id) = store_with_source(directory.path(), 8, 6, true);
        let dimension_limits = VariantLimits::new(7, 6, 48, 1_000_000, 6_000_000).unwrap();
        assert!(matches!(
            store.generate_variants(id, dimension_limits).unwrap_err(),
            MediaError::VariantDimensionsExceeded { .. }
        ));
        assert!(!store.recipe_path(id).join(MANIFEST_NAME).exists());

        let member_limits = VariantLimits::new(2_560, 2_560, 6_553_600, 8, 48).unwrap();
        assert!(matches!(
            store.generate_variants(id, member_limits).unwrap_err(),
            MediaError::VariantEncodedBytesExceeded { .. }
        ));
        assert!(!store.recipe_path(id).join(MANIFEST_NAME).exists());
        assert!(!store
            .variant_path(VariantKey {
                source: id,
                format: VariantFormat::Avif,
                kind: VariantKind::Thumb,
            })
            .exists());

        let baseline_directory = tempdir().unwrap();
        let (baseline, baseline_id) = store_with_source(baseline_directory.path(), 8, 6, true);
        let baseline_set = baseline
            .generate_variants(baseline_id, VariantLimits::default())
            .unwrap();
        let total: u64 = baseline_set
            .set()
            .variants()
            .iter()
            .map(VariantRecord::encoded_len)
            .sum();
        let aggregate_directory = tempdir().unwrap();
        let (aggregate_store, aggregate_id) =
            store_with_source(aggregate_directory.path(), 8, 6, true);
        let aggregate_limits =
            VariantLimits::new(2_560, 2_560, 6_553_600, 16 * 1024 * 1024, total - 1).unwrap();
        assert!(matches!(
            aggregate_store
                .generate_variants(aggregate_id, aggregate_limits)
                .unwrap_err(),
            MediaError::VariantAggregateBytesExceeded { .. }
        ));
        assert!(!aggregate_store
            .recipe_path(aggregate_id)
            .join(MANIFEST_NAME)
            .exists());
    }

    #[cfg(unix)]
    #[test]
    fn variant_nested_symlinks_never_touch_outside() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let marker = outside.path().join("marker");
        fs::write(&marker, b"untouched").unwrap();
        let (store, id) = store_with_source(directory.path(), 8, 6, true);
        symlink(outside.path(), store.recipe_path(id)).unwrap();
        assert!(matches!(
            store
                .generate_variants(id, VariantLimits::default())
                .unwrap_err(),
            MediaError::UnsafeStoragePath(_)
        ));
        assert_eq!(fs::read(&marker).unwrap(), b"untouched");
        assert!(!outside.path().join(MANIFEST_NAME).exists());

        fs::remove_file(store.recipe_path(id)).unwrap();
        fs::create_dir(store.recipe_path(id)).unwrap();
        let avif_dir = store.recipe_path(id).join("avif");
        fs::create_dir(&avif_dir).unwrap();
        symlink(&marker, avif_dir.join("thumb")).unwrap();
        assert!(matches!(
            store
                .generate_variants(id, VariantLimits::default())
                .unwrap_err(),
            MediaError::UnsafeStoragePath(_)
        ));
        assert_eq!(fs::read(&marker).unwrap(), b"untouched");
        assert!(!store.recipe_path(id).join(MANIFEST_NAME).exists());
    }

    #[cfg(unix)]
    #[test]
    fn variant_temp_symlink_collision_is_skipped_without_touching_outside() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let marker = outside.path().join("marker");
        fs::write(&marker, b"untouched").unwrap();
        let (store, id) = store_with_source(directory.path(), 2, 2, false);
        let id_directory = store.open_id_directory(id, false).unwrap().unwrap();
        let recipe_directory = store
            .open_recipe_directory(id, &id_directory, true)
            .unwrap()
            .unwrap();
        let sequence = TEMP_SEQUENCE.load(Ordering::Relaxed);
        let collision = format!(".variant.tmp.{}.{sequence}", std::process::id());
        symlink(&marker, store.recipe_path(id).join(&collision)).unwrap();
        let (created_name, _created_file) = create_variant_temp(&recipe_directory).unwrap();
        assert_ne!(created_name, collision);
        let mut cleanup = TempCleanup::new(&recipe_directory, created_name);
        cleanup.remove_and_sync().unwrap();
        assert_eq!(fs::read(&marker).unwrap(), b"untouched");
    }

    #[cfg(unix)]
    #[test]
    fn variant_files_and_nested_directories_are_private_and_repaired() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().unwrap();
        let limits = VariantLimits::default();
        let (store, id) = store_with_source(directory.path(), 8, 6, true);
        store.generate_variants(id, limits).unwrap();
        let recipe = store.recipe_path(id);
        let avif = recipe.join("avif");
        let member = avif.join("thumb");
        let manifest = recipe.join(MANIFEST_NAME);
        for path in [&recipe, &avif, &recipe.join("webp")] {
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        for path in [&member, &manifest] {
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }

        fs::set_permissions(&recipe, fs::Permissions::from_mode(0o777)).unwrap();
        fs::set_permissions(&avif, fs::Permissions::from_mode(0o777)).unwrap();
        fs::set_permissions(&member, fs::Permissions::from_mode(0o666)).unwrap();
        fs::set_permissions(&manifest, fs::Permissions::from_mode(0o666)).unwrap();
        store.lookup_variant_set(id, limits).unwrap().unwrap();
        assert_eq!(
            fs::metadata(&recipe).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(&avif).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(&member).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(&manifest).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
