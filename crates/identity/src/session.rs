use rand::{rngs::OsRng, RngCore};
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
use crate::{Assurance, MethodKind, PrincipalId, WorkosSessionId};

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

/// A debug-only grant awaiting attachment to a committed Dev session. It can
/// only target the exact process instance that created it and is never written
/// to Postgres or serialized into a hosted credential.
#[cfg(debug_assertions)]
#[derive(Debug, Clone)]
pub struct LocalProofAuthorization {
    instance_id: LocalProofInstanceId,
    global_capabilities: Vec<String>,
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
impl LocalProofAuthorization {
    pub fn new(
        instance_id: &LocalProofInstanceId,
        global_capabilities: Vec<String>,
    ) -> Result<Self, IdentityFlowError> {
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
        Ok(Self {
            instance_id: instance_id.clone(),
            global_capabilities: normalized,
        })
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
    pub fn from_env() -> Self {
        SessionPolicy {
            absolute_ttl_seconds: bounded_env_i64(
                "FMARCH_SESSION_TTL_SECONDS",
                60 * 60 * 24 * 30,
                60,
                60 * 60 * 24 * 365,
            ),
            workos_absolute_ttl_seconds: bounded_env_i64(
                "FMARCH_WORKOS_SESSION_TTL_SECONDS",
                60 * 60 * 24,
                60,
                60 * 60 * 24,
            ),
            idle_ttl_seconds: bounded_env_i64(
                "FMARCH_SESSION_IDLE_TTL_SECONDS",
                60 * 60 * 24 * 7,
                60,
                60 * 60 * 24 * 365,
            ),
            local_proof_instance_id: None,
        }
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

fn bounded_env_i64(name: &str, default: i64, min: i64, max: i64) -> i64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<i64>().ok())
        .unwrap_or(default)
        .clamp(min, max)
}

#[derive(Debug, Clone)]
pub struct SessionSpec<'a> {
    pub principal_id: &'a PrincipalId,
    pub authenticated_via_method_id: Option<Uuid>,
    pub assurance: Assurance,
    /// Required only for a debug local-proof session and supplied exclusively
    /// by the process-local proof authority at the API composition root.
    pub local_proof_instance_id: Option<&'a LocalProofInstanceId>,
    /// Present only for WorkOS external-SSO sessions. This is sourced from the
    /// verified `sid` claim, never from a client request.
    pub workos_session_id: Option<&'a WorkosSessionId>,
    /// The verified JWKS key id that signed a WorkOS assertion. This remains
    /// backend-only provenance for exact key retirement and session rotation.
    pub workos_signing_key_id: Option<&'a str>,
    pub authenticated_at: i64,
    pub expires_at: i64,
    pub idle_expires_at: i64,
}

#[derive(Debug, Clone)]
pub struct IssuedSession {
    pub session_token: String,
    pub token_hash: String,
    pub principal_id: PrincipalId,
    pub expires_at: i64,
    pub idle_expires_at: i64,
}

/// Attach debug local-proof authority only after the corresponding Dev session
/// transaction commits. Hosted sessions cannot call this in release builds,
/// and the process-bound grant disappears on restart even if a stale database
/// row survives unexpectedly.
#[cfg(debug_assertions)]
pub fn activate_local_proof_authorization(
    issued: &IssuedSession,
    authorization: LocalProofAuthorization,
) -> Result<(), IdentityFlowError> {
    authorization.instance_id.insert_session_authorization(
        issued.token_hash.clone(),
        authorization.global_capabilities,
        issued.expires_at,
    )
}

pub async fn issue_session(
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
    pub principal_id: PrincipalId,
    pub global_capabilities: Vec<String>,
    pub method: Option<(Uuid, MethodKind)>,
    pub assurance: Assurance,
    /// The trusted provider session behind a WorkOS local session. This value
    /// is never serialized directly to clients.
    pub workos_session_id: Option<WorkosSessionId>,
    pub session_reference: String,
    pub created_at: i64,
    pub authenticated_at: i64,
    pub expires_at: i64,
    pub idle_expires_at: i64,
}

impl AuthorizationContext {
    /// Capture the exact initiating session for a later commit-time authority
    /// fence. The returned proof contains no bearer credential and has no public
    /// constructor, so lifecycle services cannot substitute a principal-only
    /// lookup for the session that actually authorized the request.
    pub fn initiating_session(&self) -> InitiatingSession {
        InitiatingSession {
            principal_id: self.principal_id,
            session_reference: self.session_reference.clone(),
        }
    }
}

/// Opaque identity-owned proof of the exact session that initiated a mutation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InitiatingSession {
    principal_id: PrincipalId,
    session_reference: String,
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
) -> Result<AuthorizationContext, IdentityFlowError> {
    if !is_canonical_app_session_token(token) {
        return Err(IdentityFlowError::Unauthorized);
    }
    validate_session_reference(pool, hash_token(token).as_str(), policy, now).await
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
        .then(|| policy.local_proof_instance_id.as_ref())
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
    let context = AuthorizationContext {
        session_reference: token_hash,
        created_at: now,
        idle_expires_at,
        ..eligible.context
    };
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
        context: AuthorizationContext {
            principal_id,
            global_capabilities,
            method,
            assurance,
            workos_session_id,
            session_reference: session_reference.to_string(),
            created_at,
            authenticated_at,
            expires_at,
            idle_expires_at: effective_idle_expires_at,
        },
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
