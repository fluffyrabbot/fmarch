use std::fmt;
use std::sync::Arc;

use bytes::Bytes;
use object_store::aws::AmazonS3Builder;
use object_store::memory::InMemory;
use object_store::path::Path as ObjectPath;
use object_store::{ObjectStore, ObjectStoreExt, PutMode};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use url::Url;

use super::variants::{
    corrupt_set, parse_manifest, prepare_upload, validate_manifest_policy, verify_member_bytes,
    MANIFEST_MAX_BYTES, MANIFEST_NAME,
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

/// Process-local admission for private repository reads. Request slots bound operation fan-out,
/// while byte permits bound object-fetch payloads and leased response bodies. The local test
/// adapter applies the same admission contract, but its `MediaStore` can additionally retain a
/// canonical backing allocation governed by [`MediaLimits`]; this is not a total-process memory
/// budget.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MediaReadLimits {
    max_in_flight: usize,
    max_in_flight_bytes: usize,
}

impl MediaReadLimits {
    pub fn new(max_in_flight: usize, max_in_flight_bytes: usize) -> Result<Self, MediaError> {
        if max_in_flight == 0 || max_in_flight > Semaphore::MAX_PERMITS {
            return Err(MediaError::InvalidReadLimits(
                "max_in_flight must be between one and the semaphore capacity",
            ));
        }
        if max_in_flight_bytes < MANIFEST_MAX_BYTES as usize
            || max_in_flight_bytes > u32::MAX as usize
        {
            return Err(MediaError::InvalidReadLimits(
                "max_in_flight_bytes must hold a manifest and fit the byte semaphore",
            ));
        }
        Ok(Self {
            max_in_flight,
            max_in_flight_bytes,
        })
    }

    pub fn max_in_flight(self) -> usize {
        self.max_in_flight
    }

    pub fn max_in_flight_bytes(self) -> usize {
        self.max_in_flight_bytes
    }

    /// Minimum capacity for one manifest plus one maximum-sized fetched/response member. Both
    /// adapters use this admission invariant; it does not include the local test store's canonical
    /// backing allocation.
    pub fn required_in_flight_bytes(variant_limits: VariantLimits) -> Result<usize, MediaError> {
        variant_limits.validate()?;
        let manifest_bytes = usize::try_from(MANIFEST_MAX_BYTES).map_err(|_| {
            MediaError::InvalidReadLimits("manifest size does not fit process byte capacity")
        })?;
        manifest_bytes
            .checked_add(variant_limits.max_member_encoded_bytes())
            .ok_or(MediaError::InvalidReadLimits(
                "manifest and member read capacity overflowed",
            ))
    }

    pub fn validate_for_variants(self, variant_limits: VariantLimits) -> Result<(), MediaError> {
        let required = Self::required_in_flight_bytes(variant_limits)?;
        if self.max_in_flight_bytes < required {
            return Err(MediaError::InvalidReadLimits(
                "max_in_flight_bytes must hold one manifest and one maximum-sized member",
            ));
        }
        Ok(())
    }
}

impl Default for MediaReadLimits {
    fn default() -> Self {
        Self {
            max_in_flight: 16,
            max_in_flight_bytes: 64 * 1024 * 1024,
        }
    }
}

#[derive(Clone)]
struct MediaReadAdmission {
    requests: Arc<Semaphore>,
    bytes: Arc<Semaphore>,
}

impl fmt::Debug for MediaReadAdmission {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MediaReadAdmission")
            .field("available_requests", &self.requests.available_permits())
            .field("available_bytes", &self.bytes.available_permits())
            .finish()
    }
}

impl MediaReadAdmission {
    fn new(limits: MediaReadLimits) -> Self {
        Self {
            requests: Arc::new(Semaphore::new(limits.max_in_flight)),
            bytes: Arc::new(Semaphore::new(limits.max_in_flight_bytes)),
        }
    }

    fn acquire_request(&self) -> Result<OwnedSemaphorePermit, MediaError> {
        self.requests
            .clone()
            .try_acquire_owned()
            .map_err(|_| MediaError::ReadCapacityExhausted {
                resource: "request",
            })
    }

    fn acquire_bytes(&self, bytes: u64) -> Result<OwnedSemaphorePermit, MediaError> {
        let bytes = u32::try_from(bytes)
            .map_err(|_| MediaError::ReadCapacityExhausted { resource: "byte" })?;
        self.bytes
            .clone()
            .try_acquire_many_owned(bytes)
            .map_err(|_| MediaError::ReadCapacityExhausted { resource: "byte" })
    }
}

struct LeasedBytesOwner {
    bytes: Bytes,
    _request_permit: OwnedSemaphorePermit,
    _byte_permit: OwnedSemaphorePermit,
}

