//! The WorkOS adapter: JWT verification against the provider JWKS, and
//! resolution of a verified (provider, subject) assertion onto a platform
//! principal with a workos authentication method. WorkOS assertions are
//! exchanged once for a backend-owned app session; they are never the
//! per-request bearer.

use std::collections::{hash_map::Entry, HashMap};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use bytes::BytesMut;
use jsonwebtoken::jwk::{AlgorithmParameters, JwkSet, KeyAlgorithm, KeyOperations, PublicKeyUse};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::PgConnection;
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

use crate::error::IdentityFlowError;
use crate::methods;
use crate::PrincipalId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedIdentity {
    pub subject: String,
    pub session_id: WorkosSessionId,
    pub issued_at: i64,
    pub expires_at: i64,
    pub signing_key_id: String,
    pub email: Option<String>,
}

/// A canonical WorkOS session identifier from the signed `sid` access-token
/// claim. Keeping the representation validated prevents database corruption or
/// caller input from becoming a provider logout redirect parameter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkosSessionId(String);

impl WorkosSessionId {
    pub fn parse(value: impl Into<String>) -> Result<Self, IdentityError> {
        let value = value.into();
        let suffix = value
            .strip_prefix("session_")
            .ok_or(IdentityError::InvalidToken)?;
        if suffix.len() != 26
            || !suffix.bytes().all(|byte| {
                byte.is_ascii_digit()
                    || matches!(byte, b'A'..=b'H' | b'J'..=b'K' | b'M'..=b'N' | b'P'..=b'T' | b'V'..=b'Z')
            })
        {
            return Err(IdentityError::InvalidToken);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }

    /// One-way identifier used by permanent replay/logout tombstones after
    /// subject-linked provider-session data has been erased.
    pub fn fingerprint(&self) -> String {
        format!("{:x}", Sha256::digest(self.0.as_bytes()))
    }
}

/// One-way identifier retained after erasure so an access token from an
/// unobserved WorkOS session cannot recreate the erased external identity.
pub fn subject_fingerprint(subject: &str) -> String {
    format!("{:x}", Sha256::digest(subject.as_bytes()))
}

/// Construct the browser navigation target that ends the persisted WorkOS
/// session. No `return_to` is accepted here: WorkOS applies the application's
/// configured logout redirect, so callers cannot turn logout into an open
/// redirect.
pub fn logout_url(session_id: &WorkosSessionId) -> String {
    let mut url = reqwest::Url::parse("https://api.workos.com/user_management/sessions/logout")
        .expect("the fixed WorkOS logout endpoint must be a valid URL");
    url.query_pairs_mut()
        .append_pair("session_id", session_id.as_str());
    url.into()
}

#[derive(Debug, thiserror::Error)]
pub enum IdentityError {
    #[error("access token is malformed or unsupported")]
    InvalidToken,
    #[error("access token is missing a signing key id")]
    MissingKeyId,
    #[error("access token signing key is unavailable")]
    UnknownKey,
    #[error("identity provider is unavailable: {0}")]
    ProviderUnavailable(String),
    #[error("identity configuration is invalid: {0}")]
    InvalidConfiguration(String),
}

#[async_trait]
pub trait AccessTokenVerifier: Send + Sync {
    async fn verify(&self, token: &str) -> Result<VerifiedIdentity, IdentityError>;
}

const JWKS_REFRESH_MIN_INTERVAL: Duration = Duration::from_secs(30);
const JWKS_FRESH_TTL: Duration = Duration::from_secs(5 * 60);
const JWKS_NEGATIVE_KID_TTL: Duration = Duration::from_secs(30);
const JWKS_NEGATIVE_KID_CAPACITY: usize = 256;
const JWKS_MAX_RESPONSE_BYTES: usize = 256 * 1024;
const JWKS_MAX_KEYS: usize = 64;
const JWKS_MAX_KID_BYTES: usize = 256;
const RSA_MIN_MODULUS_BYTES: usize = 256;
const RSA_MAX_MODULUS_BYTES: usize = 1024;
const COMPACT_JWT_MAX_BYTES: usize = 16 * 1024;
const COMPACT_JWT_SEGMENT_MAX_BYTES: [usize; 3] = [4 * 1024, 10 * 1024, 2 * 1024];
// WorkOS access-token duration is application-configurable. Keep the verifier
// compatible with that provider contract while imposing a deliberate local
// ceiling: this service will never bootstrap authority from an assertion that
// remains valid for more than one day.
const WORKOS_ASSERTION_MAX_LIFETIME_SECS: u64 = 24 * 60 * 60;
const WORKOS_ASSERTION_MAX_AGE_SECS: u64 = 10 * 60;
const WORKOS_CLOCK_SKEW_SECS: u64 = 60;

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorkosClientId(Arc<str>);

impl WorkosClientId {
    fn parse(value: impl Into<String>) -> Result<Self, IdentityError> {
        let value = value.into();
        let suffix = value.strip_prefix("client_").ok_or_else(|| {
            IdentityError::InvalidConfiguration(
                "WorkOS client id must use the canonical client_<id> form".to_string(),
            )
        })?;
        if suffix.is_empty()
            || value.len() > 128
            || !suffix.bytes().all(|byte| byte.is_ascii_alphanumeric())
        {
            return Err(IdentityError::InvalidConfiguration(
                "WorkOS client id must use the canonical client_<id> form".to_string(),
            ));
        }
        Ok(Self(value.into()))
    }

