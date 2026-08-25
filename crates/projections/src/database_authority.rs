use std::collections::{BTreeMap, BTreeSet};

use sha2::{Digest, Sha256};
use sqlx::{
    postgres::{PgConnection, PgPool},
    Acquire, Row,
};
use thiserror::Error;

pub const APPLICATION_DATABASE_ROLE: &str = "fmarch_application";
pub const KEY_ADMIN_DATABASE_ROLE: &str = "fmarch_key_admin";

const APPLICATION_UPDATE_TABLES: &[&str] = &[
    "action_counter",
    "action_grant",
    "action_history",
    "action_submission",
    "auth_account",
    "auth_account_recovery_credential",
    "auth_credential_attempt",
    "auth_delivery_intent",
    "auth_invite",
    "auth_registration_attempt",
    "auth_session",
    "auth_websocket_ticket",
    "authentication_method",
    "command_receipt",
    "profile_mute",
    "public_watch",
    "public_watch_period",
    "day_event",
    "day_event_narrative",
    "day_event_schedule_work",
    "day_event_scheduler_state",
    "day_vote_outcome",
    "delayed_death_queue",
    "discussion_area",
    "discussion_topic",
    "engine_snapshot_checkpoint",
    "external_identity",
    "game_cohost_policy",
    "game_index",
    "game_persona_name_history",
    "game_persona",
    "game_persona_subject_binding",
    "game_persona_public",
    "game_persona_redaction",
    "game_result",
    "host_prompt",
    "identity_lifecycle_audit",
    "investigation_memory",
    "media_upload_ledger",
    "member_lifecycle_projection",
    "moderation_case",
    "moderation_report",
    "moderation_target_state",
    "phase_state",
    "platform_principal",
    "player_info_result",
    "player_investigation_result",
    "player_notification",
    "post_policy",
    "privacy_subject",
    "private_channel_member",
    "member_profile",
    "public_profile",
    "publication_surface",
    "public_citation",
    "public_publication",
    "public_search_document",
    "sheriff_badge",
    "slot_effect",
    "slot_occupancy_epoch",
    "slot_state",
    "subject_erasure",
    "thread_view",
    "visit_history",
    "vote_ballot",
    "workos_provider_session",
];

const APPLICATION_DELETE_TABLES: &[&str] = &[
    "action_counter",
    "action_grant",
    "action_history",
    "action_submission",
    "auth_account_recovery_credential",
    "auth_credential_attempt",
    "auth_delivery_intent",
    "auth_invite",
    "auth_registration_attempt",
    "auth_websocket_ticket",
    "public_inbox_item",
    "profile_mute",
    "public_watch",
    "day_event",
    "day_event_narrative",
    "day_event_participation",
    "day_event_schedule_work",
    "day_program",
    "day_vote_outcome",
    "delayed_death_queue",
    "discussion_post",
    "discussion_topic",
    "engine_snapshot_checkpoint",
    "external_identity",
    "game_authority",
    "game_cohost_policy",
    "game_index",
    "game_persona_name_claim",
    "game_persona_name_history",
    "game_persona",
    "game_persona_subject_binding",
    "game_persona_public",
    "game_persona_redaction",
    "game_result",
    "host_phase_control",
    "host_prompt",
    "investigation_memory",
    "media_upload_ledger",
    "member_personal_export",
    "moderation_case",
    "moderation_target_state",
    "phase_state",
    "player_info_result",
    "player_investigation_result",
    "player_notification",
    "game_private_citation",
    "post_policy",
    "private_channel_member",
    "member_profile",
    "public_profile",
    "publication_surface",
    "public_citation",
    "public_publication",
    "public_search_document",
    "sheriff_badge",
    "slot_effect",
    "slot_occupancy_epoch",
    "slot_state",
    "slot_status_tag",
    "spectator_membership",
    "subject_private_claim",
    "thread_view",
    "visit_history",
    "vote_ballot",
    "workos_provider_session",
    "workos_session_exchange",
];

const KEY_ADMIN_SELECT_RELATIONS: &[&str] = &[
    "_sqlx_migrations",
    "auth_delivery_intent",
    "day_event_narrative",
    "event_direct_key_reference",
    "event_direct_key_sentinel",
    "event_stream_key_state",
    "event_stream_keys",
    "investigation_memory",
    "player_info_result",
    "player_investigation_result",
    "private_channel_member",
    "slot_state",
    "thread_view",
];

const APPLICATION_SEQUENCES: &[&str] = &[
    "events_seq_seq",
    "game_thread_visibility_change_id_seq",
    "identity_lifecycle_audit_id_seq",
];

