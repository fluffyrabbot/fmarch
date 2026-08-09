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

    for request_contract in [
        "struct IdentityDeliveryCancellationRequest<'a> {",
        "delivery_id: Uuid",
        "kind: IdentityDeliveryKind",
        "account_id: &'a str",
        "principal_user_id: &'a str",
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
        "actor_user_id: &'a str",
        "principal_user_id: &'a str",
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
    for claim_contract in [
        "let request = IdentityDeliveryCancellationRequest {",
        "account_id: account_id.as_str()",
        "principal_user_id: principal_user_id.as_str()",
        "credential_hash: credential_hash.as_str()",
        "provider_id,",
        "cancelled_at: now",
        "cancel_claimed_delivery(&mut tx, request).await?",
        "tx.commit().await?",
    ] {
        assert!(
            claim.contains(claim_contract),
            "claim cancellation lost contract: {claim_contract}"
        );
    }
    assert!(!claim.contains("let mut request"));

    let cancellation = &source[cancel_start..outcome_start];
    assert!(cancellation.starts_with("async fn cancel_claimed_delivery("));
    assert!(cancellation.contains("tx: &mut sqlx::Transaction<'_, sqlx::Postgres>"));
    assert!(cancellation.contains("request: IdentityDeliveryCancellationRequest<'_>"));
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
            "credential_envelope = NULL",
            ".bind(request.delivery_id)",
            ".bind(request.cancelled_at)",
            "record_delivery_audit(",
            "IdentityDeliveryAuditRecord {",
            "event_kind: \"auth_delivery_cancelled\"",
            "actor_user_id: request.principal_user_id",
            "outcome_kind: \"cancelled\"",
            "outcome_code: Some(\"credential_inactive\")",
            "provider_receipt_id: None",
        ],
        "inactive-credential cancellation",
    );
    assert!(
        !cancellation.contains("ClaimedIdentityDelivery {"),
        "cancellation must not synthesize a false claimed-delivery state"
    );

    let delivery = &source[delivery_start..finalize_start];
    assert_ordered(
        delivery,
        &[
            "let mut tx = pool.begin().await?",
            "lock_active_credential(",
            "lock_claimed_delivery(&mut tx, &claim)",
            "delivery_outcome(&mut claim, gateway, credential_active, now)",
            "finalize_delivery(&mut tx, claim, outcome, actor_user_id, event_kind, now)",
        ],
        "delivery transaction",
    );
    let finalization_position = delivery
        .find("finalize_delivery(&mut tx, claim, outcome, actor_user_id, event_kind, now)")
        .unwrap();
    let final_commit_position = delivery.rfind("tx.commit().await?").unwrap();
    assert!(
        final_commit_position > finalization_position,
        "successful delivery must commit after finalization"
    );

    let finalization = &source[finalize_start..audit_start];
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
            "credential_envelope = CASE WHEN $3 = 'cancelled' THEN NULL ELSE credential_envelope END",
            "record_delivery_audit(",
            "IdentityDeliveryAuditRecord {",
            "event_at: now",
            "event_kind,",
            "actor_user_id,",
            "principal_user_id: claim.attempt.principal_user_id.as_str()",
            "provider_id: claim.provider_id.as_str()",
            "outcome_kind: outcome.kind()",
            "outcome_code: outcome.code()",
            "provider_receipt_id: provider_receipt_id.as_deref()",
            "let receipt = IdentityDeliveryReceipt {",
        ],
        "delivery finalization",
    );

    let audit = &source[audit_start..audit_end];
    assert!(audit.starts_with("async fn record_delivery_audit("));
    assert!(audit.contains("tx: &mut sqlx::Transaction<'_, sqlx::Postgres>"));
    assert!(audit.contains("record: IdentityDeliveryAuditRecord<'_>"));
    assert_ordered(
        audit,
        &[
            ".bind(record.event_at)",
            ".bind(record.event_kind)",
            ".bind(record.actor_user_id)",
            ".bind(record.principal_user_id)",
            ".bind(record.credential_hash)",
            "\"delivery_id\": record.delivery_id",
            "\"delivery_kind\": record.delivery_kind.as_str()",
            "\"account_id\": record.account_id",
            "\"adapter\": record.provider_id",
            "\"provider_id\": record.provider_id",
            "\"outcome_kind\": record.outcome_kind",
            "\"outcome_code\": record.outcome_code",
            "\"provider_receipt_id\": record.provider_receipt_id",
        ],
        "delivery audit persistence",
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
}
