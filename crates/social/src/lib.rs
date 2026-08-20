//! Public-profile relationships and their private reader overlays.

use thiserror::Error;
use uuid::Uuid;

pub const MEMBER_MUTED: &str = "MemberMuted";
pub const MEMBER_UNMUTED: &str = "MemberUnmuted";

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum SocialReject {
    #[error("member is already muted")]
    AlreadyMuted,
    #[error("member is not muted")]
    NotMuted,
    #[error("mute relationship was not found")]
    MuteNotFound,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberMuteState {
    pub relationship_id: Uuid,
    pub principal_user_id: String,
    pub target_profile_id: Uuid,
    pub active: bool,
    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemberMuteCommand {
    Mute { target_profile_id: Uuid },
    Unmute,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemberMuteEvent {
    Muted { target_profile_id: Uuid },
    Unmuted,
}

impl MemberMuteEvent {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Muted { .. } => MEMBER_MUTED,
            Self::Unmuted => MEMBER_UNMUTED,
        }
    }

    pub fn payload(&self) -> serde_json::Value {
        match self {
            Self::Muted { target_profile_id } => serde_json::json!({
                "target_profile_id": target_profile_id,
            }),
            Self::Unmuted => serde_json::json!({}),
        }
    }
}

pub fn decide_member_mute(
    state: Option<&MemberMuteState>,
    command: MemberMuteCommand,
) -> Result<Vec<MemberMuteEvent>, SocialReject> {
    match (state, command) {
        (None, MemberMuteCommand::Mute { target_profile_id }) => {
            Ok(vec![MemberMuteEvent::Muted { target_profile_id }])
        }
        (Some(state), MemberMuteCommand::Mute { .. }) if state.active => {
            Err(SocialReject::AlreadyMuted)
        }
        (Some(state), MemberMuteCommand::Mute { target_profile_id }) => {
            if state.target_profile_id != target_profile_id {
                return Err(SocialReject::MuteNotFound);
            }
            Ok(vec![MemberMuteEvent::Muted { target_profile_id }])
        }
        (None, MemberMuteCommand::Unmute) => Err(SocialReject::MuteNotFound),
        (Some(state), MemberMuteCommand::Unmute) if !state.active => Err(SocialReject::NotMuted),
        (Some(_), MemberMuteCommand::Unmute) => Ok(vec![MemberMuteEvent::Unmuted]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active_state() -> MemberMuteState {
        MemberMuteState {
            relationship_id: Uuid::from_u128(1),
            principal_user_id: "reader".to_string(),
            target_profile_id: Uuid::from_u128(2),
            active: true,
            version: 1,
        }
    }

    #[test]
    fn mute_is_idempotency_safe_by_rejection() {
        assert_eq!(
            decide_member_mute(
                Some(&active_state()),
                MemberMuteCommand::Mute {
                    target_profile_id: Uuid::from_u128(2),
                },
            ),
            Err(SocialReject::AlreadyMuted),
        );
    }

    #[test]
    fn an_inactive_relationship_can_only_be_reactivated_for_the_same_profile() {
        let mut state = active_state();
        state.active = false;
        assert_eq!(
            decide_member_mute(
                Some(&state),
                MemberMuteCommand::Mute {
                    target_profile_id: Uuid::from_u128(3),
                },
            ),
            Err(SocialReject::MuteNotFound),
        );
    }
}
