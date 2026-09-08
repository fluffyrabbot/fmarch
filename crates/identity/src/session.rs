use rand::{rngs::OsRng, RngCore};
#[cfg(debug_assertions)]
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, PgPool, Postgres, Transaction};
#[cfg(debug_assertions)]
use std::collections::HashMap;
use std::fmt::Write as _;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
#[cfg(debug_assertions)]
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use crate::error::IdentityFlowError;
use crate::token::{generate_session_token, hash_token, APP_SESSION_TOKEN_PREFIX};
use crate::{Assurance, MethodKind, PrincipalId, VerifiedIdentity, WorkosSessionId};

/// One lock namespace for every destructive mutation of outstanding
/// WebSocket bearer tickets. Cleanup can try this lock and skip a ticket while
/// redemption or identity lifecycle work owns it.
pub const WEBSOCKET_TICKET_LOCK_NAMESPACE: &str = "fmarch.auth-websocket-ticket-mutation:";

/// A live-delivery batch may legitimately hold shared identity-authority locks
/// for five seconds while the socket accepts its final authorized bytes.
/// Destructive identity transactions receive a larger, transaction-local wait
/// budget so logout, disablement, erasure, and signing-key retirement cannot
/// fail merely because one healthy delivery batch is already in flight.
pub const AUTHORITY_CUTOFF_LOCK_TIMEOUT: Duration = Duration::from_secs(7);
pub const AUTHORITY_CUTOFF_STATEMENT_TIMEOUT: Duration = Duration::from_secs(10);

/// Begin an identity-authority transaction with a cutoff-safe lock budget.
///
/// The production pool intentionally keeps an aggressive general lock timeout.
/// Security cutoffs are different: they must be able to wait out the bounded
/// live-delivery fence and commit within the outer HTTP deadline. Centralizing
/// the local overrides here keeps that availability property attached to the
/// transaction rather than to deployment-specific pool configuration.
pub async fn begin_authority_transaction(
    pool: &PgPool,
) -> Result<Transaction<'static, Postgres>, IdentityFlowError> {
    let mut tx = pool.begin().await?;
    sqlx::query(
        r#"
        SELECT set_config('lock_timeout', $1, true),
               set_config('statement_timeout', $2, true)
        "#,
    )
    .bind(format!("{}ms", AUTHORITY_CUTOFF_LOCK_TIMEOUT.as_millis()))
    .bind(format!(
        "{}ms",
        AUTHORITY_CUTOFF_STATEMENT_TIMEOUT.as_millis()
    ))
    .execute(&mut *tx)
    .await?;
    Ok(tx)
}

/// Backend-owned session lifetimes. Classic and WorkOS sessions share one
/// storage shape; WorkOS sessions default shorter because upstream revocation
/// is synchronized on explicit logout, not polled on every local request.
#[derive(Debug, Clone)]
pub struct SessionPolicy {
    pub absolute_ttl_seconds: i64,
    pub workos_absolute_ttl_seconds: i64,
    pub idle_ttl_seconds: i64,
    local_proof_instance_id: Option<LocalProofInstanceId>,
}

/// Non-secret designation and process-bound authorization store for one debug
/// local-proof server. Persisted Dev sessions carry only the designation; the
/// authority itself exists solely in this process-owned object. Cloning the id
/// deliberately shares the store across API surfaces composed in one process.
#[derive(Clone)]
pub struct LocalProofInstanceId(Arc<LocalProofProcess>);

struct LocalProofProcess {
    designation: String,
    #[cfg(debug_assertions)]
    session_authorizations: Mutex<HashMap<String, LocalProofSessionAuthorization>>,
}

#[cfg(debug_assertions)]
#[derive(Debug, Clone)]
struct LocalProofSessionAuthorization {
    global_capabilities: Vec<String>,
    expires_at: i64,
}

/// Process-secret proof for one debug-only local session. There is no public
/// constructor: only [`LocalProofSessionAuthority::authorize`] can mint it.
#[cfg(debug_assertions)]
pub struct LocalProofSessionGrant {
    instance_id: LocalProofInstanceId,
    global_capabilities: Vec<String>,
}

/// Debug-only verifier owned by the API composition root. Clones retain only a
/// digest of the launch secret and the same process-instance designation.
#[cfg(debug_assertions)]
#[derive(Clone)]
pub struct LocalProofSessionAuthority {
    secret_digest: [u8; 32],
    instance_id: LocalProofInstanceId,
}

/// A Dev session that must be activated only after its database transaction
/// commits. The process-bound authority remains unusable while this value is
/// pending.
#[cfg(debug_assertions)]
pub struct PendingLocalProofSession {
    issued: IssuedSession,
    grant: LocalProofSessionGrant,
}

impl LocalProofInstanceId {
    pub fn random() -> Self {
        let mut bytes = [0u8; 32];
        let mut rng = OsRng;
        rng.fill_bytes(&mut bytes);
        let mut encoded = String::with_capacity(64);
        for byte in bytes {
            write!(&mut encoded, "{byte:02x}").expect("writing to a String cannot fail");
        }
        Self::from_designation(encoded)
    }

    pub fn parse(value: impl Into<String>) -> Result<Self, &'static str> {
        let value = value.into();
        if !is_lower_hex_256(value.as_str()) {
            return Err("local-proof instance id must be 32 bytes of lowercase hex");
        }
        Ok(Self::from_designation(value))
    }

    pub fn as_str(&self) -> &str {
        self.0.designation.as_str()
    }

    fn from_designation(designation: String) -> Self {
        Self(Arc::new(LocalProofProcess {
            designation,
            #[cfg(debug_assertions)]
            session_authorizations: Mutex::new(HashMap::new()),
        }))
    }

    #[cfg(debug_assertions)]
    fn session_capabilities(
        &self,
        session_reference: &str,
        now: i64,
    ) -> Result<Vec<String>, IdentityFlowError> {
        let mut authorizations = self
            .0
            .session_authorizations
            .lock()
            .map_err(|_| IdentityFlowError::Unauthorized)?;
        authorizations.retain(|_, authorization| authorization.expires_at > now);
        authorizations
            .get(session_reference)
            .map(|authorization| authorization.global_capabilities.clone())
            .ok_or(IdentityFlowError::Unauthorized)
    }

    #[cfg(debug_assertions)]
    fn insert_session_authorization(
        &self,
        session_reference: String,
        global_capabilities: Vec<String>,
        expires_at: i64,
    ) -> Result<(), IdentityFlowError> {
        let mut authorizations = self
            .0
            .session_authorizations
            .lock()
            .map_err(|_| IdentityFlowError::Unauthorized)?;
        authorizations.insert(
            session_reference,
            LocalProofSessionAuthorization {
                global_capabilities,
                expires_at,
            },
        );
        Ok(())
    }

    #[cfg(debug_assertions)]
    fn replace_session_authorization(
        &self,
        previous_session_reference: &str,
        session_reference: String,
        global_capabilities: Vec<String>,
        expires_at: i64,
    ) -> Result<(), IdentityFlowError> {
        let mut authorizations = self
            .0
            .session_authorizations
            .lock()
            .map_err(|_| IdentityFlowError::Unauthorized)?;
        authorizations.remove(previous_session_reference);
        authorizations.insert(
            session_reference,
            LocalProofSessionAuthorization {
                global_capabilities,
                expires_at,
            },
        );
        Ok(())
    }
}

impl std::fmt::Debug for LocalProofInstanceId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_tuple("LocalProofInstanceId")
            .field(&self.as_str())
            .finish()
    }
}

impl PartialEq for LocalProofInstanceId {
    fn eq(&self, other: &Self) -> bool {
        self.as_str() == other.as_str()
    }
}

impl Eq for LocalProofInstanceId {}

impl Hash for LocalProofInstanceId {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.as_str().hash(state);
    }
}

#[cfg(debug_assertions)]
impl LocalProofSessionAuthority {
    pub fn from_secret(secret: &str) -> Result<Self, IdentityFlowError> {
        if !is_lower_hex_256(secret) {
            return Err(IdentityFlowError::Invalid(
                "local-proof secret must encode 32 random bytes as lowercase hex".to_string(),
            ));
        }
        Ok(Self {
            secret_digest: Sha256::digest(secret.as_bytes()).into(),
            instance_id: LocalProofInstanceId::random(),
        })
    }

    pub fn instance_id(&self) -> &LocalProofInstanceId {
        &self.instance_id
    }

    pub fn authorize(
        &self,
        presented_secret: &str,
        global_capabilities: Vec<String>,
    ) -> Result<LocalProofSessionGrant, IdentityFlowError> {
        let presented_digest = Sha256::digest(presented_secret.as_bytes());
        let mut difference = 0_u8;
        for (expected, actual) in self.secret_digest.iter().zip(presented_digest) {
            difference |= *expected ^ actual;
        }
        if difference != 0 {
            return Err(IdentityFlowError::Unauthorized);
        }
        let mut normalized = Vec::with_capacity(global_capabilities.len());
        for capability in global_capabilities {
            if !matches!(capability.as_str(), "GlobalAdmin" | "GlobalMod") {
                return Err(IdentityFlowError::Invalid(
                    "local-proof authorization contains an unsupported global capability"
                        .to_string(),
                ));
            }
            if !normalized.contains(&capability) {
                normalized.push(capability);
            }
        }
        Ok(LocalProofSessionGrant {
            instance_id: self.instance_id.clone(),
            global_capabilities: normalized,
        })
    }
}

#[cfg(debug_assertions)]
impl PendingLocalProofSession {
    pub fn issued(&self) -> &IssuedSession {
        &self.issued
    }

    pub fn global_capabilities(&self) -> &[String] {
        &self.grant.global_capabilities
    }

    pub fn activate(self) -> Result<IssuedSession, IdentityFlowError> {
        self.grant.instance_id.insert_session_authorization(
            self.issued.token_hash.clone(),
            self.grant.global_capabilities,
            self.issued.expires_at,
        )?;
        Ok(self.issued)
    }
}

/// Canonical designation of the provider key that signed a WorkOS assertion.
/// The value is verified provider provenance, never caller-selected session
/// authority. Keeping it typed prevents retirement and issuance code from
/// accidentally operating on malformed or differently-normalized keys.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct WorkosSigningKeyId(String);