    fn as_str(&self) -> &str {
        self.0.as_ref()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorkosAuthority {
    client_id: WorkosClientId,
    issuer: Arc<str>,
    jwks_url: Arc<str>,
}

impl WorkosAuthority {
    fn from_config(
        client_id: impl Into<String>,
        issuer: impl Into<String>,
        jwks_url: impl Into<String>,
    ) -> Result<Self, IdentityError> {
        let client_id = WorkosClientId::parse(client_id)?;
        let canonical = Self::canonical(client_id);
        let issuer = issuer.into();
        if issuer != canonical.issuer.as_ref() {
            return Err(IdentityError::InvalidConfiguration(
                "WORKOS_ISSUER must exactly match the canonical WorkOS authority".to_string(),
            ));
        }
        let jwks_url = jwks_url.into();
        if jwks_url != canonical.jwks_url.as_ref() {
            return Err(IdentityError::InvalidConfiguration(
                "WORKOS_JWKS_URL must exactly match the canonical WorkOS JWKS endpoint".to_string(),
            ));
        }
        Ok(canonical)
    }

    #[cfg(test)]
    fn from_client_id(client_id: impl Into<String>) -> Result<Self, IdentityError> {
        Ok(Self::canonical(WorkosClientId::parse(client_id)?))
    }

    fn canonical(client_id: WorkosClientId) -> Self {
        let issuer = format!(
            "https://api.workos.com/user_management/{}",
            client_id.as_str()
        );
        let jwks_url = format!("https://api.workos.com/sso/jwks/{}", client_id.as_str());
        Self {
            client_id,
            issuer: issuer.into(),
            jwks_url: jwks_url.into(),
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct JwksPolicy {
    refresh_min_interval: Duration,
    fresh_ttl: Duration,
    negative_kid_ttl: Duration,
    negative_kid_capacity: usize,
    max_response_bytes: usize,
    max_keys: usize,
}

impl Default for JwksPolicy {
    fn default() -> Self {
        Self {
            refresh_min_interval: JWKS_REFRESH_MIN_INTERVAL,
            fresh_ttl: JWKS_FRESH_TTL,
            negative_kid_ttl: JWKS_NEGATIVE_KID_TTL,
            negative_kid_capacity: JWKS_NEGATIVE_KID_CAPACITY,
            max_response_bytes: JWKS_MAX_RESPONSE_BYTES,
            max_keys: JWKS_MAX_KEYS,
        }
    }
}

struct VerifiedJwks {
    keys: HashMap<String, DecodingKey>,
}

impl VerifiedJwks {
    fn normalize(set: JwkSet, policy: JwksPolicy) -> Result<Self, IdentityError> {
        if set.keys.is_empty() || set.keys.len() > policy.max_keys {
            return Err(IdentityError::ProviderUnavailable(format!(
                "JWKS response must contain between 1 and {} keys",
                policy.max_keys
            )));
        }

        let mut keys = HashMap::with_capacity(set.keys.len());
        for jwk in set.keys {
            let kid = jwk.common.key_id.as_deref().ok_or_else(|| {
                IdentityError::ProviderUnavailable(
                    "JWKS contains a key without a key id".to_string(),
                )
            })?;
            if !is_canonical_signing_key_id(kid) {
                return Err(IdentityError::ProviderUnavailable(
                    "JWKS contains an invalid key id".to_string(),
                ));
            }
            if jwk.common.key_algorithm != Some(KeyAlgorithm::RS256)
                || jwk.common.public_key_use != Some(PublicKeyUse::Signature)
                || jwk
                    .common
                    .key_operations
                    .as_ref()
                    .is_some_and(|operations| operations.as_slice() != [KeyOperations::Verify])
            {
                return Err(IdentityError::ProviderUnavailable(
                    "JWKS contains a key that is not restricted to RS256 signature verification"
                        .to_string(),
                ));
            }
            let AlgorithmParameters::RSA(parameters) = &jwk.algorithm else {
                return Err(IdentityError::ProviderUnavailable(
                    "JWKS contains a non-RSA key".to_string(),
                ));
            };
            let modulus = decode_base64url_uint(parameters.n.as_str(), "RSA modulus")?;
            if !(RSA_MIN_MODULUS_BYTES..=RSA_MAX_MODULUS_BYTES).contains(&modulus.len())
                || (modulus.len() == RSA_MIN_MODULUS_BYTES && modulus[0] & 0x80 == 0)
                || modulus.last().is_none_or(|byte| *byte & 1 == 0)
            {
                return Err(IdentityError::ProviderUnavailable(
                    "JWKS RSA modulus is outside the accepted size range".to_string(),
                ));
            }
            let exponent = decode_base64url_uint(parameters.e.as_str(), "RSA exponent")?;
            let exponent_value = exponent.iter().try_fold(0_u64, |value, byte| {
                value.checked_mul(256)?.checked_add(u64::from(*byte))
            });
            if exponent_value.is_none_or(|value| value < 3 || value % 2 == 0) {
                return Err(IdentityError::ProviderUnavailable(
                    "JWKS contains an invalid RSA exponent".to_string(),
                ));
            }
            let key = DecodingKey::from_rsa_raw_components(&modulus, &exponent);
            match keys.entry(kid.to_string()) {
                Entry::Vacant(entry) => {
                    entry.insert(key);
                }
                Entry::Occupied(_) => {
                    return Err(IdentityError::ProviderUnavailable(
                        "JWKS contains duplicate key ids".to_string(),
                    ));
                }
            }
        }
        Ok(Self { keys })
    }

    fn find(&self, kid: &str) -> Option<&DecodingKey> {
        self.keys.get(kid)
    }
}

fn decode_base64url_uint(value: &str, label: &str) -> Result<Vec<u8>, IdentityError> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(IdentityError::ProviderUnavailable(format!(
            "JWKS contains an invalid {label}"
        )));
    }
    let decoded = URL_SAFE_NO_PAD.decode(value).map_err(|_| {
        IdentityError::ProviderUnavailable(format!("JWKS contains an invalid {label}"))
    })?;
    if decoded.is_empty() || decoded.first() == Some(&0) {
        return Err(IdentityError::ProviderUnavailable(format!(
            "JWKS contains an invalid {label}"
        )));
    }
    Ok(decoded)
}

#[derive(Default)]
struct JwksCache {
    set: Option<Arc<VerifiedJwks>>,
    fetched_at: Option<Instant>,
    last_refresh_attempt: Option<Instant>,
    last_refresh_failed: bool,
    negative_kids: HashMap<String, Instant>,
}

impl JwksCache {
    fn fresh_set(&self, now: Instant, policy: JwksPolicy) -> Option<Arc<VerifiedJwks>> {
        let fetched_at = self.fetched_at?;
        if now.saturating_duration_since(fetched_at) >= policy.fresh_ttl {
            return None;
        }
        self.set.clone()
    }

    fn install(&mut self, set: Arc<VerifiedJwks>, now: Instant) {
        self.set = Some(set);
        self.fetched_at = Some(now);
        self.last_refresh_failed = false;
    }

    fn refresh_allowed(&self, now: Instant, policy: JwksPolicy) -> bool {
        self.last_refresh_attempt
            .is_none_or(|last| now.saturating_duration_since(last) >= policy.refresh_min_interval)
    }

    fn negative_kid_is_active(&self, kid: &str, now: Instant) -> bool {
        self.negative_kids
            .get(kid)
            .is_some_and(|expires_at| *expires_at > now)
    }

    fn prune_expired_negative_kids(&mut self, now: Instant) {
        self.negative_kids.retain(|_, expires_at| *expires_at > now);
    }

    fn record_negative_kid(&mut self, kid: &str, now: Instant, policy: JwksPolicy) {
        self.prune_expired_negative_kids(now);
        if policy.negative_kid_capacity == 0 || policy.negative_kid_ttl.is_zero() {
            return;
        }

        let ttl_expiry = now.checked_add(policy.negative_kid_ttl).unwrap_or(now);
        // A negative observation made while refresh is throttled must not keep a
        // legitimately rotated key negative after the next refresh is eligible.
        let refresh_expiry = self
            .last_refresh_attempt
            .and_then(|last| last.checked_add(policy.refresh_min_interval));
        let expires_at = refresh_expiry
            .map(|refresh_expiry| ttl_expiry.min(refresh_expiry))
            .unwrap_or(ttl_expiry);
        if expires_at <= now {
            return;
        }

        if !self.negative_kids.contains_key(kid)
            && self.negative_kids.len() >= policy.negative_kid_capacity
        {
            if let Some(evicted) = self
                .negative_kids
                .iter()
                .min_by_key(|(_, expires_at)| **expires_at)
                .map(|(kid, _)| kid.clone())
            {
                self.negative_kids.remove(evicted.as_str());
            }
        }
        self.negative_kids.insert(kid.to_string(), expires_at);
    }
}

#[derive(Clone)]
pub struct WorkosAccessTokenVerifier {
    authority: WorkosAuthority,
    jwks_fetch_url: Arc<str>,
    http: reqwest::Client,
    jwks: Arc<RwLock<JwksCache>>,
    jwks_refresh: Arc<Mutex<()>>,
    jwks_policy: JwksPolicy,
}

impl WorkosAccessTokenVerifier {
    pub fn new(
        client_id: impl Into<String>,
        issuer: impl Into<String>,
        jwks_url: impl Into<String>,
    ) -> Result<Self, IdentityError> {
        let authority = WorkosAuthority::from_config(client_id, issuer, jwks_url)?;
        Self::new_with_authority(authority, None, JwksPolicy::default())
    }

    fn new_with_authority(
        authority: WorkosAuthority,
        jwks_fetch_override: Option<String>,
        jwks_policy: JwksPolicy,
    ) -> Result<Self, IdentityError> {
        let jwks_fetch_url = jwks_fetch_override.unwrap_or_else(|| authority.jwks_url.to_string());
        reqwest::Url::parse(jwks_fetch_url.as_str()).map_err(|error| {
            IdentityError::InvalidConfiguration(format!("invalid JWKS URL: {error}"))
        })?;
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|error| {
                IdentityError::InvalidConfiguration(format!("HTTP client setup failed: {error}"))
            })?;
        Ok(Self {
            authority,
            jwks_fetch_url: jwks_fetch_url.into(),
            http,
            jwks: Arc::new(RwLock::new(JwksCache::default())),
            jwks_refresh: Arc::new(Mutex::new(())),
            jwks_policy,
        })
    }

    #[cfg(test)]
    fn new_for_test(
        client_id: impl Into<String>,
        jwks_fetch_url: impl Into<String>,
        jwks_policy: JwksPolicy,
    ) -> Result<Self, IdentityError> {
        Self::new_with_authority(
            WorkosAuthority::from_client_id(client_id)?,
            Some(jwks_fetch_url.into()),
            jwks_policy,
        )
    }

    pub fn from_env() -> Result<Option<Self>, IdentityError> {
        let client_id = std::env::var("WORKOS_CLIENT_ID").ok();
        let issuer = std::env::var("WORKOS_ISSUER").ok();
        let jwks_url = std::env::var("WORKOS_JWKS_URL").ok();
        match (client_id, issuer, jwks_url) {
            (None, None, None) => Ok(None),
            (Some(client_id), Some(issuer), Some(jwks_url)) => {
                Self::new(client_id, issuer, jwks_url).map(Some)
            }
            _ => Err(IdentityError::InvalidConfiguration(
                "WORKOS_CLIENT_ID, WORKOS_ISSUER, and WORKOS_JWKS_URL must be set together"
                    .to_string(),
            )),
        }
    }

    async fn fetch_jwks(&self) -> Result<Arc<VerifiedJwks>, IdentityError> {
        let mut response = self
            .http
            .get(self.jwks_fetch_url.as_ref())
            .send()
            .await
            .map_err(|error| IdentityError::ProviderUnavailable(error.to_string()))?;
        if !response.status().is_success() {
            return Err(IdentityError::ProviderUnavailable(format!(
                "JWKS endpoint returned HTTP {}",
                response.status()
            )));
        }
        if response.content_length().is_some_and(|length| {
            length > u64::try_from(self.jwks_policy.max_response_bytes).unwrap_or(u64::MAX)
        }) {
            return Err(IdentityError::ProviderUnavailable(
                "JWKS response exceeds the configured byte limit".to_string(),
            ));
        }

        let mut body = BytesMut::with_capacity(
            response
                .content_length()
                .and_then(|length| usize::try_from(length).ok())
                .unwrap_or_default()
                .min(self.jwks_policy.max_response_bytes),
        );
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| IdentityError::ProviderUnavailable(error.to_string()))?
        {
            if body
                .len()
                .checked_add(chunk.len())
                .is_none_or(|length| length > self.jwks_policy.max_response_bytes)
            {
                return Err(IdentityError::ProviderUnavailable(
                    "JWKS response exceeds the configured byte limit".to_string(),
                ));
            }
            body.extend_from_slice(&chunk);
        }

        let jwks = serde_json::from_slice::<JwkSet>(&body)
            .map_err(|error| IdentityError::ProviderUnavailable(error.to_string()))?;
        VerifiedJwks::normalize(jwks, self.jwks_policy).map(Arc::new)
    }

    async fn fresh_jwks(&self) -> Option<Arc<VerifiedJwks>> {
        let cache = self.jwks.read().await;
        cache.fresh_set(Instant::now(), self.jwks_policy)
    }

    async fn ensure_jwks(&self) -> Result<Arc<VerifiedJwks>, IdentityError> {
        if let Some(jwks) = self.fresh_jwks().await {
            return Ok(jwks);
        }

        let _refresh = self.jwks_refresh.lock().await;
        if let Some(jwks) = self.fresh_jwks().await {
            return Ok(jwks);
        }

        {
            let mut cache = self.jwks.write().await;
            let now = Instant::now();
            // The second freshness check happened while holding the refresh
            // guard. From here onward the old snapshot is definitively stale;
            // discard it before throttling or provider I/O so no error path can
            // accidentally preserve a usable stale-key representation.
            cache.set = None;
            cache.fetched_at = None;
            if !cache.refresh_allowed(now, self.jwks_policy) {
                return Err(IdentityError::ProviderUnavailable(
                    "JWKS refresh is temporarily throttled".to_string(),
                ));
            }
            cache.last_refresh_attempt = Some(now);
        }

        match self.fetch_jwks().await {
            Ok(jwks) => {
                let mut cache = self.jwks.write().await;
                cache.install(jwks.clone(), Instant::now());
                cache.negative_kids.clear();
                Ok(jwks)
            }
            Err(error) => {
                let mut cache = self.jwks.write().await;
                cache.last_refresh_failed = true;
                Err(error)
            }
        }
    }

    async fn refresh_for_unknown_kid(&self, kid: &str) -> Result<Arc<VerifiedJwks>, IdentityError> {
        {
            let cache = self.jwks.read().await;
            let now = Instant::now();
            if let Some(jwks) = cache
                .fresh_set(now, self.jwks_policy)
                .filter(|jwks| jwks.find(kid).is_some())
            {
                return Ok(jwks);
            }
            if cache.negative_kid_is_active(kid, now) {
                return Err(IdentityError::UnknownKey);
            }
        }

        // Unknown-key floods must not build an async waiter queue behind slow
        // provider I/O. One caller becomes the refresh leader; followers
        // re-check the cache and fail fast while that leader is in flight.
        let _refresh = match self.jwks_refresh.try_lock() {
            Ok(refresh) => refresh,
            Err(_) => {
                let mut cache = self.jwks.write().await;
                let now = Instant::now();
                cache.prune_expired_negative_kids(now);
                let fresh_jwks = cache.fresh_set(now, self.jwks_policy);
                if let Some(jwks) = fresh_jwks.as_ref().filter(|jwks| jwks.find(kid).is_some()) {
                    return Ok(jwks.clone());
                }
                if fresh_jwks.is_none() || cache.last_refresh_failed {
                    return Err(IdentityError::ProviderUnavailable(
                        "JWKS refresh is already in progress".to_string(),
                    ));
                }
                cache.record_negative_kid(kid, now, self.jwks_policy);
                return Err(IdentityError::UnknownKey);
            }
        };
        {
            let mut cache = self.jwks.write().await;
            let now = Instant::now();
            cache.prune_expired_negative_kids(now);
            let fresh_jwks = cache.fresh_set(now, self.jwks_policy);
            if let Some(jwks) = fresh_jwks.as_ref().filter(|jwks| jwks.find(kid).is_some()) {
                return Ok(jwks.clone());
            }
            if cache.negative_kid_is_active(kid, now) {
                return Err(IdentityError::UnknownKey);
            }
            if !cache.refresh_allowed(now, self.jwks_policy) {
                // Once the positive cache expires, never fall back to it. A
                // refresh floor still protects the provider, but callers fail
                // closed until a new set has been fetched.
                if fresh_jwks.is_none() || cache.last_refresh_failed {
                    return Err(IdentityError::ProviderUnavailable(
                        "JWKS refresh is temporarily unavailable".to_string(),
                    ));
                }
                cache.record_negative_kid(kid, now, self.jwks_policy);
                return Err(IdentityError::UnknownKey);
            }
            cache.last_refresh_attempt = Some(now);
        }

        match self.fetch_jwks().await {
            Ok(jwks) => {
                let mut cache = self.jwks.write().await;
                cache.install(jwks.clone(), Instant::now());
                cache
                    .negative_kids
                    .retain(|negative_kid, _| jwks.find(negative_kid).is_none());
                if jwks.find(kid).is_none() {
                    cache.record_negative_kid(kid, Instant::now(), self.jwks_policy);
                }
                Ok(jwks)
            }
            Err(error) => {
                self.jwks.write().await.last_refresh_failed = true;
                Err(error)
            }
        }
    }

    fn decode_with_jwks(
        &self,
        token: &str,
        kid: &str,
        jwks: &VerifiedJwks,
    ) -> Result<VerifiedIdentity, IdentityError> {
        let key = jwks.find(kid).ok_or(IdentityError::UnknownKey)?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.leeway = WORKOS_CLOCK_SKEW_SECS;
        validation.set_issuer(&[self.authority.issuer.as_ref()]);
        validation.set_required_spec_claims(&["exp", "iss", "sub"]);
        let token =
            decode::<Claims>(token, key, &validation).map_err(|_| IdentityError::InvalidToken)?;
        let subject =
            required(token.claims.sub, "subject").map_err(|_| IdentityError::InvalidToken)?;
        let session_id = WorkosSessionId::parse(token.claims.sid)?;
        if token.claims.client_id.as_deref() != Some(self.authority.client_id.as_str()) {
            return Err(IdentityError::InvalidToken);
        }
        validate_assertion_window(
            token.claims.iat,
            token.claims.exp,
            current_unix_timestamp()?,
        )?;
        let issued_at = i64::try_from(token.claims.iat).map_err(|_| IdentityError::InvalidToken)?;
        let expires_at =
            i64::try_from(token.claims.exp).map_err(|_| IdentityError::InvalidToken)?;
        Ok(VerifiedIdentity {
            subject,
            session_id,
            issued_at,
            expires_at,
            signing_key_id: kid.to_string(),
            email: token.claims.email.filter(|email| !email.trim().is_empty()),
        })
    }
}

#[async_trait]
impl AccessTokenVerifier for WorkosAccessTokenVerifier {
    async fn verify(&self, token: &str) -> Result<VerifiedIdentity, IdentityError> {
        validate_compact_jwt(token)?;
        let header = decode_header(token).map_err(|_| IdentityError::InvalidToken)?;
        if header.alg != Algorithm::RS256 {
            return Err(IdentityError::InvalidToken);
        }
        let kid = header.kid.ok_or(IdentityError::MissingKeyId)?;
        if !is_canonical_signing_key_id(kid.as_str()) {
            return Err(IdentityError::InvalidToken);
        }

        let jwks = self.ensure_jwks().await?;
        match self.decode_with_jwks(token, kid.as_str(), &jwks) {
            Err(IdentityError::UnknownKey) => {
                let refreshed = self.refresh_for_unknown_kid(kid.as_str()).await?;
                self.decode_with_jwks(token, kid.as_str(), &refreshed)
            }
            result => result,
        }
    }
}

#[derive(Debug, Deserialize)]
struct Claims {
    sub: String,
    sid: String,
    iat: u64,
    exp: u64,
    client_id: Option<String>,
    email: Option<String>,
}

fn is_canonical_signing_key_id(kid: &str) -> bool {
    !kid.is_empty()
        && kid.len() <= JWKS_MAX_KID_BYTES
        && kid.bytes().all(|byte| matches!(byte, b'!'..=b'~'))
}

fn validate_compact_jwt(token: &str) -> Result<(), IdentityError> {
    if token.is_empty() || !token.is_ascii() || token.len() > COMPACT_JWT_MAX_BYTES {
        return Err(IdentityError::InvalidToken);
    }
    let mut segments = token.split('.');
    for max_length in COMPACT_JWT_SEGMENT_MAX_BYTES {
        let segment = segments.next().ok_or(IdentityError::InvalidToken)?;
        if segment.is_empty() || segment.len() > max_length {
            return Err(IdentityError::InvalidToken);
        }
    }
    if segments.next().is_some() {
        return Err(IdentityError::InvalidToken);
    }
    Ok(())
}

fn current_unix_timestamp() -> Result<u64, IdentityError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| IdentityError::InvalidToken)
}