const EXPECTED_SEQUENCES: &[&str] = APPLICATION_SEQUENCES;
const EXPECTED_VIEWS: &[&str] = &["event_direct_key_reference"];
const EXPECTED_GUARDS: &[(&str, &str, &str)] = &[
    (
        "auth_delivery_intent",
        "auth_delivery_intent_direct_envelope_guard",
        "event_direct_envelope_write_guard",
    ),
    (
        "completed_game_detached_alias",
        "completed_game_detached_alias_no_mutation",
        "subject_privacy_append_only_guard",
    ),
    (
        "day_event_narrative",
        "day_event_narrative_rendered_direct_envelope_guard",
        "event_direct_envelope_write_guard",
    ),
    (
        "day_event_narrative",
        "day_event_narrative_template_direct_envelope_guard",
        "event_direct_envelope_write_guard",
    ),
    (
        "event_direct_key_sentinel",
        "event_direct_key_sentinel_guard",
        "event_direct_key_sentinel_guard_mutation",
    ),
    (
        "event_direct_key_sentinel",
        "event_direct_key_sentinel_transition_lock",
        "event_direct_key_sentinel_lock_transition",
    ),
    (
        "event_direct_key_sentinel",
        "event_direct_key_sentinel_truncate_guard",
        "event_direct_key_sentinel_guard_mutation",
    ),
    (
        "event_stream_key_state",
        "event_stream_key_state_guard",
        "event_stream_key_state_monotonic",
    ),
    (
        "event_stream_key_state",
        "event_stream_key_state_truncate_guard",
        "event_stream_key_state_monotonic",
    ),
    (
        "event_stream_keys",
        "event_stream_key_wrap_guard",
        "event_stream_key_wrap_write_guard",
    ),
    (
        "event_stream_keys",
        "event_stream_keys_guard",
        "event_stream_keys_guard_mutation",
    ),
    (
        "event_stream_keys",
        "event_stream_keys_truncate_guard",
        "event_stream_keys_guard_mutation",
    ),
    ("events", "events_no_update", "events_forbid_mutation"),
    (
        "investigation_memory",
        "investigation_memory_direct_envelope_guard",
        "event_direct_envelope_write_guard",
    ),
    (
        "pack_artifact",
        "pack_artifact_no_mutation",
        "pack_artifact_immutable_guard",
    ),
    (
        "player_info_result",
        "player_info_result_direct_envelope_guard",
        "event_direct_envelope_write_guard",
    ),
    (
        "player_investigation_result",
        "player_investigation_result_direct_envelope_guard",
        "event_direct_envelope_write_guard",
    ),
    (
        "privacy_subject",
        "privacy_subject_no_reactivation",
        "privacy_subject_irreversible_erasure",
    ),
    (
        "private_channel_member",
        "private_channel_member_direct_envelope_guard",
        "event_direct_envelope_write_guard",
    ),
    (
        "slot_state",
        "slot_state_direct_envelope_guard",
        "event_direct_envelope_write_guard",
    ),
    (
        "subject_authority_binding",
        "subject_authority_binding_no_mutation",
        "subject_privacy_append_only_guard",
    ),
    (
        "subject_erasure",
        "subject_erasure_no_delete",
        "subject_privacy_append_only_guard",
    ),
    (
        "subject_erasure",
        "subject_erasure_state_transition_guard",
        "subject_erasure_state_guard",
    ),
    (
        "subject_erasure_outbox",
        "subject_erasure_outbox_no_mutation",
        "subject_privacy_append_only_guard",
    ),
    (
        "subject_key_destruction_receipt",
        "subject_key_destruction_receipt_no_mutation",
        "subject_privacy_append_only_guard",
    ),
    (
        "subject_private_claim",
        "subject_private_claim_active_subject_only",
        "subject_private_claim_reject_tombstoned",
    ),
    (
        "subject_private_claim",
        "subject_private_claim_no_update",
        "subject_privacy_append_only_guard",
    ),
    (
        "subject_tombstone",
        "subject_tombstone_no_mutation",
        "subject_privacy_append_only_guard",
    ),
    (
        "thread_view",
        "thread_view_direct_envelope_guard",
        "event_direct_envelope_write_guard",
    ),
    (
        "workos_provider_session",
        "workos_provider_session_guard",
        "workos_provider_session_guard_mutation",
    ),
    (
        "workos_provider_session",
        "workos_provider_session_truncate_guard",
        "workos_provider_session_guard_mutation",
    ),
    (
        "workos_provider_session_tombstone",
        "workos_provider_session_tombstone_no_mutation",
        "subject_privacy_append_only_guard",
    ),
    (
        "workos_subject_tombstone",
        "workos_subject_tombstone_no_mutation",
        "subject_privacy_append_only_guard",
    ),
];
const EXPECTED_GUARD_FUNCTIONS: &[&str] = &[
    "event_direct_envelope_write_guard",
    "event_direct_key_sentinel_guard_mutation",
    "event_direct_key_sentinel_lock_transition",
    "event_stream_key_state_monotonic",
    "event_stream_key_wrap_write_guard",
    "event_stream_keys_guard_mutation",
    "events_forbid_mutation",
    "pack_artifact_immutable_guard",
    "privacy_subject_irreversible_erasure",
    "subject_erasure_state_guard",
    "subject_privacy_append_only_guard",
    "subject_private_claim_reject_tombstoned",
    "workos_provider_session_guard_mutation",
];
const EXPECTED_TRIGGER_DEFINITION_HASHES: &[(&str, &str)] = &[
    (
        "auth_delivery_intent_direct_envelope_guard",
        "b59c7d75900eefe37368ce221ad1cab4c7127c443558430947111efba6301746",
    ),
    (
        "completed_game_detached_alias_no_mutation",
        "aabd82bc5aa7b83cd2ffaa7eed9bd6b25658cddf0b98a033bf5ee7502efd54e6",
    ),
    (
        "day_event_narrative_rendered_direct_envelope_guard",
        "2b229d583ff8a437c3338ad8ab4b6709ff76b6f4f41f84d753a12e7e7b4b4b57",
    ),
    (
        "day_event_narrative_template_direct_envelope_guard",
        "d71d4fab2aa0f290965eaa1a62fb1c6a0c57e526d82628b643030b218dc95b69",
    ),
    (
        "event_direct_key_sentinel_guard",
        "6a9c1cfa69e7e8a3e2e3bd09c7d2d44e13ccf884d6263a379babdd5074d149b2",
    ),
    (
        "event_direct_key_sentinel_transition_lock",
        "20cd9043466e703a9a604197f423bfb2d0e136934d5bc6273990749305d9c897",
    ),
    (
        "event_direct_key_sentinel_truncate_guard",
        "7ec02cd364ecd7875e10106b8b5e7821aee65db3a9ef8bb8c69e957251e24013",
    ),
    (
        "event_stream_key_state_guard",
        "27a88caf483105023331556062ff661a7411605ac36ebf48039511593d2efef5",
    ),
    (
        "event_stream_key_state_truncate_guard",
        "a9a8b079b91f3de16811b79d26ad3549153796059217dd4ac61dc5c82966e105",
    ),
    (
        "event_stream_key_wrap_guard",
        "b3044f5a0c885f9694c91cb12eeb9bbbbdabeac87c6d4294abec4b3a2429cfd6",
    ),
    (
        "event_stream_keys_guard",
        "145e969adbdad439e5df3c0717c3683bbbf1e2d23f1b85b002002a991914770a",
    ),
    (
        "event_stream_keys_truncate_guard",
        "54f92edb95527c29d0bdca050670bda892c64c826f8e48ca31cabd522769d5a5",
    ),
    (
        "events_no_update",
        "1f7e7637dea18ab4ac9f4b489b58d29ecf9cf7fce93486003e7101793e267cfc",
    ),
    (
        "investigation_memory_direct_envelope_guard",
        "2bdc946b8010fec8aeab212784e9a63fdbc804017ffa918e033f969db29dea5d",
    ),
    (
        "pack_artifact_no_mutation",
        "cb7a72ff4b384517736c2055a451df522dee2145be3bed12d7873ac39d8b5f2d",
    ),
    (
        "player_info_result_direct_envelope_guard",
        "1b9e62d8a8c58a33ae49988055b6eecd237be8a2cb45b66f6d6534145536f27b",
    ),
    (
        "player_investigation_result_direct_envelope_guard",
        "c9ec387a5d555c8f729d1a56ed69130e74b6e64a4e431fb449e241ded4fc3ccd",
    ),
    (
        "privacy_subject_no_reactivation",
        "39b3ebea43e5683d4a5c18c23d677c53ea84a3d58aa45ff4794a16161a915738",
    ),
    (
        "private_channel_member_direct_envelope_guard",
        "0bb9f493c2620c6a75f0a1f6bd7897e54e5cda58a9143ace5e80f511c837fbf4",
    ),
    (
        "slot_state_direct_envelope_guard",
        "e87905e0a83478024fc4631c99be0f6c26e97aed12a56d588e66e2492db1c754",
    ),
    (
        "subject_authority_binding_no_mutation",
        "f498ea9742d30966e93ecd2bce324462a2983aec7c19f8340e68bc20662cf975",
    ),
    (
        "subject_erasure_no_delete",
        "0bb8c5cab5f70c9409afb99247e703545960901a3f13726084bdeb912b821e8f",
    ),
    (
        "subject_erasure_state_transition_guard",
        "25fef2d64ef2c3a3f6164f11362e8c8f60b936e9f587cca5665aab8e42d4843e",
    ),
    (
        "subject_erasure_outbox_no_mutation",
        "b4d49f330a9e43bb34700be092ca37ade9d42acd5ede0a7ac717432d559687bb",
    ),
    (
        "subject_key_destruction_receipt_no_mutation",
        "899b106c76ace60e9de5098cc6eefa054a09bbb3581c646237891fa519284bd9",
    ),
    (
        "subject_private_claim_active_subject_only",
        "b28c57de34259e7ccfc9f61e271eb43690c1f56259c56d8371c248bdf958425f",
    ),
    (
        "subject_private_claim_no_update",
        "b50cdb5f6ef1770c99909dc588572d4cdc69b2d5cc9f83c6ba7b4b1dbda1da3c",
    ),
    (
        "subject_tombstone_no_mutation",
        "8f85496bc2f0ad854dc93333056b0acab4cf1a1a4517976c59ebcd10b3e6c3bf",
    ),
    (
        "thread_view_direct_envelope_guard",
        "e6e2e19767d2c2f9954dcec04acb5cf6683e5f4e47210d36bf760cd845bfe127",
    ),
    (
        "workos_provider_session_guard",
        "a8282b251f194020dbc1299efbb397339111310f639b119ade4cb8a51b17233d",
    ),
    (
        "workos_provider_session_truncate_guard",
        "72beeca1ecb042b90023d192cea8da680388ffa3247e17ff6091cfa03d45b612",
    ),
    (
        "workos_provider_session_tombstone_no_mutation",
        "2a3e2b7929ec9a1673d273aea70f5f325b5379a5a378fa6b9d9ebe582f0c23ce",
    ),
    (
        "workos_subject_tombstone_no_mutation",
        "1ae72d853138c1435c99fa598e0a5925377211d40306e24712657a857c89f312",
    ),
];
const EXPECTED_FUNCTION_SOURCE_HASHES: &[(&str, &str)] = &[
    (
        "event_direct_envelope_write_guard",
        "9e5cd2f0d82c58db7c31931622f7e95101fda5128b290cf89b589eafc89775f9",
    ),
    (
        "event_direct_key_sentinel_guard_mutation",
        "3eea5f96db9e8c796ec97f8aea06318f34f18560f8c76e4428c2aa63ce19ce2d",
    ),
    (
        "event_direct_key_sentinel_lock_transition",
        "1222169a46359c25f62a1ede058d80f0ad688a2eafb2d3f920b79497449d1a9d",
    ),
    (
        "event_stream_key_state_monotonic",
        "f772e436d95ae4f893b1cf3c0ffc995f1c88b8aa19d8fd6a14cd4fbe76f77fc0",
    ),
    (
        "event_stream_key_wrap_write_guard",
        "405045b54258a1d230ea62d514bda3f310e1176a3f31874266e683bb6cbb1d57",
    ),
    (
        "event_stream_keys_guard_mutation",
        "ef0f993dd7ca13759004d6b2f9e89f98fca3874e2a69267e76acc557d549801f",
    ),
    (
        "events_forbid_mutation",
        "3ac76ee449cf783717c9d9903f6238fe1bf8b4b120899780f0d0640fd66eb5b3",
    ),
    (
        "pack_artifact_immutable_guard",
        "269ae03b2da992f1125b8f13f2e3c341255fd89b5924fbd00d38fa1870744db8",
    ),
    (
        "privacy_subject_irreversible_erasure",
        "82453ef0601136bc20d5fa5af68932200d73f1a563d761a8fc55ee51b78c6bfa",
    ),
    (
        "subject_erasure_state_guard",
        "97b262d6858b1c7806d6f13e8509461789cf299eded693b57a711a7bfccf76dd",
    ),
    (
        "subject_privacy_append_only_guard",
        "483479a9d8538f0c71748e7c6ee0a4b52b17c381794ed22e144f1de1eda1c8f1",
    ),
    (
        "subject_private_claim_reject_tombstoned",
        "2c29628ab67ca3564e0291bb5480b7758b1e103961d362907be566a496fe2322",
    ),
    (
        "workos_provider_session_guard_mutation",
        "18947844d9f3c03453eb2cf771c020ed92e0577fad5c278e0e6a69b6a4b4c558",
    ),
];
const EXPECTED_TABLES: &[&str] = &[
    "_sqlx_migrations",
    "action_counter",
    "action_grant",
    "action_history",
    "action_submission",
    "auth_account",
    "auth_account_recovery_credential",
    "auth_credential_attempt",
    "auth_delivery_intent",
    "auth_invite",
    "auth_registration_attempt",
    "auth_session",
    "auth_websocket_ticket",
    "authentication_method",
    "command_receipt",
    "public_inbox_item",
    "profile_mute",
    "public_watch",
    "public_watch_period",
    "completed_game_detached_alias",
    "day_event",
    "day_event_narrative",
    "day_event_participation",
    "day_event_schedule_work",
    "day_event_scheduler_state",
    "day_program",
    "day_vote_outcome",
    "delayed_death_queue",
    "discussion_area",
    "discussion_post",
    "discussion_topic",
    "engine_snapshot_checkpoint",
    "event_direct_key_sentinel",
    "event_stream_key_state",
    "event_stream_keys",
    "events",
    "external_identity",
    "game_authority",
    "game_cohost_policy",
    "game_index",
    "game_persona_name_claim",
    "game_persona_name_history",
    "game_persona",
    "game_persona_subject_binding",
    "game_persona_public",
    "game_persona_redaction",
    "game_result",
    "game_thread_visibility_change",
    "host_phase_control",
    "host_prompt",
    "identity_lifecycle_audit",
    "investigation_memory",
    "media_upload_ledger",
    "member_lifecycle_event",
    "member_lifecycle_projection",
    "member_personal_export",
    "moderation_case",
    "moderation_case_history",
    "moderation_report",
    "moderation_target_state",
    "pack_artifact",
    "phase_state",
    "platform_principal",
    "player_info_result",
    "player_investigation_result",
    "player_notification",
    "game_private_citation",
    "post_policy",
    "privacy_subject",
    "private_channel_member",
    "member_profile",
    "public_profile",
    "publication_surface",
    "public_citation",
    "public_publication",
    "public_search_document",
    "sheriff_badge",
    "slot_effect",
    "slot_occupancy_epoch",
    "slot_state",
    "slot_status_tag",
    "spectator_membership",
    "subject_authority_binding",
    "subject_erasure",
    "subject_erasure_outbox",
    "subject_key_destruction_receipt",
    "subject_private_claim",
    "subject_tombstone",
    "thread_view",
    "visit_history",
    "vote_ballot",
    "workos_provider_session",
    "workos_provider_session_tombstone",
    "workos_session_exchange",
    "workos_subject_tombstone",
];

