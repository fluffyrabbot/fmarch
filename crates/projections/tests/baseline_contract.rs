//! Exact catalog contract after applying the current database schema.

use projections::PUBLIC_SEARCH_SQL;
use sqlx::{PgPool, Row};
use std::time::Duration;
use uuid::Uuid;

const EXPECTED_TABLES: &[&str] = &[
    "action_counter",
    "action_grant",
    "action_history",
    "action_submission",
    "auth_account",
    "auth_account_recovery_credential",
    "auth_credential_attempt",
    "auth_delivery_intent",
    "auth_registration_attempt",
    "auth_session",
    "auth_websocket_ticket",
    "authentication_method",
    "command_receipt",
    "community_invitation",
    "community_invitation_credential",
    "community_membership",
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
    "game_invitation",
    "game_persona",
    "game_persona_name_claim",
    "game_persona_name_history",
    "game_persona_public",
    "game_persona_redaction",
    "game_persona_subject_binding",
    "game_private_citation",
    "game_result",
    "game_thread_visibility_change",
    "host_phase_control",
    "host_prompt",
    "identity_lifecycle_audit",
    "investigation_memory",
    "media_upload_ledger",
    "member_inbox_cursor",
    "member_inbox_item",
    "member_lifecycle_event",
    "member_lifecycle_projection",
    "member_personal_export",
    "member_profile",
    "membership_ancestry",
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
    "post_policy",
    "privacy_subject",
    "private_channel_member",
    "profile_mute",
    "public_citation",
    "public_profile",
    "public_publication",
    "public_search_document",
    "public_watch",
    "public_watch_period",
    "publication_surface",
    "sheriff_badge",
    "slot_effect",
    "slot_mention_notification",
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
    "workos_signing_key_tombstone",
    "workos_subject_tombstone",
];

const EXPECTED_EVENT_COLUMNS: &[&str] = &[
    "seq:bigint",
    "stream_id:uuid",
    "stream_seq:bigint",
    "kind:text",
    "version:smallint",
    "occurred_at:bigint",
    "sealed_version:smallint",
    "sealed_nonce:bytea",
    "sealed_body:bytea",
    "stream_key_epoch:bigint",
];

const EXPECTED_AUTH_SESSION_COLUMNS: &[&str] = &[
    "token_hash:text",
    "principal_id:uuid",
    "created_at:bigint",
    "expires_at:bigint",
    "revoked_at:bigint",
    "authenticated_via_method_id:uuid",
    "idle_expires_at:bigint",
    "assurance:text",
    "authenticated_at:bigint",
    "workos_session_id:text",
    "local_proof_instance_id:text",
    "workos_signing_key_id:text",
];

const EXPECTED_WORKOS_SESSION_EXCHANGE_COLUMNS: &[&str] = &[
    "provider_session_id:text",
    "access_token_hash:text",
    "exchanged_at:bigint",
    "access_expires_at:bigint",
    "linking_session_hash:text",
];

const EXPECTED_WORKOS_PROVIDER_SESSION_COLUMNS: &[&str] = &[
    "provider_session_id:text",
    "subject:text",
    "principal_id:uuid",
    "method_id:uuid",
    "status:text",
    "created_at:bigint",
    "last_seen_at:bigint",
    "access_expires_at:bigint",
    "logged_out_at:bigint",
    "method_kind:text",
];

const EXPECTED_WORKOS_PROVIDER_SESSION_TOMBSTONE_COLUMNS: &[&str] = &[
    "provider_session_hash:text",
    "tombstoned_at:bigint",
    "reason:text",
];

const EXPECTED_WORKOS_SUBJECT_TOMBSTONE_COLUMNS: &[&str] = &[
    "provider_subject_hash:text",
    "tombstoned_at:bigint",
    "reason:text",
];

const EXPECTED_GAME_INDEX_COLUMNS: &[&str] = &[
    "game_id:uuid",
    "pack_key:text",
    "status:text",
    "phase_id:text",
    "created_seq:bigint",
    "started_seq:bigint",
    "completed_seq:bigint",
    "updated_seq:bigint",
    "pack_version:bigint",
    "pack_content_hash:text",
];

const EXPECTED_PACK_ARTIFACT_COLUMNS: &[&str] = &[
    "content_hash:text",
    "pack_key:text",
    "pack_version:bigint",
    "artifact_schema_version:smallint",
    "canonical_json:text",
];

const EXPECTED_MEMBER_PROFILE_COLUMNS: &[&str] = &[
    "profile_id:uuid",
    "active_principal_id:uuid",
    "handle_hmac:bytea",
    "lifecycle:text",
    "redacted_alias:text",
    "created_seq:bigint",
    "updated_seq:bigint",
    "revision:bigint",
    "subject_id:uuid",
    "current_claim_id:uuid",
];

const EXPECTED_PUBLIC_PROFILE_COLUMNS: &[&str] = &[
    "profile_id:uuid",
    "handle:text",
    "display_name:text",
    "bio:text",
    "created_seq:bigint",
    "updated_seq:bigint",
    "revision:bigint",
];

const EXPECTED_PROFILE_MUTE_COLUMNS: &[&str] = &[
    "relationship_id:uuid",
    "principal_id:uuid",
    "target_profile_id:uuid",
    "active:boolean",
    "updated_seq:bigint",
    "version:bigint",
];

const EXPECTED_IDENTITY_LIFECYCLE_AUDIT_COLUMNS: &[&str] = &[
    "id:bigint",
    "event_at:bigint",
    "event_kind:text",
    "actor_principal_id:uuid",
    "principal_id:uuid",
    "redacted_actor_alias:text",
    "redacted_principal_alias:text",
    "token_hash:text",
    "related_token_hash:text",
    "metadata:jsonb",
];

const EXPECTED_IDENTITY_LIFECYCLE_AUDIT_REDACTION_COLUMNS: &[&str] = &[
    "actor_principal_id:uuid:YES",
    "principal_id:uuid:YES",
    "redacted_actor_alias:text:YES",
    "redacted_principal_alias:text:YES",
];

// This is the deliberate authority-bearing principal surface, not a broad
// name-pattern query: public aliases and unrelated operational identifiers are
// not principals merely because their names contain a familiar word.
const EXPECTED_CANONICAL_PRINCIPAL_COLUMNS: &[&str] = &[
    "auth_account.principal_id:uuid",
    "auth_delivery_intent.principal_id:uuid",
    "auth_session.principal_id:uuid",
    "authentication_method.principal_id:uuid",
    "command_receipt.principal_id:uuid",
    "community_membership.active_principal_id:uuid",
    "external_identity.principal_id:uuid",
    "game_authority.principal_id:uuid",
    "game_invitation.principal_id:uuid",
    "game_invitation.invited_by_principal_id:uuid",
    "identity_lifecycle_audit.actor_principal_id:uuid",
    "identity_lifecycle_audit.principal_id:uuid",
    "media_upload_ledger.principal_id:uuid",
    "member_inbox_cursor.principal_id:uuid",
    "member_inbox_item.principal_id:uuid",
    "member_lifecycle_event.principal_id:uuid",
    "member_lifecycle_projection.principal_id:uuid",
    "member_personal_export.principal_id:uuid",
    "member_profile.active_principal_id:uuid",
    "moderation_case_history.actor_principal_id:uuid",
    "moderation_report.reporter_principal_id:uuid",
    "moderation_target_state.moderator_principal_id:uuid",
    "platform_principal.principal_id:uuid",
    "privacy_subject.principal_id:uuid",
    "profile_mute.principal_id:uuid",
    "public_watch.principal_id:uuid",
    "spectator_membership.principal_id:uuid",
    "subject_erasure_outbox.principal_id:uuid",
    "workos_provider_session.principal_id:uuid",
    "workos_signing_key_tombstone.retired_by_principal_id:uuid",
];