fn validate_assertion_window(
    issued_at: u64,
    expires_at: u64,
    now: u64,
) -> Result<(), IdentityError> {
    let lifetime = expires_at
        .checked_sub(issued_at)
        .ok_or(IdentityError::InvalidToken)?;
    if lifetime == 0 || lifetime > WORKOS_ASSERTION_MAX_LIFETIME_SECS {
        return Err(IdentityError::InvalidToken);
    }
    if issued_at > now.saturating_add(WORKOS_CLOCK_SKEW_SECS)
        || now.saturating_sub(issued_at)
            > WORKOS_ASSERTION_MAX_AGE_SECS.saturating_add(WORKOS_CLOCK_SKEW_SECS)
    {
        return Err(IdentityError::InvalidToken);
    }
    Ok(())
}

fn required(value: String, label: &str) -> Result<String, IdentityError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(IdentityError::InvalidConfiguration(format!(
            "{label} must not be empty"
        )));
    }
    Ok(value.to_string())
}

#[derive(Clone, Default)]
pub struct StaticAccessTokenVerifier {
    identities: Arc<HashMap<String, VerifiedIdentity>>,
}

impl StaticAccessTokenVerifier {
    pub fn new(entries: impl IntoIterator<Item = (String, VerifiedIdentity)>) -> Self {
        Self {
            identities: Arc::new(entries.into_iter().collect()),
        }
    }
}

#[async_trait]
impl AccessTokenVerifier for StaticAccessTokenVerifier {
    async fn verify(&self, token: &str) -> Result<VerifiedIdentity, IdentityError> {
        self.identities
            .get(token)
            .cloned()
            .ok_or(IdentityError::InvalidToken)
    }
}

#[derive(Debug, Clone)]
pub struct WorkosResolution {
    pub principal_id: PrincipalId,
    pub global_capabilities: Vec<String>,
    pub method_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DiscoveredWorkosIdentity {
    principal_id: PrincipalId,
    method_id: Uuid,
}

async fn discover_subject(
    conn: &mut PgConnection,
    subject: &str,
) -> Result<Option<DiscoveredWorkosIdentity>, IdentityFlowError> {
    Ok(sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT principal_id, method_id FROM external_identity WHERE provider = 'workos' AND subject = $1",
    )
    .bind(subject)
    .fetch_optional(&mut *conn)
    .await?
    .map(|(principal_id, method_id)| DiscoveredWorkosIdentity {
        principal_id: PrincipalId::from_uuid(principal_id),
        method_id,
    }))
}