const KEY_ADMIN_COLUMN_UPDATES: &[(&str, &[&str])] = &[
    ("auth_delivery_intent", &["credential_envelope"]),
    (
        "day_event_narrative",
        &["body_template_private", "rendered_body_private"],
    ),
    (
        "event_direct_key_sentinel",
        &[
            "lifecycle",
            "retirement_target_kid",
            "retirement_started_at",
            "rehearsal_token",
            "rehearsed_at",
            "retired_at",
            "sentinel_version",
            "sentinel_nonce",
            "sentinel_ciphertext",
        ],
    ),
    (
        "event_stream_keys",
        &["wrap_version", "wrap_kid", "wrap_nonce", "wrapped_dek"],
    ),
    ("investigation_memory", &["result_private"]),
    ("player_info_result", &["result_private"]),
    ("player_investigation_result", &["result_private"]),
    ("private_channel_member", &["private"]),
    ("slot_state", &["private"]),
    ("thread_view", &["body_private"]),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DatabasePrincipal {
    Application,
    KeyAdmin,
}

impl DatabasePrincipal {
    pub fn role_name(self) -> &'static str {
        match self {
            Self::Application => APPLICATION_DATABASE_ROLE,
            Self::KeyAdmin => KEY_ADMIN_DATABASE_ROLE,
        }
    }
}

