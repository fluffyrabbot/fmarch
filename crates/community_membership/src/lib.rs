//! Pure community-admission and invitation state machines.
//!
//! Authentication proves control of a principal. Membership records the
//! separate community decision that admitted that principal. Provenance uses
//! opaque membership identifiers so credential, provider, contact, profile,
//! and erasure lifecycles cannot rewrite the sponsorship forest.

use principal::PrincipalId;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

macro_rules! uuid_id {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(Uuid);

        impl $name {
            pub fn random() -> Self {
                Self(Uuid::new_v4())
            }

            pub const fn from_uuid(value: Uuid) -> Self {
                Self(value)
            }

            pub const fn as_uuid(self) -> Uuid {
                self.0
            }
        }
    };
}

uuid_id!(MembershipId);
uuid_id!(InvitationId);

pub const MEMBERSHIP_FOUNDED: &str = "MembershipFounded";
pub const MEMBERSHIP_ADMITTED: &str = "MembershipAdmitted";
pub const MEMBERSHIP_SUSPENDED: &str = "MembershipSuspended";
pub const MEMBERSHIP_RESTORED: &str = "MembershipRestored";
pub const MEMBERSHIP_WITHDRAWN: &str = "MembershipWithdrawn";
pub const MEMBERSHIP_REDACTED: &str = "MembershipRedacted";
pub const COMMUNITY_INVITATION_ISSUED: &str = "CommunityInvitationIssued";
pub const COMMUNITY_INVITATION_REVOKED: &str = "CommunityInvitationRevoked";
pub const COMMUNITY_INVITATION_ACCEPTED: &str = "CommunityInvitationAccepted";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MembershipStatus {
    Active,
    Suspended,
    Withdrawn,
    Redacted,
}