impl AsRef<[u8]> for LeasedBytesOwner {
    fn as_ref(&self) -> &[u8] {
        self.bytes.as_ref()
    }
}

fn lease_stored_variant(
    stored: StoredVariant,
    request_permit: OwnedSemaphorePermit,
    byte_permit: OwnedSemaphorePermit,
) -> StoredVariant {
    let (record, bytes) = stored.into_parts();
    StoredVariant {
        record,
        encoded_bytes: Bytes::from_owner(LeasedBytesOwner {
            bytes,
            _request_permit: request_permit,
            _byte_permit: byte_permit,
        }),
    }
}

/// A prepared upload that still owns the caller's admission guard.
///
/// The guard is intentionally opaque and cannot be separated from the prepared buffers. Passing
/// this value to [`MediaRepository::commit_guarded_prepared_upload`] keeps the same capacity lease
/// alive across local blocking persistence or every awaited object-store write.
pub struct GuardedPreparedMediaUpload<G> {
    prepared: PreparedMediaUpload,
    guard: G,
}

impl<G> fmt::Debug for GuardedPreparedMediaUpload<G> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("GuardedPreparedMediaUpload")
            .field("prepared", &self.prepared)
            .field("guard", &"<owned>")
            .finish()
    }
}

impl<G> GuardedPreparedMediaUpload<G> {
    pub fn handle(&self) -> MediaHandle {
        self.prepared.handle()
    }

    pub fn variant_set(&self) -> &VariantSet {
        self.prepared.variant_set()
    }

    pub fn stored_footprint_bytes(&self) -> u64 {
        self.prepared.stored_footprint_bytes()
    }
}

/// Async media boundary used by API replicas.
///
/// Production construction is S3-only. The local backend remains an explicit test adapter for the
/// existing filesystem hardening suite; there is no runtime fallback from S3 to local storage.
#[derive(Clone)]
pub struct MediaRepository {
    backend: RepositoryBackend,
    limits: MediaLimits,
    read_limits: MediaReadLimits,
    read_admission: MediaReadAdmission,
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
            .field("read_limits", &self.read_limits)
            .finish()
    }
}

impl From<MediaStore> for MediaRepository {
    fn from(store: MediaStore) -> Self {
        Self::local(store, MediaReadLimits::default())
    }
}

impl MediaRepository {
    /// Explicit local adapter with the same process read admission used by the
    /// object backend. Production construction remains S3-only.
    pub fn local(store: MediaStore, read_limits: MediaReadLimits) -> Self {
        let limits = store.limits();
        Self {
            backend: RepositoryBackend::Local(store),
            limits,
            read_limits,
            read_admission: MediaReadAdmission::new(read_limits),
        }
    }

    pub fn s3(
        config: S3MediaConfig,
        limits: MediaLimits,
        read_limits: MediaReadLimits,
    ) -> Result<Self, MediaError> {
        limits.validate()?;
        let endpoint = s3_bucket_endpoint(&config)?;
        let store = AmazonS3Builder::new()
            .with_endpoint(endpoint)
            .with_region(config.region)
            .with_bucket_name(config.bucket)
            .with_access_key_id(config.access_key_id)
            .with_secret_access_key(config.secret_access_key)
            .with_virtual_hosted_style_request(config.virtual_hosted_style)
            .with_allow_http(config.allow_http)
            .build()
            .map_err(|error| object_error("configure", error))?;
        Ok(Self::object(Arc::new(store), limits, read_limits))
    }

    /// Shared, process-local object storage for deterministic replica contract tests.
    pub fn in_memory(
        limits: MediaLimits,
        read_limits: MediaReadLimits,
    ) -> Result<Self, MediaError> {
        limits.validate()?;
        Ok(Self::object(Arc::new(InMemory::new()), limits, read_limits))
    }

    fn object(
        store: Arc<dyn ObjectStore>,
        limits: MediaLimits,
        read_limits: MediaReadLimits,
    ) -> Self {
        Self {
            backend: RepositoryBackend::Object(store),
            limits,
            read_limits,
            read_admission: MediaReadAdmission::new(read_limits),
        }
    }

    pub fn limits(&self) -> MediaLimits {
        self.limits
    }

    /// Prove that the configured media backend is reachable without writing a
    /// sentinel object. Object storage uses a bounded delimiter listing under
    /// a reserved empty prefix; the local test adapter verifies its retained
    /// directory capabilities.
    pub async fn check_readiness(&self) -> Result<(), MediaError> {
        match &self.backend {
            RepositoryBackend::Local(store) => {
                let store = store.clone();
                tokio::task::spawn_blocking(move || store.check_readiness())
                    .await
                    .map_err(join_error)?
            }
            RepositoryBackend::Object(store) => {
                let prefix = ObjectPath::from("__fmarch_readiness__");
                store
                    .list_with_delimiter(Some(&prefix))
                    .await
                    .map(|_| ())
                    .map_err(|error| object_error("readiness-list", error))
            }
        }
    }

