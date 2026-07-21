//! Exact catalog contract for the pre-1.0 greenfield projection baseline.

use sqlx::PgPool;

const EXPECTED_TABLES: &[&str] = &[
    "action_counter",
    "action_grant",
    "action_history",
    "auth_account",
    "auth_account_recovery_credential",
    "auth_credential_attempt",
    "auth_delivery_intent",
    "auth_invite",
    "auth_registration_attempt",
    "auth_session",
    "command_receipt",
    "day_vote_outcome",
    "delayed_death_queue",
    "discussion_area",
    "discussion_post",
    "discussion_topic",
    "events",
    "game_authority",
    "game_index",
    "game_result",
    "host_phase_control",
    "host_prompt",
    "identity_lifecycle_audit",
    "investigation_memory",
    "phase_state",
    "player_info_result",
    "player_investigation_result",
    "player_notification",
    "post_policy",
    "private_channel_member",
    "profile_editor",
    "profile_public",
    "public_search_document",
    "sheriff_badge",
    "slot_effect",
    "slot_occupancy",
    "slot_state",
    "slot_status_tag",
    "spectator_membership",
    "thread_view",
    "visit_history",
    "vote_ballot",
];

const EXPECTED_INDEXES: &[&str] = &[
    "action_counter_pkey",
    "action_counter_slot_template_idx",
    "action_grant_pkey",
    "action_grant_slot_idx",
    "action_history_pkey",
    "action_history_slot_template_idx",
    "auth_account_disabled_idx",
    "auth_account_pkey",
    "auth_account_principal_idx",
    "auth_account_recovery_account_idx",
    "auth_account_recovery_active_idx",
    "auth_account_recovery_credential_pkey",
    "auth_account_recovery_credential_token_hash_key",
    "auth_credential_attempt_blocked_idx",
    "auth_credential_attempt_pkey",
    "auth_credential_attempt_updated_idx",
    "auth_delivery_intent_account_idx",
    "auth_delivery_intent_claim_idx",
    "auth_delivery_intent_credential_hash_key",
    "auth_delivery_intent_pkey",
    "auth_delivery_intent_retry_idx",
    "auth_invite_account_idx",
    "auth_invite_expiry_idx",
    "auth_invite_game_idx",
    "auth_invite_pkey",
    "auth_invite_principal_idx",
    "auth_invite_revocation_idx",
    "auth_registration_attempt_blocked_idx",
    "auth_registration_attempt_pkey",
    "auth_registration_attempt_updated_idx",
    "auth_session_expiry_idx",
    "auth_session_pkey",
    "auth_session_principal_idx",
    "command_receipt_pkey",
    "command_receipt_stream_idx",
    "day_vote_outcome_pkey",
    "day_vote_outcome_source_idx",
    "delayed_death_queue_pkey",
    "delayed_death_queue_target_idx",
    "discussion_area_pkey",
    "discussion_area_slug_key",
    "discussion_post_pkey",
    "discussion_post_topic_order_idx",
    "discussion_topic_area_page_idx",
    "discussion_topic_pkey",
    "events_pkey",
    "events_stream_order_idx",
    "events_stream_seq_unique",
    "game_authority_pkey",
    "game_index_pkey",
    "game_index_public_page_idx",
    "game_result_pkey",
    "host_phase_control_phase_idx",
    "host_phase_control_pkey",
    "host_prompt_phase_idx",
    "host_prompt_pkey",
    "identity_lifecycle_audit_event_at_idx",
    "identity_lifecycle_audit_event_kind_idx",
    "identity_lifecycle_audit_pkey",
    "identity_lifecycle_audit_principal_idx",
    "investigation_memory_investigator_idx",
    "investigation_memory_pkey",
    "phase_state_pkey",
    "player_info_result_audience_idx",
    "player_info_result_pkey",
    "player_investigation_result_audience_idx",
    "player_investigation_result_pkey",
    "player_notification_audience_idx",
    "player_notification_pkey",
    "post_policy_pkey",
    "private_channel_member_pkey",
    "private_channel_member_slot_idx",
    "profile_editor_pkey",
    "profile_editor_principal_user_id_key",
    "profile_public_handle_key",
    "profile_public_pkey",
    "profile_public_visible_handle_idx",
    "public_search_document_page_idx",
    "public_search_document_pkey",
    "public_search_document_scope_idx",
    "public_search_document_vector_idx",
    "sheriff_badge_owner_idx",
    "sheriff_badge_pkey",
    "slot_effect_by_effect_idx",
    "slot_effect_pkey",
    "slot_occupancy_pkey",
    "slot_occupancy_user_idx",
    "slot_state_pkey",
    "slot_status_tag_by_tag_idx",
    "slot_status_tag_pkey",
    "spectator_membership_pkey",
    "thread_view_page_idx",
    "thread_view_pkey",
    "visit_history_actor_idx",
    "visit_history_pkey",
    "visit_history_target_idx",
    "vote_ballot_pkey",
    "vote_ballot_target_idx",
];

