//! Game-scoped public identity and immutable slot-occupancy vocabulary.
//!
//! A [`GamePersonaId`] is neither a credential principal nor an engine slot.
//! An [`OccupancyId`] names one uninterrupted stint by that persona in a slot;
//! replacing or returning a person always creates a new occupancy id.

use std::{fmt, str::FromStr};

use serde::{de::Error as _, Deserialize, Deserializer, Serialize, Serializer};
use uuid::Uuid;

use crate::ModelError;

macro_rules! uuid_identifier {
    ($name:ident, $kind:literal) => {
        #[doc = $kind]
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
        #[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
        #[cfg_attr(feature = "typescript", ts(type = "string"))]
        pub struct $name(Uuid);

        impl $name {
            /// Generate a new opaque identifier in this game's namespace.
            pub fn random() -> Self {
                Self(Uuid::new_v4())
            }

            /// Wrap a validated UUID from a persistence or transport adapter.
            pub const fn from_uuid(value: Uuid) -> Self {
                Self(value)
            }

            /// Return the physical UUID used by persistence and transport.
            pub const fn as_uuid(self) -> Uuid {
                self.0
            }
        }

        impl From<Uuid> for $name {
            fn from(value: Uuid) -> Self {
                Self::from_uuid(value)
            }
        }

        impl From<$name> for Uuid {
            fn from(value: $name) -> Self {
                value.as_uuid()
            }
        }

        impl Serialize for $name {
            fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
            where
                S: Serializer,
            {
                self.0.serialize(serializer)
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                Uuid::deserialize(deserializer).map(Self::from_uuid)
            }
        }

        impl FromStr for $name {
            type Err = uuid::Error;

            fn from_str(value: &str) -> Result<Self, Self::Err> {
                Ok(Self::from_uuid(Uuid::parse_str(value)?))
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }
    };
}

uuid_identifier!(GamePersonaId, "A game-local public persona identifier.");
uuid_identifier!(OccupancyId, "An immutable slot-occupancy epoch identifier.");
uuid_identifier!(
    OccupancyTransitionId,
    "An immutable occupancy transition identifier."
);

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

/// The encrypted, current presentation for a game-local public persona.
///
/// Authority intentionally does not live here: it is represented by the
/// separate privacy-subject binding. This payload is therefore safe to erase
/// cryptographically without turning a retained alias into an authority key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GamePersonaPresentation {
    pub public_name: GamePersonaName,
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
    fn opaque_ids_are_uuid_backed_and_round_trip() {
        let persona = GamePersonaId::random();
        let occupancy = OccupancyId::random();
        let transition = OccupancyTransitionId::random();
        assert_eq!(
            persona.to_string().parse::<Uuid>().unwrap(),
            persona.as_uuid()
        );
        assert_eq!(
            occupancy.to_string().parse::<Uuid>().unwrap(),
            occupancy.as_uuid()
        );
        assert_eq!(
            transition.to_string().parse::<Uuid>().unwrap(),
            transition.as_uuid()
        );
        assert_eq!(
            serde_json::from_str::<GamePersonaId>(&serde_json::to_string(&persona).unwrap())
                .unwrap(),
            persona
        );
        assert_eq!(
            serde_json::from_str::<OccupancyId>(&serde_json::to_string(&occupancy).unwrap())
                .unwrap(),
            occupancy
        );
        assert_eq!(
            serde_json::from_str::<OccupancyTransitionId>(
                &serde_json::to_string(&transition).unwrap()
            )
            .unwrap(),
            transition
        );
    }
}
