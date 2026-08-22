//! Keyed handle reservations and maintenance coordination for profiles.
//!
//! A handle reservation is derived data, never canonical event data. Profile
//! events refer only to a sealed claim; projections derive the current keyed
//! token whenever that claim is materialized or rebuilt. The maintenance lease
//! is deliberately shared by every writer that can change a reservation,
//! including erasure, so a deliberate rotation can drain them consistently.

use std::fmt;

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

pub const PROFILE_HANDLE_INDEX_KEY_ENV: &str = "FMARCH_PROFILE_HANDLE_INDEX_KEY";
pub const PROFILE_HANDLE_INDEX_KID_ENV: &str = "FMARCH_PROFILE_HANDLE_INDEX_KID";
pub const PROFILE_HANDLE_INDEX_REPLACEMENT_KEY_ENV: &str =
    "FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY";

const DEBUG_PROFILE_HANDLE_INDEX_KEY: &[u8] = b"fmarch-local-dev-profile-handle-index-key-v1";
const PROFILE_HANDLE_INDEX_MAINTENANCE_LOCK: &str = "fmarch:profile-handle-index-maintenance:v1";

type HmacSha256 = Hmac<Sha256>;

/// One opaque HMAC-SHA256 reservation. It intentionally has no `Debug`
/// implementation: logs and operator reports must never accidentally contain
/// a value that can be used as an offline handle-guessing oracle.
#[derive(Clone, PartialEq, Eq)]
pub struct HandleIndexToken([u8; 32]);

impl HandleIndexToken {
    /// Derive a reservation from the active process configuration. Debug/test
    /// callers without an explicit key use a deterministic hermetic fallback;
    /// server startup separately requires explicit configuration before
    /// accepting traffic.
    pub fn for_handle(handle: &str) -> Result<Self, ProfileHandleIndexError> {
        let key = active_key_for_projection()?;
        Self::for_handle_with_key(handle, &key)
    }

    pub fn for_handle_with_configuration(
        handle: &str,
        configuration: &ProfileHandleIndexConfiguration,
    ) -> Result<Self, ProfileHandleIndexError> {
        Self::for_handle_with_key(handle, &configuration.key)
    }

    fn for_handle_with_key(
        handle: &str,
        key: &HandleIndexKey,
    ) -> Result<Self, ProfileHandleIndexError> {
        let mut mac = HmacSha256::new_from_slice(&key.0).map_err(|_| {
            ProfileHandleIndexError::Configuration(
                "configured key cannot initialize HMAC-SHA256".to_string(),
            )
        })?;
        mac.update(handle.as_bytes());
        let bytes: [u8; 32] = mac.finalize().into_bytes().into();
        Ok(Self(bytes))
    }

    pub fn from_database(bytes: Vec<u8>) -> Result<Self, ProfileHandleIndexError> {
        let bytes: [u8; 32] = bytes.try_into().map_err(|_| {
            ProfileHandleIndexError::MalformedStoredToken(
                "active profile has a malformed handle index token".to_string(),
            )
        })?;
        Ok(Self(bytes))
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub fn as_lower_hex(&self) -> String {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut encoded = String::with_capacity(64);
        for byte in self.0 {
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
        encoded
    }
}

#[derive(Clone, PartialEq, Eq)]
struct HandleIndexKey(Vec<u8>);

/// The configured non-secret KID plus opaque key material. Deliberately expose
/// only the KID so commands can attest intent without serializing the secret.
#[derive(Clone, PartialEq, Eq)]
pub struct ProfileHandleIndexConfiguration {
    key: HandleIndexKey,
    kid: String,
}

impl fmt::Debug for ProfileHandleIndexConfiguration {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProfileHandleIndexConfiguration")
            .field("kid", &self.kid)
            .field("key", &"<redacted>")
            .finish()
    }
}

impl ProfileHandleIndexConfiguration {
    pub fn kid(&self) -> &str {
        &self.kid
    }

