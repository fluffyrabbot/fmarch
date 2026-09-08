use std::path::PathBuf;

fn assert_ordered(section: &str, contracts: &[&str], boundary: &str) {
    let mut previous = 0;
    for (index, contract) in contracts.iter().enumerate() {
        let position = section
            .find(contract)
            .unwrap_or_else(|| panic!("{boundary} lost contract: {contract}"));
        if index > 0 {
            assert!(
                position > previous,
                "{boundary} ordering changed at {contract}"
            );
        }
        previous = position;
    }
}

#[test]
fn identity_delivery_lifecycle_has_immutable_request_and_audit_boundaries() {
    let source_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/identity_delivery.rs");
    let source = std::fs::read_to_string(source_path).unwrap();

    for retry_contract in [
        "pub(super) struct ExpectedIdentityDeliveryAttemptCount(i32);",
        "pub(super) fn new(value: i32) -> Option<Self>",
        "(value >= 0).then_some(Self(value))",
        "fn get(self) -> i32",
        "pub(super) struct IdentityDeliveryRetryRequest<'a> {",
        "expected_attempt_count: ExpectedIdentityDeliveryAttemptCount",
        "initiating_session: &'a identity::InitiatingSession",
        "session_policy: &'a identity::SessionPolicy",
        "pub(super) enum IdentityDeliveryRetryResult {",
        "Applied(IdentityDeliveryReceipt)",
        "Conflict,",
        "enum IdentityDeliveryClaimResult {",
        "Reconciled(IdentityDeliveryReceipt)",
    ] {
        assert!(
            source.contains(retry_contract),
            "typed retry boundary drifted at {retry_contract}"
        );
    }
    for admission_contract in [
        "pub struct IdentityDeliveryAdmission {",
        "attempt_slots: Arc<Semaphore>",
        "database_slots: Arc<Semaphore>",
        "Semaphore::new(config.max_concurrency())",
        "Semaphore::new(config.max_database_in_flight())",
        "pub(super) fn try_acquire_attempt(&self)",
        "async fn acquire_attempt(&self)",
        "async fn acquire_database(&self)",
    ] {
        assert!(
            source.contains(admission_contract),
            "shared delivery admission drifted at {admission_contract}"
        );
    }
    let retry_start = source
        .find("pub(super) async fn retry_identity_delivery_intent_with_config(")
        .expect("typed delivery retry owner");
    let retry_end = source[retry_start..]
        .find("pub async fn process_next_identity_delivery_with_config(")
        .map(|offset| retry_start + offset)
        .expect("automatic delivery owner");
    let retry = &source[retry_start..retry_end];
    assert_ordered(
        retry,
        &[
            "bounded_delivery_database_operation(config.database_timeout(), \"claim\"",
            "admission.acquire_database().await",
            "identity::session::begin_authority_transaction(pool).await?",
            "identity::session::validate_initiating_session_for_update(",
            "request.initiating_session",
            "request.session_policy",
            "capability == \"GlobalAdmin\"",
            "claim_delivery_transaction(",
            "actor_principal_id: authorization.principal_id",
            "expected_attempt_count: request.expected_attempt_count",
            "tx.commit().await?",
            "IdentityDeliveryClaimResult::Reconciled(receipt)",
            "IdentityDeliveryRetryResult::Applied(receipt)",
            "IdentityDeliveryClaimResult::Empty",
            "IdentityDeliveryRetryResult::Conflict",
            "IdentityDeliveryExecution {",
            "admission,",
        ],
        "exact-session transactional retry",
    );
    assert!(
        !retry.contains("actor_principal_id: request"),
        "retry audit authority must come from the transactionally revalidated session"
    );
    let process_next_start = retry_end;
    let process_next_end = source[process_next_start..]
        .find("pub async fn run_identity_delivery_worker_observed")
        .map(|offset| process_next_start + offset)
        .expect("supervised delivery worker owner");
    let process_next = &source[process_next_start..process_next_end];
    assert_ordered(
        process_next,
        &[
            "pub async fn process_next_identity_delivery_with_config(",
            "let _attempt_permit = admission.acquire_attempt().await",
            "let claim = claim_delivery(",
            "IdentityDeliveryClaimTarget::NextDue",
            "deliver_and_finalize(",
        ],
        "public one-attempt delivery admission",
    );

    for request_contract in [
        "struct IdentityDeliveryCancellationRequest<'a> {",
        "delivery_id: Uuid",
        "kind: IdentityDeliveryKind",
        "account_id: &'a str",
        "actor_principal_id: &'a PrincipalId",
        "principal_id: &'a PrincipalId",
        "credential_hash: &'a str",
        "provider_id: &'a str",
        "cancelled_at: i64",
    ] {
        assert!(
            source.contains(request_contract),
            "missing cancellation request contract: {request_contract}"
        );
    }
    for audit_contract in [
        "struct IdentityDeliveryAuditRecord<'a> {",
        "event_at: i64",
        "event_kind: &'a str",
        "actor_principal_id: &'a PrincipalId",
        "principal_id: &'a PrincipalId",
        "credential_hash: &'a str",
        "delivery_id: Uuid",
        "delivery_kind: IdentityDeliveryKind",
        "account_id: &'a str",
        "provider_id: &'a str",
        "outcome_kind: &'a str",
        "outcome_code: Option<&'a str>",
        "provider_receipt_id: Option<&'a str>",
    ] {
        assert!(
            source.contains(audit_contract),
            "missing delivery audit contract: {audit_contract}"
        );
    }
    assert!(!source.contains("pub struct IdentityDeliveryCancellationRequest"));
    assert!(!source.contains("pub struct IdentityDeliveryAuditRecord"));

    let claim_start = source
        .find("async fn claim_delivery(")
        .expect("claim owner");
    let cancel_start = source[claim_start..]
        .find("async fn cancel_claimed_delivery(")
        .map(|offset| claim_start + offset)
        .expect("cancellation boundary");
    let outcome_start = source[cancel_start..]
        .find("async fn delivery_outcome(")
        .map(|offset| cancel_start + offset)
        .expect("delivery outcome boundary");
    let delivery_start = source[outcome_start..]
        .find("async fn deliver_and_finalize(")
        .map(|offset| outcome_start + offset)
        .expect("delivery transaction owner");
    let finalize_start = source[delivery_start..]
        .find("async fn finalize_delivery(")
        .map(|offset| delivery_start + offset)
        .expect("finalization boundary");
    let audit_start = source[finalize_start..]
        .find("async fn record_delivery_audit(")
        .map(|offset| finalize_start + offset)
        .expect("audit persistence boundary");
    let audit_end = source[audit_start..]
        .find("pub fn unix_now_seconds(")
        .map(|offset| audit_start + offset)
        .expect("audit boundary end");

    let claim = &source[claim_start..cancel_start];
    assert!(
        claim.contains("bounded_delivery_database_operation(config.database_timeout(), \"claim\"")
    );
    assert_eq!(
        claim
            .matches("EXTRACT(EPOCH FROM clock_timestamp())")
            .count(),
        2,
        "selection and claim mutation must each use a fresh database clock"
    );
    assert!(claim.contains("OR (status = 'retryable_failed' AND next_attempt_at <= $3)"));
    assert!(claim.contains(".bind(database_now)"));
    for claim_target_contract in [
        "IdentityDeliveryClaimTarget::NextDue",
        "IdentityDeliveryClaimTarget::ExplicitRetry {",
        "expected_attempt_count: ExpectedIdentityDeliveryAttemptCount",
        "actor_principal_id: PrincipalId",
    ] {
        assert!(
            source.contains(claim_target_contract),
            "typed delivery claim target drifted at {claim_target_contract}"
        );
    }
    for claim_mode_contract in [
        "$2::UUID IS NULL",
        "$2::UUID IS NOT NULL",
        "AND delivery_id = $2",
        "AND status = 'retryable_failed'",
        "AND attempt_count = $4",
        ".bind(expected_attempt_count)",
    ] {
        assert!(
            claim.contains(claim_mode_contract),
            "automatic and explicit claim modes drifted at {claim_mode_contract}"
        );
    }
    for claim_contract in [
        "let request = IdentityDeliveryCancellationRequest {",
        "let actor_principal_id = provenance.actor_principal_id(principal_id)",
        "account_id: row.account_id.as_str()",
        "actor_principal_id: &actor_principal_id",
        "principal_id: &principal_id",
        "credential_hash: row.credential_hash.as_str()",
        "provider_id,",
        "cancelled_at: database_now",
        "let receipt = cancel_claimed_delivery(tx, request).await?",
        "IdentityDeliveryClaimResult::Reconciled(receipt)",
    ] {
        assert!(
            claim.contains(claim_contract),
            "claim cancellation lost contract: {claim_contract}"
        );
    }
    let mutation_start = claim
        .find("WITH mutation_clock AS MATERIALIZED")
        .expect("claim mutation clock");
    assert_ordered(
        &claim[mutation_start..],
        &[
            "WITH mutation_clock AS MATERIALIZED",
            "claim_expires_at = mutation_clock.claimed_at + $3",
            "WHEN delivery.status <> 'processing' AND attempt_count < $4 THEN 1",
            "claim_source = $5",
            "claim_actor_principal_id = $6",
            "updated_at = mutation_clock.claimed_at",
            "RETURNING mutation_clock.claimed_at,",
            "delivery.claim_expires_at,",
            "delivery.attempt_count",
            "if claim_expires_at != claimed_at.saturating_add(claim_lease_seconds)",
        ],
        "claim mutation lease",
    );
    assert!(claim.contains(
        "claim_token,\n            claimed_at,\n            provenance,\n            recovered: reclaiming,\n            provider_attempt_permitted,"
    ));
    for persisted_row_contract in [
        "claim_source: Option<String>",
        "claim_actor_principal_id: Option<Uuid>",
        "recovered: bool",
    ] {
        assert!(
            source.contains(persisted_row_contract),
            "persisted claim row drifted at {persisted_row_contract}"
        );
    }
    for persisted_provenance_contract in [
        "let reclaiming = row.status == \"processing\"",
        "IdentityDeliveryClaimProvenance::from_persisted(",
        "row.claim_source.as_deref().unwrap_or_default()",
        "row.claim_actor_principal_id",
        "target.provenance()",
        "let provider_attempt_permitted = reclaiming || row.attempt_count < config.max_attempts()",
        "let claim_source = provenance.persisted_source()",
        "let claim_actor_principal_id = provenance.persisted_actor_principal_id()",
        ".bind(claim_source)",
        ".bind(claim_actor_principal_id)",
        "attempt_number,",
        "recovered: reclaiming",
    ] {
        assert!(
            claim.contains(persisted_provenance_contract),
            "persisted claim provenance or same-attempt recovery drifted at {persisted_provenance_contract}"
        );
    }
    assert!(!claim.contains("let mut request"));

    let cancellation = &source[cancel_start..outcome_start];
    assert!(cancellation.starts_with("async fn cancel_claimed_delivery("));
    assert!(cancellation.contains("tx: &mut sqlx::Transaction<'_, sqlx::Postgres>"));
    assert!(cancellation.contains("request: IdentityDeliveryCancellationRequest<'_>"));
    assert!(cancellation.contains("Result<IdentityDeliveryReceipt, sqlx::Error>"));
    assert_ordered(
        cancellation,
        &[
            "UPDATE auth_delivery_intent",
            "SET status = 'cancelled'",
            "outcome_kind = 'cancelled'",
            "outcome_code = 'credential_inactive'",
            "next_attempt_at = NULL",
            "delivered_at = NULL",
            "last_error = 'credential_inactive'",
            "provider_receipt_id = NULL",
            "claim_token = NULL",
            "claim_expires_at = NULL",
            "claim_source = NULL",
            "claim_actor_principal_id = NULL",
            "credential_envelope = NULL",
            ".bind(request.delivery_id)",
            ".bind(request.cancelled_at)",
            "record_delivery_audit(",
            "IdentityDeliveryAuditRecord {",
            "event_kind: \"auth_delivery_cancelled\"",
            "actor_principal_id: request.actor_principal_id",
            "outcome_kind: \"cancelled\"",
            "outcome_code: Some(\"credential_inactive\")",
            "provider_receipt_id: None",
            "Ok(IdentityDeliveryReceipt {",
        ],
        "inactive-credential cancellation",
    );
    assert!(
        !cancellation.contains("ClaimedIdentityDelivery {"),
        "cancellation must not synthesize a false claimed-delivery state"
    );

    let outcome = &source[outcome_start..delivery_start];
    assert!(outcome
        .contains("if !claim.recovered && claim.attempt.credential_expires_at <= claimed_at"));

    let delivery = &source[delivery_start..finalize_start];
    assert_ordered(
        delivery,
        &[
            "let outcome = delivery_outcome(",
            "bounded_delivery_database_operation(config.database_timeout(), \"finalization\"",
            "admission.acquire_database().await",
            "pool.begin().await?",
            "EXTRACT(EPOCH FROM clock_timestamp())",
            "finalize_delivery(",
        ],
        "delivery transaction",
    );
    assert!(delivery.contains(
        "let receipt = finalize_delivery(&mut tx, claim, outcome, finalized_at, config).await?;"
    ));
    assert!(
        !delivery.contains("requested_event_kind") && !delivery.contains("actor_principal_id"),
        "claim provenance, not the executor, must own finalization audit authority"
    );
    assert!(
        !delivery.contains("lock_active_credential") && !delivery.contains("lock_claimed_delivery"),
        "provider delivery must not hold credential or intent row locks"
    );
    assert!(delivery.contains("claim token and immutable credential hash fence completion"));
    let provider_position = delivery.find("delivery_outcome(").unwrap();
    let transaction_position = delivery.find("pool.begin().await?").unwrap();
    assert!(
        provider_position < transaction_position,
        "provider delivery must finish before the finalization transaction begins"
    );
    let finalization_position = delivery.find("finalize_delivery(").unwrap();
    let final_commit_position = delivery.rfind("tx.commit().await?").unwrap();
    assert!(
        final_commit_position > finalization_position,
        "successful delivery must commit after finalization"
    );

    let finalization = &source[finalize_start..audit_start];
    assert!(finalization.contains(
        "IdentityDeliveryOutcome::Cancelled(_) | IdentityDeliveryOutcome::Delivered { .. }"
    ));
    assert_ordered(
        finalization,
        &[
            "UPDATE auth_delivery_intent",
            "SET status = $3",
            "outcome_kind = $4",
            "outcome_code = $5",
            "next_attempt_at = $6",
            "delivered_at = $7",
            "last_error = $5",
            "provider_receipt_id = $8",
            "claim_token = NULL",
            "claim_expires_at = NULL",
            "claim_source = NULL",
            "claim_actor_principal_id = NULL",
            "credential_envelope = CASE WHEN $3 = 'cancelled' THEN NULL ELSE credential_envelope END",
            "AND claim_token = $2",
            "AND CASE $10",
            "WHEN 'invite' THEN EXISTS",
            "WHEN 'recovery' THEN EXISTS",
            "WHEN 'community_invitation' THEN EXISTS",
            "let cancelled_attempt_count",
            "AND NOT CASE $4",
            "record_delivery_audit(",
        ],
        "delivery finalization",
    );

    assert_eq!(
        finalization.matches("record_delivery_audit(").count(),
        1,
        "delivery finalization must persist exactly one lifecycle audit"
    );
    assert_eq!(
        finalization.matches("claim_source = NULL").count(),
        2,
        "every terminal finalization branch must clear persisted claim provenance"
    );
    assert_eq!(
        finalization
            .matches("claim_actor_principal_id = NULL")
            .count(),
        2,
        "every terminal finalization branch must clear the persisted claim actor"
    );
    assert_eq!(
        finalization
            .matches("IdentityDeliveryAuditRecord {")
            .count(),
        1,
        "delivery finalization must construct exactly one typed lifecycle audit"
    );
    let finalization_audit_start = finalization
        .find("IdentityDeliveryAuditRecord {")
        .expect("finalization audit record");
    let finalization_receipt_start = finalization[finalization_audit_start..]
        .find("let receipt = IdentityDeliveryReceipt {")
        .map(|offset| finalization_audit_start + offset)
        .expect("finalization receipt boundary");
    let finalization_audit = &finalization[finalization_audit_start..finalization_receipt_start];
    assert_ordered(
        finalization_audit,
        &[
            "IdentityDeliveryAuditRecord {",
            "event_at: now",
            "event_kind,",
            "actor_principal_id: &actor_principal_id",
            "principal_id: &claim.attempt.principal_id",
            "credential_hash: claim.attempt.credential_hash.as_str()",
            "delivery_id: claim.attempt.delivery_id",
            "delivery_kind: claim.attempt.kind",
            "account_id: claim.attempt.account_id.as_str()",
            "provider_id: claim.provider_id.as_str()",
            "outcome_kind: outcome.kind()",
            "outcome_code: outcome.code()",
            "provider_receipt_id: provider_receipt_id.as_deref()",
        ],
        "delivery finalization audit",
    );

    let audit = &source[audit_start..audit_end];
    assert!(audit.starts_with("async fn record_delivery_audit("));
    assert!(audit.contains("tx: &mut sqlx::Transaction<'_, sqlx::Postgres>"));
    assert!(audit.contains("record: IdentityDeliveryAuditRecord<'_>"));
    assert_ordered(
        audit,
        &[
            "let mut metadata = serde_json::json!({",
            "\"delivery_id\": record.delivery_id",
            "\"delivery_kind\": record.delivery_kind.as_str()",
            "\"adapter\": record.provider_id",
            "\"provider_id\": record.provider_id",
            "\"outcome_kind\": record.outcome_kind",
            "\"outcome_code\": record.outcome_code",
            "\"provider_receipt_id\": record.provider_receipt_id",
            "if record.delivery_kind != IdentityDeliveryKind::CommunityInvitation",
            "metadata[\"account_id\"]",
            ".bind(record.event_at)",
            ".bind(record.event_kind)",
            ".bind(record.actor_principal_id.as_uuid())",
            ".bind(record.principal_id.as_uuid())",
            ".bind(record.credential_hash)",
            ".bind(metadata.to_string())",
        ],
        "delivery audit persistence",
    );
    assert!(
        !audit.contains("\"account_id\": record.account_id"),
        "community invitation audits must not serialize the recipient contact"
    );

    assert_eq!(
        source
            .matches("let request = IdentityDeliveryCancellationRequest {")
            .count(),
        1,
        "the claimed row must construct the cancellation request directly"
    );
    assert_eq!(
        source.matches("IdentityDeliveryAuditRecord {").count(),
        2,
        "cancellation and finalization must construct audit records directly"
    );
    assert!(
        !source.contains("clippy::too_many_arguments"),
        "typed lifecycle records must remove identity-delivery high-arity lint debt"
    );
    assert!(source.contains("struct IdentityDeliveryExecution<'a> {"));
    assert!(source.contains("execution: IdentityDeliveryExecution<'_>"));
    for provenance_contract in [
        "provenance: IdentityDeliveryClaimProvenance",
        "enum IdentityDeliveryClaimProvenance {",
        "Automatic,",
        "ExplicitRetry {",
        "fn from_persisted(source: &str, actor_principal_id: Option<Uuid>)",
        "(\"automatic\", None) => Some(Self::Automatic)",
        "(\"explicit_retry\", Some(actor_principal_id))",
        "fn persisted_source(self) -> &'static str",
        "fn persisted_actor_principal_id(self) -> Option<Uuid>",
        "fn audit_event_kind(self, outcome: &IdentityDeliveryOutcome)",
        "Self::ExplicitRetry { .. }, _) => \"auth_delivery_retried\"",
        "let event_kind = claim.provenance.audit_event_kind(&outcome)",
        ".actor_principal_id(claim.attempt.principal_id)",
    ] {
        assert!(
            source.contains(provenance_contract),
            "claim-owned delivery provenance drifted at {provenance_contract}"
        );
    }
    assert!(!source.contains("requested_event_kind"));
    assert!(source.contains("A live database claim permits at most one invocation"));
    assert!(
        source.contains("must therefore use `attempt.delivery_id` as the stable idempotency key")
    );
    assert!(source.contains(".saturating_mul(1_u64 << exponent)"));
}