const EXPECTED_INDEXES: &[&str] = &[
    "action_counter_pkey",
    "action_counter_slot_template_idx",
    "action_grant_pkey",
    "action_grant_slot_idx",
    "action_history_pkey",
    "action_history_slot_template_idx",
    "action_submission_actor_phase_idx",
    "action_submission_pkey",
    "auth_account_disabled_idx",
    "auth_account_method_id_key",
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
    "auth_delivery_intent_credential_envelope_kid_idx",
    "auth_delivery_intent_credential_hash_key",
    "auth_delivery_intent_pkey",
    "auth_delivery_intent_principal_idx",
    "auth_delivery_intent_retry_idx",
    "auth_registration_attempt_blocked_idx",
    "auth_registration_attempt_pkey",
    "auth_registration_attempt_updated_idx",
    "auth_session_expiry_idx",
    "auth_session_method_idx",
    "auth_session_pkey",
    "auth_session_principal_idx",
    "auth_session_workos_session_idx",
    "auth_session_workos_signing_key_idx",
    "auth_websocket_ticket_expiry_idx",
    "auth_websocket_ticket_pkey",
    "auth_websocket_ticket_session_idx",
    "authentication_method_classic_unique",
    "authentication_method_identity_key",
    "authentication_method_pkey",
    "authentication_method_principal_idx",
    "command_receipt_pkey",
    "command_receipt_stream_idx",
    "community_invitation_admitted_membership_id_key",
    "community_invitation_credential_expiry_idx",
    "community_invitation_credential_invitation_id_key",
    "community_invitation_credential_pkey",
    "community_invitation_expiry_idx",
    "community_invitation_pkey",
    "community_invitation_sponsor_idx",
    "community_membership_active_principal_unique",
    "community_membership_admission_invitation_id_key",
    "community_membership_pkey",
    "community_membership_sponsor_idx",
    "community_membership_status_idx",
    "completed_game_detached_alias_game_alias_key",
    "completed_game_detached_alias_pkey",
    "day_event_narrative_pending_idx",
    "day_event_narrative_pkey",
    "day_event_narrative_rendered_private_kid_idx",
    "day_event_narrative_template_private_kid_idx",
    "day_event_participation_page_idx",
    "day_event_participation_pkey",
    "day_event_pkey",
    "day_event_schedule_work_auto_resolve_idx",
    "day_event_schedule_work_due_idx",
    "day_event_schedule_work_narrative_idx",
    "day_event_schedule_work_pkey",
    "day_event_schedule_work_wake_idx",
    "day_event_scheduler_claim_idx",
    "day_event_scheduler_state_pkey",
    "day_event_state_idx",
    "day_program_attached_idx",
    "day_program_pkey",
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
    "engine_snapshot_checkpoint_pkey",
    "event_direct_key_sentinel_lifecycle_idx",
    "event_direct_key_sentinel_pkey",
    "event_direct_key_sentinel_single_retiring_idx",
    "event_stream_key_state_pkey",
    "event_stream_keys_pkey",
    "event_stream_keys_wrap_kid_idx",
    "events_pkey",
    "events_stream_seq_unique",
    "external_identity_method_id_key",
    "external_identity_method_subject_key",
    "external_identity_pkey",
    "external_identity_principal_idx",
    "game_authority_pkey",
    "game_cohost_policy_pkey",
    "game_index_pkey",
    "game_index_public_page_idx",
    "game_invitation_account_idx",
    "game_invitation_expiry_idx",
    "game_invitation_game_idx",
    "game_invitation_pkey",
    "game_invitation_principal_idx",
    "game_invitation_revocation_idx",
    "game_persona_name_claim_pkey",
    "game_persona_name_history_pkey",
    "game_persona_pkey",
    "game_persona_public_pkey",
    "game_persona_redaction_pkey",
    "game_persona_subject_binding_erasure_idx",
    "game_persona_subject_binding_pkey",
    "game_persona_subject_binding_subject_erasure_idx",
    "game_persona_subject_binding_subject_idx",
    "game_private_citation_pkey",
    "game_private_citation_quoted_idx",
    "game_result_pkey",
    "game_thread_visibility_change_game_idx",
    "game_thread_visibility_change_pkey",
    "host_phase_control_phase_idx",
    "host_phase_control_pkey",
    "host_prompt_phase_idx",
    "host_prompt_pkey",
    "identity_lifecycle_audit_actor_idx",
    "identity_lifecycle_audit_event_at_idx",
    "identity_lifecycle_audit_event_kind_idx",
    "identity_lifecycle_audit_pkey",
    "identity_lifecycle_audit_principal_idx",
    "investigation_memory_investigator_idx",
    "investigation_memory_pkey",
    "investigation_memory_result_private_kid_idx",
    "media_upload_ledger_pkey",
    "media_upload_ledger_principal_idx",
    "member_inbox_cursor_pkey",
    "member_inbox_item_page_idx",
    "member_inbox_item_pkey",
    "member_lifecycle_event_pkey",
    "member_lifecycle_event_principal_seq_idx",
    "member_lifecycle_event_subject_idx",
    "member_lifecycle_projection_pkey",
    "member_lifecycle_projection_subject_idx",
    "member_personal_export_pkey",
    "member_personal_export_principal_requested_idx",
    "member_personal_export_subject_idx",
    "member_profile_active_principal_id_key",
    "member_profile_handle_hmac_key",
    "member_profile_pkey",
    "member_profile_subject_id_key",
    "member_profile_subject_idx",
    "membership_ancestry_descendant_idx",
    "membership_ancestry_pkey",
    "moderation_case_history_case_idx",
    "moderation_case_history_pkey",
    "moderation_case_pkey",
    "moderation_case_queue_idx",
    "moderation_case_target_key",
    "moderation_report_active_dedupe_idx",
    "moderation_report_pkey",
    "moderation_report_rate_idx",
    "moderation_target_state_pkey",
    "pack_artifact_identity_key",
    "pack_artifact_pkey",
    "phase_state_pkey",
    "platform_principal_pkey",
    "player_info_result_audience_idx",
    "player_info_result_pkey",
    "player_info_result_private_kid_idx",
    "player_investigation_result_audience_idx",
    "player_investigation_result_pkey",
    "player_investigation_result_private_kid_idx",
    "player_notification_audience_idx",
    "player_notification_pkey",
    "post_policy_pkey",
    "privacy_subject_exact_owner_unique",
    "privacy_subject_pkey",
    "privacy_subject_principal_id_key",
    "private_channel_member_pkey",
    "private_channel_member_private_kid_idx",
    "private_channel_member_slot_idx",
    "profile_mute_member_page_idx",
    "profile_mute_member_target_key",
    "profile_mute_pkey",
    "profile_mute_target_idx",
    "public_citation_pkey",
    "public_citation_quoted_page_idx",
    "public_profile_handle_key",
    "public_profile_pkey",
    "public_publication_author_idx",
    "public_publication_pkey",
    "public_publication_surface_page_idx",
    "public_search_document_author_idx",
    "public_search_document_pkey",
    "public_search_document_vector_idx",
    "public_watch_member_idx",
    "public_watch_member_target_key",
    "public_watch_period_lookup_idx",
    "public_watch_period_pkey",
    "public_watch_pkey",
    "public_watch_target_idx",
    "publication_surface_pkey",
    "sheriff_badge_owner_idx",
    "sheriff_badge_pkey",
    "slot_effect_by_effect_idx",
    "slot_effect_pkey",
    "slot_mention_notification_audience_idx",
    "slot_mention_notification_pkey",
    "slot_occupancy_epoch_open_persona_idx",
    "slot_occupancy_epoch_open_slot_idx",
    "slot_occupancy_epoch_pkey",
    "slot_state_pkey",
    "slot_state_private_kid_idx",
    "slot_status_tag_by_tag_idx",
    "slot_status_tag_pkey",
    "spectator_membership_pkey",
    "subject_authority_binding_pkey",
    "subject_erasure_outbox_pkey",
    "subject_erasure_outbox_principal_id_key",
    "subject_erasure_outbox_receipt_id_key",
    "subject_erasure_outbox_replacement_alias_key",
    "subject_erasure_outbox_subject_id_key",
    "subject_erasure_pending_claim_idx",
    "subject_erasure_pkey",
    "subject_key_destruction_receipt_erasure_id_key",
    "subject_key_destruction_receipt_pkey",
    "subject_key_destruction_receipt_subject_id_key",
    "subject_private_claim_id_subject_key",
    "subject_private_claim_pkey",
    "subject_private_claim_scope_idx",
    "subject_private_claim_subject_idx",
    "subject_tombstone_pkey",
    "subject_tombstone_replacement_alias_key",
    "thread_view_body_private_kid_idx",
    "thread_view_page_idx",
    "thread_view_pkey",
    "visit_history_actor_idx",
    "visit_history_pkey",
    "visit_history_target_idx",
    "vote_ballot_pkey",
    "vote_ballot_target_idx",
    "workos_provider_session_identity_key",
    "workos_provider_session_pkey",
    "workos_provider_session_principal_idx",
    "workos_provider_session_tombstone_pkey",
    "workos_session_exchange_expiry_idx",
    "workos_session_exchange_pkey",
    "workos_session_exchange_provider_session_idx",
    "workos_signing_key_tombstone_pkey",
    "workos_subject_tombstone_pkey",
];

const EXPECTED_PUBLIC_SEARCH_VECTOR_EXPRESSION: &str = "(setweight(to_tsvector('english'::regconfig, title_text), 'A'::\"char\") || setweight(to_tsvector('english'::regconfig, body), 'B'::\"char\"))";

const EXPECTED_PUBLIC_SEARCH_INDEX_DEFINITIONS: &[&str] = &[
    "public_search_document_vector_idx:CREATE INDEX public_search_document_vector_idx ON public.public_search_document USING gin (search_vector) WHERE visible",
];

const EXPECTED_ERASURE_INDEX_DEFINITIONS: &[&str] = &[
    "auth_delivery_intent_principal_idx:CREATE INDEX auth_delivery_intent_principal_idx ON public.auth_delivery_intent USING btree (principal_id)",
    "auth_session_principal_idx:CREATE INDEX auth_session_principal_idx ON public.auth_session USING btree (principal_id)",
    "auth_websocket_ticket_session_idx:CREATE INDEX auth_websocket_ticket_session_idx ON public.auth_websocket_ticket USING btree (session_reference)",
    "game_persona_subject_binding_erasure_idx:CREATE INDEX game_persona_subject_binding_erasure_idx ON public.game_persona_subject_binding USING btree (subject_id) WHERE (lifecycle = 'active'::text)",
    "identity_lifecycle_audit_actor_idx:CREATE INDEX identity_lifecycle_audit_actor_idx ON public.identity_lifecycle_audit USING btree (actor_principal_id)",
    "member_lifecycle_event_subject_idx:CREATE INDEX member_lifecycle_event_subject_idx ON public.member_lifecycle_event USING btree (subject_id)",
    "member_lifecycle_projection_subject_idx:CREATE INDEX member_lifecycle_projection_subject_idx ON public.member_lifecycle_projection USING btree (subject_id)",
    "member_personal_export_subject_idx:CREATE INDEX member_personal_export_subject_idx ON public.member_personal_export USING btree (subject_id)",
];

