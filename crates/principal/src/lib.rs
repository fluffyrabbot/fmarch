//! The platform's authenticated authority identity.
//!
//! A [`PrincipalId`] is deliberately distinct from provider subjects, account
//! names, profile identifiers, game personas, and privacy subjects. It is the
//! sole identifier that may carry platform authority.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use std::str::FromStr;
use uuid::Uuid;

/// Opaque, randomly generated platform authority identifier.
///
/// Its JSON representation is the canonical UUID string. It is never derived
/// from an account name or a provider-owned subject.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[cfg_attr(feature = "typescript", ts(type = "string"))]
pub struct PrincipalId(Uuid);

impl PrincipalId {
    /// Mint a platform principal. This is the only construction path for a
    /// new authority root.
    pub fn random() -> Self {
        Self(Uuid::new_v4())
    }

    pub const fn from_uuid(value: Uuid) -> Self {
        Self(value)
    }

    pub const fn as_uuid(self) -> Uuid {
        self.0
    }

    /// Deterministically derives a UUID-backed principal for a local fixture.
    ///
    /// This is intentionally explicit and must never be used for a production
    /// identity: real authority roots are minted with [`Self::random`]. It
    /// keeps tests and proof scenarios readable without reintroducing textual
    /// principal identifiers into production APIs.
    #[doc(hidden)]
    pub fn fixture(label: impl AsRef<str>) -> Self {
        const FIXTURE_NAMESPACE: Uuid = Uuid::from_u128(0x3f1076f9_0813_5eae_8105_dcd8739f5f2d);
        Self(Uuid::new_v5(&FIXTURE_NAMESPACE, label.as_ref().as_bytes()))
    }
}

impl From<Uuid> for PrincipalId {
    fn from(value: Uuid) -> Self {
        Self::from_uuid(value)
    }
}

impl From<PrincipalId> for Uuid {
    fn from(value: PrincipalId) -> Self {
        value.as_uuid()
    }
}

impl Serialize for PrincipalId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for PrincipalId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Uuid::deserialize(deserializer).map(Self::from_uuid)
    }
}

impl FromStr for PrincipalId {
    type Err = uuid::Error;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        value.parse().map(Self::from_uuid)
    }
}

impl fmt::Display for PrincipalId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[cfg(test)]
mod tests {
    use super::PrincipalId;
    use std::str::FromStr;
    use uuid::Uuid;

    #[test]
    fn serializes_as_a_canonical_uuid_string() {
        let id = PrincipalId::from_uuid(Uuid::from_u128(1));
        assert_eq!(
            serde_json::to_string(&id).unwrap(),
            "\"00000000-0000-0000-0000-000000000001\""
        );
        assert_eq!(
            serde_json::from_str::<PrincipalId>("\"00000000-0000-0000-0000-000000000001\"")
                .unwrap(),
            id
        );
        assert_eq!(PrincipalId::from_str(&id.to_string()).unwrap(), id);
    }

    #[test]
    fn fixture_identity_is_stable_but_distinct_from_authority_minting() {
        assert_eq!(PrincipalId::fixture("host"), PrincipalId::fixture("host"));
        assert_ne!(PrincipalId::fixture("host"), PrincipalId::fixture("player"));
    }
}
