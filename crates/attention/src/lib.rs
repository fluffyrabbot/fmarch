//! Watches, monotonic read cursors, and inbox-delivery domain decisions.
//!
//! Targets are public publication surfaces. This crate deliberately has no
//! knowledge of forum, game, or any other source aggregate.

use principal::PrincipalId;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

pub const SUBSCRIPTION_ENABLED: &str = "PublicWatchEnabled";
pub const SUBSCRIPTION_DISABLED: &str = "PublicWatchDisabled";
pub const SUBSCRIPTION_READ_ADVANCED: &str = "PublicWatchReadAdvanced";

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum AttentionReject {
    #[error("watch already exists")]
    AlreadySubscribed,
    #[error("watch is not active")]
    NotSubscribed,
    #[error("watch was not found")]
    SubscriptionNotFound,
    #[error("read cursor must advance")]
    ReadCursorMustAdvance,
    #[error("watch target changed")]
    TargetChanged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WatchTarget {
    pub surface_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchState {
    pub watch_id: Uuid,
    pub principal_id: PrincipalId,
    pub target: WatchTarget,
    pub active: bool,
    pub read_through_seq: i64,
    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchCommand {
    Subscribe {
        target: WatchTarget,
        initial_read_through_seq: i64,
    },
    Unsubscribe,
    AdvanceRead {
        read_through_seq: i64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchEvent {
    Enabled {
        target: WatchTarget,
        initial_read_through_seq: i64,
    },
    Disabled,
    ReadAdvanced {
        read_through_seq: i64,
    },
}

impl WatchEvent {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Enabled { .. } => SUBSCRIPTION_ENABLED,
            Self::Disabled => SUBSCRIPTION_DISABLED,
            Self::ReadAdvanced { .. } => SUBSCRIPTION_READ_ADVANCED,
        }
    }

    pub fn payload(&self) -> serde_json::Value {
        match self {
            Self::Enabled {
                target,
                initial_read_through_seq,
            } => serde_json::json!({
                "target": target,
                "initial_read_through_seq": initial_read_through_seq,
            }),
            Self::Disabled => serde_json::json!({}),
            Self::ReadAdvanced { read_through_seq } => {
                serde_json::json!({ "read_through_seq": read_through_seq })
            }
        }
    }
}

pub fn decide_watch(
    state: Option<&WatchState>,
    command: WatchCommand,
) -> Result<Vec<WatchEvent>, AttentionReject> {
    match (state, command) {
        (
            None,
            WatchCommand::Subscribe {
                target,
                initial_read_through_seq,
            },
        ) => Ok(vec![WatchEvent::Enabled {
            target,
            initial_read_through_seq,
        }]),
        (
            Some(state),
            WatchCommand::Subscribe {
                target,
                initial_read_through_seq,
            },
        ) => {
            if state.active {
                return Err(AttentionReject::AlreadySubscribed);
            }
            if state.target != target {
                return Err(AttentionReject::TargetChanged);
            }
            Ok(vec![WatchEvent::Enabled {
                target,
                initial_read_through_seq: initial_read_through_seq.max(state.read_through_seq),
            }])
        }
        (None, _) => Err(AttentionReject::SubscriptionNotFound),
        (Some(state), WatchCommand::Unsubscribe) if state.active => Ok(vec![WatchEvent::Disabled]),
        (Some(_), WatchCommand::Unsubscribe) => Err(AttentionReject::NotSubscribed),
        (Some(state), WatchCommand::AdvanceRead { read_through_seq }) if state.active => {
            if read_through_seq <= state.read_through_seq {
                return Err(AttentionReject::ReadCursorMustAdvance);
            }
            Ok(vec![WatchEvent::ReadAdvanced { read_through_seq }])
        }
        (Some(_), WatchCommand::AdvanceRead { .. }) => Err(AttentionReject::NotSubscribed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target() -> WatchTarget {
        WatchTarget {
            surface_id: Uuid::from_u128(1),
        }
    }

    fn active_state() -> WatchState {
        WatchState {
            watch_id: Uuid::from_u128(2),
            principal_id: PrincipalId::from_uuid(Uuid::from_u128(1)),
            target: target(),
            active: true,
            read_through_seq: 4,
            version: 3,
        }
    }

    #[test]
    fn active_watch_cannot_be_enabled_twice() {
        assert_eq!(
            decide_watch(
                Some(&active_state()),
                WatchCommand::Subscribe {
                    target: target(),
                    initial_read_through_seq: 4,
                },
            ),
            Err(AttentionReject::AlreadySubscribed),
        );
    }

    #[test]
    fn reenabled_watch_never_moves_its_cursor_backwards() {
        let mut state = active_state();
        state.active = false;
        assert_eq!(
            decide_watch(
                Some(&state),
                WatchCommand::Subscribe {
                    target: target(),
                    initial_read_through_seq: 1,
                },
            ),
            Ok(vec![WatchEvent::Enabled {
                target: target(),
                initial_read_through_seq: 4,
            }]),
        );
    }

    #[test]
    fn read_cursor_must_strictly_advance() {
        assert_eq!(
            decide_watch(
                Some(&active_state()),
                WatchCommand::AdvanceRead {
                    read_through_seq: 4,
                },
            ),
            Err(AttentionReject::ReadCursorMustAdvance),
        );
    }
}