    pub async fn prepare_and_commit_upload(
        &self,
        encoded: Vec<u8>,
        variant_limits: VariantLimits,
    ) -> Result<MediaUploadCommitResult, MediaError> {
        self.prepare_and_commit_upload_with_guard(encoded, variant_limits, ())
            .await
    }

    /// Transfer a process capacity guard into the blocking codec task. Cancellation of the
    /// awaiting request cannot release that capacity while the uncancellable task continues.
    pub async fn prepare_and_commit_upload_with_guard<G>(
        &self,
        encoded: Vec<u8>,
        variant_limits: VariantLimits,
        cpu_guard: G,
    ) -> Result<MediaUploadCommitResult, MediaError>
    where
        G: Send + 'static,
    {
        let prepared = self
            .prepare_upload_with_guard(encoded, variant_limits, cpu_guard)
            .await?;
        self.commit_guarded_prepared_upload(prepared).await
    }

    /// Complete all attacker-controlled decode/resize/encode work before storage side effects.
    pub async fn prepare_upload_with_guard<G>(
        &self,
        encoded: Vec<u8>,
        variant_limits: VariantLimits,
        cpu_guard: G,
    ) -> Result<GuardedPreparedMediaUpload<G>, MediaError>
    where
        G: Send + 'static,
    {
        let media_limits = self.limits;
        tokio::task::spawn_blocking(move || {
            let prepared = prepare_upload(&encoded, media_limits, variant_limits)?;
            Ok(GuardedPreparedMediaUpload {
                prepared,
                guard: cpu_guard,
            })
        })
        .await
        .map_err(join_error)?
    }

    /// Commit a fully prepared upload. The immutable manifest remains the last installed object.
    pub async fn commit_prepared_upload(
        &self,
        prepared: PreparedMediaUpload,
    ) -> Result<MediaUploadCommitResult, MediaError> {
        match &self.backend {
            RepositoryBackend::Local(store) => {
                let store = store.clone();
                tokio::task::spawn_blocking(move || store.commit_prepared_upload(prepared))
                    .await
                    .map_err(join_error)?
            }
            RepositoryBackend::Object(store) => {
                commit_object_upload(store.as_ref(), prepared).await
            }
        }
    }

    /// Commit prepared buffers without releasing the capacity guard acquired before decoding.
    pub async fn commit_guarded_prepared_upload<G>(
        &self,
        guarded: GuardedPreparedMediaUpload<G>,
    ) -> Result<MediaUploadCommitResult, MediaError>
    where
        G: Send + 'static,
    {
        let GuardedPreparedMediaUpload { prepared, guard } = guarded;
        match &self.backend {
            RepositoryBackend::Local(store) => {
                let store = store.clone();
                tokio::task::spawn_blocking(move || {
                    let _guard = guard;
                    store.commit_prepared_upload(prepared)
                })
                .await
                .map_err(join_error)?
            }
            RepositoryBackend::Object(store) => {
                let _guard = guard;
                commit_object_upload(store.as_ref(), prepared).await
            }
        }
    }