async fn lock_method(
    conn: &mut PgConnection,
    method_id: Uuid,
    principal_id: &PrincipalId,
) -> Result<String, IdentityFlowError> {
    let (linked_principal, kind, status) = sqlx::query_as::<_, (Uuid, String, String)>(
        "SELECT principal_id, kind, status FROM authentication_method WHERE method_id = $1 FOR UPDATE",
    )
    .bind(method_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| {
        IdentityFlowError::Internal(
            "WorkOS identity references a missing authentication method".to_string(),
        )
    })?;
    if linked_principal != principal_id.as_uuid() || kind != crate::MethodKind::Workos.as_str() {
        return Err(IdentityFlowError::Unauthorized);
    }
    Ok(status)
}

async fn lock_subject_binding(
    conn: &mut PgConnection,
    subject: &str,
) -> Result<Option<DiscoveredWorkosIdentity>, IdentityFlowError> {
    Ok(sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT principal_id, method_id FROM external_identity WHERE provider = 'workos' AND subject = $1 FOR UPDATE",
    )
    .bind(subject)
    .fetch_optional(&mut *conn)
    .await?
    .map(|(principal_id, method_id)| DiscoveredWorkosIdentity {
        principal_id: PrincipalId::from_uuid(principal_id),
        method_id,
    }))
}

/// Acquire the canonical transaction-scoped WorkOS-subject lock.
///
/// Identity mutations that combine a WorkOS assertion with an existing local
/// session must take this lock before locking the local principal. This keeps
/// their order identical to first-sight WorkOS resolution:
/// provider subject -> principal -> authentication details.
pub async fn lock_subject_advisory(
    conn: &mut PgConnection,
    subject: &str,
) -> Result<(), IdentityFlowError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("workos:{subject}"))
        .execute(&mut *conn)
        .await?;
    Ok(())
}

async fn reject_tombstoned_identity(
    conn: &mut PgConnection,
    verified: &VerifiedIdentity,
) -> Result<(), IdentityFlowError> {
    let tombstoned: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
                   SELECT 1
                   FROM workos_provider_session_tombstone
                   WHERE provider_session_hash = $1
               )
            OR EXISTS (
                   SELECT 1
                   FROM workos_subject_tombstone
                   WHERE provider_subject_hash = $2
               )
        "#,
    )
    .bind(verified.session_id.fingerprint())
    .bind(subject_fingerprint(verified.subject.as_str()))
    .fetch_one(&mut *conn)
    .await?;
    if tombstoned {
        return Err(IdentityFlowError::Unauthorized);
    }
    Ok(())
}

/// Turn verified provider provenance into a transaction-scoped admission
/// capability. Identity bindings must take this gate before their first
/// durable mutation so a future caller cannot accidentally bypass the
/// monotonic retirement boundary owned by the session layer.
async fn require_active_verified_signing_key(
    conn: &mut PgConnection,
    verified: &VerifiedIdentity,
) -> Result<(), IdentityFlowError> {
    let signing_key_id =
        crate::session::WorkosSigningKeyId::parse(verified.signing_key_id.clone())?;
    crate::session::require_active_workos_signing_key(conn, &signing_key_id).await
}

/// Resolve a verified WorkOS assertion onto an existing platform principal.
/// Previously unseen subjects are rejected: only the community-admission
/// boundary may provision one. The email claim remains display metadata and
/// is never an identity key or authorization input.
pub async fn resolve_subject(
    conn: &mut PgConnection,
    verified: &VerifiedIdentity,
    now: i64,
) -> Result<WorkosResolution, IdentityFlowError> {
    if verified.expires_at <= now {
        return Err(IdentityFlowError::Unauthorized);
    }
    lock_subject_advisory(conn, verified.subject.as_str()).await?;
    // This read is authoritative for the provider-subject lock. The earlier
    // API precheck prevents known erased identities from reaching provisioning
    // side effects; this one closes a concurrent erasure race.
    reject_tombstoned_identity(conn, verified).await?;
    // Discovery must never take the provider-detail lock. The owner gives us
    // the canonical principal -> privacy-subject lock root; the binding is
    // re-read under lock only after its authentication method is locked.
    let discovered = discover_subject(conn, verified.subject.as_str())
        .await?
        .ok_or(IdentityFlowError::Unauthorized)?;
    let principal_id = discovered.principal_id;
    let owner = methods::lock_identity_mutation(
        conn,
        &principal_id,
        methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    owner.require_active()?;
    let global_capabilities = owner.global_capabilities;

    let method_id = discovered.method_id;
    if lock_method(conn, method_id, &principal_id).await? != "active" {
        return Err(IdentityFlowError::Unauthorized);
    }

    let locked_binding = lock_subject_binding(conn, verified.subject.as_str()).await?;
    if locked_binding.as_ref() != Some(&discovered) {
        return Err(IdentityFlowError::Unauthorized);
    }
    require_active_verified_signing_key(conn, verified).await?;
    methods::touch_method(conn, method_id, now).await?;
    let updated = sqlx::query(
        "UPDATE external_identity SET last_seen_at = $1, display_label = COALESCE($2, display_label) WHERE provider = 'workos' AND subject = $3 AND principal_id = $4",
    )
    .bind(now)
    .bind(verified.email.as_deref())
    .bind(verified.subject.as_str())
    .bind(principal_id.as_uuid())
    .execute(&mut *conn)
    .await?;
    if updated.rows_affected() != 1 {
        return Err(IdentityFlowError::Unauthorized);
    }
    Ok(WorkosResolution {
        principal_id,
        global_capabilities,
        method_id,
    })
}

/// Provision one previously unseen WorkOS subject for an invitation-gated
/// admission transaction. The caller must complete membership admission in
/// the same transaction; rollback removes every identity row if admission
/// fails. Existing bindings are never moved or reused through this path.
pub async fn bind_new_subject_for_admission(
    conn: &mut PgConnection,
    verified: &VerifiedIdentity,
    now: i64,
) -> Result<WorkosResolution, IdentityFlowError> {
    if verified.expires_at <= now {
        return Err(IdentityFlowError::Unauthorized);
    }
    lock_subject_advisory(conn, verified.subject.as_str()).await?;
    reject_tombstoned_identity(conn, verified).await?;
    if discover_subject(conn, verified.subject.as_str())
        .await?
        .is_some()
    {
        return Err(IdentityFlowError::AlreadyExists(
            "this WorkOS identity is already bound",
        ));
    }
    require_active_verified_signing_key(conn, verified).await?;
    let principal_id = PrincipalId::random();
    methods::ensure_principal(conn, &principal_id, &[], now).await?;
    let owner = methods::lock_identity_mutation(
        conn,
        &principal_id,
        methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    owner.require_active()?;
    let method_id =
        methods::create_method(conn, &principal_id, crate::MethodKind::Workos, now).await?;
    if lock_subject_binding(conn, verified.subject.as_str())
        .await?
        .is_some()
    {
        return Err(IdentityFlowError::AlreadyExists(
            "this WorkOS identity is already bound",
        ));
    }
    sqlx::query(
        "INSERT INTO external_identity (provider, subject, principal_id, display_label, created_at, last_seen_at, method_id) VALUES ('workos', $1, $2, $3, $4, $4, $5)",
    )
    .bind(verified.subject.as_str())
    .bind(principal_id.as_uuid())
    .bind(verified.email.as_deref())
    .bind(now)
    .bind(method_id)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at, event_kind, actor_principal_id, principal_id,
            token_hash, related_token_hash, metadata
        )
        VALUES ($1, 'external_identity_admitted', NULL, $2, NULL, NULL, $3::JSONB)
        "#,
    )
    .bind(now)
    .bind(principal_id.as_uuid())
    .bind(
        serde_json::json!({
            "provider": "workos",
            "workos_signing_key_id": verified.signing_key_id.as_str()
        })
        .to_string(),
    )
    .execute(&mut *conn)
    .await?;
    Ok(WorkosResolution {
        principal_id,
        global_capabilities: owner.global_capabilities,
        method_id,
    })
}

/// Attach or reactivate a verified WorkOS identity on an already-authenticated
/// principal. Unlike first-sight sign-in this never provisions a new
/// principal and never moves an identity between principals.
pub async fn attach_subject(
    conn: &mut PgConnection,
    verified: &VerifiedIdentity,
    principal_id: &PrincipalId,
    now: i64,
) -> Result<WorkosResolution, IdentityFlowError> {
    lock_subject_advisory(conn, verified.subject.as_str()).await?;
    attach_subject_under_advisory_lock(conn, verified, principal_id, now).await
}