impl WorkosSigningKeyId {
    pub fn parse(value: impl Into<String>) -> Result<Self, IdentityFlowError> {
        let value = value.into();
        if !is_canonical_workos_signing_key_id(value.as_str()) {
            return Err(IdentityFlowError::Invalid(
                "WorkOS signing-key id is not canonical".to_string(),
            ));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

/// Durable receipt for the monotonic retirement of one WorkOS signing key.
/// Repeating the command returns the original tombstone and performs no
/// duplicate lifecycle-audit write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkosSigningKeyRetirement {
    pub signing_key_id: WorkosSigningKeyId,
    pub newly_retired: bool,
    pub retired_at: i64,
    pub retired_by_principal_id: PrincipalId,
    pub reason: String,
    pub revoked_session_count: u64,
}

impl SessionPolicy {
    /// Constructs a policy from values validated by the process composition
    /// root. Libraries do not read or repair ambient configuration.
    pub fn new(
        absolute_ttl_seconds: i64,
        workos_absolute_ttl_seconds: i64,
        idle_ttl_seconds: i64,
    ) -> Result<Self, &'static str> {
        if !(60..=31_536_000).contains(&absolute_ttl_seconds) {
            return Err("classic session TTL must be between 60 and 31536000 seconds");
        }
        if !(60..=86_400).contains(&workos_absolute_ttl_seconds) {
            return Err("WorkOS session TTL must be between 60 and 86400 seconds");
        }
        if !(60..=31_536_000).contains(&idle_ttl_seconds) {
            return Err("session idle TTL must be between 60 and 31536000 seconds");
        }
        if idle_ttl_seconds > absolute_ttl_seconds {
            return Err("session idle TTL must not exceed classic session TTL");
        }
        Ok(Self {
            absolute_ttl_seconds,
            workos_absolute_ttl_seconds,
            idle_ttl_seconds,
            local_proof_instance_id: None,
        })
    }

    /// Bind debug-only, methodless session eligibility to one exact process.
    /// The default has no local-proof authority; lifetime configuration alone
    /// can never make a persisted development session eligible.
    pub fn with_local_proof_instance(mut self, instance_id: LocalProofInstanceId) -> Self {
        #[cfg(debug_assertions)]
        {
            self.local_proof_instance_id = Some(instance_id);
        }
        #[cfg(not(debug_assertions))]
        {
            let _ = instance_id;
            self.local_proof_instance_id = None;
        }
        self
    }

    pub fn without_local_proof_instance(mut self) -> Self {
        self.local_proof_instance_id = None;
        self
    }

    pub fn classic_expiry(&self, now: i64) -> i64 {
        now.saturating_add(self.absolute_ttl_seconds)
    }

    pub fn workos_expiry(&self, now: i64) -> i64 {
        now.saturating_add(self.workos_absolute_ttl_seconds)
    }

    pub fn idle_expiry(&self, now: i64, expires_at: i64) -> i64 {
        now.saturating_add(self.idle_ttl_seconds).min(expires_at)
    }
}

impl Default for SessionPolicy {
    fn default() -> Self {
        Self::new(60 * 60 * 24 * 30, 60 * 60 * 24, 60 * 60 * 24 * 7)
            .expect("built-in session policy is valid")
    }
}

struct SessionSpec<'a> {
    principal_id: &'a PrincipalId,
    authenticated_via_method_id: Option<Uuid>,
    assurance: Assurance,
    /// Required only for a debug local-proof session and supplied exclusively
    /// by the process-local proof authority at the API composition root.
    local_proof_instance_id: Option<&'a LocalProofInstanceId>,
    /// Present only for WorkOS external-SSO sessions. This is sourced from the
    /// verified `sid` claim, never from a client request.
    workos_session_id: Option<&'a WorkosSessionId>,
    /// The verified JWKS key id that signed a WorkOS assertion. This remains
    /// backend-only provenance for exact key retirement and session rotation.
    workos_signing_key_id: Option<&'a str>,
    authenticated_at: i64,
    expires_at: i64,
    idle_expires_at: i64,
}

#[derive(Debug, Clone)]
pub struct IssuedSession {
    pub session_token: String,
    pub token_hash: String,
    pub principal_id: PrincipalId,
    pub expires_at: i64,
    pub idle_expires_at: i64,
}

/// Opaque result of ceremony-bound issuance. The values are observable only
/// after identity has validated the ceremony and inserted the session.
#[derive(Debug)]
pub struct SessionIssuance {
    issued: IssuedSession,
    method_id: Uuid,
    global_capabilities: Vec<String>,
}

impl SessionIssuance {
    pub fn issued(&self) -> &IssuedSession {
        &self.issued
    }

    pub fn into_issued(self) -> IssuedSession {
        self.issued
    }

    pub fn principal_id(&self) -> PrincipalId {
        self.issued.principal_id
    }

    pub fn method_id(&self) -> Uuid {
        self.method_id
    }

    pub fn global_capabilities(&self) -> &[String] {
        &self.global_capabilities
    }
}

/// Password-verification evidence whose encoded hash is deliberately hidden.
/// Issuance always compares it with the exact account row under the identity
/// owner lock, so verifying a caller-created hash grants no authority.
pub struct ClassicPasswordProof {
    encoded_hash: String,
}

impl ClassicPasswordProof {
    pub fn verify(encoded_hash: impl Into<String>, password: &str) -> Option<Self> {
        let encoded_hash = encoded_hash.into();
        crate::password::verify_password_sync(encoded_hash.as_str(), password)
            .then_some(Self { encoded_hash })
    }
}

/// Verified provider provenance bound back to its exact durable WorkOS method.
/// There is no public constructor; [`authorize_workos_session`] is the only
/// factory and [`issue_workos_session`] consumes the grant.
pub struct WorkosSessionGrant {
    subject: String,
    principal_id: PrincipalId,
    method_id: Uuid,
    session_id: WorkosSessionId,
    signing_key_id: WorkosSigningKeyId,
    assertion_issued_at: i64,
    assertion_expires_at: i64,
}

#[derive(Debug)]
pub struct RecoverySessionIssuance {
    session: SessionIssuance,
    recovery_id: Uuid,
    credential_hash: String,
    revoked_session_count: u64,
}

impl RecoverySessionIssuance {
    pub fn session(&self) -> &SessionIssuance {
        &self.session
    }

    pub fn into_session(self) -> SessionIssuance {
        self.session
    }

    pub fn recovery_id(&self) -> Uuid {
        self.recovery_id
    }

    pub fn credential_hash(&self) -> &str {
        self.credential_hash.as_str()
    }

    pub fn revoked_session_count(&self) -> u64 {
        self.revoked_session_count
    }
}

#[derive(Debug)]
pub struct GameInvitationSessionIssuance {
    session: SessionIssuance,
    credential_hash: String,
    invitation_expires_at: i64,
}

impl GameInvitationSessionIssuance {
    pub fn session(&self) -> &SessionIssuance {
        &self.session
    }

    pub fn into_session(self) -> SessionIssuance {
        self.session
    }

    pub fn credential_hash(&self) -> &str {
        self.credential_hash.as_str()
    }

    pub fn invitation_expires_at(&self) -> i64 {
        self.invitation_expires_at
    }
}

fn password_session_spec<'a>(
    principal_id: &'a PrincipalId,
    method_id: Uuid,
    policy: &SessionPolicy,
    now: i64,
) -> SessionSpec<'a> {
    let expires_at = policy.classic_expiry(now);
    SessionSpec {
        principal_id,
        authenticated_via_method_id: Some(method_id),
        assurance: Assurance::Password,
        local_proof_instance_id: None,
        workos_session_id: None,
        workos_signing_key_id: None,
        authenticated_at: now,
        expires_at,
        idle_expires_at: policy.idle_expiry(now, expires_at),
    }
}

fn session_issuance(
    issued: IssuedSession,
    method_id: Uuid,
    global_capabilities: Vec<String>,
) -> SessionIssuance {
    SessionIssuance {
        issued,
        method_id,
        global_capabilities,
    }
}

async fn discover_account_principal(
    conn: &mut PgConnection,
    account_id: &str,
) -> Result<PrincipalId, IdentityFlowError> {
    sqlx::query_scalar::<_, Uuid>("SELECT principal_id FROM auth_account WHERE account_id = $1")
        .bind(account_id)
        .fetch_optional(&mut *conn)
        .await?
        .map(PrincipalId::from_uuid)
        .ok_or(IdentityFlowError::Unauthorized)
}

async fn lock_verified_classic_account(
    conn: &mut PgConnection,
    account_id: &str,
    principal_id: &PrincipalId,
    proof: ClassicPasswordProof,
    now: i64,
) -> Result<Uuid, IdentityFlowError> {
    let row = sqlx::query_as::<_, (Uuid, String, Uuid, String, String)>(
        r#"
        SELECT account.method_id,
               account.password_hash,
               method.principal_id,
               method.kind,
               method.status
        FROM auth_account AS account
        JOIN authentication_method AS method ON method.method_id = account.method_id
        WHERE account.account_id = $1
          AND account.principal_id = $2
          AND account.disabled_at IS NULL
        FOR UPDATE OF account, method
        "#,
    )
    .bind(account_id)
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(IdentityFlowError::Unauthorized)?;
    let (method_id, encoded_hash, method_principal_id, kind, status) = row;
    if proof.encoded_hash != encoded_hash
        || method_principal_id != principal_id.as_uuid()
        || kind != MethodKind::ClassicPassword.as_str()
        || status != "active"
    {
        return Err(IdentityFlowError::Unauthorized);
    }
    crate::methods::touch_method(conn, method_id, now).await?;
    Ok(method_id)
}