    pub async fn lookup_variant_set(
        &self,
        id: ContentId,
        limits: VariantLimits,
    ) -> Result<Option<VariantSet>, MediaError> {
        self.read_limits.validate_for_variants(limits)?;
        let request_permit = self.read_admission.acquire_request()?;
        match &self.backend {
            RepositoryBackend::Local(store) => {
                let store = store.clone();
                let byte_permit = self
                    .read_admission
                    .acquire_bytes(MediaReadLimits::required_in_flight_bytes(limits)? as u64)?;
                tokio::task::spawn_blocking(move || {
                    let _request_permit = request_permit;
                    let _byte_permit = byte_permit;
                    store.lookup_variant_set(id, limits)
                })
                .await
                .map_err(join_error)?
            }
            RepositoryBackend::Object(store) => {
                lookup_object_set(
                    store.as_ref(),
                    &self.read_admission,
                    request_permit,
                    self.limits,
                    id,
                    limits,
                )
                .await
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
        self.read_limits.validate_for_variants(limits)?;
        let request_permit = self.read_admission.acquire_request()?;
        match &self.backend {
            RepositoryBackend::Local(store) => {
                let store = store.clone();
                let byte_permit = self
                    .read_admission
                    .acquire_bytes(MediaReadLimits::required_in_flight_bytes(limits)? as u64)?;
                let (stored, request_permit, mut byte_permit) =
                    tokio::task::spawn_blocking(move || {
                        let stored = store.lookup_variant(id, format, kind, limits);
                        (stored, request_permit, byte_permit)
                    })
                    .await
                    .map_err(join_error)?;
                let Some(stored) = stored? else {
                    return Ok(None);
                };
                let encoded_len = stored.encoded_bytes().len();
                let response_permit = byte_permit.split(encoded_len).ok_or_else(|| {
                    corrupt_set(id, "verified member exceeded its reserved read capacity")
                })?;
                drop(byte_permit);
                Ok(Some(lease_stored_variant(
                    stored,
                    request_permit,
                    response_permit,
                )))
            }
            RepositoryBackend::Object(store) => {
                lookup_object_variant(
                    store.as_ref(),
                    &self.read_admission,
                    request_permit,
                    self.limits,
                    id,
                    format,
                    kind,
                    limits,
                )
                .await
            }
        }
    }

    /// Probe only the installed-last manifest and its declared policy metadata. This does not
    /// fetch or decode the canonical raster or any variant member.
    pub async fn probe_installed_manifest(
        &self,
        id: ContentId,
        limits: VariantLimits,
    ) -> Result<Option<VariantSet>, MediaError> {
        self.read_limits.validate_for_variants(limits)?;
        let request_permit = self.read_admission.acquire_request()?;
        let manifest_permit = self.read_admission.acquire_bytes(MANIFEST_MAX_BYTES)?;
        match &self.backend {
            RepositoryBackend::Local(store) => {
                let store = store.clone();
                tokio::task::spawn_blocking(move || {
                    let _request_permit = request_permit;
                    let _manifest_permit = manifest_permit;
                    store.probe_installed_manifest(id, limits)
                })
                .await
                .map_err(join_error)?
            }
            RepositoryBackend::Object(store) => {
                let result = probe_object_manifest(store.as_ref(), self.limits, id, limits).await;
                drop(manifest_permit);
                drop(request_permit);
                result
            }
        }
    }
}

/// `object_store` treats a custom virtual-hosted endpoint as a complete bucket
/// endpoint. S3-compatible providers such as Railway instead publish a base
/// endpoint and expect the client to put the bucket in the hostname. Normalize
/// the provider contract here so every object-store operation signs and sends
/// the same canonical URL.
fn s3_bucket_endpoint(config: &S3MediaConfig) -> Result<String, MediaError> {
    let mut endpoint = Url::parse(&config.endpoint).map_err(|error| MediaError::ObjectStore {
        operation: "configure-endpoint",
        reason: error.to_string(),
    })?;
    if !matches!(endpoint.scheme(), "http" | "https")
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
    {
        return Err(MediaError::ObjectStore {
            operation: "configure-endpoint",
            reason: "endpoint must be an HTTP(S) base URL without credentials, query, or fragment"
                .to_string(),
        });
    }

    if config.virtual_hosted_style {
        let host = endpoint.host_str().ok_or_else(|| MediaError::ObjectStore {
            operation: "configure-endpoint",
            reason: "virtual-hosted endpoint must have a DNS host".to_string(),
        })?;
        let bucket_prefix = format!("{}.", config.bucket);
        if host != config.bucket && !host.starts_with(&bucket_prefix) {
            let bucket_host = format!("{}.{}", config.bucket, host);
            endpoint
                .set_host(Some(&bucket_host))
                .map_err(|_| MediaError::ObjectStore {
                    operation: "configure-endpoint",
                    reason: "bucket and endpoint do not form a valid virtual-hosted URL"
                        .to_string(),
                })?;
        }
    }

    Ok(endpoint.as_str().trim_end_matches('/').to_string())
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

async fn lookup_object_variant(
    store: &dyn ObjectStore,
    admission: &MediaReadAdmission,
    request_permit: OwnedSemaphorePermit,
    media_limits: MediaLimits,
    id: ContentId,
    format: VariantFormat,
    kind: VariantKind,
    limits: VariantLimits,
) -> Result<Option<StoredVariant>, MediaError> {
    let _manifest_bytes = admission.acquire_bytes(MANIFEST_MAX_BYTES)?;
    let manifest_path = object_path(&format!(
        "blobs/{id}/{VARIANT_RECIPE_REVISION}/{MANIFEST_NAME}"
    ))?;
    let Some(manifest) =
        get_bounded(store, &manifest_path, MANIFEST_MAX_BYTES, "get-manifest").await?
    else {
        return Ok(None);
    };
    let set = parse_manifest(id, &manifest)?;
    validate_manifest_policy(media_limits, id, &set, limits)?;

    // The installed-last immutable manifest is the complete-set commitment. Read only the
    // requested member and verify its payload against the declared digest on a blocking worker.
    let record = set
        .variants
        .iter()
        .find(|record| (record.key.format(), record.key.kind()) == (format, kind))
        .cloned()
        .ok_or_else(|| corrupt_set(id, "requested role is absent from the fixed manifest"))?;
    let member_bytes = admission.acquire_bytes(record.encoded_len)?;
    let path = variant_object_path(record.key)?;
    let bytes = get_bounded(store, &path, record.encoded_len, "get-variant")
        .await?
        .ok_or_else(|| corrupt_set(id, &format!("{} member is missing", record.key)))?;
    let (request_permit, member_bytes) = verify_member_bytes_blocking_with_guard(
        id,
        record.clone(),
        bytes.clone(),
        (request_permit, member_bytes),
    )
    .await?;
    Ok(Some(lease_stored_variant(
        StoredVariant {
            record,
            encoded_bytes: bytes,
        },
        request_permit,
        member_bytes,
    )))
}

async fn lookup_object_set(
    store: &dyn ObjectStore,
    admission: &MediaReadAdmission,
    mut request_permit: OwnedSemaphorePermit,
    media_limits: MediaLimits,
    id: ContentId,
    limits: VariantLimits,
) -> Result<Option<VariantSet>, MediaError> {
    let _manifest_bytes = admission.acquire_bytes(MANIFEST_MAX_BYTES)?;
    let manifest_path = object_path(&format!(
        "blobs/{id}/{VARIANT_RECIPE_REVISION}/{MANIFEST_NAME}"
    ))?;
    let Some(manifest) =
        get_bounded(store, &manifest_path, MANIFEST_MAX_BYTES, "get-manifest").await?
    else {
        return Ok(None);
    };
    let set = parse_manifest(id, &manifest)?;
    validate_manifest_policy(media_limits, id, &set, limits)?;
    for record in &set.variants {
        let member_bytes = admission.acquire_bytes(record.encoded_len)?;
        let path = variant_object_path(record.key)?;
        let bytes = get_bounded(store, &path, record.encoded_len, "get-variant")
            .await?
            .ok_or_else(|| corrupt_set(id, &format!("{} member is missing", record.key)))?;
        let (returned_request_permit, returned_member_permit) =
            verify_member_bytes_blocking_with_guard(
                id,
                record.clone(),
                bytes,
                (request_permit, member_bytes),
            )
            .await?;
        request_permit = returned_request_permit;
        drop(returned_member_permit);
    }
    Ok(Some(set))
}

async fn probe_object_manifest(
    store: &dyn ObjectStore,
    media_limits: MediaLimits,
    id: ContentId,
    limits: VariantLimits,
) -> Result<Option<VariantSet>, MediaError> {
    let manifest_path = object_path(&format!(
        "blobs/{id}/{VARIANT_RECIPE_REVISION}/{MANIFEST_NAME}"
    ))?;
    let Some(manifest) =
        get_bounded(store, &manifest_path, MANIFEST_MAX_BYTES, "probe-manifest").await?
    else {
        return Ok(None);
    };
    let set = parse_manifest(id, &manifest)?;
    validate_manifest_policy(media_limits, id, &set, limits)?;
    Ok(Some(set))
}

async fn verify_member_bytes_blocking_with_guard<G>(
    id: ContentId,
    record: VariantRecord,
    bytes: Bytes,
    guard: G,
) -> Result<G, MediaError>
where
    G: Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        verify_member_bytes(id, &record, &bytes)?;
        Ok(guard)
    })
    .await
    .map_err(join_error)?
}