    pub fn differs_from(&self, other: &Self) -> bool {
        self.kid != other.kid && self.key != other.key
    }
}

/// Require the runtime's active key and public custody marker. This is stricter
/// than the debug projection fallback: an actual server must never become ready
/// with an implicit or placeholder profile-index configuration.
pub fn require_profile_handle_index_configuration(
) -> Result<ProfileHandleIndexConfiguration, ProfileHandleIndexError> {
    Ok(ProfileHandleIndexConfiguration {
        key: load_explicit_key(PROFILE_HANDLE_INDEX_KEY_ENV)?,
        kid: load_kid(PROFILE_HANDLE_INDEX_KID_ENV)?,
    })
}

/// Load the one-shot replacement material supplied only to the protected
/// maintenance process. The replacement KID is an explicit operator argument,
/// rather than a second long-lived service variable.
pub fn replacement_profile_handle_index_configuration(
    replacement_kid: &str,
) -> Result<ProfileHandleIndexConfiguration, ProfileHandleIndexError> {
    Ok(ProfileHandleIndexConfiguration {
        key: load_explicit_key(PROFILE_HANDLE_INDEX_REPLACEMENT_KEY_ENV)?,
        kid: validate_kid(replacement_kid.to_string())?,
    })
}

/// Compatible profile writers take a shared transactional lease before they
/// read a key or mutate a reservation. The maintenance command holds the
/// exclusive session lease, thereby draining all compatible writers before its
/// atomic reindex begins.
pub async fn acquire_profile_handle_index_writer_lease(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), ProfileHandleIndexError> {
    sqlx::query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))")
        .bind(PROFILE_HANDLE_INDEX_MAINTENANCE_LOCK)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Acquire the exclusive session lease for the full maintenance window. Call