/// Exchange a password proof for a session only after matching that proof to
/// the exact locked, active account and method rows.
pub async fn issue_classic_password_session(
    conn: &mut PgConnection,
    account_id: &str,
    proof: ClassicPasswordProof,
    policy: &SessionPolicy,
    now: i64,
) -> Result<SessionIssuance, IdentityFlowError> {
    if account_id.is_empty() {
        return Err(IdentityFlowError::Unauthorized);
    }
    let principal_id = discover_account_principal(conn, account_id).await?;
    let owner = crate::methods::lock_identity_mutation(
        conn,
        &principal_id,
        crate::methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    owner.require_active()?;
    let method_id =
        lock_verified_classic_account(conn, account_id, &principal_id, proof, now).await?;
    let issued = issue_session_raw(
        conn,
        password_session_spec(&principal_id, method_id, policy, now),
        now,
    )
    .await?;
    Ok(session_issuance(
        issued,
        method_id,
        owner.global_capabilities,
    ))
}

/// Bind a verifier-produced WorkOS assertion to its exact durable subject,
/// principal, and active WorkOS method. Provider/session/key tombstones are
/// checked under the same transaction before the opaque grant is minted.
pub async fn authorize_workos_session(
    conn: &mut PgConnection,
    verified: &VerifiedIdentity,
    now: i64,
) -> Result<WorkosSessionGrant, IdentityFlowError> {
    if verified.expires_at() <= now {
        return Err(IdentityFlowError::Unauthorized);
    }
    crate::workos::lock_subject_advisory(conn, verified.subject()).await?;
    reject_workos_tombstones(conn, verified.session_id(), verified.subject()).await?;

    let discovered = sqlx::query_as::<_, (Uuid, Uuid)>(
        r#"
        SELECT principal_id, method_id
        FROM external_identity
        WHERE provider = 'workos' AND subject = $1
        "#,
    )
    .bind(verified.subject())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(IdentityFlowError::Unauthorized)?;
    let principal_id = PrincipalId::from_uuid(discovered.0);
    let _ =
        lock_workos_session_binding(conn, verified.subject(), &principal_id, discovered.1).await?;
    let signing_key_id = WorkosSigningKeyId::parse(verified.signing_key_id().to_string())?;
    require_active_workos_signing_key(conn, &signing_key_id).await?;
    crate::methods::touch_method(conn, discovered.1, now).await?;
    Ok(WorkosSessionGrant {
        subject: verified.subject().to_string(),
        principal_id,
        method_id: discovered.1,
        session_id: verified.session_id().clone(),
        signing_key_id,
        assertion_issued_at: verified.issued_at().min(now),
        assertion_expires_at: verified.expires_at(),
    })
}

async fn reject_workos_tombstones(
    conn: &mut PgConnection,
    session_id: &WorkosSessionId,
    subject: &str,
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
    .bind(session_id.fingerprint())
    .bind(crate::workos::subject_fingerprint(subject))
    .fetch_one(&mut *conn)
    .await?;
    if tombstoned {
        return Err(IdentityFlowError::Unauthorized);
    }
    Ok(())
}

async fn lock_workos_session_binding(
    conn: &mut PgConnection,
    subject: &str,
    principal_id: &PrincipalId,
    method_id: Uuid,
) -> Result<Vec<String>, IdentityFlowError> {
    let owner = crate::methods::lock_identity_mutation(
        conn,
        principal_id,
        crate::methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    owner.require_active()?;
    let locked = sqlx::query_as::<_, (Uuid, Uuid, String, String)>(
        r#"
        SELECT external.principal_id,
               external.method_id,
               method.kind,
               method.status
        FROM external_identity AS external
        JOIN authentication_method AS method ON method.method_id = external.method_id
        WHERE external.provider = 'workos'
          AND external.subject = $1
          AND external.principal_id = $2
          AND external.method_id = $3
        FOR UPDATE OF external, method
        "#,
    )
    .bind(subject)
    .bind(principal_id.as_uuid())
    .bind(method_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(IdentityFlowError::Unauthorized)?;
    if locked.0 != principal_id.as_uuid()
        || locked.1 != method_id
        || locked.2 != MethodKind::Workos.as_str()
        || locked.3 != "active"
    {
        return Err(IdentityFlowError::Unauthorized);
    }
    Ok(owner.global_capabilities)
}

/// Consume an exact verified WorkOS binding grant. No principal, method,
/// assurance, provider session, or signing key is caller-selectable here.
pub async fn issue_workos_session(
    conn: &mut PgConnection,
    grant: WorkosSessionGrant,
    policy: &SessionPolicy,
    now: i64,
) -> Result<SessionIssuance, IdentityFlowError> {
    if grant.assertion_expires_at <= now {
        return Err(IdentityFlowError::Unauthorized);
    }
    crate::workos::lock_subject_advisory(conn, grant.subject.as_str()).await?;
    reject_workos_tombstones(conn, &grant.session_id, grant.subject.as_str()).await?;
    let global_capabilities = lock_workos_session_binding(
        conn,
        grant.subject.as_str(),
        &grant.principal_id,
        grant.method_id,
    )
    .await?;
    crate::methods::touch_method(conn, grant.method_id, now).await?;
    let expires_at = policy.workos_expiry(now).min(grant.assertion_expires_at);
    let spec = SessionSpec {
        principal_id: &grant.principal_id,
        authenticated_via_method_id: Some(grant.method_id),
        assurance: Assurance::ExternalSso,
        local_proof_instance_id: None,
        workos_session_id: Some(&grant.session_id),
        workos_signing_key_id: Some(grant.signing_key_id.as_str()),
        authenticated_at: grant.assertion_issued_at,
        expires_at,
        idle_expires_at: policy.idle_expiry(now, expires_at),
    };
    let issued = issue_session_raw(conn, spec, now).await?;
    Ok(session_issuance(
        issued,
        grant.method_id,
        global_capabilities,
    ))
}

/// Issue a debug session from a process-secret grant. The returned pending
/// value cannot authorize requests until the caller commits and activates it.
#[cfg(debug_assertions)]
pub async fn issue_local_proof_session(
    conn: &mut PgConnection,
    principal_id: &PrincipalId,
    grant: LocalProofSessionGrant,
    requested_expires_at: i64,
    policy: &SessionPolicy,
    now: i64,
) -> Result<PendingLocalProofSession, IdentityFlowError> {
    let policy_instance = policy
        .local_proof_instance_id
        .as_ref()
        .ok_or(IdentityFlowError::Unauthorized)?;
    if policy_instance != &grant.instance_id {
        return Err(IdentityFlowError::Unauthorized);
    }
    crate::methods::ensure_principal(conn, principal_id, &[], now).await?;
    let owner = crate::methods::lock_identity_mutation(
        conn,
        principal_id,
        crate::methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    owner.require_active()?;
    let expires_at = requested_expires_at.min(policy.classic_expiry(now));
    let issued = issue_session_raw(
        conn,
        SessionSpec {
            principal_id,
            authenticated_via_method_id: None,
            assurance: Assurance::Dev,
            local_proof_instance_id: Some(policy_instance),
            workos_session_id: None,
            workos_signing_key_id: None,
            authenticated_at: now,
            expires_at,
            idle_expires_at: policy.idle_expiry(now, expires_at),
        },
        now,
    )
    .await?;
    Ok(PendingLocalProofSession { issued, grant })
}

/// Issue the successor password session for a classic method created in this
/// transaction, after revalidating the exact bearer-origin initiating session.
pub async fn issue_session_after_classic_method_added(
    conn: &mut PgConnection,
    initiating_session: &InitiatingSession,
    account_id: &str,
    policy: &SessionPolicy,
    now: i64,
    recent_authentication_max_age_seconds: i64,
) -> Result<SessionIssuance, IdentityFlowError> {
    let authorization =
        validate_initiating_session_for_update(conn, initiating_session, policy).await?;
    crate::methods::require_recent_authentication(
        authorization.authenticated_at,
        now,
        recent_authentication_max_age_seconds,
    )?;
    let method_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT method.method_id
        FROM auth_account AS account
        JOIN authentication_method AS method ON method.method_id = account.method_id
        WHERE account.account_id = $1
          AND account.principal_id = $2
          AND account.disabled_at IS NULL
          AND account.created_at = $3
          AND method.principal_id = $2
          AND method.kind = 'classic_password'
          AND method.status = 'active'
          AND method.created_at = $3
        FOR UPDATE OF account, method
        "#,
    )
    .bind(account_id)
    .bind(authorization.principal_id.as_uuid())
    .bind(now)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(IdentityFlowError::Unauthorized)?;
    crate::methods::touch_method(conn, method_id, now).await?;
    let issued = issue_session_raw(
        conn,
        password_session_spec(&authorization.principal_id, method_id, policy, now),
        now,
    )
    .await?;
    Ok(session_issuance(
        issued,
        method_id,
        authorization.global_capabilities,
    ))
}

fn valid_argon2id_hash(encoded_hash: &str) -> bool {
    argon2::PasswordHash::new(encoded_hash).is_ok_and(|hash| hash.algorithm.as_str() == "argon2id")
}

/// Consume one exact recovery secret, replace its account password, revoke all
/// predecessor sessions, and issue the successor in the same transaction.
pub async fn redeem_recovery_credential_and_issue_session(
    conn: &mut PgConnection,
    account_id: &str,
    recovery_credential: &str,
    new_password_hash: &str,
    policy: &SessionPolicy,
    now: i64,
) -> Result<RecoverySessionIssuance, IdentityFlowError> {
    if account_id.is_empty()
        || recovery_credential.is_empty()
        || recovery_credential.len() > 256
        || !valid_argon2id_hash(new_password_hash)
    {
        return Err(IdentityFlowError::Unauthorized);
    }
    let credential_hash = hash_token(recovery_credential);
    let principal_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT account.principal_id
        FROM auth_account_recovery_credential AS recovery
        JOIN auth_account AS account USING (account_id)
        WHERE recovery.account_id = $1 AND recovery.token_hash = $2
        "#,
    )
    .bind(account_id)
    .bind(credential_hash.as_str())
    .fetch_optional(&mut *conn)
    .await?
    .map(PrincipalId::from_uuid)
    .ok_or(IdentityFlowError::Unauthorized)?;
    let owner = crate::methods::lock_identity_mutation(
        conn,
        &principal_id,
        crate::methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    owner.require_active()?;
    let recovery_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT recovery.recovery_id
        FROM auth_account_recovery_credential AS recovery
        JOIN auth_account AS account ON account.account_id = recovery.account_id
        WHERE recovery.account_id = $1
          AND recovery.token_hash = $2
          AND recovery.used_at IS NULL
          AND recovery.revoked_at IS NULL
          AND recovery.expires_at > $3
          AND account.principal_id = $4
          AND account.disabled_at IS NULL
        FOR UPDATE OF recovery, account
        "#,
    )
    .bind(account_id)
    .bind(credential_hash.as_str())
    .bind(now)
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(IdentityFlowError::Unauthorized)?;
    let consumed = sqlx::query(
        r#"
        UPDATE auth_account_recovery_credential
        SET used_at = $1
        WHERE recovery_id = $2
          AND token_hash = $3
          AND used_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > $1
        "#,
    )
    .bind(now)
    .bind(recovery_id)
    .bind(credential_hash.as_str())
    .execute(&mut *conn)
    .await?;
    if consumed.rows_affected() != 1 {
        return Err(IdentityFlowError::Unauthorized);
    }
    let changed = sqlx::query(
        r#"
        UPDATE auth_account
        SET password_hash = $1
        WHERE account_id = $2
          AND principal_id = $3
          AND disabled_at IS NULL
        "#,
    )
    .bind(new_password_hash)
    .bind(account_id)
    .bind(principal_id.as_uuid())
    .execute(&mut *conn)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(IdentityFlowError::Unauthorized);
    }
    let revoked_session_count = revoke_sessions_for_principal(conn, &principal_id, now).await?;
    let method_id =
        crate::methods::touch_active_classic_method(conn, account_id, &principal_id, now).await?;
    let issued = issue_session_raw(
        conn,
        password_session_spec(&principal_id, method_id, policy, now),
        now,
    )
    .await?;
    Ok(RecoverySessionIssuance {
        session: session_issuance(issued, method_id, owner.global_capabilities),
        recovery_id,
        credential_hash,
        revoked_session_count,
    })
}

/// Atomically bind one game invitation and its account password proof to the
/// only session that can redeem the invitation.
pub async fn redeem_game_invitation_and_issue_session(
    conn: &mut PgConnection,
    invitation_credential: &str,
    account_id: &str,
    password_proof: ClassicPasswordProof,
    policy: &SessionPolicy,
    now: i64,
) -> Result<GameInvitationSessionIssuance, IdentityFlowError> {
    if invitation_credential.is_empty()
        || account_id.is_empty()
        || invitation_credential.len() > 256
    {
        return Err(IdentityFlowError::Unauthorized);
    }
    let credential_hash = hash_token(invitation_credential);
    let principal_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT invitation.principal_id
        FROM game_invitation AS invitation
        JOIN auth_account AS account ON account.account_id = invitation.account_id
        WHERE invitation.token_hash = $1
          AND invitation.account_id = $2
          AND account.principal_id = invitation.principal_id
        "#,
    )
    .bind(credential_hash.as_str())
    .bind(account_id)
    .fetch_optional(&mut *conn)
    .await?
    .map(PrincipalId::from_uuid)
    .ok_or(IdentityFlowError::Unauthorized)?;
    let owner = crate::methods::lock_identity_mutation(
        conn,
        &principal_id,
        crate::methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    owner.require_active()?;
    let invitation = sqlx::query_as::<_, (i64, String)>(
        r#"
        SELECT invitation.expires_at, account.password_hash
        FROM game_invitation AS invitation
        JOIN auth_account AS account ON account.account_id = invitation.account_id
        WHERE invitation.token_hash = $1
          AND invitation.account_id = $2
          AND invitation.principal_id = $3
          AND invitation.redeemed_at IS NULL
          AND invitation.revoked_at IS NULL
          AND invitation.expires_at > $4
          AND account.principal_id = invitation.principal_id
          AND account.disabled_at IS NULL
        FOR UPDATE OF invitation, account
        "#,
    )
    .bind(credential_hash.as_str())
    .bind(account_id)
    .bind(principal_id.as_uuid())
    .bind(now)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(IdentityFlowError::Unauthorized)?;
    if invitation.1 != password_proof.encoded_hash {
        return Err(IdentityFlowError::Unauthorized);
    }
    let method_id =
        crate::methods::touch_active_classic_method(conn, account_id, &principal_id, now).await?;
    let issued = issue_session_raw(
        conn,
        password_session_spec(&principal_id, method_id, policy, now),
        now,
    )
    .await?;
    let redeemed = sqlx::query(
        r#"
        UPDATE game_invitation
        SET redeemed_at = $1, redeemed_session_token_hash = $2
        WHERE token_hash = $3
          AND redeemed_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > $1
        "#,
    )
    .bind(now)
    .bind(issued.token_hash.as_str())
    .bind(credential_hash.as_str())
    .execute(&mut *conn)
    .await?;
    if redeemed.rows_affected() != 1 {
        return Err(IdentityFlowError::Unauthorized);
    }
    Ok(GameInvitationSessionIssuance {
        session: session_issuance(issued, method_id, owner.global_capabilities),
        credential_hash,
        invitation_expires_at: invitation.0,
    })
}

/// Issue the initial classic session only for the exact invitation credential
/// consumed by a just-completed community admission. The absence of any prior
/// session makes the durable ceremony single-use even if the plaintext invite
/// were retained.
pub async fn issue_community_admission_session(
    conn: &mut PgConnection,
    invitation_credential: &str,
    account_id: &str,
    policy: &SessionPolicy,
    now: i64,
) -> Result<SessionIssuance, IdentityFlowError> {
    if invitation_credential.is_empty()
        || invitation_credential.len() > 256
        || account_id.is_empty()
    {
        return Err(IdentityFlowError::Unauthorized);
    }
    let credential_hash = hash_token(invitation_credential);
    let principal_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT membership.active_principal_id
        FROM community_invitation_credential AS credential
        JOIN community_invitation AS invitation
          ON invitation.invitation_id = credential.invitation_id
        JOIN community_membership AS membership
          ON membership.membership_id = invitation.admitted_membership_id
        WHERE credential.token_hash = $1
          AND membership.active_principal_id IS NOT NULL
        "#,
    )
    .bind(credential_hash.as_str())
    .fetch_optional(&mut *conn)
    .await?
    .map(PrincipalId::from_uuid)
    .ok_or(IdentityFlowError::Unauthorized)?;
    let owner = crate::methods::lock_identity_mutation(
        conn,
        &principal_id,
        crate::methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    owner.require_active()?;
    let method_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT method.method_id
        FROM community_invitation_credential AS credential
        JOIN community_invitation AS invitation
          ON invitation.invitation_id = credential.invitation_id
        JOIN community_membership AS membership
          ON membership.membership_id = invitation.admitted_membership_id
        JOIN auth_account AS account
          ON account.principal_id = membership.active_principal_id
        JOIN authentication_method AS method ON method.method_id = account.method_id
        WHERE credential.token_hash = $1
          AND credential.consumed_at = $2
          AND credential.revoked_at IS NULL
          AND invitation.status = 'accepted'
          AND invitation.admitted_membership_id = membership.membership_id
          AND membership.status = 'active'
          AND membership.origin_kind = 'invitation'
          AND membership.admission_invitation_id = invitation.invitation_id
          AND membership.active_principal_id = $3
          AND account.account_id = $4
          AND account.disabled_at IS NULL
          AND method.principal_id = $3
          AND method.kind = 'classic_password'
          AND method.status = 'active'
          AND NOT EXISTS (
              SELECT 1 FROM auth_session WHERE principal_id = $3
          )
        FOR UPDATE OF credential, invitation, membership, account, method
        "#,
    )
    .bind(credential_hash.as_str())
    .bind(now)
    .bind(principal_id.as_uuid())
    .bind(account_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(IdentityFlowError::Unauthorized)?;
    crate::methods::touch_method(conn, method_id, now).await?;
    let issued = issue_session_raw(
        conn,
        password_session_spec(&principal_id, method_id, policy, now),
        now,
    )
    .await?;
    Ok(session_issuance(
        issued,
        method_id,
        owner.global_capabilities,
    ))
}

async fn issue_session_raw(
    conn: &mut PgConnection,
    spec: SessionSpec<'_>,
    now: i64,
) -> Result<IssuedSession, IdentityFlowError> {
    if spec.expires_at <= now {
        return Err(IdentityFlowError::Invalid(
            "session expiry must be in the future".to_string(),
        ));
    }
    if spec.idle_expires_at <= now || spec.idle_expires_at > spec.expires_at {
        return Err(IdentityFlowError::Invalid(
            "session idle expiry must be in the future and no later than absolute expiry"
                .to_string(),
        ));
    }
    if matches!(spec.assurance, Assurance::ExternalSso) != spec.workos_session_id.is_some() {
        return Err(IdentityFlowError::Invalid(
            "only WorkOS external-SSO sessions may carry a provider session id".to_string(),
        ));
    }
    #[cfg(debug_assertions)]
    let is_local_proof = spec.assurance == Assurance::Dev;
    #[cfg(not(debug_assertions))]
    let is_local_proof = false;
    if is_local_proof != spec.local_proof_instance_id.is_some() {
        return Err(IdentityFlowError::Invalid(
            "only Dev sessions may carry a local-proof instance id, and every Dev session requires one"
                .to_string(),
        ));
    }
    let is_workos = spec.assurance == Assurance::ExternalSso;
    let workos_signing_key_id = match (is_workos, spec.workos_signing_key_id) {
        (true, Some(key_id)) => Some(WorkosSigningKeyId::parse(key_id.to_string())?),
        (false, None) => None,
        _ => {
            return Err(IdentityFlowError::Invalid(
                "only WorkOS sessions may carry a canonical signing-key id, and every WorkOS session requires one"
                    .to_string(),
            ))
        }
    };
    if let Some(key_id) = workos_signing_key_id.as_ref() {
        require_active_workos_signing_key(conn, key_id).await?;
    }
    let session_token = generate_session_token();
    let token_hash = hash_token(session_token.as_str());
    sqlx::query(
        r#"
        INSERT INTO auth_session (
            token_hash,
            principal_id,
            created_at,
            expires_at,
            revoked_at,
            authenticated_via_method_id,
            idle_expires_at,
            assurance,
            local_proof_instance_id,
            workos_session_id,
            workos_signing_key_id,
            authenticated_at
        )
        VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10, $11)
        "#,
    )
    .bind(&token_hash)
    .bind(spec.principal_id.as_uuid())
    .bind(now)
    .bind(spec.expires_at)
    .bind(spec.authenticated_via_method_id)
    .bind(spec.idle_expires_at)
    .bind(spec.assurance.as_str())
    .bind(
        spec.local_proof_instance_id
            .map(LocalProofInstanceId::as_str),
    )
    .bind(spec.workos_session_id.map(WorkosSessionId::as_str))
    .bind(
        workos_signing_key_id
            .as_ref()
            .map(WorkosSigningKeyId::as_str),
    )
    .bind(spec.authenticated_at)
    .execute(&mut *conn)
    .await?;
    Ok(IssuedSession {
        session_token,
        token_hash,
        principal_id: *spec.principal_id,
        expires_at: spec.expires_at,
        idle_expires_at: spec.idle_expires_at,
    })
}