/// Attach a WorkOS subject after the caller acquired
/// [`lock_subject_advisory`]. This split lets account-linking acquire the
/// provider lock before it revalidates and locks the caller's local session,
/// preserving the global provider-subject -> principal lock order.
pub async fn attach_subject_under_advisory_lock(
    conn: &mut PgConnection,
    verified: &VerifiedIdentity,
    principal_id: &PrincipalId,
    now: i64,
) -> Result<WorkosResolution, IdentityFlowError> {
    if verified.expires_at <= now {
        return Err(IdentityFlowError::Unauthorized);
    }
    reject_tombstoned_identity(conn, verified).await?;
    let discovered = discover_subject(conn, verified.subject.as_str()).await?;
    methods::lock_active_principal_and_subject(conn, principal_id, now).await?;
    let owner = methods::lock_identity_mutation(
        conn,
        principal_id,
        methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    owner.require_active()?;
    let global_capabilities = owner.global_capabilities;
    if let Some(identity) = &discovered {
        if identity.principal_id != *principal_id {
            return Err(IdentityFlowError::AlreadyExists(
                "this WorkOS identity is linked to another principal",
            ));
        }
    }

    let existing_method = if let Some(identity) = discovered.as_ref() {
        let status = lock_method(conn, identity.method_id, principal_id).await?;
        Some((identity.method_id, status))
    } else {
        None
    };

    let locked_binding = lock_subject_binding(conn, verified.subject.as_str()).await?;
    if locked_binding != discovered {
        return Err(IdentityFlowError::Unauthorized);
    }
    if existing_method
        .as_ref()
        .is_some_and(|(_, status)| status == "active")
    {
        return Err(IdentityFlowError::AlreadyExists(
            "a WorkOS authentication method for this principal",
        ));
    }
    require_active_verified_signing_key(conn, verified).await?;
    let (method_id, method_status) = match existing_method {
        Some((method_id, status)) => (method_id, Some(status)),
        None => (
            methods::create_method(conn, principal_id, crate::MethodKind::Workos, now).await?,
            None,
        ),
    };
    if let Some(status) = method_status.as_deref() {
        if status != "disabled" {
            return Err(IdentityFlowError::Unauthorized);
        }
        sqlx::query(
            "UPDATE authentication_method SET status = 'active', disabled_at = NULL WHERE method_id = $1",
        )
        .bind(method_id)
        .execute(&mut *conn)
        .await?;
    }
    methods::touch_method(conn, method_id, now).await?;
    if discovered.is_some() {
        let updated = sqlx::query(
            "UPDATE external_identity SET last_seen_at = $1, display_label = COALESCE($2, display_label) WHERE provider = 'workos' AND subject = $3 AND principal_id = $4",
        )
        .bind(now)
        .bind(verified.email.as_deref())
        .bind(verified.subject.as_str())
        .bind(principal_id.as_uuid())
        .execute(&mut *conn)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(IdentityFlowError::Unauthorized);
        }
    } else {
        sqlx::query(
            "INSERT INTO external_identity (provider, subject, principal_id, display_label, created_at, last_seen_at, method_id) VALUES ('workos', $1, $2, $3, $4, $4, $5)",
        )
        .bind(verified.subject.as_str())
        .bind(principal_id.as_uuid())
        .bind(verified.email.as_deref())
        .bind(now)
        .bind(method_id)
        .execute(&mut *conn)
        .await?;
    }
    Ok(WorkosResolution {
        principal_id: *principal_id,
        global_capabilities,
        method_id,
    })
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::thread;
    use std::time::{Duration, Instant};

    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    use jsonwebtoken::{encode, EncodingKey, Header};

    use super::{
        current_unix_timestamp, logout_url, subject_fingerprint, validate_assertion_window,
        AccessTokenVerifier, IdentityError, JwksPolicy, StaticAccessTokenVerifier,
        VerifiedIdentity, VerifiedJwks, WorkosAccessTokenVerifier, WorkosSessionId,
        COMPACT_JWT_MAX_BYTES, WORKOS_ASSERTION_MAX_AGE_SECS, WORKOS_ASSERTION_MAX_LIFETIME_SECS,
        WORKOS_CLOCK_SKEW_SECS,
    };

    #[derive(Clone)]
    struct MockJwksResponse {
        body: Vec<u8>,
        include_content_length: bool,
        release: Option<Arc<AtomicBool>>,
        status: &'static str,
        location: Option<&'static str>,
    }

    struct MockJwksServer {
        address: std::net::SocketAddr,
        request_count: Arc<AtomicUsize>,
        stop: Arc<AtomicBool>,
        thread: Option<thread::JoinHandle<()>>,
    }

    impl MockJwksServer {
        fn start(responses: Vec<MockJwksResponse>) -> Self {
            assert!(!responses.is_empty());
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let address = listener.local_addr().unwrap();
            let request_count = Arc::new(AtomicUsize::new(0));
            let stop = Arc::new(AtomicBool::new(false));
            let thread_request_count = request_count.clone();
            let thread_stop = stop.clone();
            let thread = thread::spawn(move || {
                while !thread_stop.load(Ordering::Acquire) {
                    let (mut stream, _) = match listener.accept() {
                        Ok(connection) => connection,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(1));
                            continue;
                        }
                        Err(error) => panic!("mock JWKS listener failed: {error}"),
                    };
                    if thread_stop.load(Ordering::Acquire) {
                        break;
                    }
                    stream
                        .set_read_timeout(Some(Duration::from_secs(1)))
                        .unwrap();
                    let mut request = Vec::new();
                    let mut chunk = [0_u8; 512];
                    while request.len() <= 8 * 1024 {
                        match stream.read(&mut chunk) {
                            Ok(0) => break,
                            Ok(read) => {
                                request.extend_from_slice(&chunk[..read]);
                                if request.windows(4).any(|window| window == b"\r\n\r\n") {
                                    break;
                                }
                            }
                            Err(error)
                                if matches!(
                                    error.kind(),
                                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                                ) =>
                            {
                                break;
                            }
                            Err(error) => panic!("mock JWKS request read failed: {error}"),
                        }
                    }

                    let request_number = thread_request_count.fetch_add(1, Ordering::AcqRel);
                    let response = &responses[request_number.min(responses.len() - 1)];
                    if let Some(release) = response.release.as_ref() {
                        while !release.load(Ordering::Acquire)
                            && !thread_stop.load(Ordering::Acquire)
                        {
                            thread::sleep(Duration::from_millis(1));
                        }
                    }
                    let content_length = response
                        .include_content_length
                        .then(|| format!("Content-Length: {}\r\n", response.body.len()));
                    let location = response
                        .location
                        .map(|location| format!("Location: {location}\r\n"));
                    let headers = format!(
                        "HTTP/1.1 {}\r\nContent-Type: application/json\r\n{}{}Connection: close\r\n\r\n",
                        response.status,
                        content_length.as_deref().unwrap_or_default(),
                        location.as_deref().unwrap_or_default()
                    );
                    stream.write_all(headers.as_bytes()).unwrap();
                    stream.write_all(&response.body).unwrap();
                    stream.flush().unwrap();
                }
            });
            Self {
                address,
                request_count,
                stop,
                thread: Some(thread),
            }
        }

        fn url(&self) -> String {
            format!("http://{}/jwks", self.address)
        }

        fn request_count(&self) -> usize {
            self.request_count.load(Ordering::Acquire)
        }
    }

    impl Drop for MockJwksServer {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Release);
            if let Some(thread) = self.thread.take() {
                thread.join().unwrap();
            }
        }
    }

    fn mock_response(body: Vec<u8>) -> MockJwksResponse {
        MockJwksResponse {
            body,
            include_content_length: true,
            release: None,
            status: "200 OK",
            location: None,
        }
    }

    fn gated_response(body: Vec<u8>, release: Arc<AtomicBool>) -> MockJwksResponse {
        MockJwksResponse {
            body,
            include_content_length: true,
            release: Some(release),
            status: "200 OK",
            location: None,
        }
    }

    const TEST_RSA_A_N: &str = "yRE6rHuNR0QbHO3H3Kt2pOKGVhQqGZXInOduQNxXzuKlvQTLUTv4l4sggh5_CYYi_cvI-SXVT9kPWSKXxJXBXd_4LkvcPuUakBoAkfh-eiFVMh2VrUyWyj3MFl0HTVF9KwRXLAcwkREiS3npThHRyIxuy0ZMeZfxVL5arMhw1SRELB8HoGfG_AtH89BIE9jDBHZ9dLelK9a184zAf8LwoPLxvJb3Il5nncqPcSfKDDodMFBIMc4lQzDKL5gvmiXLXB1AGLm8KBjfE8s3L5xqi-yUod-j8MtvIj812dkS4QMiRVN_by2h3ZY8LYVGrqZXZTcgn2ujn8uKjXLZVD5TdQ";
    const TEST_RSA_B_N: &str = "nzyis1ZjfNB0bBgKFMSvvkTtwlvBsaJq7S5wA-kzeVOVpVWwkWdVha4s38XM_pa_yr47av7-z3VTmvDRyAHcaT92whREFpLv9cj5lTeJSibyr_Mrm_YtjCZVWgaOYIhwrXwKLqPr_11inWsAkfIytvHWTxZYEcXLgAXFuUuaS3uF9gEiNQwzGTU1v0FqkqTBr4B8nW3HCN47XUu0t8Y0e-lf4s4OxQawWD79J9_5d3Ry0vbV3Am1FtGJiJvOwRsIfVChDpYStTcHTCMqtvWbV6L11BWkpzGXSW4Hv43qa-GSYOD2QU68Mb59oSk2OB-BtOLpJofmbGEGgvmwyCI9Mw";
    const TEST_RSA_A_PRIVATE: &str = r#"-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDJETqse41HRBsc
