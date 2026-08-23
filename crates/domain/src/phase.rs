//! Canonical game-phase vocabulary.
//!
//! A phase id is a domain value, not an arbitrary storage string. Its only
//! accepted wire form is `{D|N|T}{ordinal}` with an optional `R{revote}`:
//! `D01`, `N12`, and `D03R2` are valid; abbreviated, zero, padded, or trailing
//! variants are not. Keeping the grammar and phase kind together means every
//! consumer reasons over one representation instead of re-parsing a string.

use serde::{de::Error as _, Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use std::str::FromStr;

/// The finite phase families supported by the engine and pack model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum PhaseKind {
    Day,
    Night,
    Twilight,
}

impl PhaseKind {
    /// The single-character phase-id prefix (`D`, `N`, or `T`).
    pub const fn code(self) -> char {
        match self {
            Self::Day => 'D',
            Self::Night => 'N',
            Self::Twilight => 'T',
        }
    }

    /// The serialized enum name used by existing pack and event contracts.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Day => "Day",
            Self::Night => "Night",
            Self::Twilight => "Twilight",
        }
    }

    const fn from_code(code: u8) -> Option<Self> {
        match code {
            b'D' => Some(Self::Day),
            b'N' => Some(Self::Night),
            b'T' => Some(Self::Twilight),
            _ => None,
        }
    }
}

/// A validated, canonical phase identifier.
///
/// The representation is deliberately private. Callers must obtain one from
/// [`PhaseId::parse`] at an ingress boundary or compose it from typed parts.
/// Serialization remains a JSON string so persisted event and wire contracts
/// retain their compact shape while rejecting malformed values on read.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[cfg_attr(feature = "typescript", ts(type = "string"))]
pub struct PhaseId {
    canonical: String,
    kind: PhaseKind,
    number: u32,
    revote: Option<u32>,
}

/// Why a candidate phase id cannot become a [`PhaseId`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PhaseIdError {
    UnknownKind { phase_id: String },
    MissingOrdinal { phase_id: String },
    InvalidOrdinal { phase_id: String },
    ZeroOrdinal { phase_id: String },
    OrdinalOutOfRange { phase_id: String },
    NonCanonicalOrdinal { phase_id: String },
    MissingRevote { phase_id: String },
    InvalidRevote { phase_id: String },
    ZeroRevote { phase_id: String },
    NonCanonicalRevote { phase_id: String },
}

impl fmt::Display for PhaseIdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownKind { phase_id } => {
                write!(f, "unknown phase id kind in `{phase_id}`")
            }
            Self::MissingOrdinal { phase_id } => {
                write!(f, "phase id `{phase_id}` has no ordinal")
            }
            Self::InvalidOrdinal { phase_id } => {
                write!(f, "phase id `{phase_id}` has an invalid ordinal")
            }
            Self::ZeroOrdinal { phase_id } => {
                write!(f, "phase id `{phase_id}` has ordinal zero")
            }
            Self::OrdinalOutOfRange { phase_id } => {
                write!(
                    f,
                    "phase id `{phase_id}` exceeds the supported ordinal range"
                )
            }
            Self::NonCanonicalOrdinal { phase_id } => {
                write!(f, "phase id `{phase_id}` has a non-canonical ordinal")
            }
            Self::MissingRevote { phase_id } => {
                write!(f, "phase id `{phase_id}` has no revote attempt")
            }
            Self::InvalidRevote { phase_id } => {
                write!(f, "phase id `{phase_id}` has an invalid revote attempt")
            }
            Self::ZeroRevote { phase_id } => {
                write!(f, "phase id `{phase_id}` has revote attempt zero")
            }
            Self::NonCanonicalRevote { phase_id } => {
                write!(
                    f,
                    "phase id `{phase_id}` has a non-canonical revote attempt"
                )
            }
        }
    }
}

impl std::error::Error for PhaseIdError {}