/// Canonical request authorization resolved from one eligible backend-owned
/// app session. `session_reference` is the stored token hash, never a bearer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizationContext {
    principal_id: PrincipalId,
    global_capabilities: Vec<String>,
    method: Option<(Uuid, MethodKind)>,
    assurance: Assurance,
    /// The trusted provider session behind a WorkOS local session. This value
    /// is never serialized directly to clients.
    workos_session_id: Option<WorkosSessionId>,
    session_reference: String,
    created_at: i64,
    authenticated_at: i64,
    expires_at: i64,
    idle_expires_at: i64,
}

/// Principal-owned authority recovered from the durable session projection.
/// Keeping the subject and its grants together prevents construction sites
/// from interleaving identity authority with authentication provenance.
#[derive(Debug)]
struct SessionSubjectAuthority {
    principal_id: PrincipalId,
    global_capabilities: Vec<String>,
}

/// Authentication evidence that justifies one session's assurance level.
/// WorkOS provenance therefore travels with the method that requires it.
#[derive(Debug)]
struct SessionAuthenticationProvenance {
    method: Option<(Uuid, MethodKind)>,
    assurance: Assurance,
    workos_session_id: Option<WorkosSessionId>,
    authenticated_at: i64,
}

/// Opaque session identity and the complete window in which it may authorize.
#[derive(Debug)]
struct SessionValidity {
    session_reference: String,
    created_at: i64,
    expires_at: i64,
    idle_expires_at: i64,
}

