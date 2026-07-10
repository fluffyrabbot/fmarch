//! Canonical image ingestion and local content-addressed persistence (doc 07).
//!
//! This crate owns canonical ingest, private local persistence, and deterministic AVIF/WebP
//! variants below future HTTP and product-integration layers. Untrusted PNG/JPEG uploads are
//! decoded under explicit encoded-byte, dimension, pixel, and output-buffer caps. EXIF orientation
//! is applied, all remaining container metadata is discarded, and the resulting pixels are
//! serialized as a versioned RGBA8 raster before their BLAKE3 identity is computed.
//!
//! The on-disk handle is a typed 32-byte digest, never a caller-provided path. A complete blob is
//! synced to a private temporary file and installed with an atomic no-clobber hard link, so
//! concurrent or repeated ingestion is idempotent and a reader never observes partial bytes.

use std::fmt;
use std::fs::{self, File};
use std::io::{self, Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};
use rustix::fs::{AtFlags, Mode, OFlags};

mod variants;

pub use variants::{
    MediaUploadCommitResult, PreparedMediaUpload, StoredVariant, VariantFormat,
    VariantGenerationResult, VariantGenerationStatus, VariantKey, VariantKind, VariantLimits,
    VariantRecord, VariantSet, VARIANT_RECIPE_REVISION,
};

const CANONICAL_MAGIC: &[u8; 8] = b"FMRGBA01";
const CANONICAL_HEADER_BYTES: usize = CANONICAL_MAGIC.len() + 8;
const BYTES_PER_CANONICAL_PIXEL: u64 = 4;
const CONTENT_ID_BYTES: usize = 32;
const CONTENT_ID_HEX_BYTES: usize = CONTENT_ID_BYTES * 2;
const DECODER_OVERHEAD_BYTES: u64 = 1024 * 1024;
const TEMP_CREATE_ATTEMPTS: usize = 64;
const DIRECTORY_MODE: Mode = Mode::from_raw_mode(0o700);
const FILE_MODE: Mode = Mode::from_raw_mode(0o600);

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Decode and canonical-raster bounds applied to every upload.
///
/// `max_decoded_bytes` caps both the decoder-produced pixel output and the canonical RGBA8 pixel
/// buffer. The image library also receives a best-effort allocation hint derived from that cap and
/// the encoded-input limit; it is not a strict total-process or decoder-workspace memory bound.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MediaLimits {
    max_encoded_bytes: usize,
    max_width: u32,
    max_height: u32,
    max_pixels: u64,
    max_decoded_bytes: u64,
}

impl MediaLimits {
    pub fn new(
        max_encoded_bytes: usize,
        max_width: u32,
        max_height: u32,
        max_pixels: u64,
        max_decoded_bytes: u64,
    ) -> Result<Self, MediaError> {
        let limits = Self {
            max_encoded_bytes,
            max_width,
            max_height,
            max_pixels,
            max_decoded_bytes,
        };
        limits.validate()?;
        Ok(limits)
    }

    pub fn max_encoded_bytes(self) -> usize {
        self.max_encoded_bytes
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

    pub fn max_decoded_bytes(self) -> u64 {
        self.max_decoded_bytes
    }

    fn validate(self) -> Result<(), MediaError> {
        if self.max_encoded_bytes == 0 {
            return Err(MediaError::InvalidLimits(
                "max_encoded_bytes must be non-zero",
            ));
        }
        if self.max_width == 0 {
            return Err(MediaError::InvalidLimits("max_width must be non-zero"));
        }
        if self.max_height == 0 {
            return Err(MediaError::InvalidLimits("max_height must be non-zero"));
        }
        if self.max_pixels == 0 {
            return Err(MediaError::InvalidLimits("max_pixels must be non-zero"));
        }
        if self.max_decoded_bytes < BYTES_PER_CANONICAL_PIXEL {
            return Err(MediaError::InvalidLimits(
                "max_decoded_bytes must hold at least one RGBA8 pixel",
            ));
        }
        Ok(())
    }
}

impl Default for MediaLimits {
    fn default() -> Self {
        Self {
            max_encoded_bytes: 12 * 1024 * 1024,
            max_width: 6_000,
            max_height: 6_000,
            max_pixels: 24_000_000,
            max_decoded_bytes: 96 * 1024 * 1024,
        }
    }
}

/// BLAKE3 identity of a canonical, metadata-free raster.
///
/// The byte representation is deliberately private. Text handles accept exactly 64 lowercase
/// hexadecimal ASCII characters, which makes every handle a single safe filesystem component.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ContentId([u8; CONTENT_ID_BYTES]);

impl ContentId {
    pub fn from_bytes(bytes: [u8; CONTENT_ID_BYTES]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; CONTENT_ID_BYTES] {
        &self.0
    }
}

impl fmt::Display for ContentId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        for byte in self.0 {
            write!(formatter, "{byte:02x}")?;
        }
        Ok(())
    }
}

impl fmt::Debug for ContentId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("ContentId")
            .field(&self.to_string())
            .finish()
    }
}

impl FromStr for ContentId {
    type Err = InvalidContentId;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let bytes = value.as_bytes();
        if bytes.len() != CONTENT_ID_HEX_BYTES
            || bytes
                .iter()
                .any(|byte| !byte.is_ascii_digit() && !(b'a'..=b'f').contains(byte))
        {
            return Err(InvalidContentId);
        }

        let mut decoded = [0_u8; CONTENT_ID_BYTES];
        for (index, output) in decoded.iter_mut().enumerate() {
            let high = decode_hex_nibble(bytes[index * 2]).ok_or(InvalidContentId)?;
            let low = decode_hex_nibble(bytes[index * 2 + 1]).ok_or(InvalidContentId)?;
            *output = (high << 4) | low;
        }
        Ok(Self(decoded))
    }
}

fn decode_hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("content id must be exactly 64 lowercase hexadecimal characters")]
pub struct InvalidContentId;

/// Stable reference metadata carried by a post or later variant job.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct MediaHandle {
    id: ContentId,
    width: u32,
    height: u32,
}

impl MediaHandle {
    pub fn id(self) -> ContentId {
        self.id
    }

    pub fn width(self) -> u32 {
        self.width
    }

    pub fn height(self) -> u32 {
        self.height
    }
}