impl PhaseId {
    /// Parse exactly one canonical phase id.
    pub fn parse(value: impl AsRef<str>) -> Result<Self, PhaseIdError> {
        let value = value.as_ref();
        let bytes = value.as_bytes();
        let Some(&kind_code) = bytes.first() else {
            return Err(PhaseIdError::UnknownKind {
                phase_id: value.to_owned(),
            });
        };
        let kind = PhaseKind::from_code(kind_code).ok_or_else(|| PhaseIdError::UnknownKind {
            phase_id: value.to_owned(),
        })?;

        let remainder = &value[1..];
        let (ordinal, revote) = match remainder.split_once('R') {
            Some((ordinal, revote)) => (ordinal, Some(revote)),
            None => (remainder, None),
        };
        let number = parse_ordinal(value, ordinal)?;
        let revote = revote
            .map(|attempt| parse_revote(value, attempt))
            .transpose()?;

        Ok(Self {
            canonical: value.to_owned(),
            kind,
            number,
            revote,
        })
    }

    /// Compose a non-revote phase id from typed parts.
    pub fn compose(kind: PhaseKind, number: u32) -> Result<Self, PhaseIdError> {
        Self::compose_with_revote(kind, number, None)
    }

    /// Compose a phase id with an optional typed, nonzero revote attempt.
    pub fn compose_with_revote(
        kind: PhaseKind,
        number: u32,
        revote: Option<u32>,
    ) -> Result<Self, PhaseIdError> {
        let canonical = match revote {
            Some(revote) => format!("{}{number:02}R{revote}", kind.code()),
            None => format!("{}{number:02}", kind.code()),
        };
        if number == 0 {
            return Err(PhaseIdError::ZeroOrdinal {
                phase_id: canonical,
            });
        }
        if number > i32::MAX as u32 {
            return Err(PhaseIdError::OrdinalOutOfRange {
                phase_id: canonical,
            });
        }
        if revote == Some(0) {
            return Err(PhaseIdError::ZeroRevote {
                phase_id: canonical,
            });
        }
        Ok(Self {
            canonical,
            kind,
            number,
            revote,
        })
    }

    /// The canonical string representation carried over storage and wire
    /// boundaries.
    pub fn as_str(&self) -> &str {
        &self.canonical
    }

    pub const fn kind(&self) -> PhaseKind {
        self.kind
    }

    /// The one-based phase ordinal, bounded by the relational `INTEGER`
    /// representation shared by command and projection storage.
    pub const fn number(&self) -> u32 {
        self.number
    }

    /// The optional one-based revote attempt.
    pub const fn revote_attempt(&self) -> Option<u32> {
        self.revote
    }

    /// Whether this is an ordinary, non-revote phase id.
    pub const fn is_plain(&self) -> bool {
        self.revote.is_none()
    }

    /// The ordinal only for an ordinary phase id. This preserves the scheduler
    /// distinction between a day and a later revote of that day.
    pub fn plain_number(&self) -> Option<u32> {
        self.is_plain().then_some(self.number)
    }

    /// The ordinary phase id underlying this id (`D03R2` becomes `D03`).
    pub fn revote_base(&self) -> Self {
        Self {
            canonical: format!("{}{:02}", self.kind.code(), self.number),
            kind: self.kind,
            number: self.number,
            revote: None,
        }
    }
}

fn parse_ordinal(phase_id: &str, ordinal: &str) -> Result<u32, PhaseIdError> {
    if ordinal.is_empty() {
        return Err(PhaseIdError::MissingOrdinal {
            phase_id: phase_id.to_owned(),
        });
    }
    if ordinal.len() < 2 {
        return Err(PhaseIdError::NonCanonicalOrdinal {
            phase_id: phase_id.to_owned(),
        });
    }
    if !ordinal.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(PhaseIdError::InvalidOrdinal {
            phase_id: phase_id.to_owned(),
        });
    }
    let number = ordinal
        .parse::<u32>()
        .map_err(|_| PhaseIdError::InvalidOrdinal {
            phase_id: phase_id.to_owned(),
        })?;
    if number == 0 {
        return Err(PhaseIdError::ZeroOrdinal {
            phase_id: phase_id.to_owned(),
        });
    }
    if number > i32::MAX as u32 {
        return Err(PhaseIdError::OrdinalOutOfRange {
            phase_id: phase_id.to_owned(),
        });
    }
    if format!("{number:02}") != ordinal {
        return Err(PhaseIdError::NonCanonicalOrdinal {
            phase_id: phase_id.to_owned(),
        });
    }
    Ok(number)
}