/// Typed construction boundary for an authorization context. Callers must
/// provide coherent subject authority, authentication provenance, and session
/// validity instead of relying on a long positional argument list.
#[derive(Debug)]
struct SessionAuthoritySnapshot {
    subject: SessionSubjectAuthority,
    authentication: SessionAuthenticationProvenance,
    validity: SessionValidity,
}

impl AuthorizationContext {
    fn new(snapshot: SessionAuthoritySnapshot) -> Result<Self, IdentityFlowError> {
        let SessionAuthoritySnapshot {
            subject,
            authentication,
            validity,
        } = snapshot;
        let SessionSubjectAuthority {
            principal_id,
            global_capabilities,
        } = subject;
        let SessionAuthenticationProvenance {
            method,
            assurance,
            workos_session_id,
            authenticated_at,
        } = authentication;
        let SessionValidity {
            session_reference,
            created_at,
            expires_at,
            idle_expires_at,
        } = validity;
        let authority_shape_is_valid = match (&method, assurance, &workos_session_id) {
            (Some((_, MethodKind::ClassicPassword)), Assurance::Password, None)
            | (Some((_, MethodKind::Workos)), Assurance::ExternalSso, Some(_)) => true,
            #[cfg(debug_assertions)]
            (None, Assurance::Dev, None) => true,
            _ => false,
        };
        let capabilities_are_valid =
            global_capabilities
                .iter()
                .enumerate()
                .all(|(index, capability)| {
                    matches!(capability.as_str(), "GlobalAdmin" | "GlobalMod")
                        && !global_capabilities[..index].contains(capability)
                });
        if !is_canonical_session_reference(session_reference.as_str())
            || !authority_shape_is_valid
            || !capabilities_are_valid
            || authenticated_at > created_at
            || created_at >= expires_at
            || idle_expires_at > expires_at
        {
            return Err(IdentityFlowError::Unauthorized);
        }
        Ok(Self {
            principal_id,
            global_capabilities,
            method,
            assurance,
            workos_session_id,
            session_reference,
            created_at,
            authenticated_at,
            expires_at,
            idle_expires_at,
        })
    }

    pub fn principal_id(&self) -> PrincipalId {
        self.principal_id
    }

    pub fn global_capabilities(&self) -> &[String] {
        &self.global_capabilities
    }

    pub fn method(&self) -> Option<(Uuid, MethodKind)> {
        self.method
    }

    pub fn assurance(&self) -> Assurance {
        self.assurance
    }

    pub fn workos_session_id(&self) -> Option<&WorkosSessionId> {
        self.workos_session_id.as_ref()
    }

    pub fn session_reference(&self) -> &str {
        self.session_reference.as_str()
    }

    pub fn created_at(&self) -> i64 {
        self.created_at
    }

    pub fn authenticated_at(&self) -> i64 {
        self.authenticated_at
    }

    pub fn expires_at(&self) -> i64 {
        self.expires_at
    }

    pub fn idle_expires_at(&self) -> i64 {
        self.idle_expires_at
    }
}

/// Opaque identity-owned proof of the exact session that initiated a mutation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InitiatingSession {
    principal_id: PrincipalId,
    session_reference: String,
}

impl InitiatingSession {
    pub(crate) fn require_principal(
        &self,
        principal_id: &PrincipalId,
    ) -> Result<(), IdentityFlowError> {
        if self.principal_id != *principal_id {
            return Err(IdentityFlowError::Unauthorized);
        }
        Ok(())
    }
}

/// Bearer-origin proof package. Only raw canonical bearer validation can mint
/// the initiating-session proof; trusted stored-reference lookups intentionally
/// return an authorization context without mutation authority.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticatedSession {
    authorization: AuthorizationContext,
    initiating_session: InitiatingSession,
}

impl AuthenticatedSession {
    fn from_bearer_authorization(authorization: AuthorizationContext) -> Self {
        let initiating_session = InitiatingSession {
            principal_id: authorization.principal_id,
            session_reference: authorization.session_reference.clone(),
        };
        Self {
            authorization,
            initiating_session,
        }
    }

    pub fn authorization(&self) -> &AuthorizationContext {
        &self.authorization
    }

    pub fn initiating_session(&self) -> &InitiatingSession {
        &self.initiating_session
    }
}

/// Retry evidence for a WorkOS logout whose local commit already completed
/// but whose HTTP response may have been lost. This carries no authorization;
/// callers may only use it to reproduce the constrained provider logout URL
/// after independently proving the provider row and permanent tombstone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompletedWorkosLogout {
    pub principal_id: PrincipalId,
    pub method_id: Uuid,
    pub workos_session_id: WorkosSessionId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LogoutSessionState {
    Active(AuthorizationContext),
    CompletedWorkos(CompletedWorkosLogout),
}

/// A successful atomic session rotation. Both references are hashes suitable
/// for lifecycle audit correlation; only `issued.session_token` is a bearer.
#[derive(Debug, Clone)]
pub struct RotatedSession {
    pub previous_session_reference: String,
    pub issued: IssuedSession,
    pub context: AuthorizationContext,
}

#[derive(Debug)]
struct EligibleSession {
    context: AuthorizationContext,
    local_proof_capabilities: Vec<String>,
    workos_signing_key_id: Option<String>,
}

#[derive(sqlx::FromRow)]
struct EligibleSessionRow {
    principal_id: Uuid,
    created_at: i64,
    expires_at: i64,
    idle_expires_at: Option<i64>,
    assurance: Option<String>,
    local_proof_instance_id: Option<String>,
    workos_session_id: Option<String>,
    method_id: Option<Uuid>,
    method_principal_id: Option<Uuid>,
    method_kind: Option<String>,
    method_status: Option<String>,
    method_disabled_at: Option<i64>,
    principal_status: String,
    principal_disabled_at: Option<i64>,
    principal_globals: Vec<String>,
    authenticated_at: i64,
    workos_signing_key_id: Option<String>,
}

/// Validate a canonical app-session bearer. Prefix lookalikes and legacy
/// client-selected credentials are rejected before their hash reaches the
/// database.
pub async fn validate_session(
    pool: &PgPool,
    token: &str,
    policy: &SessionPolicy,
    now: i64,
) -> Result<AuthenticatedSession, IdentityFlowError> {
    if !is_canonical_app_session_token(token) {
        return Err(IdentityFlowError::Unauthorized);
    }
    let authorization =
        validate_session_reference(pool, hash_token(token).as_str(), policy, now).await?;
    Ok(AuthenticatedSession::from_bearer_authorization(
        authorization,
    ))
}