#[derive(Debug, Error)]
pub enum DatabaseAuthorityError {
    #[error("database authority configuration error: {0}")]
    Configuration(String),
    #[error("database authority storage error: {0}")]
    Storage(#[from] sqlx::Error),
}

/// Reconcile the complete database ACL manifest after every migration or
/// restore. This deliberately is not a versioned migration: `pg_restore
/// --no-acl` restores SQLx history but discards object grants.
pub async fn reconcile_database_authority(
    pool: &PgPool,
    application_password: &str,
    key_admin_password: &str,
) -> Result<(), DatabaseAuthorityError> {
    validate_password(application_password, "FMARCH_DATABASE_APPLICATION_PASSWORD")?;
    validate_password(key_admin_password, "FMARCH_DATABASE_KEY_ADMIN_PASSWORD")?;
    if application_password == key_admin_password {
        return Err(DatabaseAuthorityError::Configuration(
            "application and key-admin database passwords must differ".to_string(),
        ));
    }
    // Reconciliation is a high-authority operation and must be safe even when
    // a caller hands us a pool built from PostgreSQL's default
    // `"$user", public` path. Pin one physical connection for the entire
    // operation, establish the only accepted creation path, and verify that
    // exact session before inspecting or mutating the catalog.
    let mut connection = pool.acquire().await?;
    sqlx::query("SELECT pg_catalog.set_config('search_path', 'public', false)")
        .execute(&mut *connection)
        .await?;
    sqlx::query("SELECT pg_catalog.set_config('session_replication_role', 'origin', false)")
        .execute(&mut *connection)
        .await?;
    verify_migration_authority_on(&mut connection).await?;
    verify_catalog_manifest_on(&mut connection).await?;
    verify_guard_manifest_on(&mut connection).await?;

    let mut tx = connection.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(5065787916851041842)")
        .execute(&mut *tx)
        .await?;
    create_or_update_login(&mut tx, APPLICATION_DATABASE_ROLE, application_password).await?;
    create_or_update_login(&mut tx, KEY_ADMIN_DATABASE_ROLE, key_admin_password).await?;
    remove_role_memberships(&mut tx, APPLICATION_DATABASE_ROLE).await?;
    remove_role_memberships(&mut tx, KEY_ADMIN_DATABASE_ROLE).await?;
    revoke_restricted_parameter_privileges(&mut tx).await?;

    execute_database_acl(&mut tx, "REVOKE ALL ON DATABASE", "FROM PUBLIC").await?;
    for role in [APPLICATION_DATABASE_ROLE, KEY_ADMIN_DATABASE_ROLE] {
        execute_database_acl(&mut tx, "REVOKE ALL ON DATABASE", &format!("FROM {role}")).await?;
    }
    execute_database_acl(
        &mut tx,
        "GRANT CONNECT ON DATABASE",
        &format!("TO {APPLICATION_DATABASE_ROLE}, {KEY_ADMIN_DATABASE_ROLE}"),
    )
    .await?;
    sqlx::query("REVOKE ALL ON SCHEMA public FROM PUBLIC")
        .execute(&mut *tx)
        .await?;
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "REVOKE ALL ON SCHEMA public FROM {APPLICATION_DATABASE_ROLE}, {KEY_ADMIN_DATABASE_ROLE}"
    )))
    .execute(&mut *tx)
    .await?;
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "GRANT USAGE ON SCHEMA public TO {APPLICATION_DATABASE_ROLE}, {KEY_ADMIN_DATABASE_ROLE}"
    )))
    .execute(&mut *tx)
    .await?;
    sqlx::query("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC")
        .execute(&mut *tx)
        .await?;
    sqlx::query("REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC")
        .execute(&mut *tx)
        .await?;
    sqlx::query("REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC")
        .execute(&mut *tx)
        .await?;
    sqlx::query("ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM PUBLIC")
        .execute(&mut *tx)
        .await?;
    sqlx::query("ALTER DEFAULT PRIVILEGES REVOKE ALL ON SEQUENCES FROM PUBLIC")
        .execute(&mut *tx)
        .await?;
    sqlx::query("ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC")
        .execute(&mut *tx)
        .await?;

    for role in [APPLICATION_DATABASE_ROLE, KEY_ADMIN_DATABASE_ROLE] {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {role}"
        )))
        .execute(&mut *tx)
        .await?;
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {role}"
        )))
        .execute(&mut *tx)
        .await?;
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM {role}"
        )))
        .execute(&mut *tx)
        .await?;
    }

    let application_tables = EXPECTED_TABLES
        .iter()
        .copied()
        .filter(|name| *name != "_sqlx_migrations" && *name != "event_direct_key_sentinel")
        .collect::<Vec<_>>();
    grant_relations(
        &mut tx,
        APPLICATION_DATABASE_ROLE,
        "SELECT, INSERT",
        &application_tables,
    )
    .await?;
    grant_relations(
        &mut tx,
        APPLICATION_DATABASE_ROLE,
        "SELECT",
        &["event_direct_key_sentinel"],
    )
    .await?;
    grant_columns(
        &mut tx,
        APPLICATION_DATABASE_ROLE,
        "event_direct_key_sentinel",
        "INSERT",
        &[
            "kid",
            "sentinel_version",
            "sentinel_nonce",
            "sentinel_ciphertext",
        ],
    )
    .await?;
    grant_relations(
        &mut tx,
        APPLICATION_DATABASE_ROLE,
        "SELECT",
        &["_sqlx_migrations", "event_direct_key_reference"],
    )
    .await?;
    grant_relations(
        &mut tx,
        APPLICATION_DATABASE_ROLE,
        "UPDATE",
        APPLICATION_UPDATE_TABLES,
    )
    .await?;
    grant_relations(
        &mut tx,
        APPLICATION_DATABASE_ROLE,
        "DELETE",
        APPLICATION_DELETE_TABLES,
    )
    .await?;
    // PostgreSQL row locks require UPDATE on at least one column. The KID is
    // immutable by trigger, so this permits FOR SHARE without granting the
    // application any lifecycle or key-material mutation.
    grant_columns(
        &mut tx,
        APPLICATION_DATABASE_ROLE,
        "event_direct_key_sentinel",
        "UPDATE",
        &["kid"],
    )
    .await?;
    grant_sequences(
        &mut tx,
        APPLICATION_DATABASE_ROLE,
        "USAGE",
        APPLICATION_SEQUENCES,
    )
    .await?;

    grant_relations(
        &mut tx,
        KEY_ADMIN_DATABASE_ROLE,
        "SELECT",
        KEY_ADMIN_SELECT_RELATIONS,
    )
    .await?;
    grant_columns(
        &mut tx,
        KEY_ADMIN_DATABASE_ROLE,
        "event_direct_key_sentinel",
        "INSERT",
        &[
            "kid",
            "sentinel_version",
            "sentinel_nonce",
            "sentinel_ciphertext",
        ],
    )
    .await?;
    for (table, columns) in KEY_ADMIN_COLUMN_UPDATES {
        grant_columns(&mut tx, KEY_ADMIN_DATABASE_ROLE, table, "UPDATE", columns).await?;
    }
    tx.commit().await?;

    Ok(())
}