impl MembershipStatus {
    pub const fn can_invite(self) -> bool {
        matches!(self, Self::Active)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MembershipOrigin {
    Founder,
    Invitation {
        invitation_id: InvitationId,
        sponsoring_membership_id: MembershipId,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MembershipState {
    pub membership_id: MembershipId,
    pub status: MembershipStatus,
    pub origin: MembershipOrigin,
    pub revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MembershipCommand {
    Found,
    Admit {
        invitation_id: InvitationId,
        sponsoring_membership_id: MembershipId,
    },
    Suspend {
        reason: String,
    },
    Restore,
    Withdraw,
    Redact {
        retained_alias: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MembershipEvent {
    Founded,
    Admitted {
        invitation_id: InvitationId,
        sponsoring_membership_id: MembershipId,
    },
    Suspended {
        reason: String,
    },
    Restored,
    Withdrawn,
    Redacted {
        retained_alias: String,
    },
}

impl MembershipEvent {
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::Founded => MEMBERSHIP_FOUNDED,
            Self::Admitted { .. } => MEMBERSHIP_ADMITTED,
            Self::Suspended { .. } => MEMBERSHIP_SUSPENDED,
            Self::Restored => MEMBERSHIP_RESTORED,
            Self::Withdrawn => MEMBERSHIP_WITHDRAWN,
            Self::Redacted { .. } => MEMBERSHIP_REDACTED,
        }
    }

    pub fn payload(&self) -> serde_json::Value {
        match self {
            Self::Founded | Self::Restored | Self::Withdrawn => serde_json::json!({}),
            Self::Admitted {
                invitation_id,
                sponsoring_membership_id,
            } => serde_json::json!({
                "invitation_id": invitation_id,
                "sponsoring_membership_id": sponsoring_membership_id,
            }),
            Self::Suspended { reason } => serde_json::json!({ "reason": reason }),
            Self::Redacted { retained_alias } => {
                serde_json::json!({ "retained_alias": retained_alias })
            }
        }
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum MembershipReject {
    #[error("membership already exists")]
    AlreadyExists,
    #[error("membership does not exist")]
    NotFound,
    #[error("membership is not active")]
    NotActive,
    #[error("membership is already suspended")]
    AlreadySuspended,
    #[error("membership is not suspended")]
    NotSuspended,
    #[error("membership is terminal")]
    Terminal,
    #[error("reason must contain 1..=280 characters")]
    InvalidReason,
    #[error("retained alias must contain 1..=128 characters")]
    InvalidAlias,
    #[error("a membership cannot sponsor itself")]
    SelfSponsorship,
}

pub fn decide_membership(
    membership_id: MembershipId,
    state: Option<&MembershipState>,
    command: MembershipCommand,
) -> Result<Vec<MembershipEvent>, MembershipReject> {
    match (state, command) {
        (None, MembershipCommand::Found) => Ok(vec![MembershipEvent::Founded]),
        (
            None,
            MembershipCommand::Admit {
                invitation_id,
                sponsoring_membership_id,
            },
        ) => {
            if sponsoring_membership_id == membership_id {
                return Err(MembershipReject::SelfSponsorship);
            }
            Ok(vec![MembershipEvent::Admitted {
                invitation_id,
                sponsoring_membership_id,
            }])
        }
        (None, _) => Err(MembershipReject::NotFound),
        (Some(_), MembershipCommand::Found | MembershipCommand::Admit { .. }) => {
            Err(MembershipReject::AlreadyExists)
        }
        (Some(state), MembershipCommand::Suspend { reason }) => {
            if state.status == MembershipStatus::Suspended {
                return Err(MembershipReject::AlreadySuspended);
            }
            if matches!(
                state.status,
                MembershipStatus::Withdrawn | MembershipStatus::Redacted
            ) {
                return Err(MembershipReject::Terminal);
            }
            let reason = reason.trim();
            if reason.is_empty() || reason.chars().count() > 280 {
                return Err(MembershipReject::InvalidReason);
            }
            Ok(vec![MembershipEvent::Suspended {
                reason: reason.to_string(),
            }])
        }
        (Some(state), MembershipCommand::Restore) => {
            if state.status != MembershipStatus::Suspended {
                return Err(MembershipReject::NotSuspended);
            }
            Ok(vec![MembershipEvent::Restored])
        }
        (Some(state), MembershipCommand::Withdraw) => {
            if matches!(
                state.status,
                MembershipStatus::Withdrawn | MembershipStatus::Redacted
            ) {
                return Err(MembershipReject::Terminal);
            }
            Ok(vec![MembershipEvent::Withdrawn])
        }
        (Some(state), MembershipCommand::Redact { retained_alias }) => {
            if state.status == MembershipStatus::Redacted {
                return Err(MembershipReject::Terminal);
            }
            let retained_alias = retained_alias.trim();
            if retained_alias.is_empty() || retained_alias.chars().count() > 128 {
                return Err(MembershipReject::InvalidAlias);
            }
            Ok(vec![MembershipEvent::Redacted {
                retained_alias: retained_alias.to_string(),
            }])
        }
    }
}

pub fn fold_membership(
    membership_id: MembershipId,
    state: Option<MembershipState>,
    event: &MembershipEvent,
) -> Result<MembershipState, MembershipReject> {
    let next_revision = state.as_ref().map_or(1, |state| state.revision + 1);
    match (state, event) {
        (None, MembershipEvent::Founded) => Ok(MembershipState {
            membership_id,
            status: MembershipStatus::Active,
            origin: MembershipOrigin::Founder,
            revision: next_revision,
        }),
        (
            None,
            MembershipEvent::Admitted {
                invitation_id,
                sponsoring_membership_id,
            },
        ) => Ok(MembershipState {
            membership_id,
            status: MembershipStatus::Active,
            origin: MembershipOrigin::Invitation {
                invitation_id: *invitation_id,
                sponsoring_membership_id: *sponsoring_membership_id,
            },
            revision: next_revision,
        }),
        (None, _) => Err(MembershipReject::NotFound),
        (Some(_), MembershipEvent::Founded | MembershipEvent::Admitted { .. }) => {
            Err(MembershipReject::AlreadyExists)
        }
        (Some(mut state), event) => {
            state.status = match event {
                MembershipEvent::Suspended { .. } => MembershipStatus::Suspended,
                MembershipEvent::Restored => MembershipStatus::Active,
                MembershipEvent::Withdrawn => MembershipStatus::Withdrawn,
                MembershipEvent::Redacted { .. } => MembershipStatus::Redacted,
                MembershipEvent::Founded | MembershipEvent::Admitted { .. } => unreachable!(),
            };
            state.revision = next_revision;
            Ok(state)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InvitationStatus {
    Issued,
    Accepted,
    Revoked,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvitationState {
    pub invitation_id: InvitationId,
    pub sponsoring_membership_id: MembershipId,
    pub target_index: String,
    pub expires_at: i64,
    pub status: InvitationStatus,
    pub admitted_membership_id: Option<MembershipId>,
    pub revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InvitationCommand {
    Issue {
        sponsoring_membership_id: MembershipId,
        target_index: String,
        expires_at: i64,
        now: i64,
    },
    Accept {
        admitted_membership_id: MembershipId,
        presented_target_index: String,
        now: i64,
    },
    Revoke,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InvitationEvent {
    Issued {
        sponsoring_membership_id: MembershipId,
        target_index: String,
        expires_at: i64,
    },
    Accepted {
        admitted_membership_id: MembershipId,
    },
    Revoked,
}

impl InvitationEvent {
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::Issued { .. } => COMMUNITY_INVITATION_ISSUED,
            Self::Accepted { .. } => COMMUNITY_INVITATION_ACCEPTED,
            Self::Revoked => COMMUNITY_INVITATION_REVOKED,
        }
    }

    pub fn payload(&self) -> serde_json::Value {
        match self {
            Self::Issued {
                sponsoring_membership_id,
                target_index,
                expires_at,
            } => serde_json::json!({
                "sponsoring_membership_id": sponsoring_membership_id,
                "target_index": target_index,
                "expires_at": expires_at,
            }),
            Self::Accepted {
                admitted_membership_id,
            } => serde_json::json!({ "admitted_membership_id": admitted_membership_id }),
            Self::Revoked => serde_json::json!({}),
        }
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum InvitationReject {
    #[error("invitation already exists")]
    AlreadyExists,
    #[error("invitation does not exist")]
    NotFound,
    #[error("sponsor is not eligible to invite")]
    SponsorIneligible,
    #[error("invitation must expire in the future")]
    InvalidExpiry,
    #[error("invitation target is invalid")]
    InvalidTarget,
    #[error("invitation is no longer active")]
    Terminal,
    #[error("invitation has expired")]
    Expired,
    #[error("invitation target does not match")]
    TargetMismatch,
}

pub fn decide_invitation(
    state: Option<&InvitationState>,
    sponsor: Option<&MembershipState>,
    command: InvitationCommand,
) -> Result<Vec<InvitationEvent>, InvitationReject> {
    match (state, command) {
        (
            None,
            InvitationCommand::Issue {
                sponsoring_membership_id,
                target_index,
                expires_at,
                now,
            },
        ) => {
            let sponsor = sponsor.filter(|state| {
                state.membership_id == sponsoring_membership_id && state.status.can_invite()
            });
            if sponsor.is_none() {
                return Err(InvitationReject::SponsorIneligible);
            }
            if expires_at <= now {
                return Err(InvitationReject::InvalidExpiry);
            }
            if target_index.trim().is_empty() || target_index.len() > 128 {
                return Err(InvitationReject::InvalidTarget);
            }
            Ok(vec![InvitationEvent::Issued {
                sponsoring_membership_id,
                target_index,
                expires_at,
            }])
        }
        (Some(_), InvitationCommand::Issue { .. }) => Err(InvitationReject::AlreadyExists),
        (None, _) => Err(InvitationReject::NotFound),
        (Some(state), InvitationCommand::Revoke) => {
            if state.status != InvitationStatus::Issued {
                return Err(InvitationReject::Terminal);
            }
            Ok(vec![InvitationEvent::Revoked])
        }
        (
            Some(state),
            InvitationCommand::Accept {
                admitted_membership_id,
                presented_target_index,
                now,
            },
        ) => {
            if state.status != InvitationStatus::Issued {
                return Err(InvitationReject::Terminal);
            }
            if now >= state.expires_at {
                return Err(InvitationReject::Expired);
            }
            if sponsor.is_none_or(|sponsor| {
                sponsor.membership_id != state.sponsoring_membership_id
                    || !sponsor.status.can_invite()
            }) {
                return Err(InvitationReject::SponsorIneligible);
            }
            if presented_target_index != state.target_index {
                return Err(InvitationReject::TargetMismatch);
            }
            Ok(vec![InvitationEvent::Accepted {
                admitted_membership_id,
            }])
        }
    }
}

pub fn fold_invitation(
    invitation_id: InvitationId,
    state: Option<InvitationState>,
    event: &InvitationEvent,
) -> Result<InvitationState, InvitationReject> {
    let next_revision = state.as_ref().map_or(1, |state| state.revision + 1);
    match (state, event) {
        (
            None,
            InvitationEvent::Issued {
                sponsoring_membership_id,
                target_index,
                expires_at,
            },
        ) => Ok(InvitationState {
            invitation_id,
            sponsoring_membership_id: *sponsoring_membership_id,
            target_index: target_index.clone(),
            expires_at: *expires_at,
            status: InvitationStatus::Issued,
            admitted_membership_id: None,
            revision: next_revision,
        }),
        (None, _) => Err(InvitationReject::NotFound),
        (Some(_), InvitationEvent::Issued { .. }) => Err(InvitationReject::AlreadyExists),
        (
            Some(mut state),
            InvitationEvent::Accepted {
                admitted_membership_id,
            },
        ) => {
            state.status = InvitationStatus::Accepted;
            state.admitted_membership_id = Some(*admitted_membership_id);
            state.revision = next_revision;
            Ok(state)
        }
        (Some(mut state), InvitationEvent::Revoked) => {
            state.status = InvitationStatus::Revoked;
            state.revision = next_revision;
            Ok(state)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveMembership {
    pub membership_id: MembershipId,
    pub principal_id: PrincipalId,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(id: u128, status: MembershipStatus) -> MembershipState {
        MembershipState {
            membership_id: MembershipId::from_uuid(Uuid::from_u128(id)),
            status,
            origin: MembershipOrigin::Founder,
            revision: 1,
        }
    }

    #[test]
    fn only_founders_may_have_no_sponsor() {
        let membership_id = MembershipId::from_uuid(Uuid::from_u128(1));
        let founded = decide_membership(membership_id, None, MembershipCommand::Found).unwrap();
        let state = fold_membership(membership_id, None, &founded[0]).unwrap();
        assert_eq!(state.origin, MembershipOrigin::Founder);

        let invitation_id = InvitationId::from_uuid(Uuid::from_u128(2));
        let admitted = decide_membership(
            membership_id,
            None,
            MembershipCommand::Admit {
                invitation_id,
                sponsoring_membership_id: MembershipId::from_uuid(Uuid::from_u128(3)),
            },
        )
        .unwrap();
        let state = fold_membership(membership_id, None, &admitted[0]).unwrap();
        assert!(matches!(state.origin, MembershipOrigin::Invitation { .. }));
    }

    #[test]
    fn self_sponsorship_is_rejected() {
        let membership_id = MembershipId::from_uuid(Uuid::from_u128(1));
        assert_eq!(
            decide_membership(
                membership_id,
                None,
                MembershipCommand::Admit {
                    invitation_id: InvitationId::from_uuid(Uuid::from_u128(2)),
                    sponsoring_membership_id: membership_id,
                },
            ),
            Err(MembershipReject::SelfSponsorship)
        );
    }

    #[test]
    fn invitation_is_target_bound_single_use_and_sponsor_live() {
        let sponsor = member(1, MembershipStatus::Active);
        let invitation_id = InvitationId::from_uuid(Uuid::from_u128(2));
        let issued = decide_invitation(
            None,
            Some(&sponsor),
            InvitationCommand::Issue {
                sponsoring_membership_id: sponsor.membership_id,
                target_index: "blind-target".to_string(),
                expires_at: 100,
                now: 10,
            },
        )
        .unwrap();
        let state = fold_invitation(invitation_id, None, &issued[0]).unwrap();
        assert_eq!(
            decide_invitation(
                Some(&state),
                Some(&sponsor),
                InvitationCommand::Accept {
                    admitted_membership_id: MembershipId::from_uuid(Uuid::from_u128(3)),
                    presented_target_index: "wrong".to_string(),
                    now: 20,
                },
            ),
            Err(InvitationReject::TargetMismatch)
        );
        let accepted = decide_invitation(
            Some(&state),
            Some(&sponsor),
            InvitationCommand::Accept {
                admitted_membership_id: MembershipId::from_uuid(Uuid::from_u128(3)),
                presented_target_index: "blind-target".to_string(),
                now: 20,
            },
        )
        .unwrap();
        let state = fold_invitation(invitation_id, Some(state), &accepted[0]).unwrap();
        assert_eq!(
            decide_invitation(Some(&state), Some(&sponsor), InvitationCommand::Revoke),
            Err(InvitationReject::Terminal)
        );
    }

    #[test]
    fn suspended_sponsor_invalidates_open_invite_without_touching_descendants() {
        let active = member(1, MembershipStatus::Active);
        let invitation_id = InvitationId::from_uuid(Uuid::from_u128(2));
        let issued = decide_invitation(
            None,
            Some(&active),
            InvitationCommand::Issue {
                sponsoring_membership_id: active.membership_id,
                target_index: "blind-target".to_string(),
                expires_at: 100,
                now: 10,
            },
        )
        .unwrap();
        let invitation = fold_invitation(invitation_id, None, &issued[0]).unwrap();
        let suspended = member(1, MembershipStatus::Suspended);
        assert_eq!(
            decide_invitation(
                Some(&invitation),
                Some(&suspended),
                InvitationCommand::Accept {
                    admitted_membership_id: MembershipId::from_uuid(Uuid::from_u128(3)),
                    presented_target_index: "blind-target".to_string(),
                    now: 20,
                },
            ),
            Err(InvitationReject::SponsorIneligible)
        );
    }
}