/// Validate and lock one canonical app session inside a caller-owned
/// transaction. Security-sensitive mutations use this entry point so session,
/// principal, method, assurance, absolute-expiry, and idle-expiry checks cannot
/// be replaced by a weaker ad-hoc lookup between authorization and mutation.
pub async fn validate_session_for_update(
    conn: &mut PgConnection,
    token: &str,
    policy: &SessionPolicy,
) -> Result<AuthorizationContext, IdentityFlowError> {
    if !is_canonical_app_session_token(token) {
        return Err(IdentityFlowError::Unauthorized);
    }
    let session_reference = hash_token(token);
    let principal_id = discover_session_principal(conn, session_reference.as_str()).await?;
    let owner = crate::methods::lock_identity_mutation(
        conn,
        &principal_id,
        crate::methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    owner.require_active()?;
    Ok(
        lock_eligible_session(conn, session_reference.as_str(), policy)
            .await?
            .context,
    )
}

/// Validate and lock the exact opaque session captured during request
/// authentication. Service-layer mutations use this form so bearer material
/// does not cross their boundary while revocation still wins before commit.
pub async fn validate_initiating_session_for_update(
    conn: &mut PgConnection,
    initiating_session: &InitiatingSession,
    policy: &SessionPolicy,
) -> Result<AuthorizationContext, IdentityFlowError> {
    let owner = crate::methods::lock_identity_mutation(
        conn,
        &initiating_session.principal_id,
        crate::methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    revalidate_initiating_session_after_owner_lock(conn, &owner, initiating_session, policy).await
}

/// Revalidate the exact initiating session after a lifecycle caller holds the
/// canonical identity owner lock. This acquires (or reuses) that session's
/// `FOR UPDATE` lock and reruns all principal, method, assurance, provider-key,
/// and expiry checks at a fresh clock sample. Callers must authorize from the
/// returned context before committing an irreversible or security-sensitive
/// mutation.
pub async fn revalidate_initiating_session_after_owner_lock(
    conn: &mut PgConnection,
    owner: &crate::methods::IdentityMutationOwner,
    initiating_session: &InitiatingSession,
    policy: &SessionPolicy,
) -> Result<AuthorizationContext, IdentityFlowError> {
    owner.require_active()?;
    if owner.principal_id != initiating_session.principal_id {
        return Err(IdentityFlowError::Unauthorized);
    }
    let context =
        lock_eligible_session(conn, initiating_session.session_reference.as_str(), policy)
            .await?
            .context;
    if context.principal_id != owner.principal_id {
        return Err(IdentityFlowError::Unauthorized);
    }
    Ok(context)
}

/// Validate and lock a trusted stored session reference inside a caller-owned
/// transaction. Ticket redemption uses this after reading the reference but
/// before locking/deleting the ticket, preserving the canonical
/// principal -> session -> derivative lock order. The supplied time is a
/// lower bound; time is sampled again after the session row lock so waiting
/// cannot resurrect an expired session.
pub async fn validate_session_reference_for_update(
    conn: &mut PgConnection,
    session_reference: &str,
    policy: &SessionPolicy,
    now: i64,
) -> Result<AuthorizationContext, IdentityFlowError> {
    if !is_canonical_session_reference(session_reference) {
        return Err(IdentityFlowError::Unauthorized);
    }
    let principal_id = discover_session_principal(conn, session_reference).await?;
    let owner = crate::methods::lock_identity_mutation(
        conn,
        &principal_id,
        crate::methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    owner.require_active()?;
    Ok(
        lock_eligible_session_not_before(conn, session_reference, policy, now)
            .await?
            .context,
    )
}

/// Hold a shared lock on one exact session while a caller emits bytes derived
/// from its authority. Every revocation path updates or exclusively locks the
/// same row, so keeping the caller-owned transaction open through the send
/// linearizes delivery against logout, method/principal disablement, and
/// provider-key retirement without granting the transport mutation authority.
pub async fn validate_session_reference_for_delivery(
    conn: &mut PgConnection,
    session_reference: &str,
    policy: &SessionPolicy,
    not_before: i64,
) -> Result<AuthorizationContext, IdentityFlowError> {
    if !is_canonical_session_reference(session_reference) {
        return Err(IdentityFlowError::Unauthorized);
    }
    sqlx::query_scalar::<_, String>(
        r#"
        SELECT token_hash
        FROM auth_session
        WHERE token_hash = $1
          AND revoked_at IS NULL
        FOR SHARE
        "#,
    )
    .bind(session_reference)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(IdentityFlowError::Unauthorized)?;
    let now = unix_now_seconds().max(not_before);
    Ok(
        load_eligible_session(conn, session_reference, policy, now, false)
            .await?
            .context,
    )
}

/// Enter the complete live-delivery side of the identity cutoff order:
///
/// global WorkOS retirement gate (shared) -> principal cutoff gate (shared) ->
/// exact session (shared, acquired by `validate_session_reference_for_delivery`).
///
/// Signing-key retirement takes the global gate exclusively before discovering
/// its session set; principal lifecycle work takes the owner row exclusively
/// before locking sessions. The shared prefix therefore drains the bounded set
/// of deliveries that entered first and prevents later batches from overtaking
/// a queued destructive writer.
pub async fn lock_live_delivery_cutoff_gates(
    conn: &mut PgConnection,
    principal_id: &PrincipalId,
) -> Result<(), IdentityFlowError> {
    sqlx::query(
        r#"
        SELECT pg_catalog.pg_advisory_xact_lock_shared(
            pg_catalog.hashtextextended(
                'fmarch.workos-signing-key-retirement-command', 0
            )
        )
        "#,
    )
    .execute(&mut *conn)
    .await?;
    crate::methods::lock_identity_delivery_gate(conn, principal_id).await
}

/// Lock a canonical session for logout. An eligible live row returns ordinary
/// authorization. A still-unexpired WorkOS row already revoked by an earlier
/// logout returns non-authorizing retry evidence so response loss cannot
/// strand the browser in an upstream provider session.
pub async fn lock_session_for_logout(
    conn: &mut PgConnection,
    token: &str,
    policy: &SessionPolicy,
) -> Result<LogoutSessionState, IdentityFlowError> {
    if !is_canonical_app_session_token(token) {
        return Err(IdentityFlowError::Unauthorized);
    }
    let session_reference = hash_token(token);
    let principal_id = discover_session_principal(conn, session_reference.as_str()).await?;
    let owner = crate::methods::lock_identity_mutation(
        conn,
        &principal_id,
        crate::methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    let revoked_at: Option<i64> =
        sqlx::query_scalar("SELECT revoked_at FROM auth_session WHERE token_hash = $1 FOR UPDATE")
            .bind(session_reference.as_str())
            .fetch_optional(&mut *conn)
            .await?
            .ok_or(IdentityFlowError::Unauthorized)?;
    if revoked_at.is_none() {
        owner.require_active()?;
        return Ok(LogoutSessionState::Active(
            lock_eligible_session(conn, session_reference.as_str(), policy)
                .await?
                .context,
        ));
    }

    let now = unix_now_seconds();
    let completed = sqlx::query_as::<
        _,
        (
            Uuid,
            Option<String>,
            Option<Uuid>,
            Option<String>,
            Option<Uuid>,
            Option<String>,
        ),
    >(
        r#"
        SELECT session.principal_id,
               session.assurance,
               session.authenticated_via_method_id,
               session.workos_session_id,
               method.principal_id,
               method.kind
        FROM auth_session AS session
        LEFT JOIN authentication_method AS method
          ON method.method_id = session.authenticated_via_method_id
        WHERE session.token_hash = $1
          AND session.revoked_at IS NOT NULL
          AND session.expires_at > $2
          AND COALESCE(session.idle_expires_at, session.expires_at) > $2
        "#,
    )
    .bind(session_reference.as_str())
    .bind(now)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(IdentityFlowError::Unauthorized)?;
    let (stored_principal, assurance, method_id, workos_session_id, method_principal, method_kind) =
        completed;
    if stored_principal != principal_id.as_uuid()
        || assurance.as_deref() != Some(Assurance::ExternalSso.as_str())
        || method_id.is_none()
        || method_principal != Some(principal_id.as_uuid())
        || method_kind.as_deref() != Some(MethodKind::Workos.as_str())
    {
        return Err(IdentityFlowError::Unauthorized);
    }
    let workos_session_id =
        WorkosSessionId::parse(workos_session_id.ok_or(IdentityFlowError::Unauthorized)?)
            .map_err(|_| IdentityFlowError::Unauthorized)?;
    let method_id = method_id.ok_or(IdentityFlowError::Unauthorized)?;
    Ok(LogoutSessionState::CompletedWorkos(CompletedWorkosLogout {
        principal_id,
        method_id,
        workos_session_id,
    }))
}

/// Validate a trusted stored session reference, such as one captured by a
/// single-use websocket ticket. Callers must not treat hashes as bearer
/// credentials; raw request authentication goes through [`validate_session`].
pub async fn validate_session_reference(
    pool: &PgPool,
    session_reference: &str,
    policy: &SessionPolicy,
    now: i64,
) -> Result<AuthorizationContext, IdentityFlowError> {
    if !is_canonical_session_reference(session_reference) {
        return Err(IdentityFlowError::Unauthorized);
    }
    let mut conn = pool.acquire().await?;
    Ok(
        load_eligible_session(&mut conn, session_reference, policy, now, true)
            .await?
            .context,
    )
}

/// Replace one eligible canonical app session under a row lock. The successor
/// receives a server-generated credential, retains the authentication ceremony
/// and absolute deadline, and starts a fresh bounded idle window. Revocation,
/// insertion, and lifecycle audit commit atomically.
pub async fn rotate_session(
    pool: &PgPool,
    token: &str,
    policy: &SessionPolicy,
) -> Result<RotatedSession, IdentityFlowError> {
    if !is_canonical_app_session_token(token) {
        return Err(IdentityFlowError::Unauthorized);
    }
    let previous_session_reference = hash_token(token);
    let mut tx = begin_authority_transaction(pool).await?;
    let principal_id =
        discover_session_principal(&mut tx, previous_session_reference.as_str()).await?;
    let owner = crate::methods::lock_identity_mutation(
        &mut tx,
        &principal_id,
        crate::methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    owner.require_active()?;
    let eligible =
        lock_eligible_session(&mut tx, previous_session_reference.as_str(), policy).await?;
    let now = unix_now_seconds();

    // Preserve the original WorkOS provenance only while that exact key is
    // still admissible. The transaction-scoped per-key lock closes the race
    // in which retirement could otherwise commit between validation and the
    // successor insert.
    if let Some(key_id) = eligible.workos_signing_key_id.as_deref() {
        let key_id = WorkosSigningKeyId::parse(key_id.to_string())?;
        require_active_workos_signing_key(&mut tx, &key_id).await?;
    }

    let session_token = generate_session_token();
    let token_hash = hash_token(session_token.as_str());
    let idle_expires_at = policy.idle_expiry(now, eligible.context.expires_at);
    #[cfg(debug_assertions)]
    let successor_local_proof_instance_id = (eligible.context.assurance == Assurance::Dev)
        .then_some(policy.local_proof_instance_id.as_ref())
        .flatten()
        .map(LocalProofInstanceId::as_str);
    #[cfg(not(debug_assertions))]
    let successor_local_proof_instance_id: Option<&str> = None;

    let revoked = sqlx::query(
        r#"
        UPDATE auth_session
        SET revoked_at = $1
        WHERE token_hash = $2
          AND revoked_at IS NULL
        "#,
    )
    .bind(now)
    .bind(previous_session_reference.as_str())
    .execute(&mut *tx)
    .await?;
    if revoked.rows_affected() != 1 {
        return Err(IdentityFlowError::Unauthorized);
    }

    sqlx::query(
        r#"
        INSERT INTO auth_session (
            token_hash,
            principal_id,
            created_at,
            expires_at,
            revoked_at,
            authenticated_via_method_id,
            idle_expires_at,
            assurance,
            local_proof_instance_id,
            workos_session_id,
            workos_signing_key_id,
            authenticated_at
        )
        VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10, $11)
        "#,
    )
    .bind(token_hash.as_str())
    .bind(eligible.context.principal_id.as_uuid())
    .bind(now)
    .bind(eligible.context.expires_at)
    .bind(eligible.context.method.map(|(method_id, _)| method_id))
    .bind(idle_expires_at)
    .bind(eligible.context.assurance.as_str())
    .bind(successor_local_proof_instance_id)
    .bind(
        eligible
            .context
            .workos_session_id
            .as_ref()
            .map(WorkosSessionId::as_str),
    )
    .bind(eligible.workos_signing_key_id.as_deref())
    .bind(eligible.context.authenticated_at)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_principal_id,
            principal_id,
            token_hash,
            related_token_hash,
            metadata
        )
        VALUES ($1, 'session_rotated', $2, $3, $4, $5, $6::JSONB)
        "#,
    )
    .bind(now)
    .bind(eligible.context.principal_id.as_uuid())
    .bind(eligible.context.principal_id.as_uuid())
    .bind(previous_session_reference.as_str())
    .bind(token_hash.as_str())
    .bind(
        serde_json::json!({
            "session_expires_at": eligible.context.expires_at,
            "local_proof_global_capability_count": eligible.local_proof_capabilities.len(),
            "workos_signing_key_id": eligible.workos_signing_key_id.as_deref()
        })
        .to_string(),
    )
    .execute(&mut *tx)
    .await?;

    let issued = IssuedSession {
        session_token,
        token_hash: token_hash.clone(),
        principal_id: eligible.context.principal_id,
        expires_at: eligible.context.expires_at,
        idle_expires_at,
    };
    let context = AuthorizationContext::new(SessionAuthoritySnapshot {
        subject: SessionSubjectAuthority {
            principal_id: eligible.context.principal_id,
            global_capabilities: eligible.context.global_capabilities,
        },
        authentication: SessionAuthenticationProvenance {
            method: eligible.context.method,
            assurance: eligible.context.assurance,
            workos_session_id: eligible.context.workos_session_id,
            authenticated_at: eligible.context.authenticated_at,
        },
        validity: SessionValidity {
            session_reference: token_hash,
            created_at: now,
            expires_at: eligible.context.expires_at,
            idle_expires_at,
        },
    })?;
    tx.commit().await?;
    #[cfg(debug_assertions)]
    if context.assurance == Assurance::Dev {
        policy
            .local_proof_instance_id
            .as_ref()
            .ok_or(IdentityFlowError::Unauthorized)?
            .replace_session_authorization(
                previous_session_reference.as_str(),
                issued.token_hash.clone(),
                eligible.local_proof_capabilities,
                issued.expires_at,
            )?;
    }
    Ok(RotatedSession {
        previous_session_reference,
        issued,
        context,
    })
}

/// Resolve only the owner identifier before taking any row lock. The binding
/// is deliberately untrusted until the canonical owner-first mutation lock is
/// held and [`lock_eligible_session`] revalidates the session.
async fn discover_session_principal(
    conn: &mut PgConnection,
    session_reference: &str,
) -> Result<PrincipalId, IdentityFlowError> {
    let principal_id: Uuid =
        sqlx::query_scalar("SELECT principal_id FROM auth_session WHERE token_hash = $1")
            .bind(session_reference)
            .fetch_optional(&mut *conn)
            .await?
            .ok_or(IdentityFlowError::Unauthorized)?;
    Ok(PrincipalId::from_uuid(principal_id))
}

async fn lock_eligible_session(
    conn: &mut PgConnection,
    session_reference: &str,
    policy: &SessionPolicy,
) -> Result<EligibleSession, IdentityFlowError> {
    lock_eligible_session_not_before(conn, session_reference, policy, i64::MIN).await
}

async fn lock_eligible_session_not_before(
    conn: &mut PgConnection,
    session_reference: &str,
    policy: &SessionPolicy,
    not_before: i64,
) -> Result<EligibleSession, IdentityFlowError> {
    sqlx::query_scalar::<_, String>(
        r#"
        SELECT token_hash
        FROM auth_session
        WHERE token_hash = $1
          AND revoked_at IS NULL
        FOR UPDATE
        "#,
    )
    .bind(session_reference)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(IdentityFlowError::Unauthorized)?;
    let now = unix_now_seconds().max(not_before);
    load_eligible_session(conn, session_reference, policy, now, false).await
}

/// One eligibility implementation for raw bearer validation, trusted
/// reference validation, and locked rotation. Principal and method rows are
/// deliberately re-read on every use rather than snapshotted into a token.
async fn load_eligible_session(
    conn: &mut PgConnection,
    session_reference: &str,
    policy: &SessionPolicy,
    now: i64,
    slide_idle: bool,
) -> Result<EligibleSession, IdentityFlowError> {
    let row = sqlx::query_as::<_, EligibleSessionRow>(ELIGIBLE_SESSION_SQL)
        .bind(session_reference)
        .bind(now)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(IdentityFlowError::Unauthorized)?;

    let EligibleSessionRow {
        principal_id,
        created_at,
        expires_at,
        idle_expires_at,
        assurance,
        local_proof_instance_id,
        workos_session_id,
        method_id,
        method_principal_id,
        method_kind,
        method_status,
        method_disabled_at,
        principal_status,
        principal_disabled_at,
        principal_globals,
        authenticated_at,
        workos_signing_key_id,
    } = row;
    let principal_id = PrincipalId::from_uuid(principal_id);
    if principal_status != "active" || principal_disabled_at.is_some() {
        return Err(IdentityFlowError::Unauthorized);
    }
    let assurance = assurance
        .as_deref()
        .and_then(Assurance::parse)
        .ok_or(IdentityFlowError::Unauthorized)?;
    if local_proof_instance_id
        .as_deref()
        .is_some_and(|instance_id| !is_lower_hex_256(instance_id))
    {
        return Err(IdentityFlowError::Unauthorized);
    }
    #[cfg(debug_assertions)]
    let local_proof_capabilities = if assurance == Assurance::Dev {
        match (
            local_proof_instance_id.as_deref(),
            policy.local_proof_instance_id.as_ref(),
        ) {
            (Some(stored), Some(expected)) if stored == expected.as_str() => {
                expected.session_capabilities(session_reference, now)?
            }
            _ => return Err(IdentityFlowError::Unauthorized),
        }
    } else if local_proof_instance_id.is_some() {
        return Err(IdentityFlowError::Unauthorized);
    } else {
        Vec::new()
    };
    #[cfg(not(debug_assertions))]
    if local_proof_instance_id.is_some() {
        return Err(IdentityFlowError::Unauthorized);
    }
    #[cfg(not(debug_assertions))]
    let local_proof_capabilities = Vec::new();
    let workos_signing_key_id = match (assurance, workos_signing_key_id) {
        (Assurance::ExternalSso, Some(key_id)) if is_canonical_workos_signing_key_id(&key_id) => {
            Some(key_id)
        }
        (Assurance::ExternalSso, _) | (_, Some(_)) => return Err(IdentityFlowError::Unauthorized),
        (_, None) => None,
    };
    let workos_session_id = match (assurance, workos_session_id) {
        (Assurance::ExternalSso, Some(session_id)) => {
            Some(WorkosSessionId::parse(session_id).map_err(|_| IdentityFlowError::Unauthorized)?)
        }
        (Assurance::ExternalSso, None) | (_, Some(_)) => {
            return Err(IdentityFlowError::Unauthorized)
        }
        (_, None) => None,
    };
    let method = match method_id {
        Some(method_id) => {
            if method_principal_id != Some(principal_id.as_uuid())
                || method_status.as_deref() != Some("active")
                || method_disabled_at.is_some()
            {
                return Err(IdentityFlowError::Unauthorized);
            }
            let kind = method_kind
                .as_deref()
                .and_then(MethodKind::parse)
                .ok_or(IdentityFlowError::Unauthorized)?;
            let expected_assurance = match kind {
                MethodKind::ClassicPassword => Assurance::Password,
                MethodKind::Workos => Assurance::ExternalSso,
            };
            if assurance != expected_assurance {
                return Err(IdentityFlowError::Unauthorized);
            }
            Some((method_id, kind))
        }
        None => {
            #[cfg(debug_assertions)]
            {
                if assurance != Assurance::Dev {
                    return Err(IdentityFlowError::Unauthorized);
                }
                None
            }
            #[cfg(not(debug_assertions))]
            {
                let _ = assurance;
                return Err(IdentityFlowError::Unauthorized);
            }
        }
    };

    let mut effective_idle_expires_at = idle_expires_at.ok_or(IdentityFlowError::Unauthorized)?;
    if slide_idle {
        let current_idle_expires_at = effective_idle_expires_at;
        let elapsed = policy
            .idle_ttl_seconds
            .saturating_sub(current_idle_expires_at.saturating_sub(now));
        if elapsed > policy.idle_ttl_seconds / 4 {
            let next_idle_expires_at = policy.idle_expiry(now, expires_at);
            if next_idle_expires_at > current_idle_expires_at {
                let updated = sqlx::query(
                    r#"
                        UPDATE auth_session
                        SET idle_expires_at = $2
                        WHERE token_hash = $1
                          AND revoked_at IS NULL
                          AND idle_expires_at = $3
                        "#,
                )
                .bind(session_reference)
                .bind(next_idle_expires_at)
                .bind(current_idle_expires_at)
                .execute(&mut *conn)
                .await?;
                if updated.rows_affected() == 1 {
                    effective_idle_expires_at = next_idle_expires_at;
                }
            }
        }
    }

    let mut global_capabilities = principal_globals;
    for capability in &local_proof_capabilities {
        if !global_capabilities.contains(capability) {
            global_capabilities.push(capability.clone());
        }
    }

    Ok(EligibleSession {
        context: AuthorizationContext::new(SessionAuthoritySnapshot {
            subject: SessionSubjectAuthority {
                principal_id,
                global_capabilities,
            },
            authentication: SessionAuthenticationProvenance {
                method,
                assurance,
                workos_session_id,
                authenticated_at,
            },
            validity: SessionValidity {
                session_reference: session_reference.to_string(),
                created_at,
                expires_at,
                idle_expires_at: effective_idle_expires_at,
            },
        })?,
        local_proof_capabilities,
        workos_signing_key_id,
    })
}

const ELIGIBLE_SESSION_SQL: &str = r#"
    SELECT session.principal_id,
           session.created_at,
           session.expires_at,
           session.idle_expires_at,
           session.assurance,
           session.local_proof_instance_id,
           session.workos_session_id,
           session.authenticated_via_method_id AS method_id,
           method.principal_id AS method_principal_id,
           method.kind AS method_kind,
           method.status AS method_status,
           method.disabled_at AS method_disabled_at,
           principal.status AS principal_status,
           principal.disabled_at AS principal_disabled_at,
           principal.global_capabilities AS principal_globals,
           session.authenticated_at,
           session.workos_signing_key_id
    FROM auth_session AS session
    INNER JOIN platform_principal AS principal
      ON principal.principal_id = session.principal_id
    LEFT JOIN authentication_method AS method
      ON method.method_id = session.authenticated_via_method_id
    WHERE session.token_hash = $1
      AND session.revoked_at IS NULL
      AND session.expires_at > $2
      AND session.idle_expires_at > $2
      AND NOT EXISTS (
          SELECT 1
          FROM workos_signing_key_tombstone AS retired_key
          WHERE retired_key.signing_key_id = session.workos_signing_key_id
      )
    "#;

fn is_canonical_app_session_token(token: &str) -> bool {
    token
        .strip_prefix(APP_SESSION_TOKEN_PREFIX)
        .is_some_and(is_lower_hex_256)
}

fn is_canonical_session_reference(reference: &str) -> bool {
    is_lower_hex_256(reference)
}

fn is_lower_hex_256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_canonical_workos_signing_key_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value.bytes().all(|byte| (b'!'..=b'~').contains(&byte))
}

/// Acquire the shared admission gate for one WorkOS signing key and reject a
/// key after its durable tombstone exists. Retirement takes the exclusive
/// form of the same transaction-scoped advisory lock. Callers must hold an
/// open transaction for the full issuance/link mutation.
pub async fn require_active_workos_signing_key(
    conn: &mut PgConnection,
    signing_key_id: &WorkosSigningKeyId,
) -> Result<(), IdentityFlowError> {
    // Issuance/linking operations share the key admission capability with one
    // another; retirement takes the exclusive form below. This keeps the
    // retirement boundary atomic without serializing every healthy login
    // signed by the same provider key.
    lock_workos_signing_key_shared(conn, signing_key_id).await?;
    let retired = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM workos_signing_key_tombstone
            WHERE signing_key_id = $1
        )
        "#,
    )
    .bind(signing_key_id.as_str())
    .fetch_one(&mut *conn)
    .await?;
    if retired {
        return Err(IdentityFlowError::Unauthorized);
    }
    Ok(())
}