7cfcq3ak4oZWFCoZlcic525A3FfO4qW9BMtRO/iXiyCCHn8JhiL9y8j5JdVP2Q9Z
IpfElcFd3/guS9w+5RqQGgCR+H56IVUyHZWtTJbKPcwWXQdNUX0rBFcsBzCRESJL
eelOEdHIjG7LRkx5l/FUvlqsyHDVJEQsHwegZ8b8C0fz0EgT2MMEdn10t6Ur1rXz
jMB/wvCg8vG8lvciXmedyo9xJ8oMOh0wUEgxziVDMMovmC+aJctcHUAYubwoGN8T
yzcvnGqL7JSh36Pwy28iPzXZ2RLhAyJFU39vLaHdljwthUaupldlNyCfa6Ofy4qN
ctlUPlN1AgMBAAECggEAdESTQjQ70O8QIp1ZSkCYXeZjuhj081CK7jhhp/4ChK7J
GlFQZMwiBze7d6K84TwAtfQGZhQ7km25E1kOm+3hIDCoKdVSKch/oL54f/BK6sKl
qlIzQEAenho4DuKCm3I4yAw9gEc0DV70DuMTR0LEpYyXcNJY3KNBOTjN5EYQAR9s
2MeurpgK2MdJlIuZaIbzSGd+diiz2E6vkmcufJLtmYUT/k/ddWvEtz+1DnO6bRHh
xuuDMeJA/lGB/EYloSLtdyCF6sII6C6slJJtgfb0bPy7l8VtL5iDyz46IKyzdyzW
tKAn394dm7MYR1RlUBEfqFUyNK7C+pVMVoTwCC2V4QKBgQD64syfiQ2oeUlLYDm4
CcKSP3RnES02bcTyEDFSuGyyS1jldI4A8GXHJ/lG5EYgiYa1RUivge4lJrlNfjyf
dV230xgKms7+JiXqag1FI+3mqjAgg4mYiNjaao8N8O3/PD59wMPeWYImsWXNyeHS
55rUKiHERtCcvdzKl4u35ZtTqQKBgQDNKnX2bVqOJ4WSqCgHRhOm386ugPHfy+8j
m6cicmUR46ND6ggBB03bCnEG9OtGisxTo/TuYVRu3WP4KjoJs2LD5fwdwJqpgtHl
yVsk45Y1Hfo+7M6lAuR8rzCi6kHHNb0HyBmZjysHWZsn79ZM+sQnLpgaYgQGRbKV
DZWlbw7g7QKBgQCl1u+98UGXAP1jFutwbPsx40IVszP4y5ypCe0gqgon3UiY/G+1
zTLp79GGe/SjI2VpQ7AlW7TI2A0bXXvDSDi3/5Dfya9ULnFXv9yfvH1QwWToySpW
Kvd1gYSoiX84/WCtjZOr0e0HmLIb0vw0hqZA4szJSqoxQgvF22EfIWaIaQKBgQCf
34+OmMYw8fEvSCPxDxVvOwW2i7pvV14hFEDYIeZKW2W1HWBhVMzBfFB5SE8yaCQy
pRfOzj9aKOCm2FjjiErVNpkQoi6jGtLvScnhZAt/lr2TXTrl8OwVkPrIaN0bG/AS
aUYxmBPCpXu3UjhfQiWqFq/mFyzlqlgvuCc9g95HPQKBgAscKP8mLxdKwOgX8yFW
GcZ0izY/30012ajdHY+/QK5lsMoxTnn0skdS+spLxaS5ZEO4qvPVb8RAoCkWMMal
2pOhmquJQVDPDLuZHdrIiKiDM20dy9sMfHygWcZjQ4WSxf/J7T9canLZIXFhHAZT
3wc9h4G8BBCtWN2TN/LsGZdB
-----END PRIVATE KEY-----"#;
    const TEST_RSA_B_PRIVATE: &str = r#"-----BEGIN RSA PRIVATE KEY-----