/// Fail closed unless the connected login is the exact non-owner authority
/// expected by the process and the reconciled ACL boundary remains intact.
pub async fn verify_database_principal(
    pool: &PgPool,
    expected: DatabasePrincipal,
) -> Result<(), DatabaseAuthorityError> {
    let role = expected.role_name();
    let row = sqlx::query(
        r#"
        SELECT current_user AS current_name,
               session_user AS session_name,
               r.rolsuper,
               r.rolinherit,
               r.rolcreaterole,
               r.rolcreatedb,
               r.rolcanlogin,
               r.rolreplication,
               r.rolbypassrls,
               r.rolconfig,
               current_setting('search_path') AS search_path,
               current_setting('session_replication_role') AS replication_role
        FROM pg_roles r
        WHERE r.rolname = current_user
        "#,
    )
    .fetch_one(pool)
    .await?;
    let current_name: String = row.get("current_name");
    let session_name: String = row.get("session_name");
    if current_name != role || session_name != role {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "process requires database role {role}, connected as current={current_name} session={session_name}"
        )));
    }
    let forbidden_attribute = row.get::<bool, _>("rolsuper")
        || row.get::<bool, _>("rolinherit")
        || row.get::<bool, _>("rolcreaterole")
        || row.get::<bool, _>("rolcreatedb")
        || !row.get::<bool, _>("rolcanlogin")
        || row.get::<bool, _>("rolreplication")
        || row.get::<bool, _>("rolbypassrls");
    if forbidden_attribute {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "database role {role} has forbidden authority attributes"
        )));
    }
    let role_config: Option<Vec<String>> = row.get("rolconfig");
    let expected_role_config = vec!["search_path=pg_catalog, public".to_string()];
    let search_path: String = row.get("search_path");
    let replication_role: String = row.get("replication_role");
    if role_config.as_ref() != Some(&expected_role_config)
        || search_path != "pg_catalog, public"
        || replication_role != "origin"
    {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "database role {role} must have only the fixed pg_catalog, public search_path"
        )));
    }
    let membership_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM pg_auth_members membership
        JOIN pg_database database ON database.datname = current_database()
        WHERE membership.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
           OR (
               membership.roleid = (SELECT oid FROM pg_roles WHERE rolname = current_user)
               AND (
                   membership.member <> database.datdba
                   OR membership.inherit_option
                   OR membership.set_option
                   OR NOT membership.admin_option
               )
           )
        "#,
    )
    .fetch_one(pool)
    .await?;
    if membership_count != 0 {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "database role {role} must not inherit or assume another role"
        )));
    }
    let parameter_authority: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM pg_parameter_acl parameter
        CROSS JOIN LATERAL aclexplode(parameter.paracl) privilege
        WHERE privilege.grantee IN (
            0,
            (SELECT oid FROM pg_roles WHERE rolname = 'fmarch_application'),
            (SELECT oid FROM pg_roles WHERE rolname = 'fmarch_key_admin')
        )
          AND privilege.privilege_type IN ('SET', 'ALTER SYSTEM')
        "#,
    )
    .fetch_one(pool)
    .await?;
    if parameter_authority != 0 {
        return Err(DatabaseAuthorityError::Configuration(
            "PUBLIC or a restricted database role has forbidden parameter authority".to_string(),
        ));
    }
    let database_role_settings: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pg_db_role_setting WHERE setdatabase <> 0 AND setrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)",
    )
    .fetch_one(pool)
    .await?;
    if database_role_settings != 0 {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "database role {role} has forbidden per-database settings"
        )));
    }
    let (owns_database, can_create_database_objects, can_create_schema_objects, can_temp): (
        bool,
        bool,
        bool,
        bool,
    ) = sqlx::query_as(
        r#"
        SELECT d.datdba = (SELECT oid FROM pg_roles WHERE rolname = current_user),
               has_database_privilege(current_user, current_database(), 'CREATE'),
               has_schema_privilege(current_user, 'public', 'CREATE'),
               has_database_privilege(current_user, current_database(), 'TEMP')
        FROM pg_database d
        WHERE d.datname = current_database()
        "#,
    )
    .fetch_one(pool)
    .await?;
    if owns_database || can_create_database_objects || can_create_schema_objects || can_temp {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "database role {role} has owner, CREATE, or TEMP authority"
        )));
    }
    let owned_objects: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
          AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
        "#,
    )
    .fetch_one(pool)
    .await?;
    if owned_objects != 0 {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "database role {role} owns public schema objects"
        )));
    }
    let (ownership_drift, trusted_schema_owner): (i64, bool) = sqlx::query_as(
        r#"
        SELECT
            (SELECT COUNT(*)
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_database database ON database.datname = current_database()
             WHERE n.nspname = 'public'
               AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
               AND c.relowner <> database.datdba)
          + (SELECT COUNT(*)
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             JOIN pg_database database ON database.datname = current_database()
             WHERE n.nspname = 'public'
               AND p.proowner <> database.datdba),
            (SELECT namespace.nspowner IN (
                        database.datdba,
                        (SELECT oid FROM pg_roles WHERE rolname = 'pg_database_owner')
                    )
             FROM pg_namespace namespace
             JOIN pg_database database ON database.datname = current_database()
             WHERE namespace.nspname = 'public')
        "#,
    )
    .fetch_one(pool)
    .await?;
    if ownership_drift != 0 || !trusted_schema_owner {
        return Err(DatabaseAuthorityError::Configuration(
            "public database objects are not uniformly owned by the database/schema authority"
                .to_string(),
        ));
    }
    let dangerous_table_privileges: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND (
              has_table_privilege(current_user, c.oid, 'TRUNCATE')
              OR has_table_privilege(current_user, c.oid, 'TRIGGER')
              OR has_table_privilege(current_user, c.oid, 'REFERENCES')
          )
        "#,
    )
    .fetch_one(pool)
    .await?;
    if dangerous_table_privileges != 0 {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "database role {role} has TRUNCATE, TRIGGER, or REFERENCES authority"
        )));
    }
    let disabled_triggers: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND NOT t.tgisinternal
          AND t.tgenabled <> 'O'
        "#,
    )
    .fetch_one(pool)
    .await?;
    if disabled_triggers != 0 {
        return Err(DatabaseAuthorityError::Configuration(
            "one or more database write guards are disabled".to_string(),
        ));
    }
    verify_required_privileges(pool, expected).await?;
    verify_catalog_manifest(pool).await?;
    verify_exact_acl(pool, DatabasePrincipal::Application).await?;
    verify_exact_acl(pool, DatabasePrincipal::KeyAdmin).await?;
    verify_guard_manifest(pool).await?;
    Ok(())
}

pub async fn verify_migration_authority(pool: &PgPool) -> Result<(), DatabaseAuthorityError> {
    let mut connection = pool.acquire().await?;
    verify_migration_authority_on(&mut connection).await
}

async fn verify_migration_authority_on(
    connection: &mut PgConnection,
) -> Result<(), DatabaseAuthorityError> {
    let (
        current_name,
        session_name,
        owns_database,
        can_create_schema,
        can_create_role,
        trusted_schema_owner,
        search_path,
        replication_role,
        ownership_drift,
    ): (String, String, bool, bool, bool, bool, String, String, i64) = sqlx::query_as(
        r#"
        SELECT current_user,
               session_user,
               database.datdba = (SELECT oid FROM pg_roles WHERE rolname = current_user),
               has_schema_privilege(current_user, 'public', 'CREATE'),
               (SELECT rolsuper OR rolcreaterole FROM pg_roles WHERE rolname = current_user),
               (SELECT namespace.nspowner IN (
                           database.datdba,
                           (SELECT oid FROM pg_roles WHERE rolname = 'pg_database_owner')
                       )
                FROM pg_namespace namespace
                WHERE namespace.nspname = 'public'),
               current_setting('search_path'),
               current_setting('session_replication_role'),
               ((SELECT COUNT(*)
                 FROM pg_class relation
                 JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
                 WHERE namespace.nspname = 'public'
                  AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
                   AND relation.relowner <> database.datdba)
                +
                (SELECT COUNT(*)
                 FROM pg_proc routine
                 JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
                 WHERE namespace.nspname = 'public'
                   AND routine.proowner <> database.datdba))
        FROM pg_database database
        WHERE database.datname = current_database()
        "#,
    )
    .fetch_one(&mut *connection)
    .await?;
    if current_name != session_name
        || !owns_database
        || !can_create_schema
        || !can_create_role
        || !trusted_schema_owner
        || search_path != "public"
        || replication_role != "origin"
        || ownership_drift != 0
    {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "migration connection must directly own the database and all public relations, with schema CREATE and role-management authority; current={current_name} session={session_name}"
        )));
    }
    Ok(())
}

async fn verify_required_privileges(
    pool: &PgPool,
    expected: DatabasePrincipal,
) -> Result<(), DatabaseAuthorityError> {
    let required = match expected {
        DatabasePrincipal::Application => vec![
            ("_sqlx_migrations", "SELECT"),
            ("events", "SELECT"),
            ("events", "INSERT"),
            ("platform_principal", "UPDATE"),
            ("thread_view", "DELETE"),
        ],
        DatabasePrincipal::KeyAdmin => vec![
            ("_sqlx_migrations", "SELECT"),
            ("event_direct_key_sentinel", "SELECT"),
            ("event_stream_keys", "SELECT"),
            ("event_direct_key_reference", "SELECT"),
        ],
    };
    for (relation, privilege) in required {
        let present: bool = sqlx::query_scalar(
            "SELECT has_table_privilege(current_user, format('public.%I', $1), $2)",
        )
        .bind(relation)
        .bind(privilege)
        .fetch_one(pool)
        .await?;
        if !present {
            return Err(DatabaseAuthorityError::Configuration(format!(
                "database role {} lacks required {privilege} on public.{relation}",
                expected.role_name()
            )));
        }
    }
    match expected {
        DatabasePrincipal::Application => {
            let forbidden: bool = sqlx::query_scalar(
                "SELECT has_column_privilege(current_user, 'public.event_direct_key_sentinel', 'lifecycle', 'UPDATE')",
            )
            .fetch_one(pool)
            .await?;
            if forbidden {
                return Err(DatabaseAuthorityError::Configuration(
                    "application role may not update runtime-KEK lifecycle state".to_string(),
                ));
            }
        }
        DatabasePrincipal::KeyAdmin => {
            let can_install_sentinel: bool = sqlx::query_scalar(
                "SELECT has_column_privilege(current_user, 'public.event_direct_key_sentinel', 'sentinel_ciphertext', 'INSERT')",
            )
            .fetch_one(pool)
            .await?;
            if !can_install_sentinel {
                return Err(DatabaseAuthorityError::Configuration(
                    "key-admin role cannot install an authenticated runtime-KEK sentinel"
                        .to_string(),
                ));
            }
            let forbidden: bool = sqlx::query_scalar(
                "SELECT has_table_privilege(current_user, 'public.events', 'INSERT,UPDATE,DELETE')",
            )
            .fetch_one(pool)
            .await?;
            if forbidden {
                return Err(DatabaseAuthorityError::Configuration(
                    "key-admin role has general event mutation authority".to_string(),
                ));
            }
        }
    }
    Ok(())
}

