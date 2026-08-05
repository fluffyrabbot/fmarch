use std::fmt;
use std::sync::Arc;

use bytes::Bytes;
use object_store::aws::AmazonS3Builder;
use object_store::memory::InMemory;
use object_store::path::Path as ObjectPath;
use object_store::{ObjectStore, ObjectStoreExt, PutMode};

use super::variants::{
    check_variant_dimensions, corrupt_set, fitted_dimensions, parse_manifest, prepare_upload,
    verify_member_bytes, MANIFEST_MAX_BYTES, MANIFEST_NAME,
};
use super::*;

/// Explicit S3-compatible connection settings. Credentials are deliberately supplied by the
/// composition root instead of discovered ambiently inside the media domain.
#[derive(Clone)]
pub struct S3MediaConfig {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub virtual_hosted_style: bool,
    pub allow_http: bool,
}

impl fmt::Debug for S3MediaConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("S3MediaConfig")
            .field("endpoint", &self.endpoint)
            .field("region", &self.region)
            .field("bucket", &self.bucket)
            .field("access_key_id", &"<redacted>")
            .field("secret_access_key", &"<redacted>")
            .field("virtual_hosted_style", &self.virtual_hosted_style)
            .field("allow_http", &self.allow_http)
            .finish()
    }
}

#[derive(Clone)]
enum RepositoryBackend {
    Local(MediaStore),
    Object(Arc<dyn ObjectStore>),
}

/// Async media boundary used by API replicas.
///
/// Production construction is S3-only. The local backend remains an explicit test adapter for the
/// existing filesystem hardening suite; there is no runtime fallback from S3 to local storage.
#[derive(Clone)]
pub struct MediaRepository {
    backend: RepositoryBackend,
    limits: MediaLimits,
}

impl fmt::Debug for MediaRepository {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let backend = match &self.backend {
            RepositoryBackend::Local(_) => "local-test-adapter",
            RepositoryBackend::Object(_) => "object-store",
        };
        formatter
            .debug_struct("MediaRepository")
            .field("backend", &backend)
            .field("limits", &self.limits)
            .finish()
    }
}

impl From<MediaStore> for MediaRepository {
    fn from(store: MediaStore) -> Self {
        let limits = store.limits();
        Self {
            backend: RepositoryBackend::Local(store),
            limits,
        }
    }
}

impl MediaRepository {
    pub fn s3(config: S3MediaConfig, limits: MediaLimits) -> Result<Self, MediaError> {
        limits.validate()?;
        let store = AmazonS3Builder::new()
            .with_endpoint(config.endpoint)
            .with_region(config.region)
            .with_bucket_name(config.bucket)
            .with_access_key_id(config.access_key_id)
            .with_secret_access_key(config.secret_access_key)
            .with_virtual_hosted_style_request(config.virtual_hosted_style)
            .with_allow_http(config.allow_http)
            .build()
            .map_err(|error| object_error("configure", error))?;
        Ok(Self::object(Arc::new(store), limits))
    }

    /// Shared, process-local object storage for deterministic replica contract tests.
    pub fn in_memory(limits: MediaLimits) -> Result<Self, MediaError> {
        limits.validate()?;
        Ok(Self::object(Arc::new(InMemory::new()), limits))
    }

    fn object(store: Arc<dyn ObjectStore>, limits: MediaLimits) -> Self {
        Self {
            backend: RepositoryBackend::Object(store),
            limits,
        }
    }

    pub fn limits(&self) -> MediaLimits {
        self.limits
    }

    pub async fn prepare_and_commit_upload(
        &self,
        encoded: Vec<u8>,
        variant_limits: VariantLimits,
    ) -> Result<MediaUploadCommitResult, MediaError> {
        match &self.backend {
            RepositoryBackend::Local(store) => {
                let store = store.clone();
                tokio::task::spawn_blocking(move || {
                    let prepared = store.prepare_upload(&encoded, variant_limits)?;
                    store.commit_prepared_upload(prepared)
                })
                .await
                .map_err(join_error)?
            }
            RepositoryBackend::Object(store) => {
                let media_limits = self.limits;
                let prepared = tokio::task::spawn_blocking(move || {
                    prepare_upload(&encoded, media_limits, variant_limits)
                })
                .await
                .map_err(join_error)??;
                commit_object_upload(store.as_ref(), prepared).await
            }
        }
    }

    pub async fn lookup_variant_set(
        &self,
        id: ContentId,
        limits: VariantLimits,
    ) -> Result<Option<VariantSet>, MediaError> {
        match &self.backend {
            RepositoryBackend::Local(store) => {
                let store = store.clone();
                tokio::task::spawn_blocking(move || store.lookup_variant_set(id, limits))
                    .await
                    .map_err(join_error)?
            }
            RepositoryBackend::Object(store) => {
                Ok(
                    lookup_object_snapshot(store.as_ref(), self.limits, id, limits, None)
                        .await?
                        .map(|snapshot| snapshot.0),
                )
            }
        }
    }