async fn get_bounded(
    store: &dyn ObjectStore,
    path: &ObjectPath,
    max_len: u64,
    operation: &'static str,
) -> Result<Option<Bytes>, MediaError> {
    let object = match store.get(path).await {
        Ok(object) => object,
        Err(object_store::Error::NotFound { .. }) => return Ok(None),
        Err(error) => return Err(object_error(operation, error)),
    };
    if object.meta.size > max_len {
        return Err(MediaError::ObjectStore {
            operation,
            reason: format!(
                "object {path} is {} bytes; limit is {max_len}",
                object.meta.size
            ),
        });
    }
    let bytes = object
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
async fn run_blocking_with_guard<G, T, F>(guard: G, work: F) -> Result<T, MediaError>
where
    G: Send + 'static,
    T: Send + 'static,
    F: FnOnce() -> Result<T, MediaError> + Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let _guard = guard;
        work()
    })
    .await
    .map_err(join_error)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use futures_util::stream::BoxStream;
    use image::{ImageBuffer, ImageFormat, Rgba};
    use std::io::Cursor;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex as StdMutex;
    use tokio::sync::Notify;

    use object_store::{
        CopyOptions, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta,
        PutMultipartOptions, PutOptions, PutPayload, PutResult, Result as ObjectStoreResult,
    };

    #[derive(Default)]
    struct CountingObjectStore {
        inner: InMemory,
        reads: StdMutex<Vec<String>>,
        block_next_put: AtomicBool,
        put_blocked: AtomicBool,
        put_started: Notify,
        put_release: Notify,
    }

    impl fmt::Debug for CountingObjectStore {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter
                .debug_struct("CountingObjectStore")
                .field("reads", &self.reads())
                .field("put_blocked", &self.put_blocked.load(Ordering::SeqCst))
                .finish_non_exhaustive()
        }
    }

    impl fmt::Display for CountingObjectStore {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("counting-memory")
        }
    }

    impl CountingObjectStore {
        fn clear_reads(&self) {
            self.reads.lock().unwrap().clear();
        }

        fn reads(&self) -> Vec<String> {
            self.reads.lock().unwrap().clone()
        }

        fn block_next_put(&self) {
            self.put_blocked.store(false, Ordering::SeqCst);
            self.block_next_put.store(true, Ordering::SeqCst);
        }

        async fn wait_for_blocked_put(&self) {
            loop {
                if self.put_blocked.load(Ordering::SeqCst) {
                    return;
                }
                let notified = self.put_started.notified();
                if self.put_blocked.load(Ordering::SeqCst) {
                    return;
                }
                notified.await;
            }
        }

        fn release_put(&self) {
            self.put_release.notify_one();
        }
    }

    #[async_trait]
    impl ObjectStore for CountingObjectStore {
        async fn put_opts(
            &self,
            location: &ObjectPath,
            payload: PutPayload,
            options: PutOptions,
        ) -> ObjectStoreResult<PutResult> {
            if self.block_next_put.swap(false, Ordering::SeqCst) {
                self.put_blocked.store(true, Ordering::SeqCst);
                self.put_started.notify_waiters();
                self.put_release.notified().await;
                self.put_blocked.store(false, Ordering::SeqCst);
            }
            self.inner.put_opts(location, payload, options).await
        }

        async fn put_multipart_opts(
            &self,
            location: &ObjectPath,
            options: PutMultipartOptions,
        ) -> ObjectStoreResult<Box<dyn MultipartUpload>> {
            self.inner.put_multipart_opts(location, options).await
        }

        async fn get_opts(
            &self,
            location: &ObjectPath,
            options: GetOptions,
        ) -> ObjectStoreResult<GetResult> {
            self.reads.lock().unwrap().push(location.to_string());
            self.inner.get_opts(location, options).await
        }

        fn delete_stream(
            &self,
            locations: BoxStream<'static, ObjectStoreResult<ObjectPath>>,
        ) -> BoxStream<'static, ObjectStoreResult<ObjectPath>> {
            self.inner.delete_stream(locations)
        }

        fn list(
            &self,
            prefix: Option<&ObjectPath>,
        ) -> BoxStream<'static, ObjectStoreResult<ObjectMeta>> {
            self.inner.list(prefix)
        }

        async fn list_with_delimiter(
            &self,
            prefix: Option<&ObjectPath>,
        ) -> ObjectStoreResult<ListResult> {
            self.inner.list_with_delimiter(prefix).await
        }

        async fn copy_opts(
            &self,
            from: &ObjectPath,
            to: &ObjectPath,
            options: CopyOptions,
        ) -> ObjectStoreResult<()> {
            self.inner.copy_opts(from, to, options).await
        }
    }

    fn png() -> Vec<u8> {
        let image = ImageBuffer::from_pixel(4, 3, Rgba([12_u8, 34, 56, 255]));
        let mut bytes = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        bytes
    }

    fn s3_config(endpoint: &str, bucket: &str, virtual_hosted_style: bool) -> S3MediaConfig {
        S3MediaConfig {
            endpoint: endpoint.to_string(),
            region: "auto".to_string(),
            bucket: bucket.to_string(),
            access_key_id: "access-key".to_string(),
            secret_access_key: "secret-key".to_string(),
            virtual_hosted_style,
            allow_http: false,
        }
    }

    #[test]
    fn virtual_hosted_s3_endpoint_composes_bucket_with_provider_base() {
        let config = s3_config("https://t3.storageapi.dev", "media-staging-abc123", true);
        assert_eq!(
            s3_bucket_endpoint(&config).unwrap(),
            "https://media-staging-abc123.t3.storageapi.dev"
        );
    }

    #[test]
    fn s3_endpoint_preserves_path_style_and_precomposed_virtual_hosts() {
        let path_style = s3_config("https://objects.example.test/base/", "media", false);
        assert_eq!(
            s3_bucket_endpoint(&path_style).unwrap(),
            "https://objects.example.test/base"
        );

        let virtual_hosted = s3_config("https://media.objects.example.test/", "media", true);
        assert_eq!(
            s3_bucket_endpoint(&virtual_hosted).unwrap(),
            "https://media.objects.example.test"
        );
    }

    #[test]
    fn s3_endpoint_rejects_credential_bearing_or_opaque_urls() {
        for endpoint in [
            "https://user:password@objects.example.test",
            "https://objects.example.test?bucket=media",
            "file:///tmp/media",
        ] {
            assert!(s3_bucket_endpoint(&s3_config(endpoint, "media", true)).is_err());
        }
    }

    #[test]
    fn read_admission_rejects_excess_parallel_requests_without_queueing() {
        let admission =
            MediaReadAdmission::new(MediaReadLimits::new(1, MANIFEST_MAX_BYTES as usize).unwrap());
        let _first = admission.acquire_request().unwrap();
        assert!(matches!(
            admission.acquire_request(),
            Err(MediaError::ReadCapacityExhausted {
                resource: "request"
            })
        ));
    }

    #[test]
    fn read_limits_are_validated_against_manifest_and_member_policy() {
        let variants = VariantLimits::default();
        let required = MediaReadLimits::required_in_flight_bytes(variants).unwrap();
        assert!(MediaReadLimits::new(1, required)
            .unwrap()
            .validate_for_variants(variants)
            .is_ok());
        assert!(matches!(
            MediaReadLimits::new(1, required - 1)
                .unwrap()
                .validate_for_variants(variants),
            Err(MediaError::InvalidReadLimits(_))
        ));
    }

    #[tokio::test]
    async fn shared_object_repository_cross_replica_round_trip_is_idempotent() {
        let first =
            MediaRepository::in_memory(MediaLimits::default(), MediaReadLimits::default()).unwrap();
        let second = first.clone();
        first.check_readiness().await.unwrap();
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

    #[tokio::test]
    async fn object_variant_lookup_reads_only_manifest_and_requested_member() {
        let object_store = Arc::new(CountingObjectStore::default());
        let repository = MediaRepository::object(
            object_store.clone(),
            MediaLimits::default(),
            MediaReadLimits::default(),
        );
        let committed = repository
            .prepare_and_commit_upload(png(), VariantLimits::default())
            .await
            .unwrap();
        let id = committed.ingest().handle().id();
        object_store.clear_reads();

        let variant = repository
            .lookup_variant(
                id,
                VariantFormat::Webp,
                VariantKind::Thumb,
                VariantLimits::default(),
            )
            .await
            .unwrap()
            .unwrap();
        assert!(!variant.encoded_bytes().is_empty());

        let reads = object_store.reads();
        let manifest = format!("blobs/{id}/{VARIANT_RECIPE_REVISION}/{MANIFEST_NAME}");
        let requested = format!("blobs/{id}/{VARIANT_RECIPE_REVISION}/webp/thumb");
        assert_eq!(reads.len(), 2, "one GET for exactly two objects");
        assert_eq!(reads.iter().filter(|path| *path == &manifest).count(), 1);
        assert_eq!(reads.iter().filter(|path| *path == &requested).count(), 1);
        assert!(!reads.iter().any(|path| path.ends_with("/orig")));
        assert!(reads
            .iter()
            .all(|path| path == &manifest || path == &requested));
    }

    #[tokio::test]
    async fn object_variant_lookup_rejects_incoherent_read_policy_before_io() {
        let object_store = Arc::new(CountingObjectStore::default());
        let repository = MediaRepository::object(
            object_store.clone(),
            MediaLimits::default(),
            MediaReadLimits::new(1, MANIFEST_MAX_BYTES as usize).unwrap(),
        );
        let committed = repository
            .prepare_and_commit_upload(png(), VariantLimits::default())
            .await
            .unwrap();
        let id = committed.ingest().handle().id();
        object_store.clear_reads();

        assert!(matches!(
            repository
                .lookup_variant(
                    id,
                    VariantFormat::Webp,
                    VariantKind::Thumb,
                    VariantLimits::default(),
                )
                .await,
            Err(MediaError::InvalidReadLimits(_))
        ));
        let reads = object_store.reads();
        assert!(reads.is_empty(), "invalid read policy must fail before I/O");
    }

    async fn assert_variant_bytes_retain_read_admission(repository: MediaRepository) {
        let limits = VariantLimits::default();
        let committed = repository
            .prepare_and_commit_upload(png(), limits)
            .await
            .unwrap();
        let id = committed.ingest().handle().id();
        let total_bytes = repository.read_limits.max_in_flight_bytes();
        let variant = repository
            .lookup_variant(id, VariantFormat::Webp, VariantKind::Thumb, limits)
            .await
            .unwrap()
            .unwrap();
        let retained_bytes = variant.record().encoded_len() as usize;
        assert_eq!(repository.read_admission.requests.available_permits(), 0);
        assert_eq!(
            repository.read_admission.bytes.available_permits(),
            total_bytes - retained_bytes
        );

        let clone = variant.clone();
        drop(variant);
        assert_eq!(repository.read_admission.requests.available_permits(), 0);
        assert!(matches!(
            repository
                .lookup_variant(id, VariantFormat::Webp, VariantKind::Thumb, limits)
                .await,
            Err(MediaError::ReadCapacityExhausted {
                resource: "request"
            })
        ));
        drop(clone);
        assert_eq!(repository.read_admission.requests.available_permits(), 1);
        assert_eq!(
            repository.read_admission.bytes.available_permits(),
            total_bytes
        );
    }

    #[tokio::test]
    async fn object_variant_bytes_retain_read_admission_across_clones() {
        let limits = VariantLimits::default();
        let read_limits = MediaReadLimits::new(
            1,
            MediaReadLimits::required_in_flight_bytes(limits).unwrap(),
        )
        .unwrap();
        let repository = MediaRepository::in_memory(MediaLimits::default(), read_limits).unwrap();
        assert_variant_bytes_retain_read_admission(repository).await;
    }

    #[tokio::test]
    async fn local_variant_bytes_retain_read_admission_across_clones() {
        let directory = tempfile::tempdir().unwrap();
        let limits = VariantLimits::default();
        let read_limits = MediaReadLimits::new(
            1,
            MediaReadLimits::required_in_flight_bytes(limits).unwrap(),
        )
        .unwrap();
        let store = MediaStore::open(directory.path(), MediaLimits::default()).unwrap();
        let repository = MediaRepository::local(store, read_limits);
        assert_variant_bytes_retain_read_admission(repository).await;
    }

    #[tokio::test]
    async fn guarded_upload_holds_capacity_through_object_store_awaits() {
        let object_store = Arc::new(CountingObjectStore::default());
        let repository = MediaRepository::object(
            object_store.clone(),
            MediaLimits::default(),
            MediaReadLimits::default(),
        );
        let capacity = Arc::new(Semaphore::new(1));
        let permit = capacity.clone().try_acquire_owned().unwrap();
        let prepared = repository
            .prepare_upload_with_guard(png(), VariantLimits::default(), permit)
            .await
            .unwrap();
        assert_eq!(capacity.available_permits(), 0);

        object_store.block_next_put();
        let commit_repository = repository.clone();
        let commit = tokio::spawn(async move {
            commit_repository
                .commit_guarded_prepared_upload(prepared)
                .await
        });
        object_store.wait_for_blocked_put().await;
        assert_eq!(capacity.available_permits(), 0);
        object_store.release_put();
        commit.await.unwrap().unwrap();
        assert_eq!(capacity.available_permits(), 1);
    }

    #[tokio::test]
    async fn manifest_probe_is_shallow() {
        let object_store = Arc::new(CountingObjectStore::default());
        let repository = MediaRepository::object(
            object_store.clone(),
            MediaLimits::default(),
            MediaReadLimits::default(),
        );
        let limits = VariantLimits::default();
        let committed = repository
            .prepare_and_commit_upload(png(), limits)
            .await
            .unwrap();
        let id = committed.ingest().handle().id();
        object_store.clear_reads();

        let manifest = repository
            .probe_installed_manifest(id, limits)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(manifest.source(), id);
        assert_eq!(
            object_store.reads(),
            vec![format!(
                "blobs/{id}/{VARIANT_RECIPE_REVISION}/{MANIFEST_NAME}"
            )]
        );
    }

    #[tokio::test]
    async fn cancelled_waiter_does_not_release_blocking_work_capacity() {
        let capacity = Arc::new(Semaphore::new(1));
        let permit = capacity.clone().try_acquire_owned().unwrap();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (finish_tx, finish_rx) = std::sync::mpsc::channel();
        let waiter = tokio::spawn(run_blocking_with_guard(permit, move || {
            started_tx.send(()).unwrap();
            finish_rx.recv().unwrap();
            Ok(())
        }));
        tokio::task::spawn_blocking(move || started_rx.recv().unwrap())
            .await
            .unwrap();
        waiter.abort();
        assert_eq!(capacity.available_permits(), 0);

        finish_tx.send(()).unwrap();
        let reacquired = capacity.clone().acquire_owned().await.unwrap();
        drop(reacquired);
        assert_eq!(capacity.available_permits(), 1);
    }
}
