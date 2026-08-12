//! Game-scoped public identity and immutable slot-occupancy vocabulary.
//!
//! A [`GamePersonaId`] is neither a credential principal nor an engine slot.
//! An [`OccupancyId`] names one uninterrupted stint by that persona in a slot;
//! replacing or returning a person always creates a new occupancy id.

use std::fmt;

use serde::{de::Error as _, Deserialize, Deserializer, Serialize};

use crate::ModelError;

macro_rules! opaque_identifier {
    ($name:ident, $kind:literal) => {
        #[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
        #[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
        #[cfg_attr(feature = "typescript", ts(type = "string"))]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self, ModelError> {
                let value = value.into();
                if value.trim().is_empty() {
                    return Err(ModelError::BlankIdentifier { kind: $kind });
                }
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                Self::new(String::deserialize(deserializer)?).map_err(D::Error::custom)
            }
        }
    };
}

opaque_identifier!(GamePersonaId, "game persona id");
opaque_identifier!(OccupancyId, "occupancy id");
opaque_identifier!(OccupancyTransitionId, "occupancy transition id");

/// The public, game-local name that may appear in durable game history.
///
/// This value is deliberately independent from a profile display name or an
/// authentication principal. Projection ownership enforces per-game uniqueness
/// of [`Self::normalized`] and permanently reserves every claimed normalization.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[cfg_attr(feature = "typescript", ts(type = "string"))]
pub struct GamePersonaName(String);

impl GamePersonaName {
    pub fn new(value: impl Into<String>) -> Result<Self, ModelError> {
        let value = value.into().trim().to_owned();
        if value.is_empty() {
            return Err(ModelError::BlankIdentifier {
                kind: "game persona name",
            });
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Stable key for game-wide, case-insensitive claim ownership.
    pub fn normalized(&self) -> String {
        self.0.to_lowercase()
    }
}

impl fmt::Display for GamePersonaName {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl<'de> Deserialize<'de> for GamePersonaName {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::new(String::deserialize(deserializer)?).map_err(D::Error::custom)
    }
}

/// Why a new immutable occupancy epoch began.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(rename_all = "snake_case")]
pub enum OccupancyStartReason {
    Initial,
    Replacement,
    Return,
}

/// Why an immutable occupancy epoch ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(rename_all = "snake_case")]
pub enum OccupancyEndReason {
    Replaced,
    Withdrawn,
    Removed,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persona_name_preserves_presentation_but_normalizes_claims() {
        let name = GamePersonaName::new("  Lark  ").unwrap();
        assert_eq!(name.as_str(), "Lark");
        assert_eq!(name.normalized(), "lark");
        assert!(GamePersonaName::new(" \n\t ").is_err());
    }

    #[test]
    fn opaque_ids_reject_blank_values() {
        assert!(GamePersonaId::new("persona-1").is_ok());
        assert!(OccupancyId::new("epoch-1").is_ok());
        assert!(OccupancyTransitionId::new("transition-1").is_ok());
        assert!(GamePersonaId::new(" ").is_err());
    }
}