const EXPECTED_CONSTRAINTS: &[&str] = &[
    "action_counter_pkey:p",
    "action_grant_pkey:p",
    "action_history_pkey:p",
    "action_submission_pkey:p",
    "auth_account_method_id_fkey:f",
    "auth_account_method_id_key:u",
    "auth_account_method_identity_fkey:f",
    "auth_account_pkey:p",
    "auth_account_recovery_credential_account_id_fkey:f",
    "auth_account_recovery_credential_check:c",
    "auth_account_recovery_credential_check1:c",
    "auth_account_recovery_credential_pkey:p",
    "auth_account_recovery_credential_token_hash_key:u",
    "auth_credential_attempt_check:c",
    "auth_credential_attempt_failure_count_check:c",
    "auth_credential_attempt_pkey:p",
    "auth_delivery_intent_attempt_count_check:c",
    "auth_delivery_intent_credential_envelope_check:c",
    "auth_delivery_intent_credential_envelope_kid_fkey:f",
    "auth_delivery_intent_credential_envelope_kid_shape:c",
    "auth_delivery_intent_credential_expiry_check:c",
    "auth_delivery_intent_credential_hash_key:u",
    "auth_delivery_intent_delivery_kind_check:c",
    "auth_delivery_intent_delivery_shape_check:c",
    "auth_delivery_intent_outcome_kind_check:c",
    "auth_delivery_intent_pkey:p",
    "auth_delivery_intent_provider_id_check:c",
    "auth_delivery_intent_status_check:c",
    "auth_registration_attempt_attempt_count_check:c",
    "auth_registration_attempt_check:c",
    "auth_registration_attempt_pkey:p",
    "auth_session_assurance_check:c",
    "auth_session_authenticated_at_check:c",
    "auth_session_idle_expiry_check:c",
    "auth_session_local_proof_instance_shape_check:c",
    "auth_session_method_fkey:f",
    "auth_session_pkey:p",
    "auth_session_principal_id_fkey:f",
    "auth_session_workos_provider_session_fkey:f",
    "auth_session_workos_session_shape_check:c",
    "auth_session_workos_signing_key_shape_check:c",
    "auth_websocket_ticket_access_expiry_check:c",
    "auth_websocket_ticket_after_seq_check:c",
    "auth_websocket_ticket_audience_check:c",
    "auth_websocket_ticket_channel_check:c",
    "auth_websocket_ticket_expiry_check:c",
    "auth_websocket_ticket_pkey:p",
    "auth_websocket_ticket_session_reference_fkey:f",
    "authentication_method_disabled_shape_check:c",
    "authentication_method_identity_key:u",
    "authentication_method_kind_check:c",
    "authentication_method_pkey:p",
    "authentication_method_principal_id_fkey:f",
    "authentication_method_status_check:c",
    "command_receipt_fingerprint_check:c",
    "command_receipt_pkey:p",
    "community_invitation_admitted_membership_fkey:f",
    "community_invitation_admitted_membership_id_key:u",
    "community_invitation_credential_hash_check:c",
    "community_invitation_credential_invitation_fkey:f",
    "community_invitation_credential_invitation_id_key:u",
    "community_invitation_credential_pkey:p",
    "community_invitation_credential_terminal_check:c",
    "community_invitation_credential_time_check:c",
    "community_invitation_pkey:p",
    "community_invitation_revision_check:c",
    "community_invitation_sponsor_fkey:f",
    "community_invitation_status_check:c",
    "community_invitation_status_shape_check:c",
    "community_invitation_target_check:c",
    "community_invitation_time_check:c",
    "community_membership_active_principal_fkey:f",
    "community_membership_admission_invitation_fkey:f",
    "community_membership_admission_invitation_id_key:u",
    "community_membership_origin_shape_check:c",
    "community_membership_pkey:p",
    "community_membership_principal_shape_check:c",
    "community_membership_revision_check:c",
    "community_membership_sponsor_fkey:f",
    "community_membership_status_check:c",
    "community_membership_time_check:c",
    "completed_game_detached_alias_game_alias_key:u",
    "completed_game_detached_alias_pkey:p",
    "completed_game_detached_alias_shape_check:c",
    "completed_game_detached_alias_subject_ref_check:c",
    "completed_game_detached_alias_version_check:c",
    "day_event_auto_seed_check:c",
    "day_event_definition_check:c",
    "day_event_lock_observation_check:c",
    "day_event_narrative_channel_check:c",
    "day_event_narrative_delivery_check:c",
    "day_event_narrative_event_fkey:f",
    "day_event_narrative_lifecycle_check:c",
    "day_event_narrative_pkey:p",
    "day_event_narrative_rendered_private_kid_fkey:f",
    "day_event_narrative_rendered_private_kid_shape:c",
    "day_event_narrative_rendered_storage_check:c",
    "day_event_narrative_status_check:c",
    "day_event_narrative_template_hash_check:c",
    "day_event_narrative_template_private_kid_fkey:f",
    "day_event_narrative_template_private_kid_shape:c",
    "day_event_narrative_template_storage_check:c",
    "day_event_open_observation_check:c",
    "day_event_participation_event_fkey:f",
    "day_event_participation_payload_check:c",
    "day_event_participation_pkey:p",
    "day_event_pkey:p",
    "day_event_resolution_evidence_check:c",
    "day_event_reward_keys_check:c",
    "day_event_schedule_work_pkey:p",
    "day_event_schedule_work_updated_check:c",
    "day_event_schedule_work_wake_check:c",
    "day_event_scheduler_state_attempt_check:c",
    "day_event_scheduler_state_failure_check:c",
    "day_event_scheduler_state_lease_check:c",
    "day_event_scheduler_state_pkey:p",
    "day_event_scheduler_state_wake_check:c",
    "day_event_state_check:c",
    "day_event_winner_slots_check:c",
    "day_program_content_hash_check:c",
    "day_program_display_name_check:c",
    "day_program_document_check:c",
    "day_program_pkey:p",
    "day_program_version_check:c",
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
    "engine_snapshot_checkpoint_pkey:p",
    "event_direct_key_sentinel_ciphertext_check:c",
    "event_direct_key_sentinel_kid_check:c",
    "event_direct_key_sentinel_lifecycle_check:c",
    "event_direct_key_sentinel_nonce_check:c",
    "event_direct_key_sentinel_pkey:p",
    "event_direct_key_sentinel_retirement_target_fk:f",
    "event_direct_key_sentinel_retirement_target_kid_check:c",
    "event_direct_key_sentinel_version_check:c",
    "event_stream_key_state_active_epoch_check:c",
    "event_stream_key_state_pkey:p",
    "event_stream_key_state_stream_id_active_epoch_fkey:f",
    "event_stream_keys_key_epoch_check:c",
    "event_stream_keys_pkey:p",
    "event_stream_keys_wrap_kid_check:c",
    "event_stream_keys_wrap_kid_fkey:f",
    "event_stream_keys_wrap_nonce_check:c",
    "event_stream_keys_wrap_version_check:c",
    "event_stream_keys_wrapped_dek_check:c",
    "events_pkey:p",
    "events_sealed_body_shape:c",
    "events_stream_key_epoch_fk:f",
    "events_stream_seq_unique:u",
    "external_identity_method_id_fkey:f",
    "external_identity_method_id_key:u",
    "external_identity_method_identity_fkey:f",
    "external_identity_method_subject_key:u",
    "external_identity_pkey:p",
    "external_identity_principal_id_fkey:f",
    "external_identity_provider_check:c",
    "external_identity_seen_check:c",
    "external_identity_subject_check:c",
    "game_authority_pkey:p",
    "game_cohost_policy_pkey:p",
    "game_index_pack_artifact_fkey:f",
    "game_index_pack_content_hash_check:c",
    "game_index_pack_key_check:c",
    "game_index_pack_version_check:c",
    "game_index_pkey:p",
    "game_index_status_check:c",
    "game_invitation_account_id_fkey:f",
    "game_invitation_pkey:p",
    "game_persona_name_claim_persona_fkey:f",
    "game_persona_name_claim_pkey:p",
    "game_persona_name_history_persona_fkey:f",
    "game_persona_name_history_pkey:p",
    "game_persona_pkey:p",
    "game_persona_public_persona_fkey:f",
    "game_persona_public_pkey:p",
    "game_persona_redaction_persona_fkey:f",
    "game_persona_redaction_pkey:p",
    "game_persona_subject_binding_claim_subject_fkey:f",
    "game_persona_subject_binding_lifecycle_check:c",
    "game_persona_subject_binding_persona_fkey:f",
    "game_persona_subject_binding_pkey:p",
    "game_persona_subject_binding_subject_fkey:f",
    "game_private_citation_pkey:p",
    "game_result_pkey:p",
    "game_thread_visibility_change_pkey:p",
    "game_thread_visibility_change_visibility_check:c",
    "host_phase_control_pkey:p",
    "host_prompt_pkey:p",
    "identity_lifecycle_audit_pkey:p",
    "investigation_memory_pkey:p",
    "investigation_memory_result_private_kid_fkey:f",
    "investigation_memory_result_private_kid_present:c",
    "media_upload_ledger_encoded_bytes_check:c",
    "media_upload_ledger_pkey:p",
    "media_upload_ledger_principal_id_fkey:f",
    "member_inbox_cursor_pkey:p",
    "member_inbox_cursor_read_through_seq_check:c",
    "member_inbox_item_pkey:p",
    "member_inbox_item_reason_check:c",
    "member_lifecycle_event_kind_check:c",
    "member_lifecycle_event_pkey:p",
    "member_lifecycle_event_principal_id_fkey:f",
    "member_lifecycle_event_seq_check:c",
    "member_lifecycle_event_subject_id_fkey:f",
    "member_lifecycle_projection_pkey:p",
    "member_lifecycle_projection_principal_id_fkey:f",
    "member_lifecycle_projection_seq_check:c",
    "member_lifecycle_projection_status_check:c",
    "member_lifecycle_projection_subject_id_fkey:f",
    "member_personal_export_envelope_shape:c",
    "member_personal_export_expiry_check:c",
    "member_personal_export_pkey:p",
    "member_personal_export_principal_id_fkey:f",
    "member_personal_export_seq_check:c",
    "member_personal_export_subject_id_fkey:f",
    "member_profile_active_principal_id_fkey:f",
    "member_profile_active_principal_id_key:u",
    "member_profile_active_redacted_shape_check:c",
    "member_profile_current_claim_id_fkey:f",
    "member_profile_handle_hmac_key:u",
    "member_profile_lifecycle_check:c",
    "member_profile_pkey:p",
    "member_profile_subject_id_fkey:f",
    "member_profile_subject_id_key:u",
    "membership_ancestry_ancestor_fkey:f",
    "membership_ancestry_depth_check:c",
    "membership_ancestry_descendant_fkey:f",
    "membership_ancestry_pkey:p",
    "membership_ancestry_self_shape_check:c",
    "moderation_case_history_case_id_fkey:f",
    "moderation_case_history_pkey:p",
    "moderation_case_pkey:p",
    "moderation_case_report_count_check:c",
    "moderation_case_status_check:c",
    "moderation_case_target_key:u",
    "moderation_report_case_id_fkey:f",
    "moderation_report_pkey:p",
    "moderation_report_reason_family_check:c",
    "moderation_target_state_pkey:p",
    "moderation_target_state_visibility_check:c",
    "pack_artifact_content_hash_check:c",
    "pack_artifact_document_check:c",
    "pack_artifact_identity_key:u",
    "pack_artifact_key_check:c",
    "pack_artifact_pkey:p",
    "pack_artifact_schema_version_check:c",
    "pack_artifact_version_check:c",
    "phase_state_pkey:p",
    "platform_principal_disabled_shape_check:c",
    "platform_principal_pkey:p",
    "platform_principal_status_check:c",
    "player_info_result_pkey:p",
    "player_info_result_private_kid_fkey:f",
    "player_info_result_private_kid_present:c",
    "player_investigation_result_pkey:p",
    "player_investigation_result_private_kid_fkey:f",
    "player_investigation_result_private_kid_present:c",
    "player_notification_pkey:p",
    "post_policy_pkey:p",
    "privacy_subject_exact_owner_unique:u",
    "privacy_subject_lifecycle_state_check:c",
    "privacy_subject_pkey:p",
    "privacy_subject_principal_id_fkey:f",
    "privacy_subject_principal_id_key:u",
    "private_channel_member_pkey:p",
    "private_channel_member_private_kid_fkey:f",
    "private_channel_member_private_kid_present:c",
    "profile_mute_member_target_key:u",
    "profile_mute_pkey:p",
    "profile_mute_target_profile_id_fkey:f",
    "profile_mute_version_check:c",
    "public_citation_pkey:p",
    "public_citation_quoted_fkey:f",
    "public_citation_quoting_fkey:f",
    "public_profile_handle_key:u",
    "public_profile_pkey:p",
    "public_profile_profile_id_fkey:f",
    "public_publication_pkey:p",
    "public_publication_surface_id_fkey:f",
    "public_search_document_pkey:p",
    "public_search_document_shape_check:c",
    "public_search_document_surface_id_fkey:f",
    "public_search_document_type_check:c",
    "public_watch_member_target_key:u",
    "public_watch_period_bounds_check:c",
    "public_watch_period_pkey:p",
    "public_watch_period_subscription_id_fkey:f",
    "public_watch_pkey:p",
    "public_watch_read_through_seq_check:c",
    "publication_surface_pkey:p",
    "publication_surface_search_group_check:c",
    "sheriff_badge_pkey:p",
    "slot_effect_pkey:p",
    "slot_mention_notification_pkey:p",
    "slot_occupancy_epoch_persona_fkey:f",
    "slot_occupancy_epoch_pkey:p",
    "slot_state_pkey:p",
    "slot_state_private_kid_fkey:f",
    "slot_state_private_kid_shape:c",
    "slot_status_tag_pkey:p",
    "spectator_membership_pkey:p",
    "subject_authority_binding_manifest_check:c",
    "subject_authority_binding_pkey:p",
    "subject_authority_binding_revision_check:c",
    "subject_authority_binding_singleton_check:c",
    "subject_erasure_attempt_count_check:c",
    "subject_erasure_claim_shape_check:c",
    "subject_erasure_completion_shape_check:c",
    "subject_erasure_erasure_id_fkey:f",
    "subject_erasure_outbox_alias_check:c",
    "subject_erasure_outbox_authority_check:c",
    "subject_erasure_outbox_exact_owner_fkey:f",
    "subject_erasure_outbox_fingerprint_check:c",
    "subject_erasure_outbox_payload_version_check:c",
    "subject_erasure_outbox_pkey:p",
    "subject_erasure_outbox_principal_id_key:u",
    "subject_erasure_outbox_receipt_id_key:u",
    "subject_erasure_outbox_replacement_alias_key:u",
    "subject_erasure_outbox_subject_id_key:u",
    "subject_erasure_pkey:p",
    "subject_erasure_state_check:c",
    "subject_key_destruction_receipt_erasure_id_fkey:f",
    "subject_key_destruction_receipt_erasure_id_key:u",
    "subject_key_destruction_receipt_fingerprint_check:c",
    "subject_key_destruction_receipt_pkey:p",
    "subject_key_destruction_receipt_subject_id_fkey:f",
    "subject_key_destruction_receipt_subject_id_key:u",
    "subject_private_claim_id_subject_key:u",
    "subject_private_claim_kind_check:c",
    "subject_private_claim_pkey:p",
    "subject_private_claim_scope_check:c",
    "subject_private_claim_subject_id_fkey:f",
    "subject_tombstone_alias_check:c",
    "subject_tombstone_pkey:p",
    "subject_tombstone_replacement_alias_key:u",
    "subject_tombstone_subject_id_fkey:f",
    "thread_view_author_shape:c",
    "thread_view_body_private_kid_fkey:f",
    "thread_view_body_private_kid_shape:c",
    "thread_view_body_storage:c",
    "thread_view_pkey:p",
    "visit_history_pkey:p",
    "vote_ballot_pkey:p",
    "workos_provider_session_external_identity_fkey:f",
    "workos_provider_session_id_check:c",
    "workos_provider_session_identity_key:u",
    "workos_provider_session_logout_shape_check:c",
    "workos_provider_session_method_identity_fkey:f",
    "workos_provider_session_pkey:p",
    "workos_provider_session_principal_fkey:f",
    "workos_provider_session_status_check:c",
    "workos_provider_session_subject_check:c",
    "workos_provider_session_time_check:c",
    "workos_provider_session_tombstone_hash_check:c",
    "workos_provider_session_tombstone_pkey:p",
    "workos_provider_session_tombstone_reason_check:c",
    "workos_session_exchange_assertion_hash_check:c",
    "workos_session_exchange_expiry_check:c",
    "workos_session_exchange_linking_session_fkey:f",
    "workos_session_exchange_linking_session_hash_check:c",
    "workos_session_exchange_pkey:p",
    "workos_session_exchange_provider_session_fkey:f",
    "workos_session_exchange_provider_session_id_check:c",
    "workos_signing_key_tombstone_key_shape_check:c",
    "workos_signing_key_tombstone_pkey:p",
    "workos_signing_key_tombstone_reason_check:c",
    "workos_signing_key_tombstone_retired_by_principal_id_fkey:f",
    "workos_subject_tombstone_hash_check:c",
    "workos_subject_tombstone_pkey:p",
    "workos_subject_tombstone_reason_check:c",
];