async fn verify_exact_acl(
    pool: &PgPool,
    expected: DatabasePrincipal,
) -> Result<(), DatabaseAuthorityError> {
    let role = expected.role_name();
    let table_rows = sqlx::query(
        r#"
        SELECT c.relname, acl.privilege_type, acl.is_grantable
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) acl
        JOIN pg_roles grantee ON grantee.oid = acl.grantee
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND grantee.rolname = $1
        "#,
    )
    .bind(role)
    .fetch_all(pool)
    .await?;
    let mut actual_tables = BTreeSet::new();
    for row in table_rows {
        if row.get::<bool, _>("is_grantable") {
            return Err(DatabaseAuthorityError::Configuration(format!(
                "database role {role} has a table privilege WITH GRANT OPTION"
            )));
        }
        actual_tables.insert((
            row.get::<String, _>("relname"),
            row.get::<String, _>("privilege_type"),
        ));
    }
    let expected_tables = expected_table_privileges(expected);
    if actual_tables != expected_tables {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "database role {role} table ACL differs from the exact manifest: {}",
            set_difference_description(&expected_tables, &actual_tables)
        )));
    }

    let column_rows = sqlx::query(
        r#"
        SELECT c.relname, a.attname, acl.privilege_type, acl.is_grantable
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(a.attacl) acl
        JOIN pg_roles grantee ON grantee.oid = acl.grantee
        WHERE n.nspname = 'public'
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND grantee.rolname = $1
        "#,
    )
    .bind(role)
    .fetch_all(pool)
    .await?;
    let mut actual_columns = BTreeSet::new();
    for row in column_rows {
        if row.get::<bool, _>("is_grantable") {
            return Err(DatabaseAuthorityError::Configuration(format!(
                "database role {role} has a column privilege WITH GRANT OPTION"
            )));
        }
        actual_columns.insert((
            row.get::<String, _>("relname"),
            row.get::<String, _>("attname"),
            row.get::<String, _>("privilege_type"),
        ));
    }
    let expected_columns = expected_column_privileges(expected);
    if actual_columns != expected_columns {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "database role {role} column ACL differs from the exact manifest: expected={expected_columns:?} actual={actual_columns:?}"
        )));
    }

    let sequence_rows = sqlx::query(
        r#"
        SELECT c.relname, acl.privilege_type, acl.is_grantable
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) acl
        JOIN pg_roles grantee ON grantee.oid = acl.grantee
        WHERE n.nspname = 'public'
          AND c.relkind = 'S'
          AND grantee.rolname = $1
        "#,
    )
    .bind(role)
    .fetch_all(pool)
    .await?;
    let mut actual_sequences = BTreeSet::new();
    for row in sequence_rows {
        if row.get::<bool, _>("is_grantable") {
            return Err(DatabaseAuthorityError::Configuration(format!(
                "database role {role} has a sequence privilege WITH GRANT OPTION"
            )));
        }
        actual_sequences.insert((
            row.get::<String, _>("relname"),
            row.get::<String, _>("privilege_type"),
        ));
    }
    let expected_sequences = match expected {
        DatabasePrincipal::Application => APPLICATION_SEQUENCES
            .iter()
            .map(|name| ((*name).to_string(), "USAGE".to_string()))
            .collect(),
        DatabasePrincipal::KeyAdmin => BTreeSet::new(),
    };
    if actual_sequences != expected_sequences {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "database role {role} sequence ACL differs from the exact manifest: expected={expected_sequences:?} actual={actual_sequences:?}"
        )));
    }

    let public_or_unclassified_leaks: i64 = sqlx::query_scalar(
        r#"
        SELECT
            (SELECT COUNT(*)
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, c.relowner))) acl
             LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
             WHERE n.nspname = 'public'
               AND (
                   acl.grantee = 0
                   OR (
                       acl.grantee <> c.relowner
                       AND grantee.rolname NOT IN ('fmarch_application', 'fmarch_key_admin')
                   )
               ))
          + (SELECT COUNT(*)
             FROM pg_attribute attribute
             JOIN pg_class relation ON relation.oid = attribute.attrelid
             JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
             CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
             LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
             WHERE namespace.nspname = 'public'
               AND attribute.attnum > 0
               AND NOT attribute.attisdropped
               AND (
                   acl.grantee = 0
                   OR (
                       acl.grantee <> relation.relowner
                       AND grantee.rolname NOT IN ('fmarch_application', 'fmarch_key_admin')
                   )
               ))
          + (SELECT COUNT(*)
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
             LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
             WHERE n.nspname = 'public'
               AND (
                   acl.grantee = 0
                   OR acl.grantee <> p.proowner
               ))
          + (SELECT COUNT(*)
             FROM pg_database database
             CROSS JOIN LATERAL aclexplode(database.datacl) acl
             LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
             WHERE database.datname = current_database()
               AND (
                   acl.grantee = 0
                   OR (
                       acl.grantee <> database.datdba
                       AND grantee.rolname NOT IN ('fmarch_application', 'fmarch_key_admin')
                   )
               ))
          + (SELECT COUNT(*)
             FROM pg_namespace namespace
             CROSS JOIN LATERAL aclexplode(namespace.nspacl) acl
             LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
             JOIN pg_database database ON database.datname = current_database()
             WHERE namespace.nspname = 'public'
               AND (
                   acl.grantee = 0
                   OR (
                       acl.grantee <> namespace.nspowner
                       AND acl.grantee <> database.datdba
                       AND grantee.rolname NOT IN ('fmarch_application', 'fmarch_key_admin')
                   )
               ))
          + (SELECT COUNT(*)
             FROM (
                 VALUES ('r'::"char"), ('S'::"char"), ('f'::"char")
             ) object_type(kind)
             JOIN pg_database database ON database.datname = current_database()
             LEFT JOIN pg_default_acl defaults
               ON defaults.defaclrole = database.datdba
              AND defaults.defaclnamespace = 0
              AND defaults.defaclobjtype = object_type.kind
             CROSS JOIN LATERAL aclexplode(COALESCE(defaults.defaclacl, acldefault(object_type.kind, database.datdba))) acl
             WHERE acl.grantee <> database.datdba)
          + (SELECT COUNT(*)
             FROM pg_default_acl defaults
             JOIN pg_database database ON database.datname = current_database()
             LEFT JOIN pg_namespace namespace ON namespace.oid = defaults.defaclnamespace
             CROSS JOIN LATERAL aclexplode(defaults.defaclacl) acl
             WHERE (defaults.defaclnamespace = 0 OR namespace.nspname = 'public')
               AND (
                   defaults.defaclrole <> database.datdba
                   OR acl.grantee <> database.datdba
               ))
        "#,
    )
    .fetch_one(pool)
    .await?;
    if public_or_unclassified_leaks != 0 {
        return Err(DatabaseAuthorityError::Configuration(
            "PUBLIC or an unclassified third role retains database, schema, relation, function, or default authority"
                .to_string(),
        ));
    }

    let (database_privileges, schema_privileges): (Vec<String>, Vec<String>) = sqlx::query_as(
        r#"
        SELECT
            ARRAY(
                SELECT acl.privilege_type
                FROM pg_database database,
                     LATERAL aclexplode(database.datacl) acl
                JOIN pg_roles grantee ON grantee.oid = acl.grantee
                WHERE database.datname = current_database() AND grantee.rolname = $1
                ORDER BY acl.privilege_type
            ),
            ARRAY(
                SELECT acl.privilege_type
                FROM pg_namespace namespace,
                     LATERAL aclexplode(namespace.nspacl) acl
                JOIN pg_roles grantee ON grantee.oid = acl.grantee
                WHERE namespace.nspname = 'public' AND grantee.rolname = $1
                ORDER BY acl.privilege_type
            )
        "#,
    )
    .bind(role)
    .fetch_one(pool)
    .await?;
    if database_privileges != ["CONNECT"] || schema_privileges != ["USAGE"] {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "database role {role} must have exactly database CONNECT and public schema USAGE; database={database_privileges:?} schema={schema_privileges:?}"
        )));
    }
    Ok(())
}

