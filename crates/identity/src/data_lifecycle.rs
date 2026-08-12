//! Pure member data-lifecycle write model (Wave 3 D10 substrate).
//!
//! HTTP, SQL, migrations, projection rebuild, and personal-export assembly stay
//! outside this module. Callers hold a lifecycle status, ask
//! [`decide_member_lifecycle`] for typed facts, then append and project them.
//!
//! Deactivate is the gate before erasure: an active member cannot jump straight
//! to `RequestErasure`. Re-deactivating an already-deactivated member is an
//! idempotent no-op (`Ok(vec![])`).

use serde::{Deserialize, Serialize};

/// Fact kind tags for member lifecycle streams (platform identity family).
pub const MEMBER_DEACTIVATED: &str = "MemberDeactivated";
pub const MEMBER_ERASURE_REQUESTED: &str = "MemberErasureRequested";
pub const MEMBER_CREDENTIALS_ERASED: &str = "MemberCredentialsErased";
pub const MEMBER_AUTHORSHIP_PSEUDONYMIZED: &str = "MemberAuthorshipPseudonymized";
pub const MEMBER_PERSONAL_EXPORT_RECORDED: &str = "MemberPersonalExportRecorded";

/// Aggregate lifecycle status for a principal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemberLifecycleStatus {
    Active,
    Deactivated,
    ErasureInProgress,
    Erased,
}

impl MemberLifecycleStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Deactivated => "deactivated",
            Self::ErasureInProgress => "erasure_in_progress",
            Self::Erased => "erased",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "active" => Some(Self::Active),
            "deactivated" => Some(Self::Deactivated),
            "erasure_in_progress" => Some(Self::ErasureInProgress),
            "erased" => Some(Self::Erased),
            _ => None,
        }
    }
}

/// Folded state handed to the pure decide function.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberLifecycleState {
    pub status: MemberLifecycleStatus,
}

/// Member-issued lifecycle commands. Projection-side effects (authorship
/// pseudonymization completion, personal export assembly) are not commands
/// here; they appear as recorded facts after later jobs finish.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemberLifecycleCommand {
    /// Immediately leave the active set; sessions/methods are revoked by
    /// projection/handlers of the resulting fact (not in this pure module).
    Deactivate { reason: String },
    /// Begin erasure. Requires prior deactivation.
    RequestErasure,
}

/// Typed lifecycle facts. Kind strings match the constants above.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemberLifecycleEvent {
    Deactivated { reason: String },
    ErasureRequested,
    CredentialsErased,
    AuthorshipPseudonymized,
    PersonalExportRecorded,
}

impl MemberLifecycleEvent {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Deactivated { .. } => MEMBER_DEACTIVATED,
            Self::ErasureRequested => MEMBER_ERASURE_REQUESTED,
            Self::CredentialsErased => MEMBER_CREDENTIALS_ERASED,
            Self::AuthorshipPseudonymized => MEMBER_AUTHORSHIP_PSEUDONYMIZED,
            Self::PersonalExportRecorded => MEMBER_PERSONAL_EXPORT_RECORDED,
        }
    }

    pub fn payload(&self) -> serde_json::Value {
        match self {
            Self::Deactivated { reason } => serde_json::json!({ "reason": reason }),
            Self::ErasureRequested
            | Self::CredentialsErased
            | Self::AuthorshipPseudonymized
            | Self::PersonalExportRecorded => serde_json::json!({}),
        }
    }

    /// Status after this fact is applied, when the fact itself moves lifecycle
    /// status. `MemberAuthorshipPseudonymized` is terminal: its handler has
    /// already removed credential authority and replaced retained public labels.
    pub fn resulting_status(&self) -> Option<MemberLifecycleStatus> {
        match self {
            Self::Deactivated { .. } => Some(MemberLifecycleStatus::Deactivated),
            Self::ErasureRequested => Some(MemberLifecycleStatus::ErasureInProgress),
            Self::CredentialsErased | Self::PersonalExportRecorded => None,
            Self::AuthorshipPseudonymized => Some(MemberLifecycleStatus::Erased),
        }
    }
}

/// Pure decide rejects for member lifecycle transitions.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum MemberLifecycleReject {
    /// Erasure requires a prior successful deactivation.
    #[error("member must deactivate before requesting erasure")]
    MustDeactivateFirst,
    /// Lifecycle work is already running; further member commands are refused.
    #[error("member erasure is already in progress")]
    ErasureInProgress,
    /// Terminal status: no further lifecycle commands apply.
    #[error("member is already erased")]
    AlreadyErased,
}

/// Classes of member-associated data with a declared retention/access disposition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DataClass {
    /// Passwords, method secrets, SSO linkage secrets.
    Credentials,
    /// Recovery tokens and related secrets.
    RecoveryMaterial,
    /// Email / delivery destinations used for invites and recovery.
    DeliveryDestination,
    /// Nonessential profile fields (handle alias material beyond durable authorship).
    NonessentialProfileIdentifier,
    /// Durable public posts and similar discussion authorship retained for coherence.
    PublicAuthorship,
    /// Private member content not required for public history.
    PrivateContent,
    /// Reports, hide reasons, and related operator evidence.
    ModerationEvidence,
    /// Append-only audit and security facts.
    AuditFacts,
    /// Offline/backup copies under operator custody.
    BackupCopy,
    /// Bundle assembled for a subject personal-data export request.
    PersonalExportBundle,
}