const EXPECTED_NOT_VALID_CONSTRAINTS: &[&str] = &["event_stream_keys_wrap_kid_fkey"];

fn assert_inventory(kind: &str, actual: &[String], expected: &[&str]) {
    let actual: Vec<&str> = actual.iter().map(String::as_str).collect();
    assert_eq!(actual, expected, "{kind} inventory drifted");
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn erasure_support_indexes_have_exact_catalog_definitions(pool: PgPool) {
    let definitions: Vec<String> = sqlx::query_scalar(
        "SELECT indexname || ':' || indexdef \
         FROM pg_indexes \
         WHERE schemaname = 'public' \
           AND indexname IN ( \
               'auth_delivery_intent_principal_idx', \
               'auth_session_principal_idx', \
               'auth_websocket_ticket_session_idx', \
               'game_persona_subject_binding_erasure_idx', \
               'identity_lifecycle_audit_actor_idx', \
               'member_lifecycle_event_subject_idx', \
               'member_lifecycle_projection_subject_idx', \
               'member_personal_export_subject_idx' \
           ) \
         ORDER BY indexname",
    )
    .fetch_all(&pool)
    .await
    .expect("read erasure support index definitions");
    assert_inventory(
        "erasure support index definition",
        &definitions,
        EXPECTED_ERASURE_INDEX_DEFINITIONS,
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn public_search_uses_a_stored_weighted_vector_and_visible_gin_index(pool: PgPool) {
    let expression: String = sqlx::query_scalar(
        "SELECT generation_expression \
         FROM information_schema.columns \
         WHERE table_schema = 'public' \
           AND table_name = 'public_search_document' \
           AND column_name = 'search_vector'",
    )
    .fetch_one(&pool)
    .await
    .expect("read public search vector generation expression");
    assert_eq!(expression, EXPECTED_PUBLIC_SEARCH_VECTOR_EXPRESSION);

    let index_definitions: Vec<String> = sqlx::query_scalar(
        "SELECT indexname || ':' || indexdef \
         FROM pg_indexes \
         WHERE schemaname = 'public' AND indexname = 'public_search_document_vector_idx' \
         ORDER BY indexname",
    )
    .fetch_all(&pool)
    .await
    .expect("read public search index definition");
    assert_inventory(
        "public search index definition",
        &index_definitions,
        EXPECTED_PUBLIC_SEARCH_INDEX_DEFINITIONS,
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn public_search_plan_uses_the_visible_gin_index(pool: PgPool) {
    let surface_id = Uuid::from_u128(1);
    sqlx::query(
        "INSERT INTO publication_surface \
         (surface_id, search_group, title, href, visible, updated_seq) \
         VALUES ($1, 'discussions', 'Zebra Theory', '/discussions/theory/t/1', TRUE, 1)",
    )
    .bind(surface_id)
    .execute(&pool)
    .await
    .expect("insert search plan surface");
    sqlx::query(
        "INSERT INTO public_search_document \
         (surface_id, document_type, source_seq, title_text, body, href, published_at, updated_seq, visible) \
         VALUES ($1, 'discussion', 0, 'Zebra Theory', 'quokka body', '/discussions/theory/t/1', 1, 1, TRUE)",
    )
    .bind(surface_id)
    .execute(&pool)
    .await
    .expect("insert search plan publication");

    let mut tx = pool.begin().await.expect("begin search plan explain");
    sqlx::query("SET LOCAL enable_seqscan = off")
        .execute(&mut *tx)
        .await
        .expect("disable sequential scans for the search plan");
    let explain_sql = format!("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {PUBLIC_SEARCH_SQL}");
    let row = sqlx::query(sqlx::AssertSqlSafe(explain_sql.as_str()))
        .bind("zebra")
        .bind("all")
        .bind(Option::<Uuid>::None)
        .bind(Option::<i64>::None)
        .bind(Option::<i64>::None)
        .bind(Option::<&str>::None)
        .bind(Option::<&str>::None)
        .bind(2_i64)
        .fetch_one(&mut *tx)
        .await
        .expect("explain public search");
    let plan: serde_json::Value = row.try_get(0).expect("read public search plan json");
    tx.rollback().await.expect("rollback search plan explain");

    let mut index_names = Vec::new();
    collect_plan_index_names(&plan, &mut index_names);
    assert!(
        index_names
            .iter()
            .any(|name| name == "public_search_document_vector_idx"),
        "public search must reach public_search_document_vector_idx, found {index_names:?} in {plan}"
    );
    assert!(
        !plan_has_cte_scan(&plan, "search_query"),
        "search_query must be inlined with NOT MATERIALIZED so the tsquery can fold into the GIN predicate, plan was {plan}"
    );
}

fn plan_has_cte_scan(value: &serde_json::Value, cte_name: &str) -> bool {
    match value {
        serde_json::Value::Array(values) => values
            .iter()
            .any(|value| plan_has_cte_scan(value, cte_name)),
        serde_json::Value::Object(values) => {
            let is_named_cte_scan = values.get("Node Type").and_then(|value| value.as_str())
                == Some("CTE Scan")
                && values.get("CTE Name").and_then(|value| value.as_str()) == Some(cte_name);
            is_named_cte_scan
                || values
                    .values()
                    .any(|value| plan_has_cte_scan(value, cte_name))
        }
        _ => false,
    }
}

fn collect_plan_index_names(value: &serde_json::Value, index_names: &mut Vec<String>) {
    match value {
        serde_json::Value::Array(values) => {
            for value in values {
                collect_plan_index_names(value, index_names);
            }
        }
        serde_json::Value::Object(values) => {
            if let Some(name) = values.get("Index Name").and_then(|value| value.as_str()) {
                index_names.push(name.to_string());
            }
            for value in values.values() {
                collect_plan_index_names(value, index_names);
            }
        }
        _ => {}
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn canonical_authority_principal_columns_are_uuid(pool: PgPool) {
    let columns: Vec<String> = sqlx::query_scalar(
        "SELECT table_name || '.' || column_name || ':' || data_type \
         FROM information_schema.columns \
         WHERE table_schema = 'public' \
           AND (table_name, column_name) IN ( \
               ('auth_account', 'principal_id'), \
               ('auth_delivery_intent', 'principal_id'), \
               ('game_invitation', 'principal_id'), \
               ('game_invitation', 'invited_by_principal_id'), \
               ('auth_session', 'principal_id'), \
               ('authentication_method', 'principal_id'), \
               ('command_receipt', 'principal_id'), \
               ('community_membership', 'active_principal_id'), \
               ('external_identity', 'principal_id'), \
               ('game_authority', 'principal_id'), \
               ('identity_lifecycle_audit', 'actor_principal_id'), \
               ('identity_lifecycle_audit', 'principal_id'), \
               ('media_upload_ledger', 'principal_id'), \
               ('member_inbox_cursor', 'principal_id'), \
               ('member_inbox_item', 'principal_id'), \
               ('member_lifecycle_event', 'principal_id'), \
               ('member_lifecycle_projection', 'principal_id'), \
               ('member_personal_export', 'principal_id'), \
               ('member_profile', 'active_principal_id'), \
               ('moderation_case_history', 'actor_principal_id'), \
               ('moderation_report', 'reporter_principal_id'), \
               ('moderation_target_state', 'moderator_principal_id'), \
               ('platform_principal', 'principal_id'), \
               ('privacy_subject', 'principal_id'), \
               ('profile_mute', 'principal_id'), \
               ('public_watch', 'principal_id'), \
               ('spectator_membership', 'principal_id'), \
               ('subject_erasure_outbox', 'principal_id'), \
               ('workos_provider_session', 'principal_id'), \
               ('workos_signing_key_tombstone', 'retired_by_principal_id') \
           ) \
         ORDER BY table_name, ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .expect("read canonical authority principal column types");
    assert_inventory(
        "canonical authority principal column",
        &columns,
        EXPECTED_CANONICAL_PRINCIPAL_COLUMNS,
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn migrated_projection_schema_has_exact_catalog_inventory(pool: PgPool) {
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

    let erasure_index_definitions: Vec<String> = sqlx::query_scalar(
        "SELECT indexname || ':' || indexdef \
         FROM pg_indexes \
         WHERE schemaname = 'public' \
           AND indexname IN ( \
               'auth_delivery_intent_principal_idx', \
               'auth_session_principal_idx', \
               'auth_websocket_ticket_session_idx', \
               'game_persona_subject_binding_erasure_idx', \
               'identity_lifecycle_audit_actor_idx', \
               'member_lifecycle_event_subject_idx', \
               'member_lifecycle_projection_subject_idx', \
               'member_personal_export_subject_idx' \
           ) \
         ORDER BY indexname",
    )
    .fetch_all(&pool)
    .await
    .expect("read erasure support index definitions");
    assert_inventory(
        "erasure support index definition",
        &erasure_index_definitions,
        EXPECTED_ERASURE_INDEX_DEFINITIONS,
    );

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

    let mute_target_table: String = sqlx::query_scalar(
        "SELECT target_relation.relname \
         FROM pg_constraint AS constraint_row \
         JOIN pg_class AS target_relation ON target_relation.oid = constraint_row.confrelid \
         WHERE constraint_row.conname = 'profile_mute_target_profile_id_fkey'",
    )
    .fetch_one(&pool)
    .await
    .expect("read profile mute target relation");
    assert_eq!(mute_target_table, "member_profile");
    let mute_target_delete_action: String = sqlx::query_scalar(
        "SELECT confdeltype::text \
         FROM pg_constraint \
         WHERE conname = 'profile_mute_target_profile_id_fkey'",
    )
    .fetch_one(&pool)
    .await
    .expect("read profile mute target delete action");
    assert_eq!(mute_target_delete_action, "r");

    let not_valid_constraints: Vec<String> = sqlx::query_scalar(
        "SELECT constraint_row.conname \
         FROM pg_constraint AS constraint_row \
         JOIN pg_namespace AS namespace_row \
           ON namespace_row.oid = constraint_row.connamespace \
         WHERE namespace_row.nspname = 'public' \
           AND NOT constraint_row.convalidated \
         ORDER BY constraint_row.conname",
    )
    .fetch_all(&pool)
    .await
    .expect("read deliberate NOT VALID constraint inventory");
    assert_inventory(
        "NOT VALID constraint",
        &not_valid_constraints,
        EXPECTED_NOT_VALID_CONSTRAINTS,
    );

    let auth_session_columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name || ':' || data_type \
         FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = 'auth_session' \
         ORDER BY ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .expect("read auth session column inventory");
    assert_inventory(
        "auth session column",
        &auth_session_columns,
        EXPECTED_AUTH_SESSION_COLUMNS,
    );

    let workos_provider_session_columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name || ':' || data_type \
         FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = 'workos_provider_session' \
         ORDER BY ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .expect("read WorkOS provider session column inventory");
    assert_inventory(
        "WorkOS provider session column",
        &workos_provider_session_columns,
        EXPECTED_WORKOS_PROVIDER_SESSION_COLUMNS,
    );

    let workos_provider_tombstone_columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name || ':' || data_type \
         FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = 'workos_provider_session_tombstone' \
         ORDER BY ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .expect("read WorkOS provider tombstone column inventory");
    assert_inventory(
        "WorkOS provider tombstone column",
        &workos_provider_tombstone_columns,
        EXPECTED_WORKOS_PROVIDER_SESSION_TOMBSTONE_COLUMNS,
    );

    let workos_subject_tombstone_columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name || ':' || data_type \
         FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = 'workos_subject_tombstone' \
         ORDER BY ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .expect("read WorkOS subject tombstone column inventory");
    assert_inventory(
        "WorkOS subject tombstone column",
        &workos_subject_tombstone_columns,
        EXPECTED_WORKOS_SUBJECT_TOMBSTONE_COLUMNS,
    );

    let workos_exchange_columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name || ':' || data_type \
         FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = 'workos_session_exchange' \
         ORDER BY ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .expect("read WorkOS exchange column inventory");
    assert_inventory(
        "WorkOS exchange column",
        &workos_exchange_columns,
        EXPECTED_WORKOS_SESSION_EXCHANGE_COLUMNS,
    );

    let event_columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name || ':' || data_type \
         FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = 'events' \
         ORDER BY ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .expect("read event storage column inventory");
    assert_inventory("event column", &event_columns, EXPECTED_EVENT_COLUMNS);

    let game_index_columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name || ':' || data_type \
         FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = 'game_index' \
         ORDER BY ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .expect("read game index column inventory");
    assert_inventory(
        "game index column",
        &game_index_columns,
        EXPECTED_GAME_INDEX_COLUMNS,
    );

    let pack_artifact_columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name || ':' || data_type \
         FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = 'pack_artifact' \
         ORDER BY ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .expect("read pack artifact custody column inventory");
    assert_inventory(
        "pack artifact column",
        &pack_artifact_columns,
        EXPECTED_PACK_ARTIFACT_COLUMNS,
    );

    let member_profile_columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name || ':' || data_type \
         FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = 'member_profile' \
         ORDER BY ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .expect("read member profile column inventory");
    assert_inventory(
        "member profile column",
        &member_profile_columns,
        EXPECTED_MEMBER_PROFILE_COLUMNS,
    );

    let public_profile_columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name || ':' || data_type \
         FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = 'public_profile' \
         ORDER BY ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .expect("read public profile column inventory");
    assert_inventory(
        "public profile column",
        &public_profile_columns,
        EXPECTED_PUBLIC_PROFILE_COLUMNS,
    );

    let profile_mute_columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name || ':' || data_type \
         FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = 'profile_mute' \
         ORDER BY ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .expect("read profile mute column inventory");
    assert_inventory(
        "profile mute column",
        &profile_mute_columns,
        EXPECTED_PROFILE_MUTE_COLUMNS,
    );

    let lifecycle_audit_columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name || ':' || data_type \
         FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = 'identity_lifecycle_audit' \
         ORDER BY ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .expect("read identity lifecycle audit column inventory");
    assert_inventory(
        "identity lifecycle audit column",
        &lifecycle_audit_columns,
        EXPECTED_IDENTITY_LIFECYCLE_AUDIT_COLUMNS,
    );

    let lifecycle_audit_redaction_columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name || ':' || data_type || ':' || is_nullable \
         FROM information_schema.columns \
         WHERE table_schema = 'public' \
           AND table_name = 'identity_lifecycle_audit' \
           AND column_name IN ( \
               'actor_principal_id', \
               'principal_id', \
               'redacted_actor_alias', \
               'redacted_principal_alias' \
           ) \
         ORDER BY ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .expect("read identity lifecycle audit redaction column contract");
    assert_inventory(
        "identity lifecycle audit redaction column",
        &lifecycle_audit_redaction_columns,
        EXPECTED_IDENTITY_LIFECYCLE_AUDIT_REDACTION_COLUMNS,
    );
}

fn assert_foreign_key_violation(error: sqlx::Error, constraint: &str) {
    assert_database_constraint(error, "23503", constraint);
}

fn assert_database_constraint(error: sqlx::Error, code: &str, constraint: &str) {
    let database_error = error
        .as_database_error()
        .expect("constraint rejection must be a database error");
    assert_eq!(database_error.code().as_deref(), Some(code));
    assert_eq!(database_error.constraint(), Some(constraint));
}

async fn insert_runtime_kek_sentinel(pool: &PgPool, kid: &str) {
    sqlx::query(
        "INSERT INTO event_direct_key_sentinel \
         (kid, sentinel_version, sentinel_nonce, sentinel_ciphertext) \
         VALUES ($1, 1, decode(repeat('01', 24), 'hex'), decode(repeat('02', 56), 'hex'))",
    )
    .bind(kid)
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn runtime_kek_catalog_fences_raw_stream_wraps_and_direct_envelopes(pool: PgPool) {
    insert_runtime_kek_sentinel(&pool, "old-v1").await;
    insert_runtime_kek_sentinel(&pool, "new-v2").await;
    insert_runtime_kek_sentinel(&pool, "other-v3").await;

    let malformed = sqlx::query(
        "INSERT INTO event_direct_key_sentinel \
         (kid, sentinel_version, sentinel_nonce, sentinel_ciphertext) \
         VALUES ('-bad-kid', 1, decode(repeat('01', 24), 'hex'), decode(repeat('02', 56), 'hex'))",
    )
    .execute(&pool)
    .await
    .expect_err("KIDs outside the restricted alphabet must be rejected");
    let malformed = malformed.as_database_error().unwrap();
    assert_eq!(malformed.code().as_deref(), Some("23514"));
    let stream_wrap_fk_validated: bool = sqlx::query_scalar(
        "SELECT convalidated FROM pg_constraint \
         WHERE conname = 'event_stream_keys_wrap_kid_fkey'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        !stream_wrap_fk_validated,
        "the mirrored legacy stream-wrap FK must remain NOT VALID"
    );

    let stream = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO event_stream_keys \
         (stream_id, key_epoch, wrap_version, wrap_kid, wrap_nonce, wrapped_dek) \
         VALUES ($1, 1, 1, 'old-v1', decode(repeat('03', 24), 'hex'), decode(repeat('04', 48), 'hex'))",
    )
    .bind(stream)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO slot_state (game_id, slot_id, private) \
         VALUES ($1, 'slot_1', '{\"kid\":\"old-v1\"}'::jsonb)",
    )
    .bind(stream)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "UPDATE event_direct_key_sentinel \
         SET lifecycle = 'retiring', retirement_target_kid = 'new-v2', \
             retirement_started_at = clock_timestamp() \
         WHERE kid = 'old-v1'",
    )
    .execute(&pool)
    .await
    .unwrap();

    let stale_wrap = sqlx::query(
        "UPDATE event_stream_keys SET wrapped_dek = decode(repeat('05', 48), 'hex') \
         WHERE stream_id = $1 AND key_epoch = 1",
    )
    .bind(stream)
    .execute(&pool)
    .await
    .expect_err("a retiring KID must reject raw stream-wrap replacement");
    assert!(stale_wrap
        .to_string()
        .contains("not writable for an event stream-key wrap"));

    let stale_direct = sqlx::query(
        "INSERT INTO slot_state (game_id, slot_id, private) \
         VALUES ($1, 'slot_2', '{\"kid\":\"old-v1\"}'::jsonb)",
    )
    .bind(stream)
    .execute(&pool)
    .await
    .expect_err("a retiring KID must reject raw direct-envelope insertion");
    assert!(stale_direct
        .to_string()
        .contains("not writable for direct envelope"));

    let parallel_rotation = sqlx::query(
        "UPDATE event_direct_key_sentinel \
         SET lifecycle = 'retiring', retirement_target_kid = 'new-v2', \
             retirement_started_at = clock_timestamp() \
         WHERE kid = 'other-v3'",
    )
    .execute(&pool)
    .await
    .expect_err("only one runtime KEK rotation may be in flight");
    assert!(parallel_rotation
        .to_string()
        .contains("another runtime KEK rotation is already in flight"));

    let references: Vec<(String, String)> =
        sqlx::query_as("SELECT surface, kid FROM event_direct_key_reference ORDER BY surface, kid")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        references,
        vec![("slot_state.private".to_string(), "old-v1".to_string())]
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn stream_wrap_share_lock_closes_the_retirement_race(pool: PgPool) {
    insert_runtime_kek_sentinel(&pool, "old-v1").await;
    insert_runtime_kek_sentinel(&pool, "new-v2").await;
    let stream = Uuid::new_v4();
    let mut writer = pool.begin().await.unwrap();
    sqlx::query(
        "INSERT INTO event_stream_keys \
         (stream_id, key_epoch, wrap_version, wrap_kid, wrap_nonce, wrapped_dek) \
         VALUES ($1, 1, 1, 'old-v1', decode(repeat('03', 24), 'hex'), decode(repeat('04', 48), 'hex'))",
    )
    .bind(stream)
    .execute(&mut *writer)
    .await
    .unwrap();

    let rotation_pool = pool.clone();
    let mut rotation = tokio::spawn(async move {
        sqlx::query(
            "UPDATE event_direct_key_sentinel \
             SET lifecycle = 'retiring', retirement_target_kid = 'new-v2', \
                 retirement_started_at = clock_timestamp() \
             WHERE kid = 'old-v1'",
        )
        .execute(&rotation_pool)
        .await
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut rotation)
            .await
            .is_err(),
        "retirement must wait for the in-flight writable-KID share lock"
    );
    writer.commit().await.unwrap();
    tokio::time::timeout(Duration::from_secs(2), rotation)
        .await
        .expect("retirement should resume after the wrap commits")
        .unwrap()
        .unwrap();

    let stale = sqlx::query(
        "INSERT INTO event_stream_keys \
         (stream_id, key_epoch, wrap_version, wrap_kid, wrap_nonce, wrapped_dek) \
         VALUES ($1, 2, 1, 'old-v1', decode(repeat('03', 24), 'hex'), decode(repeat('04', 48), 'hex'))",
    )
    .bind(stream)
    .execute(&pool)
    .await
    .expect_err("the stale writer must lose after the transition commits");
    assert!(stale
        .to_string()
        .contains("not writable for an event stream-key wrap"));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn lifecycle_advisory_lock_serializes_raw_rotation_starts(pool: PgPool) {
    insert_runtime_kek_sentinel(&pool, "source-a").await;
    insert_runtime_kek_sentinel(&pool, "source-b").await;
    insert_runtime_kek_sentinel(&pool, "target-v2").await;

    let mut first = pool.begin().await.unwrap();
    sqlx::query(
        "UPDATE event_direct_key_sentinel \
         SET lifecycle = 'retiring', retirement_target_kid = 'target-v2', \
             retirement_started_at = clock_timestamp() \
         WHERE kid = 'source-a'",
    )
    .execute(&mut *first)
    .await
    .unwrap();

    let second_pool = pool.clone();
    let mut second = tokio::spawn(async move {
        sqlx::query(
            "UPDATE event_direct_key_sentinel \
             SET lifecycle = 'retiring', retirement_target_kid = 'target-v2', \
                 retirement_started_at = clock_timestamp() \
             WHERE kid = 'source-b'",
        )
        .execute(&second_pool)
        .await
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut second)
            .await
            .is_err(),
        "a second raw rotation must wait on the database-wide transition lock"
    );
    first.commit().await.unwrap();
    let error = tokio::time::timeout(Duration::from_secs(2), second)
        .await
        .expect("the second rotation should resume after the first commits")
        .unwrap()
        .expect_err("one in-flight rotation must reject the second transition");
    assert!(error
        .to_string()
        .contains("another runtime KEK rotation is already in flight"));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn reseal_claim_indexes_match_each_skip_locked_order(pool: PgPool) {
    let definitions: Vec<(String, String)> = sqlx::query_as(
        "SELECT indexname, indexdef FROM pg_indexes \
         WHERE schemaname = 'public' AND indexname = ANY($1) ORDER BY indexname",
    )
    .bind(vec![
        "auth_delivery_intent_credential_envelope_kid_idx",
        "day_event_narrative_rendered_private_kid_idx",
        "day_event_narrative_template_private_kid_idx",
        "investigation_memory_result_private_kid_idx",
        "player_info_result_private_kid_idx",
        "player_investigation_result_private_kid_idx",
        "private_channel_member_private_kid_idx",
        "slot_state_private_kid_idx",
        "thread_view_body_private_kid_idx",
    ])
    .fetch_all(&pool)
    .await
    .unwrap();
    let expected = [
        (
            "auth_delivery_intent_credential_envelope_kid_idx",
            "(credential_envelope_kid, delivery_id)",
        ),
        (
            "day_event_narrative_rendered_private_kid_idx",
            "(rendered_body_private_kid, game_id, event_id, lifecycle)",
        ),
        (
            "day_event_narrative_template_private_kid_idx",
            "(body_template_private_kid, game_id, event_id, lifecycle)",
        ),
        (
            "investigation_memory_result_private_kid_idx",
            "(result_private_kid, game_id, investigator_slot, target_slot, mode)",
        ),
        (
            "player_info_result_private_kid_idx",
            "(result_private_kid, game_id, phase_id, event_index, audience_slot)",
        ),
        (
            "player_investigation_result_private_kid_idx",
            "(result_private_kid, game_id, phase_id, event_index, audience_slot)",
        ),
        (
            "private_channel_member_private_kid_idx",
            "(private_kid, game_id, channel_id, slot_id)",
        ),
        (
            "slot_state_private_kid_idx",
            "(private_kid, game_id, slot_id)",
        ),
        (
            "thread_view_body_private_kid_idx",
            "(body_private_kid, game_id, source_seq)",
        ),
    ];
    assert_eq!(definitions.len(), expected.len());
    for ((actual_name, definition), (expected_name, ordered_columns)) in
        definitions.iter().zip(expected)
    {
        assert_eq!(actual_name, expected_name);
        assert!(
            definition.contains(ordered_columns),
            "{actual_name} does not cover its lock order: {definition}"
        );
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn auth_sessions_require_a_live_platform_principal_owner(pool: PgPool) {
    let orphan_insert = sqlx::query(
        r#"
        INSERT INTO auth_session (
            token_hash,
            principal_id,
            created_at,
            expires_at,
            idle_expires_at,
            assurance,
            local_proof_instance_id,
            authenticated_at
        )
        VALUES (
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            '00000000-0000-4000-8000-000000000001',
            1,
            100,
            50,
            'dev',
            repeat('a', 64),
            1
        )
        "#,
    )
    .execute(&pool)
    .await
    .expect_err("an orphan session must be rejected");
    assert_foreign_key_violation(orphan_insert, "auth_session_principal_id_fkey");

    sqlx::query(
        "INSERT INTO platform_principal (principal_id, status, global_capabilities, created_at) VALUES ('00000000-0000-4000-8000-000000000002', 'active', '{}', 1)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO auth_session (
            token_hash,
            principal_id,
            created_at,
            expires_at,
            idle_expires_at,
            assurance,
            local_proof_instance_id,
            authenticated_at
        )
        VALUES (
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            '00000000-0000-4000-8000-000000000002',
            1,
            100,
            50,
            'dev',
            repeat('a', 64),
            1
        )
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let owner_delete =
        sqlx::query("DELETE FROM platform_principal WHERE principal_id = '00000000-0000-4000-8000-000000000002'")
            .execute(&pool)
            .await
            .expect_err("a referenced principal must not be deleted");
    assert_foreign_key_violation(owner_delete, "auth_session_principal_id_fkey");
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn member_profiles_enforce_exact_subject_owner_and_claim_provenance(pool: PgPool) {
    let owner_a = Uuid::new_v4();
    let owner_b = Uuid::new_v4();
    let redacted_owner = Uuid::new_v4();
    for principal_id in [owner_a, owner_b, redacted_owner] {
        sqlx::query(
            "INSERT INTO platform_principal (principal_id, status, global_capabilities, created_at) \
             VALUES ($1, 'active', '{}'::text[], 1)",
        )
        .bind(principal_id)
        .execute(&pool)
        .await
        .unwrap();
    }

    let subject_a = Uuid::new_v4();
    let subject_b = Uuid::new_v4();
    let redacted_subject = Uuid::new_v4();
    for (subject_id, principal_id) in [
        (subject_a, owner_a),
        (subject_b, owner_b),
        (redacted_subject, redacted_owner),
    ] {
        sqlx::query(
            "INSERT INTO privacy_subject (subject_id, principal_id, created_at) VALUES ($1, $2, 1)",
        )
        .bind(subject_id)
        .bind(principal_id)
        .execute(&pool)
        .await
        .unwrap();
    }

    let claim_a = Uuid::new_v4();
    let claim_b = Uuid::new_v4();
    for (claim_id, subject_id) in [(claim_a, subject_a), (claim_b, subject_b)] {
        sqlx::query(
            "INSERT INTO subject_private_claim \
             (claim_id, subject_id, claim_kind, scope_id, envelope, created_at) \
             VALUES ($1, $2, 'profile', $3, '{}'::jsonb, 1)",
        )
        .bind(claim_id)
        .bind(subject_id)
        .bind(Uuid::new_v4())
        .execute(&pool)
        .await
        .unwrap();
    }

    let wrong_owner = sqlx::query(
        "INSERT INTO member_profile \
         (profile_id, active_principal_id, handle_hmac, lifecycle, created_seq, updated_seq, revision, subject_id, current_claim_id) \
         VALUES ($1, $2, decode(repeat('01', 32), 'hex'), 'active', 1, 1, 1, $3, $4)",
    )
    .bind(Uuid::new_v4())
    .bind(owner_b)
    .bind(subject_a)
    .bind(claim_a)
    .execute(&pool)
    .await
    .expect_err("a profile principal must own its subject");
    assert_foreign_key_violation(wrong_owner, "member_profile_active_principal_id_fkey");

    let wrong_claim = sqlx::query(
        "INSERT INTO member_profile \
         (profile_id, active_principal_id, handle_hmac, lifecycle, created_seq, updated_seq, revision, subject_id, current_claim_id) \
         VALUES ($1, $2, decode(repeat('02', 32), 'hex'), 'active', 1, 1, 1, $3, $4)",
    )
    .bind(Uuid::new_v4())
    .bind(owner_a)
    .bind(subject_a)
    .bind(claim_b)
    .execute(&pool)
    .await
    .expect_err("a profile claim must belong to its subject");
    assert_foreign_key_violation(wrong_claim, "member_profile_current_claim_id_fkey");

    let profile_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO member_profile \
         (profile_id, active_principal_id, handle_hmac, lifecycle, created_seq, updated_seq, revision, subject_id, current_claim_id) \
         VALUES ($1, $2, decode(repeat('03', 32), 'hex'), 'active', 1, 1, 1, $3, $4)",
    )
    .bind(profile_id)
    .bind(owner_a)
    .bind(subject_a)
    .bind(claim_a)
    .execute(&pool)
    .await
    .unwrap();

    let resolved_owner: Uuid = sqlx::query_scalar(
        "SELECT subject.principal_id \
         FROM member_profile AS profile \
         JOIN privacy_subject AS subject \
           ON (subject.subject_id, subject.principal_id) = (profile.subject_id, profile.active_principal_id) \
         WHERE profile.profile_id = $1",
    )
    .bind(profile_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(resolved_owner, owner_a);

    sqlx::query(
        "INSERT INTO member_profile \
         (profile_id, active_principal_id, handle_hmac, lifecycle, redacted_alias, created_seq, updated_seq, revision, subject_id, current_claim_id) \
         VALUES ($1, NULL, NULL, 'redacted', 'former-member-ownership-proof', 1, 1, 1, $2, NULL)",
    )
    .bind(Uuid::new_v4())
    .bind(redacted_subject)
    .execute(&pool)
    .await
    .expect("redacted profiles may intentionally omit active owner and claim references");
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn workos_session_catalog_binds_provider_custody_and_replays_exact_assertions(pool: PgPool) {
    sqlx::query(
        "INSERT INTO platform_principal (principal_id, status, global_capabilities, created_at) VALUES ('00000000-0000-4000-8000-000000000004', 'active', '{}', 1)",
    )
    .execute(&pool)
    .await
    .unwrap();
    let method_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO authentication_method (method_id, principal_id, kind, status, created_at) VALUES ($1, '00000000-0000-4000-8000-000000000004', 'workos', 'active', 1)",
    )
    .bind(method_id)
    .execute(&pool)
    .await
    .unwrap();

    let missing_provider_session = sqlx::query(
        r#"
        INSERT INTO auth_session (
            token_hash, principal_id, created_at, expires_at,
            authenticated_via_method_id,
            idle_expires_at, assurance, authenticated_at,
            workos_signing_key_id
        )
        VALUES (repeat('a', 64), '00000000-0000-4000-8000-000000000004', 1, 100, $1, 50, 'external_sso', 1, 'test-workos-key')
        "#,
    )
    .bind(method_id)
    .execute(&pool)
    .await
    .expect_err("external SSO without provider-session custody must be rejected");
    assert_database_constraint(
        missing_provider_session,
        "23514",
        "auth_session_workos_session_shape_check",
    );

    let provider_session_on_other_assurance = sqlx::query(
        r#"
        INSERT INTO auth_session (
            token_hash, principal_id, created_at, expires_at,
            idle_expires_at, assurance,
            authenticated_at, workos_session_id, local_proof_instance_id
        )
        VALUES (
            repeat('b', 64), '00000000-0000-4000-8000-000000000004', 1, 100, 50,
            'dev', 1, 'session_01HQAG1HENBZMAZD82YRXDFC0B', repeat('a', 64)
        )
        "#,
    )
    .execute(&pool)
    .await
    .expect_err("non-WorkOS assurance must not carry a WorkOS sid");
    assert_database_constraint(
        provider_session_on_other_assurance,
        "23514",
        "auth_session_workos_session_shape_check",
    );

    sqlx::query(
        r#"
        INSERT INTO external_identity (
            provider, subject, principal_id, display_label,
            created_at, last_seen_at, method_id
        )
        VALUES (
            'workos', 'user_01HQAG1HENBZMAZD82YRXDFC0B', '00000000-0000-4000-8000-000000000004',
            NULL, 1, 1, $1
        )
        "#,
    )
    .bind(method_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO workos_provider_session (
            provider_session_id, subject, principal_id, method_id,
            status, created_at, last_seen_at, access_expires_at
        )
        VALUES (
            'session_01HQAG1HENBZMAZD82YRXDFC0B',
            'user_01HQAG1HENBZMAZD82YRXDFC0B',
            '00000000-0000-4000-8000-000000000004', $1, 'active', 1, 1, 100
        )
        "#,
    )
    .bind(method_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO auth_session (
            token_hash, principal_id, created_at, expires_at,
            authenticated_via_method_id,
            idle_expires_at, assurance, authenticated_at, workos_session_id,
            workos_signing_key_id
        )
        VALUES (
            repeat('c', 64), '00000000-0000-4000-8000-000000000004', 1, 100, $1, 50,
            'external_sso', 1, 'session_01HQAG1HENBZMAZD82YRXDFC0B', 'test-workos-key'
        )
        "#,
    )
    .bind(method_id)
    .execute(&pool)
    .await
    .unwrap();

    let stripped_provider_session = sqlx::query(
        "UPDATE auth_session SET workos_session_id = NULL WHERE token_hash = repeat('c', 64)",
    )
    .execute(&pool)
    .await
    .expect_err("an active WorkOS session must retain canonical provider custody");
    assert_database_constraint(
        stripped_provider_session,
        "23514",
        "auth_session_workos_session_shape_check",
    );

    let unbound_provider_session = sqlx::query(
        r#"
        INSERT INTO auth_session (
            token_hash, principal_id, created_at, expires_at,
            authenticated_via_method_id,
            idle_expires_at, assurance, authenticated_at, workos_session_id,
            workos_signing_key_id
        )
        VALUES (
            repeat('f', 64), '00000000-0000-4000-8000-000000000004', 1, 100, $1, 50,
            'external_sso', 1, 'session_01HQAG1HENBZMAZD82YRXDFC0C', 'test-workos-key'
        )
        "#,
    )
    .bind(method_id)
    .execute(&pool)
    .await
    .expect_err("new WorkOS sessions must bind to exact provider custody");
    assert_foreign_key_violation(
        unbound_provider_session,
        "auth_session_workos_provider_session_fkey",
    );

    let unbound_exchange = sqlx::query(
        r#"
        INSERT INTO workos_session_exchange (
            provider_session_id, access_token_hash,
            exchanged_at, access_expires_at
        )
        VALUES (
            'session_01HQAG1HENBZMAZD82YRXDFC0C', repeat('f', 64), 1, 100
        )
        "#,
    )
    .execute(&pool)
    .await
    .expect_err("new assertions must bind to provider-session custody");
    assert_foreign_key_violation(
        unbound_exchange,
        "workos_session_exchange_provider_session_fkey",
    );

    for assertion_hash in ["d", "e"] {
        sqlx::query(
            r#"
            INSERT INTO workos_session_exchange (
                provider_session_id, access_token_hash,
                exchanged_at, access_expires_at
            )
            VALUES (
                'session_01HQAG1HENBZMAZD82YRXDFC0B', repeat($1, 64), 1, 100
            )
            "#,
        )
        .bind(assertion_hash)
        .execute(&pool)
        .await
        .unwrap();
    }
    let exact_replay = sqlx::query(
        r#"
        INSERT INTO workos_session_exchange (
            provider_session_id, access_token_hash,
            exchanged_at, access_expires_at
        )
        VALUES (
            'session_01HQAG1HENBZMAZD82YRXDFC0B', repeat('d', 64), 2, 100
        )
        "#,
    )
    .execute(&pool)
    .await
    .expect_err("the exact assertion hash may be exchanged only once");
    assert_database_constraint(exact_replay, "23505", "workos_session_exchange_pkey");

    let distinct_assertions: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM workos_session_exchange WHERE provider_session_id = 'session_01HQAG1HENBZMAZD82YRXDFC0B'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(distinct_assertions, 2);

    sqlx::query(
        "UPDATE workos_provider_session SET last_seen_at = 2, access_expires_at = 101 WHERE provider_session_id = 'session_01HQAG1HENBZMAZD82YRXDFC0B'",
    )
    .execute(&pool)
    .await
    .expect("an active provider observation may advance monotonically");
    for (mutation, expected_message) in [
        (
            "UPDATE workos_provider_session SET subject = 'other-user' WHERE provider_session_id = 'session_01HQAG1HENBZMAZD82YRXDFC0B'",
            "identity is immutable",
        ),
        (
            "UPDATE workos_provider_session SET last_seen_at = 1 WHERE provider_session_id = 'session_01HQAG1HENBZMAZD82YRXDFC0B'",
            "observation must be monotonic",
        ),
    ] {
        let error = sqlx::query(mutation)
            .execute(&pool)
            .await
            .expect_err("raw provider-session mutation must be rejected");
        assert!(error.to_string().contains(expected_message), "{error}");
    }
    sqlx::query(
        "UPDATE workos_provider_session SET status = 'logged_out', logged_out_at = 2 WHERE provider_session_id = 'session_01HQAG1HENBZMAZD82YRXDFC0B'",
    )
    .execute(&pool)
    .await
    .expect("active provider session may become a terminal tombstone");
    let reactivation = sqlx::query(
        "UPDATE workos_provider_session SET status = 'active', logged_out_at = NULL WHERE provider_session_id = 'session_01HQAG1HENBZMAZD82YRXDFC0B'",
    )
    .execute(&pool)
    .await
    .expect_err("a provider-session tombstone must be terminal");
    assert!(reactivation.to_string().contains("logged-out"));
    let raw_delete = sqlx::query(
        "DELETE FROM workos_provider_session WHERE provider_session_id = 'session_01HQAG1HENBZMAZD82YRXDFC0B'",
    )
    .execute(&pool)
    .await
    .expect_err("provider-session custody deletion requires claimed erasure");
    assert!(raw_delete.to_string().contains("claimed subject erasure"));
    let truncate = sqlx::query("TRUNCATE workos_provider_session")
        .execute(&pool)
        .await
        .expect_err("provider-session custody must reject truncation");
    assert!(truncate.to_string().contains("cannot truncate"));

    let subject_id = Uuid::new_v4();
    let erasure_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO privacy_subject (subject_id, principal_id, created_at, lifecycle_state) VALUES ($1, '00000000-0000-4000-8000-000000000004', 1, 'erasure_pending')",
    )
    .bind(subject_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO subject_erasure_outbox (
            erasure_id, subject_id, principal_id, receipt_id,
            replacement_alias, key_fingerprint_sha256, requested_at
        )
        VALUES ($1, $2, '00000000-0000-4000-8000-000000000004', $3, 'erased-workos-owner', repeat('f', 64), 1)
        "#,
    )
    .bind(erasure_id)
    .bind(subject_id)
    .bind(Uuid::new_v4())
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO subject_erasure (
            erasure_id, state, claim_token, claim_owner,
            claim_expires_at, attempt_count, last_attempt_at
        )
        VALUES ($1, 'pending', $2, 'catalog-proof', 100, 1, 2)
        "#,
    )
    .bind(erasure_id)
    .bind(Uuid::new_v4())
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO workos_provider_session_tombstone (
            provider_session_hash, tombstoned_at, reason
        )
        VALUES (
            '12809d16e8a0869e08f32b449c05398bb6052a3905ea1d5d2506abe8ceb8755e',
            2,
            'subject_erasure'
        )
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    for mutation in [
        "UPDATE workos_provider_session_tombstone SET reason = 'logout'",
        "DELETE FROM workos_provider_session_tombstone",
        "TRUNCATE workos_provider_session_tombstone",
    ] {
        let error = sqlx::query(mutation)
            .execute(&pool)
            .await
            .expect_err("permanent sid fingerprints must be append-only");
        assert!(error.to_string().contains("append-only"), "{error}");
    }
    sqlx::query(
        r#"
        INSERT INTO workos_subject_tombstone (
            provider_subject_hash, tombstoned_at, reason
        )
        VALUES (repeat('a', 64), 2, 'subject_erasure')
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    for mutation in [
        "UPDATE workos_subject_tombstone SET tombstoned_at = 3",
        "DELETE FROM workos_subject_tombstone",
        "TRUNCATE workos_subject_tombstone",
    ] {
        let error = sqlx::query(mutation)
            .execute(&pool)
            .await
            .expect_err("permanent provider-subject fingerprints must be append-only");
        assert!(error.to_string().contains("append-only"), "{error}");
    }
    sqlx::query(
        "DELETE FROM workos_session_exchange WHERE provider_session_id = 'session_01HQAG1HENBZMAZD82YRXDFC0B'",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "DELETE FROM auth_session WHERE workos_session_id = 'session_01HQAG1HENBZMAZD82YRXDFC0B'",
    )
    .execute(&pool)
    .await
    .unwrap();
    let erased = sqlx::query(
        "DELETE FROM workos_provider_session WHERE provider_session_id = 'session_01HQAG1HENBZMAZD82YRXDFC0B'",
    )
    .execute(&pool)
    .await
    .expect("claimed subject erasure may remove provider-session custody");
    assert_eq!(erased.rows_affected(), 1);

    let sid_recreated = sqlx::query(
        r#"
        INSERT INTO workos_provider_session (
            provider_session_id, subject, principal_id, method_id,
            status, created_at, last_seen_at, access_expires_at
        )
        VALUES (
            'session_01HQAG1HENBZMAZD82YRXDFC0B',
            'user_01HQAG1HENBZMAZD82YRXDFC0B',
            '00000000-0000-4000-8000-000000000004', $1, 'active', 3, 3, 100
        )
        "#,
    )
    .bind(method_id)
    .execute(&pool)
    .await
    .expect_err("a permanently tombstoned provider sid cannot be recreated");
    assert!(sid_recreated.to_string().contains("tombstoned"));

    sqlx::query(
        r#"
        INSERT INTO workos_subject_tombstone (
            provider_subject_hash, tombstoned_at, reason
        )
        VALUES (
            encode(
                sha256(convert_to('user_01HQAG1HENBZMAZD82YRXDFC0B', 'UTF8')),
                'hex'
            ),
            3,
            'subject_erasure'
        )
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    let subject_recreated = sqlx::query(
        r#"
        INSERT INTO workos_provider_session (
            provider_session_id, subject, principal_id, method_id,
            status, created_at, last_seen_at, access_expires_at
        )
        VALUES (
            'session_01HQAG1HENBZMAZD82YRXDFC0C',
            'user_01HQAG1HENBZMAZD82YRXDFC0B',
            '00000000-0000-4000-8000-000000000004', $1, 'active', 3, 3, 100
        )
        "#,
    )
    .bind(method_id)
    .execute(&pool)
    .await
    .expect_err("an erased provider subject cannot return through an unseen sid");
    assert!(subject_recreated.to_string().contains("tombstoned"));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn schema_readiness_rejects_a_database_newer_than_the_binary(pool: PgPool) {
    database_schema::ensure_schema_ready(&pool)
        .await
        .expect("the exact embedded migration head must be ready");
    sqlx::query(
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (9223372036854775000, 'future destructive migration', TRUE, '\\x01'::bytea, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let error = database_schema::ensure_schema_ready(&pool)
        .await
        .expect_err("an older binary must refuse a database with an unknown migration");
    assert!(
        error
            .to_string()
            .contains("database schema is newer than this binary"),
        "unexpected readiness error: {error}"
    );
}