/// Whether an ingest installed bytes or found the same canonical raster already present.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IngestStatus {
    Stored,
    AlreadyPresent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IngestResult {
    handle: MediaHandle,
    status: IngestStatus,
}

impl IngestResult {
    pub fn handle(self) -> MediaHandle {
        self.handle
    }

    pub fn status(self) -> IngestStatus {
        self.status
    }
}

/// A verified canonical raster loaded from the configured store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredRaster {
    handle: MediaHandle,
    canonical_bytes: Vec<u8>,
}

impl StoredRaster {
    pub fn handle(&self) -> MediaHandle {
        self.handle
    }

    /// Versioned `FMRGBA01` header followed by row-major, non-premultiplied RGBA8 pixels.
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub fn rgba8_pixels(&self) -> &[u8] {
        &self.canonical_bytes[CANONICAL_HEADER_BYTES..]
    }
}

#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("invalid media limits: {0}")]
    InvalidLimits(&'static str),
    #[error("encoded upload is {actual} bytes; limit is {max} bytes")]
    EncodedInputTooLarge { actual: usize, max: usize },
    #[error("unsupported upload format; only PNG and JPEG are accepted")]
    UnsupportedFormat,
    #[error("image is malformed: {0}")]
    MalformedImage(String),
    #[error("image dimensions {width}x{height} exceed the {max_width}x{max_height} limits")]
    DimensionsExceeded {
        width: u32,
        height: u32,
        max_width: u32,
        max_height: u32,
    },
    #[error("image has {pixels} pixels; limit is {max_pixels}")]
    PixelCountExceeded { pixels: u64, max_pixels: u64 },
    #[error("decoded image requires {actual} bytes; limit is {max} bytes")]
    DecodedBytesExceeded { actual: u64, max: u64 },
    #[error("the image decoder reported a resource limit: {0}")]
    DecoderResourceLimit(String),
    #[error("could not allocate {bytes} bytes for the canonical raster")]
    CanonicalAllocationFailed { bytes: usize },
    #[error("unsafe storage path rejected: {0}")]
    UnsafeStoragePath(PathBuf),
    #[error("stored media {id} is corrupt: {reason}")]
    CorruptStoredRaster { id: ContentId, reason: String },
    #[error("stored media {id} does not match newly canonicalized bytes")]
    ExistingRasterMismatch { id: ContentId },
    #[error("invalid variant limits: {0}")]
    InvalidVariantLimits(&'static str),
    #[error("variant {key} dimensions {width}x{height} exceed configured output bounds")]
    VariantDimensionsExceeded {
        key: VariantKey,
        width: u32,
        height: u32,
    },
    #[error("variant {key} has {pixels} pixels; limit is {max_pixels}")]
    VariantPixelCountExceeded {
        key: VariantKey,
        pixels: u64,
        max_pixels: u64,
    },
    #[error("variant {key} exceeded its encoded-byte limit of {max} bytes")]
    VariantEncodedBytesExceeded { key: VariantKey, max: usize },
    #[error("variant set for {id} exceeded its aggregate encoded-byte limit of {max} bytes")]
    VariantAggregateBytesExceeded { id: ContentId, max: u64 },
    #[error("variant encoding failed for {key}: {reason}")]
    VariantEncoding { key: VariantKey, reason: String },
    #[error("variant set for {id} is corrupt: {reason}")]
    CorruptVariantSet { id: ContentId, reason: String },
    #[error("media filesystem operation failed: {0}")]
    Io(#[from] io::Error),
}

/// Local, content-addressed canonical-raster store.
#[derive(Debug, Clone)]
pub struct MediaStore {
    root: PathBuf,
    root_directory: Arc<File>,
    blobs_directory: Arc<File>,
    limits: MediaLimits,
}

impl MediaStore {
    /// Open a pre-provisioned store root and retain directory capabilities for all later
    /// filesystem IO.
    ///
    /// Root provisioning is deliberately outside this crate: recursively creating an ambient
    /// path cannot truthfully promise that every new parent entry was fsynced. Once the root
    /// exists, this store durably creates and owns everything beneath it.
    pub fn open(root: impl AsRef<Path>, limits: MediaLimits) -> Result<Self, MediaError> {
        limits.validate()?;
        let root = fs::canonicalize(root.as_ref())?;
        let root_directory = Arc::new(open_root_directory(&root)?);
        let blobs_path = root.join("blobs");
        let blobs_directory = Arc::new(
            open_child_directory(&root_directory, "blobs", &blobs_path, true)?
                .expect("create=true always opens the directory"),
        );

        Ok(Self {
            root,
            root_directory,
            blobs_directory,
            limits,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn limits(&self) -> MediaLimits {
        self.limits
    }

    /// Decode, canonicalize, identify, and idempotently persist one encoded upload.
    pub fn ingest(&self, encoded: &[u8]) -> Result<IngestResult, MediaError> {
        let decoded = self.decode_bounded(encoded)?;
        let canonical_bytes = canonical_raster_bytes(decoded)?;
        let id = ContentId::from_bytes(*blake3::hash(&canonical_bytes).as_bytes());
        let (width, height) = parse_canonical_header(&canonical_bytes)
            .map_err(|reason| MediaError::CorruptStoredRaster { id, reason })?;
        let handle = MediaHandle { id, width, height };
        let status = self.persist(&handle, &canonical_bytes)?;
        Ok(IngestResult { handle, status })
    }

    /// Look up and fully verify a canonical raster by its typed content id.
    ///
    /// Verification includes regular-file/path checks, bounded length, canonical header/length,
    /// current limits, and recomputing the BLAKE3 identity. The lookup therefore survives process
    /// restart without trusting an in-memory index.
    pub fn lookup(&self, id: ContentId) -> Result<Option<StoredRaster>, MediaError> {
        let Some(id_directory) = self.open_id_directory(id, false)? else {
            return Ok(None);
        };
        let logical_orig = self.id_path(id).join("orig");
        let Some(orig) = open_regular_file(&id_directory, "orig", &logical_orig)? else {
            // A crash before the atomic link may leave only the id directory. It is not a blob.
            return Ok(None);
        };
        let raster = self.read_verified(id, &id_directory, orig)?;
        self.verify_id_attached(id, &id_directory)?;
        self.verify_store_attached()?;
        Ok(Some(raster))
    }

    fn decode_bounded(&self, encoded: &[u8]) -> Result<DynamicImage, MediaError> {
        if encoded.len() > self.limits.max_encoded_bytes {
            return Err(MediaError::EncodedInputTooLarge {
                actual: encoded.len(),
                max: self.limits.max_encoded_bytes,
            });
        }

        let format = image::guess_format(encoded).map_err(|_| MediaError::UnsupportedFormat)?;
        if !matches!(format, ImageFormat::Png | ImageFormat::Jpeg) {
            return Err(MediaError::UnsupportedFormat);
        }

        let mut reader = ImageReader::with_format(Cursor::new(encoded), format);
        let mut initial_limits = Limits::default();
        initial_limits.max_image_width = None;
        initial_limits.max_image_height = None;
        initial_limits.max_alloc = Some(self.decoder_allocation_hint());
        reader.limits(initial_limits);
        let mut decoder = reader.into_decoder().map_err(map_decode_error)?;
        let (width, height) = decoder.dimensions();
        self.check_dimensions(width, height)?;
        self.check_decoded_bytes(decoder.total_bytes())?;
        let mut decode_limits = Limits::default();
        decode_limits.max_image_width = Some(self.limits.max_width);
        decode_limits.max_image_height = Some(self.limits.max_height);
        decode_limits.max_alloc = Some(self.decoder_allocation_hint());
        decoder
            .set_limits(decode_limits)
            .map_err(map_decode_error)?;

        // Orientation changes visible pixels and is therefore applied before all container
        // metadata is discarded. Other EXIF/XMP/IPTC/text/profile bytes never enter the raster.
        let orientation = decoder.orientation().map_err(map_decode_error)?;
        let mut image = DynamicImage::from_decoder(decoder).map_err(map_decode_error)?;
        image.apply_orientation(orientation);
        self.check_dimensions(image.width(), image.height())?;
        Ok(image)
    }

    fn check_dimensions(&self, width: u32, height: u32) -> Result<(), MediaError> {
        if width == 0
            || height == 0
            || width > self.limits.max_width
            || height > self.limits.max_height
        {
            return Err(MediaError::DimensionsExceeded {
                width,
                height,
                max_width: self.limits.max_width,
                max_height: self.limits.max_height,
            });
        }
        let pixels = u64::from(width) * u64::from(height);
        if pixels > self.limits.max_pixels {
            return Err(MediaError::PixelCountExceeded {
                pixels,
                max_pixels: self.limits.max_pixels,
            });
        }
        self.check_decoded_bytes(pixels.saturating_mul(BYTES_PER_CANONICAL_PIXEL))
    }

    fn check_decoded_bytes(&self, actual: u64) -> Result<(), MediaError> {
        if actual > self.limits.max_decoded_bytes {
            return Err(MediaError::DecodedBytesExceeded {
                actual,
                max: self.limits.max_decoded_bytes,
            });
        }
        Ok(())
    }

    fn decoder_allocation_hint(&self) -> u64 {
        self.limits
            .max_decoded_bytes
            .saturating_add(self.limits.max_encoded_bytes as u64)
            .saturating_add(DECODER_OVERHEAD_BYTES)
    }

    fn persist(
        &self,
        handle: &MediaHandle,
        canonical_bytes: &[u8],
    ) -> Result<IngestStatus, MediaError> {
        let id_directory = self
            .open_id_directory(handle.id, true)?
            .expect("create=true always opens the id directory");
        let (temp_name, mut temp_file) = create_private_temp(&id_directory)?;
        let mut cleanup = TempCleanup::new(&id_directory, temp_name.clone());
        temp_file.write_all(canonical_bytes)?;
        temp_file.sync_all()?;
        verify_attached_entry(
            &id_directory,
            &temp_name,
            &temp_file,
            &self.id_path(handle.id).join(&temp_name),
        )?;

        match rustix::fs::linkat(
            &id_directory,
            temp_name.as_str(),
            &id_directory,
            "orig",
            AtFlags::empty(),
        ) {
            Ok(()) => {
                let logical_orig = self.id_path(handle.id).join("orig");
                let final_file = open_regular_file(&id_directory, "orig", &logical_orig)?
                    .ok_or_else(|| MediaError::UnsafeStoragePath(logical_orig.clone()))?;
                if !same_open_file(&temp_file, &final_file)? {
                    let _ = rustix::fs::unlinkat(&id_directory, "orig", AtFlags::empty());
                    return Err(MediaError::UnsafeStoragePath(logical_orig));
                }
                rustix::fs::fchmod(&final_file, FILE_MODE).map_err(std::io::Error::from)?;
                final_file.sync_all()?;
                cleanup.remove_and_sync()?;
                sync_fd(&id_directory)?;
                verify_attached_entry(&id_directory, "orig", &final_file, &logical_orig)?;
                self.verify_id_attached(handle.id, &id_directory)?;
                self.verify_store_attached()?;
                Ok(IngestStatus::Stored)
            }
            Err(error) if error == rustix::io::Errno::EXIST => {
                let logical_orig = self.id_path(handle.id).join("orig");
                let existing = open_regular_file(&id_directory, "orig", &logical_orig)?
                    .ok_or(MediaError::UnsafeStoragePath(logical_orig))?;
                let status =
                    self.verify_existing(handle.id, &id_directory, existing, canonical_bytes)?;
                cleanup.remove_and_sync()?;
                self.verify_id_attached(handle.id, &id_directory)?;
                self.verify_store_attached()?;
                Ok(status)
            }
            Err(error) => Err(MediaError::Io(error.into())),
        }
    }

    fn verify_existing(
        &self,
        id: ContentId,
        id_directory: &File,
        existing: File,
        canonical_bytes: &[u8],
    ) -> Result<IngestStatus, MediaError> {
        let stored = self.read_verified(id, id_directory, existing)?;
        if stored.canonical_bytes != canonical_bytes {
            return Err(MediaError::ExistingRasterMismatch { id });
        }
        Ok(IngestStatus::AlreadyPresent)
    }

    fn id_path(&self, id: ContentId) -> PathBuf {
        let id_component = id.to_string();
        debug_assert_eq!(id_component.len(), CONTENT_ID_HEX_BYTES);
        debug_assert!(!id_component.contains(std::path::MAIN_SEPARATOR));
        self.root.join("blobs").join(id_component)
    }

    fn open_id_directory(&self, id: ContentId, create: bool) -> Result<Option<File>, MediaError> {
        self.verify_store_attached()?;
        let id_component = id.to_string();
        let logical_path = self.id_path(id);
        let opened =
            open_child_directory(&self.blobs_directory, &id_component, &logical_path, create)?;
        if let Some(directory) = &opened {
            self.verify_id_attached(id, directory)?;
        }
        self.verify_store_attached()?;
        Ok(opened)
    }

    fn verify_store_attached(&self) -> Result<(), MediaError> {
        verify_attached_entry(
            &self.root_directory,
            "blobs",
            &self.blobs_directory,
            &self.root.join("blobs"),
        )
    }

    fn verify_id_attached(&self, id: ContentId, directory: &File) -> Result<(), MediaError> {
        verify_attached_entry(
            &self.blobs_directory,
            &id.to_string(),
            directory,
            &self.id_path(id),
        )
    }

    fn read_verified(
        &self,
        id: ContentId,
        id_directory: &File,
        mut file: File,
    ) -> Result<StoredRaster, MediaError> {
        let logical_orig = self.id_path(id).join("orig");
        verify_attached_entry(id_directory, "orig", &file, &logical_orig)?;
        let metadata = file.metadata()?;
        let max_len = self
            .limits
            .max_decoded_bytes
            .checked_add(CANONICAL_HEADER_BYTES as u64)
            .ok_or_else(|| MediaError::CorruptStoredRaster {
                id,
                reason: "configured canonical length overflow".to_owned(),
            })?;
        if metadata.len() > max_len {
            return Err(MediaError::CorruptStoredRaster {
                id,
                reason: format!(
                    "file length {} exceeds configured maximum {max_len}",
                    metadata.len()
                ),
            });
        }

        let file_len =
            usize::try_from(metadata.len()).map_err(|_| MediaError::CorruptStoredRaster {
                id,
                reason: "canonical file length does not fit this platform".to_owned(),
            })?;
        let mut canonical_bytes = Vec::new();
        canonical_bytes.try_reserve_exact(file_len).map_err(|_| {
            MediaError::CorruptStoredRaster {
                id,
                reason: "canonical file length cannot be allocated".to_owned(),
            }
        })?;
        {
            let mut bounded = Read::by_ref(&mut file).take(max_len);
            bounded.read_to_end(&mut canonical_bytes)?;
        }
        let mut extra = [0_u8; 1];
        if file.read(&mut extra)? != 0 {
            return Err(MediaError::CorruptStoredRaster {
                id,
                reason: format!("file grew beyond configured maximum {max_len} while reading"),
            });
        }
        verify_attached_entry(id_directory, "orig", &file, &logical_orig)?;

        let (width, height) = parse_canonical_header(&canonical_bytes)
            .map_err(|reason| MediaError::CorruptStoredRaster { id, reason })?;
        self.check_dimensions(width, height)
            .map_err(|error| MediaError::CorruptStoredRaster {
                id,
                reason: error.to_string(),
            })?;
        let actual_id = ContentId::from_bytes(*blake3::hash(&canonical_bytes).as_bytes());
        if actual_id != id {
            return Err(MediaError::CorruptStoredRaster {
                id,
                reason: format!("BLAKE3 identity is {actual_id}"),
            });
        }
        // Existing-file success includes both inode and containing-directory durability, and
        // persists the permission repair performed after content verification.
        rustix::fs::fchmod(&file, FILE_MODE).map_err(std::io::Error::from)?;
        file.sync_all()?;
        sync_fd(id_directory)?;
        verify_attached_entry(id_directory, "orig", &file, &logical_orig)?;

        Ok(StoredRaster {
            handle: MediaHandle { id, width, height },
            canonical_bytes,
        })
    }
}

fn canonical_raster_bytes(image: DynamicImage) -> Result<Vec<u8>, MediaError> {
    let rgba = image.into_rgba8();
    let pixel_bytes = rgba.as_raw();
    let canonical_len = CANONICAL_HEADER_BYTES
        .checked_add(pixel_bytes.len())
        .ok_or(MediaError::CanonicalAllocationFailed { bytes: usize::MAX })?;
    let mut canonical = Vec::new();
    canonical.try_reserve_exact(canonical_len).map_err(|_| {
        MediaError::CanonicalAllocationFailed {
            bytes: canonical_len,
        }
    })?;
    canonical.extend_from_slice(CANONICAL_MAGIC);
    canonical.extend_from_slice(&rgba.width().to_be_bytes());
    canonical.extend_from_slice(&rgba.height().to_be_bytes());
    canonical.extend_from_slice(pixel_bytes);
    Ok(canonical)
}

fn parse_canonical_header(bytes: &[u8]) -> Result<(u32, u32), String> {
    if bytes.len() < CANONICAL_HEADER_BYTES {
        return Err(format!(
            "file is {} bytes; canonical header requires {CANONICAL_HEADER_BYTES}",
            bytes.len()
        ));
    }
    if &bytes[..CANONICAL_MAGIC.len()] != CANONICAL_MAGIC {
        return Err("canonical magic/version mismatch".to_owned());
    }

    let width = u32::from_be_bytes(
        bytes[8..12]
            .try_into()
            .expect("fixed-width header slice is four bytes"),
    );
    let height = u32::from_be_bytes(
        bytes[12..16]
            .try_into()
            .expect("fixed-width header slice is four bytes"),
    );
    let pixel_bytes = u64::from(width)
        .checked_mul(u64::from(height))
        .and_then(|pixels| pixels.checked_mul(BYTES_PER_CANONICAL_PIXEL))
        .ok_or_else(|| "canonical dimensions overflow byte length".to_owned())?;
    let expected = (CANONICAL_HEADER_BYTES as u64)
        .checked_add(pixel_bytes)
        .ok_or_else(|| "canonical file length overflow".to_owned())?;
    if bytes.len() as u64 != expected {
        return Err(format!(
            "file is {} bytes; {width}x{height} RGBA8 requires {expected}",
            bytes.len()
        ));
    }
    Ok((width, height))
}

fn map_decode_error(error: image::ImageError) -> MediaError {
    match error {
        image::ImageError::Unsupported(_) => MediaError::UnsupportedFormat,
        image::ImageError::Limits(limit) => MediaError::DecoderResourceLimit(limit.to_string()),
        other => MediaError::MalformedImage(other.to_string()),
    }
}

fn open_root_directory(path: &Path) -> Result<File, MediaError> {
    let owned = rustix::fs::open(path, directory_open_flags(), Mode::empty())
        .map_err(|error| map_open_error(error, path))?;
    let directory = File::from(owned);
    if !directory.metadata()?.is_dir() {
        return Err(MediaError::UnsafeStoragePath(path.to_owned()));
    }
    rustix::fs::fchmod(&directory, DIRECTORY_MODE).map_err(std::io::Error::from)?;
    sync_fd(&directory)?;
    Ok(directory)
}

fn open_child_directory(
    parent: &File,
    name: &str,
    logical_path: &Path,
    create: bool,
) -> Result<Option<File>, MediaError> {
    if create {
        match rustix::fs::mkdirat(parent, name, DIRECTORY_MODE) {
            Ok(()) => sync_fd(parent)?,
            Err(error) if error == rustix::io::Errno::EXIST => {}
            Err(error) => return Err(MediaError::Io(error.into())),
        }
    }

    let owned = match rustix::fs::openat(parent, name, directory_open_flags(), Mode::empty()) {
        Ok(owned) => owned,
        Err(error) if !create && error == rustix::io::Errno::NOENT => return Ok(None),
        Err(error) => return Err(map_open_error(error, logical_path)),
    };
    let directory = File::from(owned);
    if !directory.metadata()?.is_dir() {
        return Err(MediaError::UnsafeStoragePath(logical_path.to_owned()));
    }
    verify_attached_entry(parent, name, &directory, logical_path)?;
    rustix::fs::fchmod(&directory, DIRECTORY_MODE).map_err(std::io::Error::from)?;
    sync_fd(&directory)?;
    verify_attached_entry(parent, name, &directory, logical_path)?;
    Ok(Some(directory))
}

fn open_regular_file(
    parent: &File,
    name: &str,
    logical_path: &Path,
) -> Result<Option<File>, MediaError> {
    let flags = OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK;
    let owned = match rustix::fs::openat(parent, name, flags, Mode::empty()) {
        Ok(owned) => owned,
        Err(error) if error == rustix::io::Errno::NOENT => return Ok(None),
        Err(error) => return Err(map_open_error(error, logical_path)),
    };
    let file = File::from(owned);
    if !file.metadata()?.is_file() {
        return Err(MediaError::UnsafeStoragePath(logical_path.to_owned()));
    }
    verify_attached_entry(parent, name, &file, logical_path)?;
    Ok(Some(file))
}

fn directory_open_flags() -> OFlags {
    OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC
}

fn map_open_error(error: rustix::io::Errno, logical_path: &Path) -> MediaError {
    if matches!(error, rustix::io::Errno::LOOP | rustix::io::Errno::NOTDIR) {
        MediaError::UnsafeStoragePath(logical_path.to_owned())
    } else {
        MediaError::Io(error.into())
    }
}

fn verify_attached_entry(
    parent: &File,
    name: &str,
    opened: &File,
    logical_path: &Path,
) -> Result<(), MediaError> {
    let current = rustix::fs::statat(parent, name, AtFlags::SYMLINK_NOFOLLOW)
        .map_err(|_| MediaError::UnsafeStoragePath(logical_path.to_owned()))?;
    let held = rustix::fs::fstat(opened).map_err(std::io::Error::from)?;
    if current.st_dev != held.st_dev || current.st_ino != held.st_ino {
        return Err(MediaError::UnsafeStoragePath(logical_path.to_owned()));
    }
    Ok(())
}

fn same_open_file(left: &File, right: &File) -> Result<bool, MediaError> {
    let left = rustix::fs::fstat(left).map_err(std::io::Error::from)?;
    let right = rustix::fs::fstat(right).map_err(std::io::Error::from)?;
    Ok(left.st_dev == right.st_dev && left.st_ino == right.st_ino)
}

fn create_private_temp(directory: &File) -> Result<(String, File), MediaError> {
    for _ in 0..TEMP_CREATE_ATTEMPTS {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let name = format!(".orig.tmp.{}.{sequence}", std::process::id());
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
        "could not create a unique media temporary file",
    )))
}

fn sync_fd(file: &File) -> Result<(), MediaError> {
    rustix::fs::fsync(file).map_err(std::io::Error::from)?;
    Ok(())
}

struct TempCleanup<'a> {
    directory: &'a File,
    name: String,
    active: bool,
}

impl<'a> TempCleanup<'a> {
    fn new(directory: &'a File, name: String) -> Self {
        Self {
            directory,
            name,
            active: true,
        }
    }

    fn remove_and_sync(&mut self) -> Result<(), MediaError> {
        match rustix::fs::unlinkat(self.directory, self.name.as_str(), AtFlags::empty()) {
            Ok(()) => {}
            Err(error) if error == rustix::io::Errno::NOENT => {}
            Err(error) => return Err(MediaError::Io(error.into())),
        }
        sync_fd(self.directory)?;
        self.active = false;
        Ok(())
    }
}

impl Drop for TempCleanup<'_> {
    fn drop(&mut self) {
        if self.active {
            let _ = rustix::fs::unlinkat(self.directory, self.name.as_str(), AtFlags::empty());
            let _ = rustix::fs::fsync(self.directory);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};

    use super::*;
    use image::codecs::jpeg::JpegEncoder;
    use image::ExtendedColorType;
    use tempfile::tempdir;

    fn limits(
        max_encoded_bytes: usize,
        max_width: u32,
        max_height: u32,
        max_pixels: u64,
        max_decoded_bytes: u64,
    ) -> MediaLimits {
        MediaLimits::new(
            max_encoded_bytes,
            max_width,
            max_height,
            max_pixels,
            max_decoded_bytes,
        )
        .unwrap()
    }

    fn png_with_comment(width: u32, height: u32, comment: &str) -> Vec<u8> {
        let mut encoded = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut encoded, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .add_text_chunk("Comment".to_owned(), comment.to_owned())
                .unwrap();
            let mut writer = encoder.write_header().unwrap();
            let pixels: Vec<u8> = (0..u64::from(width) * u64::from(height))
                .flat_map(|index| {
                    [
                        (index % 251) as u8,
                        ((index * 3) % 251) as u8,
                        ((index * 7) % 251) as u8,
                        255,
                    ]
                })
                .collect();
            writer.write_image_data(&pixels).unwrap();
        }
        encoded
    }

    fn jpeg(width: u32, height: u32) -> Vec<u8> {
        let pixels: Vec<u8> = (0..u64::from(width) * u64::from(height))
            .flat_map(|index| {
                [
                    ((index * 83 + 17) % 251) as u8,
                    ((index * 47 + 61) % 251) as u8,
                    ((index * 29 + 103) % 251) as u8,
                ]
            })
            .collect();
        let mut encoded = Vec::new();
        JpegEncoder::new_with_quality(&mut encoded, 100)
            .encode(&pixels, width, height, ExtendedColorType::Rgb8)
            .unwrap();
        encoded
    }

    fn jpeg_with_app1(jpeg: &[u8], payload: &[u8]) -> Vec<u8> {
        assert!(jpeg.starts_with(&[0xff, 0xd8]));
        let segment_len = u16::try_from(payload.len() + 2).unwrap();
        let mut with_app1 = Vec::with_capacity(jpeg.len() + payload.len() + 4);
        with_app1.extend_from_slice(&jpeg[..2]);
        with_app1.extend_from_slice(&[0xff, 0xe1]);
        with_app1.extend_from_slice(&segment_len.to_be_bytes());
        with_app1.extend_from_slice(payload);
        with_app1.extend_from_slice(&jpeg[2..]);
        with_app1
    }

    fn exif_orientation_payload(orientation: u16) -> Vec<u8> {
        let mut payload = b"Exif\0\0".to_vec();
        payload.extend_from_slice(b"II");
        payload.extend_from_slice(&42_u16.to_le_bytes());
        payload.extend_from_slice(&8_u32.to_le_bytes());
        payload.extend_from_slice(&1_u16.to_le_bytes());
        payload.extend_from_slice(&0x0112_u16.to_le_bytes());
        payload.extend_from_slice(&3_u16.to_le_bytes());
        payload.extend_from_slice(&1_u32.to_le_bytes());
        payload.extend_from_slice(&orientation.to_le_bytes());
        payload.extend_from_slice(&0_u16.to_le_bytes());
        payload.extend_from_slice(&0_u32.to_le_bytes());
        payload
    }

    fn content_id_for(store: &MediaStore, encoded: &[u8]) -> ContentId {
        let decoded = store.decode_bounded(encoded).unwrap();
        let canonical = canonical_raster_bytes(decoded).unwrap();
        ContentId::from_bytes(*blake3::hash(&canonical).as_bytes())
    }

    fn retained_blob_count(store: &MediaStore) -> usize {
        fs::read_dir(store.root.join("blobs")).unwrap().count()
    }

    #[cfg(unix)]
    fn unix_mode(path: &Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;

        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn metadata_only_variants_deduplicate_and_restart_lookup_works() {
        let directory = tempdir().unwrap();
        let first = png_with_comment(2, 2, "GPS and device metadata A");
        let second = png_with_comment(2, 2, "different metadata B");
        assert_ne!(first, second);

        let first_result = {
            let store = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
            let first_result = store.ingest(&first).unwrap();
            assert_eq!(first_result.status(), IngestStatus::Stored);
            let second_result = store.ingest(&second).unwrap();
            assert_eq!(second_result.status(), IngestStatus::AlreadyPresent);
            assert_eq!(first_result.handle(), second_result.handle());
            first_result
        };

        let restarted = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
        let loaded = restarted
            .lookup(first_result.handle().id())
            .unwrap()
            .expect("persisted raster should be found after restart");
        assert_eq!(loaded.handle(), first_result.handle());
        assert_eq!(loaded.handle().width(), 2);
        assert_eq!(loaded.handle().height(), 2);
        assert_eq!(loaded.rgba8_pixels().len(), 16);
        assert!(!loaded
            .canonical_bytes()
            .windows("metadata".len())
            .any(|window| window == b"metadata"));
    }

    #[test]
    fn jpeg_app1_metadata_deduplicates_without_retention() {
        let directory = tempdir().unwrap();
        let store = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
        let base = jpeg(3, 2);
        let marker_a = b"http://ns.adobe.com/xap/1.0/\0private-app1-metadata-a";
        let marker_b = b"http://ns.adobe.com/xap/1.0/\0private-app1-metadata-b";
        let first = jpeg_with_app1(&base, marker_a);
        let second = jpeg_with_app1(&base, marker_b);

        let first_result = store.ingest(&first).unwrap();
        let second_result = store.ingest(&second).unwrap();
        assert_eq!(first_result.status(), IngestStatus::Stored);
        assert_eq!(second_result.status(), IngestStatus::AlreadyPresent);
        assert_eq!(first_result.handle(), second_result.handle());

        let loaded = store.lookup(first_result.handle().id()).unwrap().unwrap();
        assert!(!loaded
            .canonical_bytes()
            .windows(b"private-app1-metadata".len())
            .any(|window| window == b"private-app1-metadata"));
    }

    #[test]
    fn jpeg_exif_orientation_is_applied_to_dimensions_and_pixels() {
        let directory = tempdir().unwrap();
        let store = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
        let base = jpeg(2, 1);
        let oriented = jpeg_with_app1(&base, &exif_orientation_payload(6));

        let unrotated = store.decode_bounded(&base).unwrap().into_rgba8();
        let expected = DynamicImage::ImageRgba8(unrotated).rotate90().into_rgba8();
        let result = store.ingest(&oriented).unwrap();
        let loaded = store.lookup(result.handle().id()).unwrap().unwrap();

        assert_eq!((result.handle().width(), result.handle().height()), (1, 2));
        assert_eq!(loaded.rgba8_pixels(), expected.as_raw());
        assert_ne!(result.handle().id(), content_id_for(&store, &base));
    }

    #[test]
    fn malformed_and_limited_jpegs_retain_no_blob() {
        let base = jpeg(3, 2);

        let malformed_directory = tempdir().unwrap();
        let malformed_store =
            MediaStore::open(malformed_directory.path(), MediaLimits::default()).unwrap();
        let truncated = &base[..20];
        assert!(matches!(
            malformed_store.ingest(truncated).unwrap_err(),
            MediaError::MalformedImage(_) | MediaError::DecoderResourceLimit(_)
        ));
        assert_eq!(retained_blob_count(&malformed_store), 0);

        let limited_directory = tempdir().unwrap();
        let limited_store = MediaStore::open(
            limited_directory.path(),
            limits(base.len() - 1, 3, 2, 6, 24),
        )
        .unwrap();
        assert!(matches!(
            limited_store.ingest(&base).unwrap_err(),
            MediaError::EncodedInputTooLarge { .. }
        ));
        assert_eq!(retained_blob_count(&limited_store), 0);

        let dimension_directory = tempdir().unwrap();
        let dimension_store =
            MediaStore::open(dimension_directory.path(), limits(4096, 2, 2, 6, 24)).unwrap();
        assert!(matches!(
            dimension_store.ingest(&base).unwrap_err(),
            MediaError::DimensionsExceeded {
                width: 3,
                height: 2,
                ..
            }
        ));
        assert_eq!(retained_blob_count(&dimension_store), 0);
    }

    #[test]
    fn rejects_oversized_encoded_input_before_format_detection() {
        let directory = tempdir().unwrap();
        let store = MediaStore::open(directory.path(), limits(8, 10, 10, 100, 400)).unwrap();
        let error = store.ingest(&[0_u8; 9]).unwrap_err();
        assert!(matches!(
            error,
            MediaError::EncodedInputTooLarge { actual: 9, max: 8 }
        ));
    }

    #[test]
    fn rejects_malformed_and_unsupported_inputs() {
        let directory = tempdir().unwrap();
        let store = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();

        let malformed_png = b"\x89PNG\r\n\x1a\nnot-a-real-png";
        assert!(matches!(
            store.ingest(malformed_png).unwrap_err(),
            MediaError::MalformedImage(_)
        ));
        let gif = b"GIF89a\x01\x00\x01\x00";
        assert!(matches!(
            store.ingest(gif).unwrap_err(),
            MediaError::UnsupportedFormat
        ));
    }

    #[test]
    fn rejects_dimension_pixel_and_decoded_byte_overruns() {
        let encoded = png_with_comment(3, 2, "bounded");

        let width_directory = tempdir().unwrap();
        let width_store =
            MediaStore::open(width_directory.path(), limits(4096, 2, 3, 6, 24)).unwrap();
        let width_error = width_store.ingest(&encoded).unwrap_err();
        assert!(
            matches!(
                &width_error,
                MediaError::DimensionsExceeded {
                    width: 3,
                    height: 2,
                    ..
                }
            ),
            "unexpected error: {width_error:?}"
        );

        let pixel_directory = tempdir().unwrap();
        let pixel_store =
            MediaStore::open(pixel_directory.path(), limits(4096, 3, 3, 5, 24)).unwrap();
        assert!(matches!(
            pixel_store.ingest(&encoded).unwrap_err(),
            MediaError::PixelCountExceeded {
                pixels: 6,
                max_pixels: 5
            }
        ));

        let byte_directory = tempdir().unwrap();
        let byte_store =
            MediaStore::open(byte_directory.path(), limits(4096, 3, 3, 6, 23)).unwrap();
        assert!(matches!(
            byte_store.ingest(&encoded).unwrap_err(),
            MediaError::DecodedBytesExceeded {
                actual: 24,
                max: 23
            }
        ));
    }

    #[test]
    fn concurrent_ingest_installs_one_complete_blob() {
        let directory = tempdir().unwrap();
        let store = Arc::new(MediaStore::open(directory.path(), MediaLimits::default()).unwrap());
        let encoded = Arc::new(png_with_comment(8, 8, "same upload"));
        let barrier = Arc::new(Barrier::new(8));
        let mut threads = Vec::new();

        for _ in 0..8 {
            let store = Arc::clone(&store);
            let encoded = Arc::clone(&encoded);
            let barrier = Arc::clone(&barrier);
            threads.push(std::thread::spawn(move || {
                barrier.wait();
                store.ingest(&encoded).unwrap()
            }));
        }

        let results: Vec<_> = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect();
        assert_eq!(
            results
                .iter()
                .filter(|result| result.status() == IngestStatus::Stored)
                .count(),
            1
        );
        assert!(results
            .iter()
            .all(|result| result.handle() == results[0].handle()));
        let loaded = store
            .lookup(results[0].handle().id())
            .unwrap()
            .expect("the winning atomic install should be readable");
        assert_eq!(loaded.rgba8_pixels().len(), 8 * 8 * 4);

        let blob_directory = store.id_path(results[0].handle().id());
        assert_eq!(fs::read_dir(blob_directory).unwrap().count(), 1);
    }

    #[test]
    fn content_ids_are_strict_safe_path_components() {
        for invalid in [
            "../../outside",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg",
        ] {
            assert!(invalid.parse::<ContentId>().is_err(), "accepted {invalid}");
        }

        let valid = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            .parse::<ContentId>()
            .unwrap();
        assert_eq!(valid.to_string().len(), CONTENT_ID_HEX_BYTES);

        let directory = tempdir().unwrap();
        let store = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
        store.open_id_directory(valid, true).unwrap();
        let path = store.id_path(valid).join("orig");
        assert_eq!(path.file_name().unwrap(), "orig");
        assert_eq!(
            path.parent().unwrap().parent().unwrap(),
            store.root.join("blobs")
        );
    }

    #[cfg(unix)]
    #[test]
    fn unix_permissions_are_private_for_new_and_existing_entries() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().unwrap();
        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o777)).unwrap();
        let blobs = directory.path().join("blobs");
        fs::create_dir(&blobs).unwrap();
        fs::set_permissions(&blobs, fs::Permissions::from_mode(0o777)).unwrap();

        let store = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
        assert_eq!(unix_mode(directory.path()), 0o700);
        assert_eq!(unix_mode(&blobs), 0o700);

        let result = store.ingest(&png_with_comment(2, 2, "private")).unwrap();
        let id_directory = store.id_path(result.handle().id());
        let orig = id_directory.join("orig");
        assert_eq!(unix_mode(&id_directory), 0o700);
        assert_eq!(unix_mode(&orig), 0o600);

        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o777)).unwrap();
        fs::set_permissions(&blobs, fs::Permissions::from_mode(0o777)).unwrap();
        fs::set_permissions(&id_directory, fs::Permissions::from_mode(0o777)).unwrap();
        fs::set_permissions(&orig, fs::Permissions::from_mode(0o666)).unwrap();
        drop(store);

        let reopened = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
        reopened.lookup(result.handle().id()).unwrap().unwrap();
        assert_eq!(unix_mode(directory.path()), 0o700);
        assert_eq!(unix_mode(&blobs), 0o700);
        assert_eq!(unix_mode(&id_directory), 0o700);
        assert_eq!(unix_mode(&orig), 0o600);

        let temp_id = ContentId::from_bytes([11; CONTENT_ID_BYTES]);
        let temp_directory = reopened.open_id_directory(temp_id, true).unwrap().unwrap();
        let (temp_name, temp_file) = create_private_temp(&temp_directory).unwrap();
        assert_eq!(
            temp_file.metadata().unwrap().permissions().mode() & 0o777,
            0o600
        );
        let mut cleanup = TempCleanup::new(&temp_directory, temp_name.clone());
        cleanup.remove_and_sync().unwrap();
        assert!(!reopened.id_path(temp_id).join(temp_name).exists());
    }

    #[cfg(unix)]
    #[test]
    fn swapped_blobs_symlink_rejects_ingest_and_lookup_without_touching_outside() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let store = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
        let encoded = png_with_comment(2, 2, "blobs swap");
        let id = content_id_for(&store, &encoded);
        let blobs = store.root.join("blobs");
        fs::rename(&blobs, store.root.join("held-blobs")).unwrap();
        symlink(outside.path(), &blobs).unwrap();

        let ingest_error = store.ingest(&encoded).unwrap_err();
        assert!(
            matches!(&ingest_error, MediaError::UnsafeStoragePath(path) if path == &blobs),
            "unexpected ingest error: {ingest_error:?}"
        );
        let lookup_error = store.lookup(id).unwrap_err();
        assert!(
            matches!(&lookup_error, MediaError::UnsafeStoragePath(path) if path == &blobs),
            "unexpected lookup error: {lookup_error:?}"
        );
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn swapped_id_symlink_rejects_ingest_and_lookup_without_touching_outside() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let marker = outside.path().join("marker");
        fs::write(&marker, b"untouched").unwrap();
        let store = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
        let encoded = png_with_comment(2, 2, "id swap");
        let id = content_id_for(&store, &encoded);
        let id_path = store.id_path(id);
        fs::create_dir(&id_path).unwrap();
        fs::rename(&id_path, store.root.join("blobs").join("held-id")).unwrap();
        symlink(outside.path(), &id_path).unwrap();

        assert!(matches!(
            store.ingest(&encoded).unwrap_err(),
            MediaError::UnsafeStoragePath(path) if path == id_path
        ));
        assert!(matches!(
            store.lookup(id).unwrap_err(),
            MediaError::UnsafeStoragePath(path) if path == id_path
        ));
        assert_eq!(fs::read(&marker).unwrap(), b"untouched");
        assert!(!outside.path().join("orig").exists());
    }

    #[cfg(unix)]
    #[test]
    fn swapped_orig_symlink_rejects_ingest_and_lookup_without_touching_outside() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let store = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
        let encoded = png_with_comment(2, 2, "orig swap");
        let result = store.ingest(&encoded).unwrap();
        let id_path = store.id_path(result.handle().id());
        let orig = id_path.join("orig");
        fs::rename(&orig, id_path.join("saved-orig")).unwrap();
        let outside_target = outside.path().join("target");
        fs::write(&outside_target, b"outside-untouched").unwrap();
        symlink(&outside_target, &orig).unwrap();

        assert!(matches!(
            store.lookup(result.handle().id()).unwrap_err(),
            MediaError::UnsafeStoragePath(path) if path == orig
        ));
        assert!(matches!(
            store.ingest(&encoded).unwrap_err(),
            MediaError::UnsafeStoragePath(path) if path == orig
        ));
        assert_eq!(fs::read(&outside_target).unwrap(), b"outside-untouched");
        assert!(!fs::read_dir(&id_path).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".orig.tmp.")));
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_handle_directory_cannot_escape_the_root() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let store = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
        let id = ContentId::from_bytes([7; CONTENT_ID_BYTES]);
        let handle_directory = store.id_path(id);
        symlink(outside.path(), &handle_directory).unwrap();

        assert!(matches!(
            store.lookup(id).unwrap_err(),
            MediaError::UnsafeStoragePath(path) if path == handle_directory
        ));
    }

    #[test]
    fn corrupted_stored_bytes_are_rejected_on_lookup() {
        let directory = tempdir().unwrap();
        let store = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
        let result = store.ingest(&png_with_comment(2, 1, "original")).unwrap();
        let path = store.id_path(result.handle().id()).join("orig");
        let mut bytes = fs::read(&path).unwrap();
        *bytes.last_mut().unwrap() ^= 0xff;
        fs::write(path, bytes).unwrap();

        assert!(matches!(
            store.lookup(result.handle().id()).unwrap_err(),
            MediaError::CorruptStoredRaster { .. }
        ));
    }

    #[test]
    fn empty_crash_leftover_directory_is_not_a_blob() {
        let directory = tempdir().unwrap();
        let store = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
        let id = ContentId::from_bytes([9; CONTENT_ID_BYTES]);
        store.open_id_directory(id, true).unwrap();

        assert_eq!(store.lookup(id).unwrap(), None);
    }

    #[test]
    fn storage_root_must_be_preprovisioned() {
        let parent = tempdir().unwrap();
        let missing = parent.path().join("operator-must-create-this");

        assert!(matches!(
            MediaStore::open(&missing, MediaLimits::default()).unwrap_err(),
            MediaError::Io(error) if error.kind() == io::ErrorKind::NotFound
        ));
        assert!(!missing.exists());
    }
}