    pub async fn lookup_variant(
        &self,
        id: ContentId,
        format: VariantFormat,
        kind: VariantKind,
        limits: VariantLimits,
    ) -> Result<Option<StoredVariant>, MediaError> {
        match &self.backend {
            RepositoryBackend::Local(store) => {
                let store = store.clone();
                tokio::task::spawn_blocking(move || store.lookup_variant(id, format, kind, limits))
                    .await
                    .map_err(join_error)?
            }
            RepositoryBackend::Object(store) => Ok(lookup_object_snapshot(
                store.as_ref(),
                self.limits,
                id,
                limits,
                Some((format, kind)),
            )
            .await?
            .and_then(|snapshot| snapshot.1)),
        }
    }
}

async fn commit_object_upload(
    store: &dyn ObjectStore,
    prepared: PreparedMediaUpload,
) -> Result<MediaUploadCommitResult, MediaError> {
    let id = prepared.handle.id();
    let original = object_path(&format!("blobs/{id}/orig"))?;
    let original_stored = put_immutable(store, &original, &prepared.canonical_bytes).await?;
    for member in &prepared.variants.members {
        let path = variant_object_path(member.record.key())?;
        put_immutable(store, &path, &member.encoded_bytes).await?;
    }
    let manifest = object_path(&format!(
        "blobs/{id}/{VARIANT_RECIPE_REVISION}/{MANIFEST_NAME}"
    ))?;
    let manifest_stored = put_immutable(store, &manifest, &prepared.variants.manifest).await?;
    let set = prepared.variants.set;
    Ok(MediaUploadCommitResult {
        ingest: IngestResult {
            handle: prepared.handle,
            status: if original_stored {
                IngestStatus::Stored
            } else {
                IngestStatus::AlreadyPresent
            },
        },
        variants: VariantGenerationResult {
            set,
            status: if manifest_stored {
                VariantGenerationStatus::Stored
            } else {
                VariantGenerationStatus::AlreadyPresent
            },
        },
    })
}

async fn put_immutable(
    store: &dyn ObjectStore,
    path: &ObjectPath,
    bytes: &[u8],
) -> Result<bool, MediaError> {
    match store
        .put_opts(
            path,
            Bytes::copy_from_slice(bytes).into(),
            PutMode::Create.into(),
        )
        .await
    {
        Ok(_) => Ok(true),
        Err(object_store::Error::AlreadyExists { .. }) => {
            let existing = get_bounded(store, path, bytes.len() as u64, "read-existing")
                .await?
                .ok_or_else(|| MediaError::ObjectStore {
                    operation: "read-existing",
                    reason: format!("immutable object {path} vanished after create conflict"),
                })?;
            if existing.as_ref() != bytes {
                return Err(MediaError::ObjectStore {
                    operation: "verify-existing",
                    reason: format!("immutable object {path} differs from canonical bytes"),
                });
            }
            Ok(false)
        }
        Err(error) => Err(object_error("put-create", error)),
    }
}