const EXPECTED_CONSTRAINTS: &[&str] = &[
    "action_counter_pkey:p",
    "action_grant_pkey:p",
    "action_history_pkey:p",
    "auth_account_pkey:p",
    "auth_account_recovery_credential_account_id_fkey:f",
    "auth_account_recovery_credential_check:c",
    "auth_account_recovery_credential_check1:c",
    "auth_account_recovery_credential_pkey:p",
    "auth_account_recovery_credential_token_hash_key:u",
    "auth_credential_attempt_check:c",
    "auth_credential_attempt_failure_count_check:c",
    "auth_credential_attempt_pkey:p",
    "auth_delivery_intent_account_id_fkey:f",
    "auth_delivery_intent_attempt_count_check:c",
    "auth_delivery_intent_credential_envelope_check:c",
    "auth_delivery_intent_credential_hash_key:u",
    "auth_delivery_intent_delivery_kind_check:c",
    "auth_delivery_intent_delivery_shape_check:c",
    "auth_delivery_intent_outcome_kind_check:c",
    "auth_delivery_intent_pkey:p",
    "auth_delivery_intent_provider_id_check:c",
    "auth_delivery_intent_status_check:c",
    "auth_invite_account_id_fkey:f",
    "auth_invite_pkey:p",
    "auth_registration_attempt_attempt_count_check:c",
    "auth_registration_attempt_check:c",
    "auth_registration_attempt_pkey:p",
    "auth_session_pkey:p",
    "command_receipt_pkey:p",
    "day_vote_outcome_pkey:p",
    "delayed_death_queue_pkey:p",
    "discussion_area_pkey:p",
    "discussion_area_slug_key:u",
    "discussion_post_author_profile_id_fkey:f",
    "discussion_post_pkey:p",
    "discussion_post_topic_id_fkey:f",
    "discussion_topic_area_id_fkey:f",
    "discussion_topic_author_profile_id_fkey:f",
    "discussion_topic_pkey:p",
    "discussion_topic_posting_state_check:c",
    "discussion_topic_visibility_check:c",
    "events_pkey:p",
    "events_stream_seq_unique:u",
    "game_authority_pkey:p",
    "game_index_pkey:p",
    "game_index_status_check:c",
    "game_result_pkey:p",
    "host_phase_control_pkey:p",
    "host_prompt_pkey:p",
    "identity_lifecycle_audit_pkey:p",
    "investigation_memory_pkey:p",
    "phase_state_pkey:p",
    "player_info_result_pkey:p",
    "player_investigation_result_pkey:p",
    "player_notification_pkey:p",
    "post_policy_pkey:p",
    "private_channel_member_pkey:p",
    "profile_editor_pkey:p",
    "profile_editor_principal_user_id_key:u",
    "profile_editor_profile_id_fkey:f",
    "profile_public_handle_key:u",
    "profile_public_pkey:p",
    "profile_public_visibility_check:c",
    "public_search_document_document_kind_check:c",
    "public_search_document_pkey:p",
    "public_search_document_scope_kind_check:c",
    "sheriff_badge_pkey:p",
    "slot_effect_pkey:p",
    "slot_occupancy_pkey:p",
    "slot_state_pkey:p",
    "slot_status_tag_pkey:p",
    "spectator_membership_pkey:p",
    "thread_view_author_present:c",
    "thread_view_pkey:p",
    "visit_history_pkey:p",
    "vote_ballot_pkey:p",
];

fn assert_inventory(kind: &str, actual: &[String], expected: &[&str]) {
    let actual: Vec<&str> = actual.iter().map(String::as_str).collect();
    assert_eq!(actual, expected, "{kind} inventory drifted");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn greenfield_baseline_has_exact_catalog_inventory(pool: PgPool) {
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT table_name \
         FROM information_schema.tables \
         WHERE table_schema = 'public' \
           AND table_type = 'BASE TABLE' \
           AND table_name <> '_sqlx_migrations' \
         ORDER BY table_name",
    )
    .fetch_all(&pool)
    .await
    .expect("read baseline table inventory");
    assert_inventory("table", &tables, EXPECTED_TABLES);

    let indexes: Vec<String> = sqlx::query_scalar(
        "SELECT indexname \
         FROM pg_indexes \
         WHERE schemaname = 'public' \
           AND tablename <> '_sqlx_migrations' \
         ORDER BY indexname",
    )
    .fetch_all(&pool)
    .await
    .expect("read baseline index inventory");
    assert_inventory("index", &indexes, EXPECTED_INDEXES);

    let constraints: Vec<String> = sqlx::query_scalar(
        "SELECT constraint_row.conname || ':' || constraint_row.contype::text \
         FROM pg_constraint AS constraint_row \
         JOIN pg_namespace AS namespace_row \
           ON namespace_row.oid = constraint_row.connamespace \
         JOIN pg_class AS relation_row \
           ON relation_row.oid = constraint_row.conrelid \
         WHERE namespace_row.nspname = 'public' \
           AND relation_row.relname <> '_sqlx_migrations' \
         ORDER BY constraint_row.conname",
    )
    .fetch_all(&pool)
    .await
    .expect("read baseline constraint inventory");
    assert_inventory("constraint", &constraints, EXPECTED_CONSTRAINTS);
}