/// Declared disposition for a [`DataClass`] under member lifecycle policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RetentionDisposition {
    /// Wipe; not retained after erasure.
    Erase,
    /// Keep the fact for history; replace subject identifiers with pseudonyms.
    RetainPseudonymize,
    /// Keep under restricted operator/access policy (not public, not subject-rewritable).
    RetainRestricted,
    /// May be included in a personal/account export to the subject.
    /// Distinct from a host's completed-game export.
    ExportableToSubject,
    /// Operator custody only; not subject-exportable as a bulk personal dump.
    OperatorOnly,
}

/// Ownership matrix: every data class maps to exactly one primary disposition.
pub fn disposition(class: DataClass) -> RetentionDisposition {
    match class {
        DataClass::Credentials
        | DataClass::RecoveryMaterial
        | DataClass::DeliveryDestination
        | DataClass::NonessentialProfileIdentifier => RetentionDisposition::Erase,
        DataClass::PublicAuthorship => RetentionDisposition::RetainPseudonymize,
        DataClass::PrivateContent | DataClass::ModerationEvidence => {
            RetentionDisposition::RetainRestricted
        }
        DataClass::PersonalExportBundle => RetentionDisposition::ExportableToSubject,
        DataClass::AuditFacts | DataClass::BackupCopy => RetentionDisposition::OperatorOnly,
    }
}

/// Decide lifecycle facts for the current status and command.
///
/// Transitions:
/// - `Active` + `Deactivate` → `[MemberDeactivated]`, status becomes `Deactivated`
/// - `Deactivated` + `Deactivate` → idempotent `Ok([])` (no second deactivation fact)
/// - `Active` + `RequestErasure` → `Err(MustDeactivateFirst)`
/// - `Deactivated` + `RequestErasure` → `[MemberErasureRequested, MemberCredentialsErased]`,
///   status becomes `ErasureInProgress`. Credentials are co-emitted in the same
///   batch on this clean deactivation path (Wave 3 substrate); authorship
///   pseudonymization and export receipts remain later jobs/facts.
/// - `ErasureInProgress` / `Erased` + any command → reject
pub fn decide_member_lifecycle(
    state: &MemberLifecycleState,
    command: MemberLifecycleCommand,
) -> Result<Vec<MemberLifecycleEvent>, MemberLifecycleReject> {
    match (state.status, command) {
        (MemberLifecycleStatus::Active, MemberLifecycleCommand::Deactivate { reason }) => {
            Ok(vec![MemberLifecycleEvent::Deactivated { reason }])
        }
        (MemberLifecycleStatus::Deactivated, MemberLifecycleCommand::Deactivate { .. }) => {
            // Idempotent: already deactivated; emit nothing.
            Ok(vec![])
        }
        (MemberLifecycleStatus::Active, MemberLifecycleCommand::RequestErasure) => {
            Err(MemberLifecycleReject::MustDeactivateFirst)
        }
        (MemberLifecycleStatus::Deactivated, MemberLifecycleCommand::RequestErasure) => {
            // Clean path: erasure request plus credential wipe in one batch.
            Ok(vec![
                MemberLifecycleEvent::ErasureRequested,
                MemberLifecycleEvent::CredentialsErased,
            ])
        }
        (MemberLifecycleStatus::ErasureInProgress, _) => {
            Err(MemberLifecycleReject::ErasureInProgress)
        }
        (MemberLifecycleStatus::Erased, _) => Err(MemberLifecycleReject::AlreadyErased),
    }
}