/// [`release_profile_handle_index_maintenance_lease`] on normal completion; a
/// process exit also releases PostgreSQL session advisory locks.
pub async fn acquire_profile_handle_index_maintenance_lease(
    connection: &mut sqlx::PgConnection,
) -> Result<(), ProfileHandleIndexError> {
    sqlx::query("SELECT pg_advisory_lock(hashtextextended($1, 0))")
        .bind(PROFILE_HANDLE_INDEX_MAINTENANCE_LOCK)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

pub async fn release_profile_handle_index_maintenance_lease(
    connection: &mut sqlx::PgConnection,
) -> Result<(), ProfileHandleIndexError> {
    let released: bool = sqlx::query_scalar("SELECT pg_advisory_unlock(hashtextextended($1, 0))")
        .bind(PROFILE_HANDLE_INDEX_MAINTENANCE_LOCK)
        .fetch_one(&mut *connection)
        .await?;
    if !released {
        return Err(ProfileHandleIndexError::Configuration(
            "profile handle-index maintenance lease was not held by this session".to_string(),
        ));
    }
    Ok(())
}

fn active_key_for_projection() -> Result<HandleIndexKey, ProfileHandleIndexError> {
    match std::env::var(PROFILE_HANDLE_INDEX_KEY_ENV) {
        Ok(_) => load_explicit_key(PROFILE_HANDLE_INDEX_KEY_ENV),
        Err(std::env::VarError::NotPresent) if cfg!(debug_assertions) => Ok(HandleIndexKey(
            Sha256::digest(DEBUG_PROFILE_HANDLE_INDEX_KEY).to_vec(),
        )),
        Err(std::env::VarError::NotPresent) => Err(ProfileHandleIndexError::Configuration(
            format!("{PROFILE_HANDLE_INDEX_KEY_ENV} is required"),
        )),
        Err(std::env::VarError::NotUnicode(_)) => Err(ProfileHandleIndexError::Configuration(
            format!("{PROFILE_HANDLE_INDEX_KEY_ENV} must be valid UTF-8"),
        )),
    }
}

fn load_explicit_key(name: &str) -> Result<HandleIndexKey, ProfileHandleIndexError> {
    let value = std::env::var(name).map_err(|error| match error {
        std::env::VarError::NotPresent => {
            ProfileHandleIndexError::Configuration(format!("{name} is required"))
        }
        std::env::VarError::NotUnicode(_) => {
            ProfileHandleIndexError::Configuration(format!("{name} must be valid UTF-8"))
        }
    })?;
    if value.len() < 32 || value != value.trim() {
        return Err(ProfileHandleIndexError::Configuration(format!(
            "{name} must contain at least 32 bytes with no leading or trailing whitespace"
        )));
    }
    if is_obvious_placeholder(&value) {
        return Err(ProfileHandleIndexError::Configuration(format!(
            "{name} must not use a placeholder value"
        )));
    }
    Ok(HandleIndexKey(value.into_bytes()))
}

fn load_kid(name: &str) -> Result<String, ProfileHandleIndexError> {
    let value = std::env::var(name).map_err(|error| match error {
        std::env::VarError::NotPresent => {
            ProfileHandleIndexError::Configuration(format!("{name} is required"))
        }
        std::env::VarError::NotUnicode(_) => {
            ProfileHandleIndexError::Configuration(format!("{name} must be valid UTF-8"))
        }
    })?;
    validate_kid(value)
}

fn validate_kid(value: String) -> Result<String, ProfileHandleIndexError> {
    let is_valid = !value.is_empty()
        && value.len() <= 128
        && value == value.trim()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'));
    if !is_valid {
        return Err(ProfileHandleIndexError::Configuration(
            "profile handle-index KID must be a non-empty, trimmed identifier using only letters, digits, '.', '_', or '-'"
                .to_string(),
        ));
    }
    Ok(value)
}

fn is_obvious_placeholder(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    ["replace", "change", "placeholder", "example", "at-least"]
        .iter()
        .any(|marker| normalized.contains(marker))
}

#[derive(Debug, thiserror::Error)]
pub enum ProfileHandleIndexError {
    #[error("profile handle-index configuration is invalid: {0}")]
    Configuration(String),
    #[error("profile handle-index data is invalid: {0}")]
    MalformedStoredToken(String),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

#[cfg(test)]
mod tests {
    use super::{
        replacement_profile_handle_index_configuration, require_profile_handle_index_configuration,
        HandleIndexToken, PROFILE_HANDLE_INDEX_KEY_ENV, PROFILE_HANDLE_INDEX_KID_ENV,
        PROFILE_HANDLE_INDEX_REPLACEMENT_KEY_ENV,
    };
    use std::sync::{Mutex, MutexGuard};

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct EnvGuard {
        key: Option<String>,
        kid: Option<String>,
        replacement_key: Option<String>,
        _lock: MutexGuard<'static, ()>,
    }

    impl EnvGuard {
        fn isolated() -> Self {
            let lock = ENV_LOCK
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let guard = Self {
                key: std::env::var(PROFILE_HANDLE_INDEX_KEY_ENV).ok(),
                kid: std::env::var(PROFILE_HANDLE_INDEX_KID_ENV).ok(),
                replacement_key: std::env::var(PROFILE_HANDLE_INDEX_REPLACEMENT_KEY_ENV).ok(),
                _lock: lock,
            };
            std::env::remove_var(PROFILE_HANDLE_INDEX_KEY_ENV);
            std::env::remove_var(PROFILE_HANDLE_INDEX_KID_ENV);
            std::env::remove_var(PROFILE_HANDLE_INDEX_REPLACEMENT_KEY_ENV);
            guard
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (name, value) in [
                (PROFILE_HANDLE_INDEX_KEY_ENV, &self.key),
                (PROFILE_HANDLE_INDEX_KID_ENV, &self.kid),
                (
                    PROFILE_HANDLE_INDEX_REPLACEMENT_KEY_ENV,
                    &self.replacement_key,
                ),
            ] {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
    }

    #[test]
    fn token_is_lowercase_hmac_sha256_of_a_normalized_handle() {
        let environment = EnvGuard::isolated();
        std::env::set_var(
            PROFILE_HANDLE_INDEX_KEY_ENV,
            "current-profile-index-key-material-0001",
        );
        let token = HandleIndexToken::for_handle("alpha_99").unwrap();
        assert_eq!(
            token.as_lower_hex(),
            "2aefd17949ab750cdd64dd48fe067c982cac730efc641b2bdf3373c7fa519bd2"
        );
        drop(environment);
    }

    #[test]
    fn runtime_configuration_never_uses_the_debug_fallback() {
        let environment = EnvGuard::isolated();
        assert!(require_profile_handle_index_configuration().is_err());
        std::env::set_var(
            PROFILE_HANDLE_INDEX_KEY_ENV,
            "replace-with-at-least-32-random-bytes",
        );
        std::env::set_var(PROFILE_HANDLE_INDEX_KID_ENV, "profile-index-v1");
        assert!(require_profile_handle_index_configuration().is_err());
        std::env::set_var(
            PROFILE_HANDLE_INDEX_KEY_ENV,
            "current-profile-index-key-material-0001",
        );
        let current = require_profile_handle_index_configuration().unwrap();
        assert_eq!(current.kid(), "profile-index-v1");
        drop(environment);
    }

    #[test]
    fn replacement_requires_distinct_explicit_material_and_a_valid_kid() {
        let environment = EnvGuard::isolated();
        std::env::set_var(
            PROFILE_HANDLE_INDEX_KEY_ENV,
            "current-profile-index-key-material-0001",
        );
        std::env::set_var(PROFILE_HANDLE_INDEX_KID_ENV, "profile-index-v1");
        std::env::set_var(
            PROFILE_HANDLE_INDEX_REPLACEMENT_KEY_ENV,
            "rotated-profile-index-key-material-0002",
        );
        let current = require_profile_handle_index_configuration().unwrap();
        let replacement =
            replacement_profile_handle_index_configuration("profile-index-v2").unwrap();
        assert!(current.differs_from(&replacement));
        assert!(replacement_profile_handle_index_configuration(" profile-index-v2").is_err());
        drop(environment);
    }
}