MIIEogIBAAKCAQEAnzyis1ZjfNB0bBgKFMSvvkTtwlvBsaJq7S5wA+kzeVOVpVWw
kWdVha4s38XM/pa/yr47av7+z3VTmvDRyAHcaT92whREFpLv9cj5lTeJSibyr/Mr
m/YtjCZVWgaOYIhwrXwKLqPr/11inWsAkfIytvHWTxZYEcXLgAXFuUuaS3uF9gEi
NQwzGTU1v0FqkqTBr4B8nW3HCN47XUu0t8Y0e+lf4s4OxQawWD79J9/5d3Ry0vbV
3Am1FtGJiJvOwRsIfVChDpYStTcHTCMqtvWbV6L11BWkpzGXSW4Hv43qa+GSYOD2
QU68Mb59oSk2OB+BtOLpJofmbGEGgvmwyCI9MwIDAQABAoIBACiARq2wkltjtcjs
kFvZ7w1JAORHbEufEO1Eu27zOIlqbgyAcAl7q+/1bip4Z/x1IVES84/yTaM8p0go
amMhvgry/mS8vNi1BN2SAZEnb/7xSxbflb70bX9RHLJqKnp5GZe2jexw+wyXlwaM
+bclUCrh9e1ltH7IvUrRrQnFJfh+is1fRon9Co9Li0GwoN0x0byrrngU8Ak3Y6D9
D8GjQA4Elm94ST3izJv8iCOLSDBmzsPsXfcCUZfmTfZ5DbUDMbMxRnSo3nQeoKGC
0Lj9FkWcfmLcpGlSXTO+Ww1L7EGq+PT3NtRae1FZPwjddQ1/4V905kyQFLamAA5Y
lSpE2wkCgYEAy1OPLQcZt4NQnQzPz2SBJqQN2P5u3vXl+zNVKP8w4eBv0vWuJJF+
hkGNnSxXQrTkvDOIUddSKOzHHgSg4nY6K02ecyT0PPm/UZvtRpWrnBjcEVtHEJNp
bU9pLD5iZ0J9sbzPU/LxPmuAP2Bs8JmTn6aFRspFrP7W0s1Nmk2jsm0CgYEAyH0X
+jpoqxj4efZfkUrg5GbSEhf+dZglf0tTOA5bVg8IYwtmNk/pniLG/zI7c+GlTc9B
BwfMr59EzBq/eFMI7+LgXaVUsM/sS4Ry+yeK6SJx/otIMWtDfqxsLD8CPMCRvecC
2Pip4uSgrl0MOebl9XKp57GoaUWRWRHqwV4Y6h8CgYAZhI4mh4qZtnhKjY4TKDjx
QYufXSdLAi9v3FxmvchDwOgn4L+PRVdMwDNms2bsL0m5uPn104EzM6w1vzz1zwKz
5pTpPI0OjgWN13Tq8+PKvm/4Ga2MjgOgPWQkslulO/oMcXbPwWC3hcRdr9tcQtn9
Imf9n2spL/6EDFId+Hp/7QKBgAqlWdiXsWckdE1Fn91/NGHsc8syKvjjk1onDcw0
NvVi5vcba9oGdElJX3e9mxqUKMrw7msJJv1MX8LWyMQC5L6YNYHDfbPF1q5L4i8j
8mRex97UVokJQRRA452V2vCO6S5ETgpnad36de3MUxHgCOX3qL382Qx9/THVmbma
3YfRAoGAUxL/Eu5yvMK8SAt/dJK6FedngcM3JEFNplmtLYVLWhkIlNRGDwkg3I5K
y18Ae9n7dHVueyslrb6weq7dTkYDi3iOYRW8HRkIQh06wEdbxt0shTzAJvvCQfrB
jg/3747WSsf/zBTcHihTRBdAv6OmdhV4/dD5YBfLAkLrd+mX7iE=
-----END RSA PRIVATE KEY-----"#;

    fn jwks_body(kids: &[&str]) -> Vec<u8> {
        jwks_body_with_modulus(kids, TEST_RSA_A_N)
    }

    fn jwks_body_with_modulus(kids: &[&str], modulus: &str) -> Vec<u8> {
        let keys = kids
            .iter()
            .map(|kid| {
                serde_json::json!({
                    "kty": "RSA",
                    "alg": "RS256",
                    "kid": kid,
                    "use": "sig",
                    "n": modulus,
                    "e": "AQAB"
                })
            })
            .collect::<Vec<_>>();
        serde_json::to_vec(&serde_json::json!({ "keys": keys })).unwrap()
    }

    fn signed_token(kid: &str, private_key: &str, issued_at: u64, expires_at: u64) -> String {
        signed_claims(
            kid,
            private_key,
            &serde_json::json!({
                "sub": "user_01",
                "sid": "session_01HQAG1HENBZMAZD82YRXDFC0B",
                "iat": issued_at,
                "exp": expires_at,
                "iss": "https://api.workos.com/user_management/client_123",
                "client_id": "client_123",
                "email": "player@example.test"
            }),
        )
    }

    fn signed_claims(kid: &str, private_key: &str, claims: &serde_json::Value) -> String {
        let mut header = Header::new(jsonwebtoken::Algorithm::RS256);
        header.kid = Some(kid.to_string());
        encode(
            &header,
            claims,
            &EncodingKey::from_rsa_pem(private_key.as_bytes()).unwrap(),
        )
        .unwrap()
    }

    fn unknown_key_token(kid: &str) -> String {
        let header = serde_json::to_vec(&serde_json::json!({
            "alg": "RS256",
            "typ": "JWT",
            "kid": kid
        }))
        .unwrap();
        format!("{}.e30.c2lnbmF0dXJl", URL_SAFE_NO_PAD.encode(header))
    }

    fn test_policy() -> JwksPolicy {
        JwksPolicy {
            refresh_min_interval: Duration::from_secs(3_600),
            fresh_ttl: Duration::from_secs(3_600),
            negative_kid_ttl: Duration::from_secs(3_600),
            negative_kid_capacity: 8,
            max_response_bytes: 64 * 1024,
            max_keys: 8,
        }
    }

    fn verifier(server: &MockJwksServer, policy: JwksPolicy) -> WorkosAccessTokenVerifier {
        WorkosAccessTokenVerifier::new_for_test("client_123", server.url(), policy).unwrap()
    }

    fn freshness_policy() -> JwksPolicy {
        JwksPolicy {
            refresh_min_interval: Duration::from_secs(1),
            fresh_ttl: Duration::from_millis(10),
            ..test_policy()
        }
    }

    async fn expire_positive_cache(verifier: &WorkosAccessTokenVerifier) {
        let mut cache = verifier.jwks.write().await;
        let expired_age = verifier
            .jwks_policy
            .fresh_ttl
            .checked_add(Duration::from_nanos(1))
            .expect("the test freshness duration must be representable");
        cache.fetched_at = Some(
            Instant::now()
                .checked_sub(expired_age)
                .expect("the test clock must permit a freshness backdate"),
        );
        cache.last_refresh_attempt = None;
    }

    #[test]
    fn workos_configuration_is_exactly_the_canonical_authority() {
        let verifier = WorkosAccessTokenVerifier::new(
            "client_123",
            "https://api.workos.com/user_management/client_123",
            "https://api.workos.com/sso/jwks/client_123",
        )
        .unwrap();
        assert_eq!(verifier.authority.client_id.as_str(), "client_123");
        assert_eq!(
            verifier.authority.issuer.as_ref(),
            "https://api.workos.com/user_management/client_123"
        );

        for (client_id, issuer, jwks_url) in [
            (
                "",
                "https://api.workos.com/user_management/",
                "https://api.workos.com/sso/jwks/",
            ),
            (
                "client_123/../../evil",
                "https://api.workos.com/user_management/client_123/../../evil",
                "https://api.workos.com/sso/jwks/client_123/../../evil",
            ),
            (
                "client_123",
                "http://api.workos.com/user_management/client_123",
                "https://api.workos.com/sso/jwks/client_123",
            ),
            (
                "client_123",
                "https://api.workos.com/user_management/client_123/",
                "https://api.workos.com/sso/jwks/client_123",
            ),
            (
                "client_123",
                "https://api.workos.com/user_management/client_123",
                "https://evil.test/sso/jwks/client_123",
            ),
            (
                "client_123",
                "https://api.workos.com/user_management/client_other",
                "https://api.workos.com/sso/jwks/client_123",
            ),
        ] {
            assert!(
                WorkosAccessTokenVerifier::new(client_id, issuer, jwks_url).is_err(),
                "noncanonical WorkOS authority was accepted: {client_id}"
            );
        }
    }

    #[tokio::test]
    async fn static_verifier_is_a_deterministic_local_proof_boundary() {
        let expected = VerifiedIdentity {
            subject: "user_01".to_string(),
            session_id: WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0B").unwrap(),
            issued_at: 4_102_444_500,
            expires_at: 4_102_444_800,
            signing_key_id: "test-key".to_string(),
            email: Some("player@example.test".to_string()),
        };
        let verifier =
            StaticAccessTokenVerifier::new([("signed-test-token".to_string(), expected.clone())]);
        assert_eq!(
            verifier.verify("signed-test-token").await.unwrap(),
            expected
        );
        assert!(verifier.verify("wrong-token").await.is_err());
    }

    #[test]
    fn assertion_window_requires_bounded_lifetime_age_and_clock_skew() {
        let now = 1_000_000;
        assert!(
            validate_assertion_window(now, now + WORKOS_ASSERTION_MAX_LIFETIME_SECS, now).is_ok()
        );
        for (issued_at, expires_at) in [
            (now, now),
            (now, now + WORKOS_ASSERTION_MAX_LIFETIME_SECS + 1),
            (now + WORKOS_CLOCK_SKEW_SECS + 1, now + 300),
            (
                now - WORKOS_ASSERTION_MAX_AGE_SECS - WORKOS_CLOCK_SKEW_SECS - 1,
                now - WORKOS_ASSERTION_MAX_AGE_SECS - WORKOS_CLOCK_SKEW_SECS + 299,
            ),
        ] {
            assert!(validate_assertion_window(issued_at, expires_at, now).is_err());
        }
    }

    #[tokio::test]
    async fn signed_assertion_requires_an_issued_at_claim() {
        let server = MockJwksServer::start(vec![mock_response(jwks_body(&["current-key"]))]);
        let verifier = verifier(&server, test_policy());
        let now = current_unix_timestamp().unwrap();
        let without_iat = signed_claims(
            "current-key",
            TEST_RSA_A_PRIVATE,
            &serde_json::json!({
                "sub": "user_01",
                "sid": "session_01HQAG1HENBZMAZD82YRXDFC0B",
                "exp": now + 300,
                "iss": "https://api.workos.com/user_management/client_123",
                "client_id": "client_123"
            }),
        );

        assert!(matches!(
            verifier.verify(without_iat.as_str()).await,
            Err(IdentityError::InvalidToken)
        ));
    }

    #[tokio::test]
    async fn expired_known_key_is_removed_on_the_next_eligible_refresh() {
        let server = MockJwksServer::start(vec![
            mock_response(jwks_body(&["removed-key"])),
            mock_response(jwks_body(&["replacement-key"])),
        ]);
        let verifier = verifier(&server, freshness_policy());
        verifier.ensure_jwks().await.unwrap();
        expire_positive_cache(&verifier).await;

        assert!(matches!(
            verifier
                .verify(unknown_key_token("removed-key").as_str())
                .await,
            Err(IdentityError::UnknownKey)
        ));
        let cache = verifier.jwks.read().await;
        assert!(cache.set.as_ref().is_some_and(
            |jwks| jwks.find("removed-key").is_none() && jwks.find("replacement-key").is_some()
        ));
        assert_eq!(server.request_count(), 2, "one preload plus one refresh");
    }

    #[tokio::test]
    async fn concurrent_expired_known_key_checks_share_one_refresh() {
        let server = MockJwksServer::start(vec![
            mock_response(jwks_body(&["current-key"])),
            mock_response(jwks_body(&["current-key"])),
        ]);
        let verifier = Arc::new(verifier(&server, freshness_policy()));
        verifier.ensure_jwks().await.unwrap();
        expire_positive_cache(&verifier).await;

        let attempts = (0..32)
            .map(|_| {
                let verifier = verifier.clone();
                tokio::spawn(async move {
                    verifier
                        .verify(unknown_key_token("current-key").as_str())
                        .await
                })
            })
            .collect::<Vec<_>>();
        for attempt in attempts {
            assert!(matches!(
                attempt.await.unwrap(),
                Err(IdentityError::InvalidToken)
            ));
        }

        assert_eq!(server.request_count(), 2, "one preload plus one refresh");
    }

    #[tokio::test]
    async fn expired_cache_fails_closed_when_the_provider_stays_unavailable() {
        let server = MockJwksServer::start(vec![
            mock_response(jwks_body(&["stale-key"])),
            mock_response(b"not valid JWKS".to_vec()),
        ]);
        let verifier = verifier(&server, freshness_policy());
        verifier.ensure_jwks().await.unwrap();
        expire_positive_cache(&verifier).await;

        for _ in 0..2 {
            assert!(matches!(
                verifier
                    .verify(unknown_key_token("stale-key").as_str())
                    .await,
                Err(IdentityError::ProviderUnavailable(_))
            ));
        }
        assert_eq!(
            server.request_count(),
            2,
            "the retry floor suppresses an immediate second provider request"
        );

        // Model the next eligible refresh without a wall-clock sleep. The
        // provider still fails, and the stale key is still never trusted.
        verifier.jwks.write().await.last_refresh_attempt = None;
        assert!(matches!(
            verifier
                .verify(unknown_key_token("stale-key").as_str())
                .await,
            Err(IdentityError::ProviderUnavailable(_))
        ));
        assert_eq!(server.request_count(), 3);
        let cache = verifier.jwks.read().await;
        assert!(cache
            .fresh_set(Instant::now(), verifier.jwks_policy)
            .is_none());
        assert!(
            cache.set.is_none(),
            "the expired snapshot must be discarded"
        );
    }

    #[tokio::test]
    async fn concurrent_unknown_kids_share_one_refresh_and_negative_cache_stays_bounded() {
        let server = MockJwksServer::start(vec![
            mock_response(jwks_body(&["current-key"])),
            mock_response(jwks_body(&["current-key"])),
        ]);
        let verifier = Arc::new(verifier(&server, test_policy()));
        verifier.ensure_jwks().await.unwrap();
        // Model an established cache whose refresh floor has elapsed.
        verifier.jwks.write().await.last_refresh_attempt = None;

        let attempts = (0..32)
            .map(|index| {
                let verifier = verifier.clone();
                tokio::spawn(async move {
                    verifier
                        .verify(unknown_key_token(format!("attacker-{index}").as_str()).as_str())
                        .await
                })
            })
            .collect::<Vec<_>>();
        for attempt in attempts {
            assert!(matches!(
                attempt.await.unwrap(),
                Err(IdentityError::UnknownKey)
            ));
        }

        assert_eq!(server.request_count(), 2, "one preload plus one refresh");
        assert_eq!(verifier.jwks.read().await.negative_kids.len(), 8);
    }

    #[tokio::test]
    async fn unknown_kid_flood_followers_fail_fast_while_the_provider_is_delayed() {
        let release = Arc::new(AtomicBool::new(false));
        let server = MockJwksServer::start(vec![
            mock_response(jwks_body(&["current-key"])),
            gated_response(jwks_body(&["current-key"]), release.clone()),
        ]);
        let verifier = Arc::new(verifier(&server, test_policy()));
        verifier.ensure_jwks().await.unwrap();
        verifier.jwks.write().await.last_refresh_attempt = None;

        let leader_verifier = verifier.clone();
        let leader = tokio::spawn(async move {
            leader_verifier
                .verify(unknown_key_token("leader-unknown").as_str())
                .await
        });
        let leader_deadline = Instant::now() + Duration::from_secs(1);
        while server.request_count() < 2 && Instant::now() < leader_deadline {
            tokio::task::yield_now().await;
        }
        assert_eq!(
            server.request_count(),
            2,
            "refresh leader never reached provider"
        );

        let followers = (0..32)
            .map(|index| {
                let verifier = verifier.clone();
                tokio::spawn(async move {
                    verifier
                        .verify(unknown_key_token(format!("follower-{index}").as_str()).as_str())
                        .await
                })
            })
            .collect::<Vec<_>>();
        let follower_deadline = Instant::now() + Duration::from_secs(1);
        while followers.iter().any(|follower| !follower.is_finished())
            && Instant::now() < follower_deadline
        {
            tokio::task::yield_now().await;
        }
        assert!(
            followers.iter().all(|follower| follower.is_finished()),
            "unknown-key followers queued behind provider I/O"
        );
        assert!(
            !leader.is_finished(),
            "provider response was not held by the gate"
        );
        for follower in followers {
            assert!(matches!(
                follower.await.unwrap(),
                Err(IdentityError::UnknownKey)
            ));
        }
        assert_eq!(server.request_count(), 2, "followers caused provider I/O");

        release.store(true, Ordering::Release);
        assert!(matches!(
            leader.await.unwrap(),
            Err(IdentityError::UnknownKey)
        ));
    }

    #[tokio::test]
    async fn real_rs256_tokens_verify_across_a_signing_key_rotation() {
        let server = MockJwksServer::start(vec![
            mock_response(jwks_body(&["current-key"])),
            mock_response(jwks_body_with_modulus(&["rotated-key"], TEST_RSA_B_N)),
        ]);
        let verifier = verifier(&server, test_policy());
        let now = current_unix_timestamp().unwrap();

        let current = verifier
            .verify(signed_token("current-key", TEST_RSA_A_PRIVATE, now, now + 300).as_str())
            .await
            .unwrap();
        assert_eq!(current.issued_at, i64::try_from(now).unwrap());
        assert_eq!(current.expires_at, i64::try_from(now + 300).unwrap());
        assert_eq!(current.signing_key_id, "current-key");
        assert_eq!(current.subject, "user_01");
        verifier.jwks.write().await.last_refresh_attempt = None;

        let rotated = verifier
            .verify(signed_token("rotated-key", TEST_RSA_B_PRIVATE, now, now + 300).as_str())
            .await
            .unwrap();
        assert_eq!(rotated.signing_key_id, "rotated-key");
        assert!(verifier
            .jwks
            .read()
            .await
            .set
            .as_ref()
            .is_some_and(|jwks| jwks.find("rotated-key").is_some()));

        assert!(matches!(
            verifier
                .verify(unknown_key_token("another-key").as_str())
                .await,
            Err(IdentityError::UnknownKey)
        ));
        assert_eq!(server.request_count(), 2);
    }

    #[test]
    fn jwks_normalization_rejects_ambiguous_or_unsupported_keys_atomically() {
        let rsa_key = |kid: Option<&str>, algorithm: &str, key_use: &str, modulus: &str| {
            let mut key = serde_json::json!({
                "kty": "RSA",
                "alg": algorithm,
                "use": key_use,
                "n": modulus,
                "e": "AQAB"
            });
            if let Some(kid) = kid {
                key.as_object_mut()
                    .unwrap()
                    .insert("kid".to_string(), serde_json::json!(kid));
            }
            key
        };
        let valid = rsa_key(Some("valid-key"), "RS256", "sig", TEST_RSA_A_N);
        let malformed_sets = [
            serde_json::json!({ "keys": [rsa_key(None, "RS256", "sig", TEST_RSA_A_N)] }),
            serde_json::json!({ "keys": [rsa_key(Some(""), "RS256", "sig", TEST_RSA_A_N)] }),
            serde_json::json!({ "keys": [rsa_key(Some(&"x".repeat(257)), "RS256", "sig", TEST_RSA_A_N)] }),
            serde_json::json!({ "keys": [rsa_key(Some("has space"), "RS256", "sig", TEST_RSA_A_N)] }),
            serde_json::json!({ "keys": [rsa_key(Some("unicode-☃"), "RS256", "sig", TEST_RSA_A_N)] }),
            serde_json::json!({ "keys": [rsa_key(Some("wrong-alg"), "PS256", "sig", TEST_RSA_A_N)] }),
            serde_json::json!({ "keys": [rsa_key(Some("encrypt"), "RS256", "enc", TEST_RSA_A_N)] }),
            serde_json::json!({ "keys": [{
                "kty": "RSA", "use": "sig", "kid": "missing-alg", "n": TEST_RSA_A_N, "e": "AQAB"
            }] }),
            serde_json::json!({ "keys": [{
                "kty": "RSA", "alg": "RS256", "kid": "missing-use", "n": TEST_RSA_A_N, "e": "AQAB"
            }] }),
            serde_json::json!({ "keys": [{
                "kty": "RSA", "alg": "RS256", "use": "sig", "key_ops": ["sign"],
                "kid": "wrong-ops", "n": TEST_RSA_A_N, "e": "AQAB"
            }] }),
            serde_json::json!({ "keys": [{
                "kty": "oct", "alg": "RS256", "use": "sig", "kid": "symmetric", "k": "YWJj"
            }] }),
            serde_json::json!({ "keys": [rsa_key(Some("weak-rsa"), "RS256", "sig", "AQAB")] }),
            serde_json::json!({ "keys": [valid.clone(), valid.clone()] }),
        ];

        for set in malformed_sets {
            let parsed = serde_json::from_value(set).unwrap();
            assert!(matches!(
                VerifiedJwks::normalize(parsed, test_policy()),
                Err(IdentityError::ProviderUnavailable(_))
            ));
        }
    }

    #[tokio::test]
    async fn jwks_stream_is_rejected_as_soon_as_the_byte_cap_is_crossed() {
        let server = MockJwksServer::start(vec![MockJwksResponse {
            body: vec![b'x'; 257],
            include_content_length: false,
            release: None,
            status: "200 OK",
            location: None,
        }]);
        let mut policy = test_policy();
        policy.max_response_bytes = 256;
        let byte_cap_verifier = verifier(&server, policy);

        assert!(matches!(
            byte_cap_verifier.ensure_jwks().await,
            Err(IdentityError::ProviderUnavailable(message))
                if message.contains("byte limit")
        ));
        assert_eq!(server.request_count(), 1);
    }

    #[tokio::test]
    async fn jwks_fetch_never_follows_redirects() {
        let server = MockJwksServer::start(vec![MockJwksResponse {
            body: Vec::new(),
            include_content_length: true,
            release: None,
            status: "302 Found",
            location: Some("/jwks"),
        }]);
        let verifier = verifier(&server, test_policy());

        assert!(matches!(
            verifier.ensure_jwks().await,
            Err(IdentityError::ProviderUnavailable(_))
        ));
        assert_eq!(server.request_count(), 1, "redirect target was requested");
    }

    #[tokio::test]
    async fn jwks_key_count_and_compact_token_shape_are_bounded() {
        let server =
            MockJwksServer::start(vec![mock_response(jwks_body(&["key-1", "key-2", "key-3"]))]);
        let mut policy = test_policy();
        policy.max_keys = 2;
        let key_count_verifier = verifier(&server, policy);

        assert!(matches!(
            key_count_verifier.ensure_jwks().await,
            Err(IdentityError::ProviderUnavailable(message))
                if message.contains("between 1 and 2 keys")
        ));
        assert_eq!(server.request_count(), 1);

        let unused_server = MockJwksServer::start(vec![mock_response(jwks_body(&["key-1"]))]);
        let verifier = verifier(&unused_server, test_policy());
        assert!(matches!(
            verifier
                .verify(unknown_key_token("x".repeat(257).as_str()).as_str())
                .await,
            Err(IdentityError::InvalidToken)
        ));
        for noncanonical_kid in ["", "has space", "unicode-☃", "line\nbreak"] {
            assert!(matches!(
                verifier
                    .verify(unknown_key_token(noncanonical_kid).as_str())
                    .await,
                Err(IdentityError::InvalidToken)
            ));
        }
        for malformed in [
            "x".repeat(COMPACT_JWT_MAX_BYTES + 1),
            "e30.e30".to_string(),
            "e30.e30.signature.extra".to_string(),
            format!("{}.e30.signature", "a".repeat(4 * 1024 + 1)),
            format!("e30.e30.{}", "a".repeat(2 * 1024 + 1)),
        ] {
            assert!(matches!(
                verifier.verify(malformed.as_str()).await,
                Err(IdentityError::InvalidToken)
            ));
        }
        assert_eq!(unused_server.request_count(), 0);
    }

    #[test]
    fn workos_session_ids_and_logout_urls_are_closed_over_canonical_provider_ids() {
        let session_id = WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0B").unwrap();
        assert_eq!(
            logout_url(&session_id),
            "https://api.workos.com/user_management/sessions/logout?session_id=session_01HQAG1HENBZMAZD82YRXDFC0B"
        );
        assert_eq!(
            session_id.fingerprint(),
            "12809d16e8a0869e08f32b449c05398bb6052a3905ea1d5d2506abe8ceb8755e"
        );
        assert_eq!(
            subject_fingerprint("user_01"),
            "91f494a9228102f44ffa1067a2a9194a7c003b5ef61502e0ee6e5d8fdcdf39f0"
        );

        for invalid in [
            "session_01HQAG1HENBZMAZD82YRXDFC0I",
            "session_01hqag1henbzmazd82yrxdfc0b",
            "session_short",
            "session_01HQAG1HENBZMAZD82YRXDFC0B&return_to=https://evil.test",
            "https://evil.test/",
        ] {
            assert!(WorkosSessionId::parse(invalid).is_err(), "{invalid}");
        }
    }
}