/// Fold a decided event batch onto status for in-memory tests / pure callers.
pub fn apply_lifecycle_events(
    status: MemberLifecycleStatus,
    events: &[MemberLifecycleEvent],
) -> MemberLifecycleStatus {
    let mut next = status;
    for event in events {
        if let Some(status) = event.resulting_status() {
            next = status;
        }
    }
    next
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disposition_matrix_matches_declared_policy() {
        let cases = [
            (DataClass::Credentials, RetentionDisposition::Erase),
            (DataClass::RecoveryMaterial, RetentionDisposition::Erase),
            (DataClass::DeliveryDestination, RetentionDisposition::Erase),
            (
                DataClass::NonessentialProfileIdentifier,
                RetentionDisposition::Erase,
            ),
            (
                DataClass::PublicAuthorship,
                RetentionDisposition::RetainPseudonymize,
            ),
            (
                DataClass::PrivateContent,
                RetentionDisposition::RetainRestricted,
            ),
            (
                DataClass::ModerationEvidence,
                RetentionDisposition::RetainRestricted,
            ),
            (
                DataClass::PersonalExportBundle,
                RetentionDisposition::ExportableToSubject,
            ),
            (DataClass::AuditFacts, RetentionDisposition::OperatorOnly),
            (DataClass::BackupCopy, RetentionDisposition::OperatorOnly),
        ];
        for (class, expected) in cases {
            assert_eq!(
                disposition(class),
                expected,
                "disposition for {class:?} should be {expected:?}"
            );
        }
    }

    #[test]
    fn decide_member_lifecycle_table() {
        // (status, command, expected result)
        let cases: Vec<(
            MemberLifecycleStatus,
            MemberLifecycleCommand,
            Result<Vec<MemberLifecycleEvent>, MemberLifecycleReject>,
        )> = vec![
            (
                MemberLifecycleStatus::Active,
                MemberLifecycleCommand::Deactivate {
                    reason: "member request".into(),
                },
                Ok(vec![MemberLifecycleEvent::Deactivated {
                    reason: "member request".into(),
                }]),
            ),
            (
                MemberLifecycleStatus::Deactivated,
                MemberLifecycleCommand::Deactivate {
                    reason: "repeat".into(),
                },
                Ok(vec![]), // idempotent no-op
            ),
            (
                MemberLifecycleStatus::Active,
                MemberLifecycleCommand::RequestErasure,
                Err(MemberLifecycleReject::MustDeactivateFirst),
            ),
            (
                MemberLifecycleStatus::Deactivated,
                MemberLifecycleCommand::RequestErasure,
                Ok(vec![
                    MemberLifecycleEvent::ErasureRequested,
                    MemberLifecycleEvent::CredentialsErased,
                ]),
            ),
            (
                MemberLifecycleStatus::ErasureInProgress,
                MemberLifecycleCommand::Deactivate {
                    reason: "late".into(),
                },
                Err(MemberLifecycleReject::ErasureInProgress),
            ),
            (
                MemberLifecycleStatus::ErasureInProgress,
                MemberLifecycleCommand::RequestErasure,
                Err(MemberLifecycleReject::ErasureInProgress),
            ),
            (
                MemberLifecycleStatus::Erased,
                MemberLifecycleCommand::Deactivate {
                    reason: "late".into(),
                },
                Err(MemberLifecycleReject::AlreadyErased),
            ),
            (
                MemberLifecycleStatus::Erased,
                MemberLifecycleCommand::RequestErasure,
                Err(MemberLifecycleReject::AlreadyErased),
            ),
        ];

        for (status, command, expected) in cases {
            let state = MemberLifecycleState { status };
            let got = decide_member_lifecycle(&state, command.clone());
            assert_eq!(got, expected, "status={status:?} command={command:?}");
        }
    }

    #[test]
    fn deactivate_then_erasure_moves_status_through_declared_path() {
        let mut state = MemberLifecycleState {
            status: MemberLifecycleStatus::Active,
        };
        let deactivated = decide_member_lifecycle(
            &state,
            MemberLifecycleCommand::Deactivate {
                reason: "leaving".into(),
            },
        )
        .unwrap();
        assert_eq!(
            deactivated
                .iter()
                .map(MemberLifecycleEvent::kind)
                .collect::<Vec<_>>(),
            vec![MEMBER_DEACTIVATED]
        );
        state.status = apply_lifecycle_events(state.status, &deactivated);
        assert_eq!(state.status, MemberLifecycleStatus::Deactivated);

        let erasure =
            decide_member_lifecycle(&state, MemberLifecycleCommand::RequestErasure).unwrap();
        assert_eq!(
            erasure
                .iter()
                .map(MemberLifecycleEvent::kind)
                .collect::<Vec<_>>(),
            vec![MEMBER_ERASURE_REQUESTED, MEMBER_CREDENTIALS_ERASED]
        );
        state.status = apply_lifecycle_events(state.status, &erasure);
        assert_eq!(state.status, MemberLifecycleStatus::ErasureInProgress);
    }

    #[test]
    fn event_kind_constants_are_stable() {
        let cases = [
            (
                MemberLifecycleEvent::Deactivated { reason: "x".into() },
                MEMBER_DEACTIVATED,
            ),
            (
                MemberLifecycleEvent::ErasureRequested,
                MEMBER_ERASURE_REQUESTED,
            ),
            (
                MemberLifecycleEvent::CredentialsErased,
                MEMBER_CREDENTIALS_ERASED,
            ),
            (
                MemberLifecycleEvent::AuthorshipPseudonymized,
                MEMBER_AUTHORSHIP_PSEUDONYMIZED,
            ),
            (
                MemberLifecycleEvent::PersonalExportRecorded,
                MEMBER_PERSONAL_EXPORT_RECORDED,
            ),
        ];
        for (event, kind) in cases {
            assert_eq!(event.kind(), kind);
        }
    }

    #[test]
    fn status_parse_round_trip() {
        for status in [
            MemberLifecycleStatus::Active,
            MemberLifecycleStatus::Deactivated,
            MemberLifecycleStatus::ErasureInProgress,
            MemberLifecycleStatus::Erased,
        ] {
            assert_eq!(MemberLifecycleStatus::parse(status.as_str()), Some(status));
        }
        assert_eq!(MemberLifecycleStatus::parse("unknown"), None);
    }
}