#[test]
fn supervised_delivery_worker_is_bounded_observable_and_shutdown_aware() {
    let source_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/identity_delivery.rs");
    let source = std::fs::read_to_string(source_path).unwrap();
    let worker_start = source
        .find("pub async fn run_identity_delivery_worker_observed")
        .expect("supervised worker entry point");
    let worker_end = source[worker_start..]
        .find("\nfn finish_delivery_task(")
        .map(|offset| worker_start + offset)
        .expect("worker completion boundary");
    let worker = &source[worker_start..worker_end];
    assert!(
        source[worker_end..].starts_with("\nfn finish_delivery_task("),
        "completed task decoding must remain a synchronous, side-effect-free boundary"
    );

    assert!(source.contains(
        "let lease_coverage_timeout = post_claim_timeout.saturating_add(database_timeout)"
    ));
    assert!(source
        .contains("claim_lease <= lease_coverage_timeout.saturating_add(Duration::from_secs(1))"));

    for contract in [
        "IdentityDeliveryWorkerObservation",
        "admission: IdentityDeliveryAdmission",
        "permit = admission.acquire_attempt() => permit",
        "&admission,",
        "let attempt_admission = admission.clone()",
        "let _attempt_permit = attempt_permit",
        "admission: &attempt_admission",
        "biased;",
        "changed = shutdown.changed()",
        "if *shutdown.borrow()",
        "deliver_and_finalize(",
        "IdentityDeliveryExecution {",
        "attempt_errors:",
        "IdentityDeliveryWorkerObservationKind::EmptyClaim",
        "IdentityDeliveryWorkerObservationKind::AttemptStarted",
        "IdentityDeliveryWorkerObservationKind::TimerTick",
        "in_flight: attempts.len()",
        "tokio::time::sleep(config.poll_interval())",
    ] {
        assert!(
            worker.contains(contract),
            "worker lost contract: {contract}"
        );
    }
    assert!(
        !worker.contains("tokio::time::timeout("),
        "the worker must not cancel database finalization at the provider deadline"
    );
    assert!(
        !source.contains("spawn_identity_delivery_worker"),
        "production worker ownership must remain with the process supervisor"
    );
}