async fn lookup_object_snapshot(
    store: &dyn ObjectStore,
    media_limits: MediaLimits,
    id: ContentId,
    limits: VariantLimits,
    requested: Option<(VariantFormat, VariantKind)>,
) -> Result<Option<(VariantSet, Option<StoredVariant>)>, MediaError> {
    limits.validate()?;
    let manifest_path = object_path(&format!(
        "blobs/{id}/{VARIANT_RECIPE_REVISION}/{MANIFEST_NAME}"
    ))?;
    let Some(manifest) =
        get_bounded(store, &manifest_path, MANIFEST_MAX_BYTES, "get-manifest").await?
    else {
        return Ok(None);
    };
    let set = parse_manifest(id, &manifest)?;
    let original_path = object_path(&format!("blobs/{id}/orig"))?;
    let max_original = media_limits
        .max_decoded_bytes()
        .saturating_add(CANONICAL_HEADER_BYTES as u64);
    let original = get_bounded(store, &original_path, max_original, "get-original")
        .await?
        .ok_or_else(|| corrupt_set(id, "manifest exists without canonical orig"))?;
    let (source_width, source_height) = parse_canonical_header(&original)
        .map_err(|reason| MediaError::CorruptStoredRaster { id, reason })?;
    check_dimensions(media_limits, source_width, source_height).map_err(|error| {
        MediaError::CorruptStoredRaster {
            id,
            reason: error.to_string(),
        }
    })?;
    let actual_id = ContentId::from_bytes(*blake3::hash(&original).as_bytes());
    if actual_id != id {
        return Err(MediaError::CorruptStoredRaster {
            id,
            reason: format!("BLAKE3 identity is {actual_id}"),
        });
    }
    if (set.source_width, set.source_height) != (source_width, source_height) {
        return Err(corrupt_set(
            id,
            "manifest source dimensions do not match canonical orig",
        ));
    }

    let mut aggregate = 0_u64;
    let mut requested_variant = None;
    for record in &set.variants {
        let expected = fitted_dimensions(
            source_width,
            source_height,
            record.key.kind().maximum_dimensions(),
        )?;
        if (record.width, record.height) != expected {
            return Err(corrupt_set(
                id,
                &format!("{} dimensions do not match the fixed policy", record.key),
            ));
        }
        check_variant_dimensions(record.key, record.width, record.height, limits)?;
        if record.encoded_len > limits.max_member_encoded_bytes() as u64 {
            return Err(MediaError::VariantEncodedBytesExceeded {
                key: record.key,
                max: limits.max_member_encoded_bytes(),
            });
        }
        let path = variant_object_path(record.key)?;
        let bytes = get_bounded(store, &path, record.encoded_len, "get-variant")
            .await?
            .ok_or_else(|| corrupt_set(id, &format!("{} member is missing", record.key)))?;
        verify_member_bytes(id, record, &bytes)?;
        aggregate = aggregate
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| corrupt_set(id, "variant aggregate encoded length overflow"))?;
        if aggregate > limits.max_total_encoded_bytes() {
            return Err(MediaError::VariantAggregateBytesExceeded {
                id,
                max: limits.max_total_encoded_bytes(),
            });
        }
        if requested == Some((record.key.format(), record.key.kind())) {
            requested_variant = Some(StoredVariant {
                record: record.clone(),
                encoded_bytes: bytes.to_vec(),
            });
        }
    }
    if requested.is_some() && requested_variant.is_none() {
        return Err(corrupt_set(
            id,
            "requested role is absent from the fixed manifest",
        ));
    }
    Ok(Some((set, requested_variant)))
}

async fn get_bounded(
    store: &dyn ObjectStore,
    path: &ObjectPath,
    max_len: u64,
    operation: &'static str,
) -> Result<Option<Bytes>, MediaError> {
    let metadata = match store.head(path).await {
        Ok(metadata) => metadata,
        Err(object_store::Error::NotFound { .. }) => return Ok(None),
        Err(error) => return Err(object_error(operation, error)),
    };
    if metadata.size > max_len {
        return Err(MediaError::ObjectStore {
            operation,
            reason: format!(
                "object {path} is {} bytes; limit is {max_len}",
                metadata.size
            ),
        });
    }
    let bytes = store
        .get(path)
        .await
        .map_err(|error| object_error(operation, error))?
        .bytes()
        .await
        .map_err(|error| object_error(operation, error))?;
    if bytes.len() as u64 > max_len {
        return Err(MediaError::ObjectStore {
            operation,
            reason: format!("object {path} grew beyond the {max_len}-byte limit"),
        });
    }
    Ok(Some(bytes))
}

fn variant_object_path(key: VariantKey) -> Result<ObjectPath, MediaError> {
    object_path(&format!("blobs/{key}"))
}

fn object_path(value: &str) -> Result<ObjectPath, MediaError> {
    ObjectPath::parse(value).map_err(|error| MediaError::ObjectStore {
        operation: "construct-key",
        reason: error.to_string(),
    })
}

fn object_error(operation: &'static str, error: object_store::Error) -> MediaError {
    MediaError::ObjectStore {
        operation,
        reason: error.to_string(),
    }
}

fn join_error(error: tokio::task::JoinError) -> MediaError {
    MediaError::ObjectStore {
        operation: "cpu-worker",
        reason: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, ImageFormat, Rgba};
    use std::io::Cursor;

    fn png() -> Vec<u8> {
        let image = ImageBuffer::from_pixel(4, 3, Rgba([12_u8, 34, 56, 255]));
        let mut bytes = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        bytes
    }

    #[tokio::test]
    async fn shared_object_repository_cross_replica_round_trip_is_idempotent() {
        let first = MediaRepository::in_memory(MediaLimits::default()).unwrap();
        let second = first.clone();
        let committed = first
            .prepare_and_commit_upload(png(), VariantLimits::default())
            .await
            .unwrap();
        assert_eq!(committed.ingest().status(), IngestStatus::Stored);
        let id = committed.ingest().handle().id();
        let variant = second
            .lookup_variant(
                id,
                VariantFormat::Webp,
                VariantKind::Tablet,
                VariantLimits::default(),
            )
            .await
            .unwrap()
            .unwrap();
        assert!(!variant.encoded_bytes().is_empty());
        let repeated = second
            .prepare_and_commit_upload(png(), VariantLimits::default())
            .await
            .unwrap();
        assert_eq!(repeated.ingest().status(), IngestStatus::AlreadyPresent);
        assert_eq!(
            repeated.variants().status(),
            VariantGenerationStatus::AlreadyPresent
        );
    }
}