fn expected_table_privileges(expected: DatabasePrincipal) -> BTreeSet<(String, String)> {
    let mut privileges = BTreeSet::new();
    match expected {
        DatabasePrincipal::Application => {
            for table in EXPECTED_TABLES
                .iter()
                .copied()
                .filter(|name| *name != "_sqlx_migrations")
            {
                privileges.insert((table.to_string(), "SELECT".to_string()));
                if table != "event_direct_key_sentinel" {
                    privileges.insert((table.to_string(), "INSERT".to_string()));
                }
            }
            privileges.insert(("_sqlx_migrations".to_string(), "SELECT".to_string()));
            privileges.insert((
                "event_direct_key_reference".to_string(),
                "SELECT".to_string(),
            ));
            for table in APPLICATION_UPDATE_TABLES {
                privileges.insert(((*table).to_string(), "UPDATE".to_string()));
            }
            for table in APPLICATION_DELETE_TABLES {
                privileges.insert(((*table).to_string(), "DELETE".to_string()));
            }
        }
        DatabasePrincipal::KeyAdmin => {
            for relation in KEY_ADMIN_SELECT_RELATIONS {
                privileges.insert(((*relation).to_string(), "SELECT".to_string()));
            }
        }
    }
    privileges
}

fn expected_column_privileges(expected: DatabasePrincipal) -> BTreeSet<(String, String, String)> {
    let mut privileges = BTreeSet::new();
    let sentinel_insert_columns = [
        "kid",
        "sentinel_version",
        "sentinel_nonce",
        "sentinel_ciphertext",
    ];
    for column in sentinel_insert_columns {
        privileges.insert((
            "event_direct_key_sentinel".to_string(),
            column.to_string(),
            "INSERT".to_string(),
        ));
    }
    if expected == DatabasePrincipal::Application {
        privileges.insert((
            "event_direct_key_sentinel".to_string(),
            "kid".to_string(),
            "UPDATE".to_string(),
        ));
    } else {
        for (table, columns) in KEY_ADMIN_COLUMN_UPDATES {
            for column in *columns {
                privileges.insert((
                    (*table).to_string(),
                    (*column).to_string(),
                    "UPDATE".to_string(),
                ));
            }
        }
    }
    privileges
}

fn set_difference_description(
    expected: &BTreeSet<(String, String)>,
    actual: &BTreeSet<(String, String)>,
) -> String {
    let missing = expected.difference(actual).cloned().collect::<Vec<_>>();
    let unexpected = actual.difference(expected).cloned().collect::<Vec<_>>();
    format!("missing={missing:?} unexpected={unexpected:?}")
}

async fn verify_catalog_manifest(pool: &PgPool) -> Result<(), DatabaseAuthorityError> {
    let mut connection = pool.acquire().await?;
    verify_catalog_manifest_on(&mut connection).await
}

async fn verify_catalog_manifest_on(
    connection: &mut PgConnection,
) -> Result<(), DatabaseAuthorityError> {
    let user_schemas = sqlx::query_scalar::<_, String>(
        r#"
        SELECT nspname
        FROM pg_namespace
        WHERE nspname <> 'information_schema'
          AND nspname !~ '^pg_'
        ORDER BY nspname
        "#,
    )
    .fetch_all(&mut *connection)
    .await?;
    if user_schemas != ["public"] {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "database contains unclassified user schemas: {user_schemas:?}"
        )));
    }
    let rows = sqlx::query(
        r#"
        SELECT c.relname, c.relkind::TEXT
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
        ORDER BY c.relname
        "#,
    )
    .fetch_all(&mut *connection)
    .await?;
    let actual = rows
        .into_iter()
        .map(|row| {
            (
                row.get::<String, _>("relname"),
                row.get::<String, _>("relkind"),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let expected = EXPECTED_TABLES
        .iter()
        .map(|name| ((*name).to_string(), "r".to_string()))
        .chain(
            EXPECTED_VIEWS
                .iter()
                .map(|name| ((*name).to_string(), "v".to_string())),
        )
        .chain(
            EXPECTED_SEQUENCES
                .iter()
                .map(|name| ((*name).to_string(), "S".to_string())),
        )
        .collect::<BTreeMap<_, _>>();
    if actual != expected {
        let actual_names = actual.keys().cloned().collect::<BTreeSet<_>>();
        let expected_names = expected.keys().cloned().collect::<BTreeSet<_>>();
        let missing = expected_names
            .difference(&actual_names)
            .cloned()
            .collect::<Vec<_>>();
        let unexpected = actual_names
            .difference(&expected_names)
            .cloned()
            .collect::<Vec<_>>();
        return Err(DatabaseAuthorityError::Configuration(format!(
            "database ACL manifest differs from the migrated catalog; missing={missing:?} unexpected={unexpected:?}"
        )));
    }
    Ok(())
}

async fn verify_guard_manifest(pool: &PgPool) -> Result<(), DatabaseAuthorityError> {
    let mut connection = pool.acquire().await?;
    verify_guard_manifest_on(&mut connection).await
}

async fn verify_guard_manifest_on(
    connection: &mut PgConnection,
) -> Result<(), DatabaseAuthorityError> {
    let trigger_rows = sqlx::query(
        r#"
        SELECT relation.relname AS table_name,
               trigger.tgname AS trigger_name,
               trigger.tgenabled::TEXT AS enabled,
               routine.proname AS function_name,
               pg_get_triggerdef(trigger.oid, TRUE) AS definition
        FROM pg_trigger trigger
        JOIN pg_class relation ON relation.oid = trigger.tgrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        JOIN pg_proc routine ON routine.oid = trigger.tgfoid
        WHERE namespace.nspname = 'public'
          AND NOT trigger.tgisinternal
        "#,
    )
    .fetch_all(&mut *connection)
    .await?;
    let mut actual_triggers = BTreeSet::new();
    let mut actual_trigger_hashes = BTreeMap::new();
    for row in trigger_rows {
        let trigger_name: String = row.get("trigger_name");
        let definition: String = row.get("definition");
        actual_trigger_hashes.insert(
            trigger_name.clone(),
            format!("{:x}", Sha256::digest(definition.as_bytes())),
        );
        actual_triggers.insert((
            row.get::<String, _>("table_name"),
            trigger_name,
            row.get::<String, _>("function_name"),
            row.get::<String, _>("enabled"),
        ));
    }
    let expected_triggers = EXPECTED_GUARDS
        .iter()
        .map(|(table, trigger, function)| {
            (
                (*table).to_string(),
                (*trigger).to_string(),
                (*function).to_string(),
                "O".to_string(),
            )
        })
        .collect::<BTreeSet<_>>();
    if actual_triggers != expected_triggers {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "database write-guard trigger manifest differs: expected={expected_triggers:?} actual={actual_triggers:?}"
        )));
    }
    let expected_trigger_hashes = EXPECTED_TRIGGER_DEFINITION_HASHES
        .iter()
        .map(|(name, hash)| ((*name).to_string(), (*hash).to_string()))
        .collect::<BTreeMap<_, _>>();
    if actual_trigger_hashes != expected_trigger_hashes {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "database write-guard trigger definitions differ: expected={expected_trigger_hashes:?} actual={actual_trigger_hashes:?}"
        )));
    }

    let function_rows = sqlx::query(
        r#"
        SELECT routine.proname,
               routine.prosecdef,
               routine.provolatile::TEXT AS volatility,
               routine.proowner = database.datdba AS trusted_owner,
               language.lanname,
               routine.proconfig,
               routine.proargtypes::TEXT AS argument_types,
               routine.prorettype::regtype::TEXT AS return_type,
               routine.prosrc
        FROM pg_proc routine
        JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
        JOIN pg_language language ON language.oid = routine.prolang
        JOIN pg_database database ON database.datname = current_database()
        WHERE namespace.nspname = 'public'
        "#,
    )
    .fetch_all(&mut *connection)
    .await?;
    let mut actual_functions = BTreeSet::new();
    let mut actual_function_hashes = BTreeMap::new();
    for row in function_rows {
        let function_name: String = row.get("proname");
        let source: String = row.get("prosrc");
        let config: Option<Vec<String>> = row.get("proconfig");
        if row.get::<String, _>("lanname") != "plpgsql"
            || config.is_some()
            || !row.get::<String, _>("argument_types").is_empty()
            || row.get::<String, _>("return_type") != "trigger"
        {
            return Err(DatabaseAuthorityError::Configuration(format!(
                "database write-guard function {function_name} has an unexpected language, arguments, return type, or local configuration"
            )));
        }
        actual_function_hashes.insert(
            function_name.clone(),
            format!("{:x}", Sha256::digest(source.as_bytes())),
        );
        actual_functions.insert((
            function_name,
            row.get::<bool, _>("prosecdef"),
            row.get::<String, _>("volatility"),
            row.get::<bool, _>("trusted_owner"),
        ));
    }
    let expected_functions = EXPECTED_GUARD_FUNCTIONS
        .iter()
        .map(|name| ((*name).to_string(), false, "v".to_string(), true))
        .collect::<BTreeSet<_>>();
    if actual_functions != expected_functions {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "database write-guard function manifest differs: expected={expected_functions:?} actual={actual_functions:?}"
        )));
    }
    let expected_function_hashes = EXPECTED_FUNCTION_SOURCE_HASHES
        .iter()
        .map(|(name, hash)| ((*name).to_string(), (*hash).to_string()))
        .collect::<BTreeMap<_, _>>();
    if actual_function_hashes != expected_function_hashes {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "database write-guard function bodies differ: expected={expected_function_hashes:?} actual={actual_function_hashes:?}"
        )));
    }
    Ok(())
}