async fn lock_workos_signing_key_shared(
    conn: &mut PgConnection,
    signing_key_id: &WorkosSigningKeyId,
) -> Result<(), IdentityFlowError> {
    // Hash collisions conservatively serialize unrelated keys; they can never
    // make two keys share authority. Domain separation avoids coupling this
    // lock namespace to other advisory-lock protocols in the process.
    sqlx::query(
        r#"
        SELECT pg_catalog.pg_advisory_xact_lock_shared(
            pg_catalog.hashtextextended('fmarch.workos-signing-key:' || $1, 0)
        )
        "#,
    )
    .bind(signing_key_id.as_str())
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn lock_workos_signing_key_exclusive(
    conn: &mut PgConnection,
    signing_key_id: &WorkosSigningKeyId,
) -> Result<(), IdentityFlowError> {
    sqlx::query(
        r#"
        SELECT pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('fmarch.workos-signing-key:' || $1, 0)
        )
        "#,
    )
    .bind(signing_key_id.as_str())
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Serialize retirement commands before any caller or target session row is
/// locked. The global order prevents two administrators whose sessions are
/// part of the same incident set from each holding one row while waiting for
/// the other. The retirement operation reacquires this transaction lock so
/// direct callers cannot omit the command fence accidentally; HTTP callers
/// take it earlier, before locked session revalidation.
pub async fn lock_workos_retirement_command(
    conn: &mut PgConnection,
) -> Result<(), IdentityFlowError> {
    sqlx::query(
        r#"
        SELECT pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(
                'fmarch.workos-signing-key-retirement-command', 0
            )
        )
        "#,
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

fn canonical_workos_retirement_reason(reason: &str) -> Result<&str, IdentityFlowError> {
    if reason.is_empty()
        || reason.len() > 512
        || reason.trim() != reason
        || reason.chars().any(char::is_control)
    {
        return Err(IdentityFlowError::Invalid(
            "WorkOS signing-key retirement reason must be 1..=512 trimmed non-control bytes"
                .to_string(),
        ));
    }
    Ok(reason)
}

fn unix_now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub async fn revoke_sessions_for_principal(
    conn: &mut PgConnection,
    principal_id: &PrincipalId,
    now: i64,
) -> Result<u64, IdentityFlowError> {
    let revoked = sqlx::query(
        r#"
        UPDATE auth_session
        SET revoked_at = $1
        WHERE principal_id = $2
          AND revoked_at IS NULL
          AND expires_at > $1
        "#,
    )
    .bind(now)
    .bind(principal_id.as_uuid())
    .execute(&mut *conn)
    .await?;
    Ok(revoked.rows_affected())
}

/// Serialize one ticket mutation in the canonical ticket namespace.
pub async fn lock_websocket_ticket_mutation(
    conn: &mut PgConnection,
    token_hash: &str,
) -> Result<(), IdentityFlowError> {
    sqlx::query(
        r#"
        SELECT pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended($1 || $2, 0)
        )
        "#,
    )
    .bind(WEBSOCKET_TICKET_LOCK_NAMESPACE)
    .bind(token_hash)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Lock every outstanding ticket derived from a principal's sessions in token
/// order. Callers already own the principal and session rows, which prevents a
/// correctly fenced mint from extending this set during lifecycle mutation.
pub async fn lock_websocket_ticket_mutations_for_principal(
    conn: &mut PgConnection,
    principal_id: &PrincipalId,
) -> Result<(), IdentityFlowError> {
    let token_hashes = sqlx::query_scalar::<_, String>(
        r#"
        SELECT ticket.token_hash
        FROM auth_websocket_ticket AS ticket
        JOIN auth_session AS session
          ON session.token_hash = ticket.session_reference
        WHERE session.principal_id = $1
        ORDER BY ticket.token_hash
        "#,
    )
    .bind(principal_id.as_uuid())
    .fetch_all(&mut *conn)
    .await?;
    for token_hash in token_hashes {
        lock_websocket_ticket_mutation(conn, token_hash.as_str()).await?;
    }
    Ok(())
}

/// Defense-in-depth cleanup for single-process deployments. Exact instance
/// matching is the authorization boundary; this startup transaction also
/// revokes stale Dev rows and removes their outstanding ticket derivatives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalProofStartupRevocation {
    pub sessions: u64,
    pub websocket_tickets: u64,
}

pub async fn revoke_local_proof_sessions_for_startup(
    pool: &PgPool,
    now: i64,
) -> Result<LocalProofStartupRevocation, IdentityFlowError> {
    let mut tx = begin_authority_transaction(pool).await?;
    let websocket_tickets = sqlx::query(
        r#"
        DELETE FROM auth_websocket_ticket
        WHERE session_reference IN (
            SELECT token_hash
            FROM auth_session
            WHERE assurance = 'dev'
        )
        "#,
    )
    .execute(&mut *tx)
    .await?;
    let revoked = sqlx::query(
        r#"
        UPDATE auth_session
        SET revoked_at = $1
        WHERE assurance = 'dev'
          AND revoked_at IS NULL
        "#,
    )
    .bind(now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(LocalProofStartupRevocation {
        sessions: revoked.rows_affected(),
        websocket_tickets: websocket_tickets.rows_affected(),
    })
}

pub async fn revoke_sessions_for_method(
    conn: &mut PgConnection,
    method_id: Uuid,
    now: i64,
) -> Result<u64, IdentityFlowError> {
    let revoked = sqlx::query(
        r#"
        UPDATE auth_session
        SET revoked_at = $1
        WHERE authenticated_via_method_id = $2
          AND revoked_at IS NULL
          AND expires_at > $1
        "#,
    )
    .bind(now)
    .bind(method_id)
    .execute(&mut *conn)
    .await?;
    Ok(revoked.rows_affected())
}

/// Revoke exactly the WorkOS sessions proven to have been signed by one
/// retired provider key. The provenance never leaves the backend session
/// model, while this operation gives key-rotation code a narrow revocation
/// capability instead of broad principal or provider authority.
async fn revoke_workos_sessions_for_signing_key(
    conn: &mut PgConnection,
    workos_signing_key_id: &str,
    now: i64,
) -> Result<u64, IdentityFlowError> {
    let workos_signing_key_id = WorkosSigningKeyId::parse(workos_signing_key_id.to_string())?;
    let revoked = sqlx::query(
        r#"
        UPDATE auth_session
        SET revoked_at = $1
        WHERE assurance = 'external_sso'
          AND workos_signing_key_id = $2
          AND revoked_at IS NULL
          AND expires_at > $1
          AND idle_expires_at > $1
        "#,
    )
    .bind(now)
    .bind(workos_signing_key_id.as_str())
    .execute(&mut *conn)
    .await?;
    Ok(revoked.rows_affected())
}

/// Monotonically retire one provider signing key and revoke every live app
/// session derived from it. The global command fence is taken first; then only
/// live, unrevoked matching session rows are locked before the per-key gate so
/// rotation (session row, then key gate) and retirement cannot deadlock.
/// Historical rows remain untouched. A concurrently committed issuance is
/// either rejected by the tombstone or included by the subsequent revocation
/// update.
pub async fn retire_workos_signing_key(
    conn: &mut PgConnection,
    signing_key_id: &WorkosSigningKeyId,
    retired_by_principal_id: &PrincipalId,
    reason: &str,
    now: i64,
) -> Result<WorkosSigningKeyRetirement, IdentityFlowError> {
    lock_workos_retirement_command(conn).await?;
    let reason = canonical_workos_retirement_reason(reason)?;
    let _locked_session_references = sqlx::query_scalar::<_, String>(
        r#"
        SELECT token_hash
        FROM auth_session
        WHERE assurance = 'external_sso'
          AND workos_signing_key_id = $1
          AND revoked_at IS NULL
          AND expires_at > $2
          AND idle_expires_at > $2
        ORDER BY token_hash
        FOR UPDATE
        "#,
    )
    .bind(signing_key_id.as_str())
    .bind(now)
    .fetch_all(&mut *conn)
    .await?;
    lock_workos_signing_key_exclusive(conn, signing_key_id).await?;

    let inserted = sqlx::query(
        r#"
        INSERT INTO workos_signing_key_tombstone (
            signing_key_id, retired_at, retired_by_principal_id, reason
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(signing_key_id.as_str())
    .bind(now)
    .bind(retired_by_principal_id.as_uuid())
    .bind(reason)
    .execute(&mut *conn)
    .await?
    .rows_affected()
        == 1;

    let (retired_at, original_actor, original_reason) = sqlx::query_as::<_, (i64, Uuid, String)>(
        r#"
            SELECT retired_at, retired_by_principal_id, reason
            FROM workos_signing_key_tombstone
            WHERE signing_key_id = $1
            "#,
    )
    .bind(signing_key_id.as_str())
    .fetch_one(&mut *conn)
    .await?;
    let revoked_session_count =
        revoke_workos_sessions_for_signing_key(conn, signing_key_id.as_str(), now).await?;

    if inserted {
        sqlx::query(
            r#"
            INSERT INTO identity_lifecycle_audit (
                event_at, event_kind, actor_principal_id, principal_id,
                token_hash, related_token_hash, metadata
            )
            VALUES ($1, 'workos_signing_key_retired', $2, NULL, NULL, NULL, $3::JSONB)
            "#,
        )
        .bind(now)
        .bind(retired_by_principal_id.as_uuid())
        .bind(
            serde_json::json!({
                "workos_signing_key_id": signing_key_id.as_str(),
                "reason": reason,
                "revoked_session_count": revoked_session_count
            })
            .to_string(),
        )
        .execute(&mut *conn)
        .await?;
    }

    Ok(WorkosSigningKeyRetirement {
        signing_key_id: signing_key_id.clone(),
        newly_retired: inserted,
        retired_at,
        retired_by_principal_id: PrincipalId::from_uuid(original_actor),
        reason: original_reason,
        revoked_session_count,
    })
}

#[cfg(test)]
mod tests {
    use super::{is_canonical_app_session_token, is_canonical_session_reference};
    use crate::token::{generate_session_token, hash_token};

    #[test]
    fn raw_validation_accepts_only_the_server_token_shape() {
        let canonical = generate_session_token();
        assert!(is_canonical_app_session_token(canonical.as_str()));
        assert!(is_canonical_session_reference(
            hash_token(canonical.as_str()).as_str()
        ));

        for invalid in [
            "fmss_",
            "fmss_short",
            "fmss_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "fmss_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "fmss_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "fmss_gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg",
            "legacy-client-selected-token",
        ] {
            assert!(!is_canonical_app_session_token(invalid), "{invalid}");
        }
    }
}