fn parse_revote(phase_id: &str, revote: &str) -> Result<u32, PhaseIdError> {
    if revote.is_empty() {
        return Err(PhaseIdError::MissingRevote {
            phase_id: phase_id.to_owned(),
        });
    }
    if !revote.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(PhaseIdError::InvalidRevote {
            phase_id: phase_id.to_owned(),
        });
    }
    let attempt = revote
        .parse::<u32>()
        .map_err(|_| PhaseIdError::InvalidRevote {
            phase_id: phase_id.to_owned(),
        })?;
    if attempt == 0 {
        return Err(PhaseIdError::ZeroRevote {
            phase_id: phase_id.to_owned(),
        });
    }
    if attempt.to_string() != revote {
        return Err(PhaseIdError::NonCanonicalRevote {
            phase_id: phase_id.to_owned(),
        });
    }
    Ok(attempt)
}

impl fmt::Display for PhaseId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.canonical.fmt(f)
    }
}

impl AsRef<str> for PhaseId {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl FromStr for PhaseId {
    type Err = PhaseIdError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}

impl TryFrom<&str> for PhaseId {
    type Error = PhaseIdError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::parse(value)
    }
}

impl TryFrom<String> for PhaseId {
    type Error = PhaseIdError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(value)
    }
}

impl Serialize for PhaseId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for PhaseId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(value).map_err(D::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::{PhaseId, PhaseIdError, PhaseKind};

    #[test]
    fn parse_accepts_exact_canonical_ids() {
        let day = PhaseId::parse("D01").expect("canonical day id parses");
        assert_eq!(day.kind(), PhaseKind::Day);
        assert_eq!(day.number(), 1);
        assert_eq!(day.revote_attempt(), None);
        assert_eq!(day.as_str(), "D01");

        let night = PhaseId::parse("N12").expect("multi-digit night id parses");
        assert_eq!(night.kind(), PhaseKind::Night);
        assert_eq!(night.number(), 12);

        let revote = PhaseId::parse("D03R2").expect("canonical revote parses");
        assert_eq!(revote.number(), 3);
        assert_eq!(revote.revote_attempt(), Some(2));
        assert_eq!(revote.revote_base().as_str(), "D03");
        assert_eq!(revote.plain_number(), None);
    }

    #[test]
    fn parse_rejects_noncanonical_or_trailing_forms() {
        for invalid in ["D00", "D3", "D003", "D01junk", "D01R0", "D01R02"] {
            assert!(
                PhaseId::parse(invalid).is_err(),
                "{invalid} must not become a PhaseId"
            );
        }
        assert!(matches!(
            PhaseId::parse("X01"),
            Err(PhaseIdError::UnknownKind { .. })
        ));
        assert!(matches!(
            PhaseId::parse("D"),
            Err(PhaseIdError::MissingOrdinal { .. })
        ));
        assert!(matches!(
            PhaseId::parse("D2147483648"),
            Err(PhaseIdError::OrdinalOutOfRange { .. })
        ));
    }

    #[test]
    fn compose_round_trips_only_valid_parts() {
        assert_eq!(PhaseId::compose(PhaseKind::Day, 1).unwrap().as_str(), "D01");
        assert_eq!(
            PhaseId::compose(PhaseKind::Twilight, 255).unwrap().as_str(),
            "T255"
        );
        assert_eq!(
            PhaseId::compose_with_revote(PhaseKind::Night, 12, Some(3))
                .unwrap()
                .as_str(),
            "N12R3"
        );
        assert!(PhaseId::compose(PhaseKind::Day, 0).is_err());
        assert_eq!(
            PhaseId::compose(PhaseKind::Day, i32::MAX as u32)
                .unwrap()
                .as_str(),
            "D2147483647"
        );
        assert!(matches!(
            PhaseId::compose(PhaseKind::Day, i32::MAX as u32 + 1),
            Err(PhaseIdError::OrdinalOutOfRange { .. })
        ));
        assert!(PhaseId::compose_with_revote(PhaseKind::Day, 1, Some(0)).is_err());
    }

    #[test]
    fn serde_refuses_invalid_storage_values() {
        let value: PhaseId = serde_json::from_str("\"D01R1\"").unwrap();
        assert_eq!(value.as_str(), "D01R1");
        assert!(serde_json::from_str::<PhaseId>("\"D01R02\"").is_err());
    }

    #[test]
    fn owned_string_conversion_uses_the_strict_domain_parser() {
        let value = PhaseId::try_from("N12".to_owned()).expect("canonical phase id converts");
        assert_eq!(value.as_str(), "N12");
        assert!(PhaseId::try_from("N3".to_owned()).is_err());
    }
}