fn validate_password(value: &str, name: &str) -> Result<(), DatabaseAuthorityError> {
    if !(24..=256).contains(&value.len()) || value.chars().any(char::is_control) {
        return Err(DatabaseAuthorityError::Configuration(format!(
            "{name} must contain 24..=256 non-control bytes"
        )));
    }
    Ok(())
}

async fn create_or_update_login(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    role: &str,
    password: &str,
) -> Result<(), sqlx::Error> {
    let (create_role, alter_role, reset_role, set_search_path) = match role {
        APPLICATION_DATABASE_ROLE => (
            "DO $fmarch$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fmarch_application') THEN CREATE ROLE fmarch_application; END IF; END $fmarch$",
            "DO $fmarch$ BEGIN EXECUTE format('ALTER ROLE fmarch_application WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS', current_setting('fmarch.database_role_password')); END $fmarch$",
            "ALTER ROLE fmarch_application RESET ALL",
            "ALTER ROLE fmarch_application SET search_path TO pg_catalog, public",
        ),
        KEY_ADMIN_DATABASE_ROLE => (
            "DO $fmarch$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fmarch_key_admin') THEN CREATE ROLE fmarch_key_admin; END IF; END $fmarch$",
            "DO $fmarch$ BEGIN EXECUTE format('ALTER ROLE fmarch_key_admin WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS', current_setting('fmarch.database_role_password')); END $fmarch$",
            "ALTER ROLE fmarch_key_admin RESET ALL",
            "ALTER ROLE fmarch_key_admin SET search_path TO pg_catalog, public",
        ),
        _ => unreachable!("database authority role names are compile-time constants"),
    };
    sqlx::query(create_role).execute(&mut **tx).await?;
    sqlx::query("SELECT set_config('fmarch.database_role_password', $1, true)")
        .bind(password)
        .execute(&mut **tx)
        .await?;
    sqlx::query(alter_role).execute(&mut **tx).await?;
    sqlx::query("SELECT set_config('fmarch.database_role_password', '', true)")
        .execute(&mut **tx)
        .await?;
    sqlx::query(reset_role).execute(&mut **tx).await?;
    let database: String = sqlx::query_scalar("SELECT quote_ident(current_database())")
        .fetch_one(&mut **tx)
        .await?;
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "ALTER ROLE {role} IN DATABASE {database} RESET ALL"
    )))
    .execute(&mut **tx)
    .await?;
    sqlx::query(set_search_path).execute(&mut **tx).await?;
    Ok(())
}

async fn remove_role_memberships(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    role: &str,
) -> Result<(), sqlx::Error> {
    let groups = sqlx::query_scalar::<_, String>(
        r#"
        SELECT quote_ident(parent.rolname)
        FROM pg_auth_members membership
        JOIN pg_roles member ON member.oid = membership.member
        JOIN pg_roles parent ON parent.oid = membership.roleid
        WHERE member.rolname = $1
        "#,
    )
    .bind(role)
    .fetch_all(&mut **tx)
    .await?;
    for group in groups {
        sqlx::query(sqlx::AssertSqlSafe(format!("REVOKE {group} FROM {role}")))
            .execute(&mut **tx)
            .await?;
    }
    let inbound = sqlx::query(
        r#"
        SELECT quote_ident(member.rolname) AS member_name,
               member.oid = database.datdba AS trusted_database_owner,
               membership.admin_option,
               membership.inherit_option,
               membership.set_option
        FROM pg_auth_members membership
        JOIN pg_roles member ON member.oid = membership.member
        JOIN pg_roles parent ON parent.oid = membership.roleid
        JOIN pg_database database ON database.datname = current_database()
        WHERE parent.rolname = $1
        "#,
    )
    .bind(role)
    .fetch_all(&mut **tx)
    .await?;
    for row in inbound {
        let trusted = row.get::<bool, _>("trusted_database_owner")
            && row.get::<bool, _>("admin_option")
            && !row.get::<bool, _>("inherit_option")
            && !row.get::<bool, _>("set_option");
        if !trusted {
            let member: String = row.get("member_name");
            sqlx::query(sqlx::AssertSqlSafe(format!("REVOKE {role} FROM {member}")))
                .execute(&mut **tx)
                .await?;
        }
    }
    Ok(())
}

async fn revoke_restricted_parameter_privileges(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), DatabaseAuthorityError> {
    let parameters = sqlx::query_scalar::<_, String>(
        r#"
        SELECT DISTINCT parameter.parname
        FROM pg_parameter_acl parameter
        CROSS JOIN LATERAL aclexplode(parameter.paracl) privilege
        WHERE privilege.grantee IN (
            0,
            (SELECT oid FROM pg_roles WHERE rolname = 'fmarch_application'),
            (SELECT oid FROM pg_roles WHERE rolname = 'fmarch_key_admin')
        )
        ORDER BY parameter.parname
        "#,
    )
    .fetch_all(&mut **tx)
    .await?;
    for parameter in parameters {
        let statement: String = sqlx::query_scalar(
            r#"
            SELECT format(
                'REVOKE ALL ON PARAMETER %I FROM PUBLIC, fmarch_application, fmarch_key_admin',
                $1
            )
            "#,
        )
        .bind(parameter)
        .fetch_one(&mut **tx)
        .await?;
        sqlx::query(sqlx::AssertSqlSafe(statement))
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

async fn execute_database_acl(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    prefix: &str,
    suffix: &str,
) -> Result<(), sqlx::Error> {
    let database: String = sqlx::query_scalar("SELECT quote_ident(current_database())")
        .fetch_one(&mut **tx)
        .await?;
    sqlx::query(sqlx::AssertSqlSafe(format!("{prefix} {database} {suffix}")))
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn grant_relations(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    role: &str,
    privileges: &str,
    relations: &[&str],
) -> Result<(), sqlx::Error> {
    if relations.is_empty() {
        return Ok(());
    }
    let qualified = relations
        .iter()
        .map(|name| format!("public.{name}"))
        .collect::<Vec<_>>()
        .join(", ");
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "GRANT {privileges} ON TABLE {qualified} TO {role}"
    )))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn grant_columns(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    role: &str,
    table: &str,
    privilege: &str,
    columns: &[&str],
) -> Result<(), sqlx::Error> {
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "GRANT {privilege} ({}) ON TABLE public.{table} TO {role}",
        columns.join(", ")
    )))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn grant_sequences(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    role: &str,
    privileges: &str,
    sequences: &[&str],
) -> Result<(), sqlx::Error> {
    let qualified = sequences
        .iter()
        .map(|name| format!("public.{name}"))
        .collect::<Vec<_>>()
        .join(", ");
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "GRANT {privileges} ON SEQUENCE {qualified} TO {role}"
    )))
    .execute(&mut **tx)
    .await?;
    Ok(())
}
