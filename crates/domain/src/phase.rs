//! The game-phase identifier grammar: one owner for parsing, composing, and
//! revote-suffix arithmetic over ids like `D01`, `N12`, and `D03R2`.

use crate::pack::PhaseKind;
use std::fmt;

/// A parsed game-phase identifier borrowing its source text.
///
/// The grammar is `{D|N|T}{digits}` with an optional trailing revote suffix
/// `{base}R{attempt}`. Parsing tolerates trailing characters after the leading
/// digits (for example `D01R2` parses with number `1`) and canonical
/// composition zero-pads the number to two digits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PhaseId<'id> {
    raw: &'id str,
    kind: PhaseKind,
    number: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PhaseIdError {
    UnknownKind { phase_id: String },
    MissingNumber { phase_id: String },
}

impl fmt::Display for PhaseIdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PhaseIdError::UnknownKind { phase_id } => {
                write!(f, "unknown phase id `{phase_id}`")
            }
            PhaseIdError::MissingNumber { phase_id } => {
                write!(f, "phase id `{phase_id}` has no numeric number")
            }
        }
    }
}

impl std::error::Error for PhaseIdError {}

impl<'id> PhaseId<'id> {
    pub fn parse(phase_id: &'id str) -> Result<Self, PhaseIdError> {
        let kind = match phase_id.chars().next() {
            Some('D') => PhaseKind::Day,
            Some('N') => PhaseKind::Night,
            Some('T') => PhaseKind::Twilight,
            _ => {
                return Err(PhaseIdError::UnknownKind {
                    phase_id: phase_id.to_string(),
                })
            }
        };
        let digits: String = phase_id
            .chars()
            .skip(1)
            .take_while(char::is_ascii_digit)
            .collect();
        let number = digits.parse().map_err(|_| PhaseIdError::MissingNumber {
            phase_id: phase_id.to_string(),
        })?;
        Ok(Self {
            raw: phase_id,
            kind,
            number,
        })
    }

    pub fn as_str(self) -> &'id str {
        self.raw
    }

    pub fn kind(self) -> PhaseKind {
        self.kind
    }

    pub fn number(self) -> u32 {
        self.number
    }

    /// The number only when the identifier is exactly `{code}{digits}` —
    /// no revote suffix and no trailing characters (`D03` -> `Some(3)`,
    /// `D03R1` and `D03x` -> `None`).
    pub fn plain_number(self) -> Option<u32> {
        let rest = &self.raw[1..];
        (!rest.is_empty() && rest.bytes().all(|byte| byte.is_ascii_digit())).then_some(self.number)
    }

    /// Strips a trailing numeric revote suffix (`D03R2` -> `D03`). Ids whose
    /// suffix is absent or non-numeric are returned unchanged.
    pub fn revote_base(self) -> &'id str {
        if let Some((base, suffix)) = self.raw.split_once('R') {
            if !base.is_empty() && suffix.parse::<u32>().is_ok() {
                return base;
            }
        }
        self.raw
    }

    /// Composes the canonical form carried on the wire and in storage.
    pub fn compose(kind: PhaseKind, number: u32) -> String {
        format!("{}{number:02}", kind.code())
    }
}

#[cfg(test)]
mod tests {
    use super::{PhaseId, PhaseIdError};
    use crate::pack::PhaseKind;

    #[test]
    fn parse_extracts_kind_and_leading_number() {
        let parsed = PhaseId::parse("D12").expect("canonical day id parses");
        assert_eq!(parsed.kind(), PhaseKind::Day);
        assert_eq!(parsed.number(), 12);
        assert_eq!(parsed.as_str(), "D12");

        let night = PhaseId::parse("N3").expect("single-digit night id parses");
        assert_eq!(night.kind(), PhaseKind::Night);
        assert_eq!(night.number(), 3);

        assert_eq!(
            PhaseId::parse("T07").expect("twilight id parses").kind(),
            PhaseKind::Twilight
        );
    }

    #[test]
    fn parse_tolerates_trailing_suffix_and_rejects_malformed_ids() {
        let revote = PhaseId::parse("D01R2").expect("revote id parses");
        assert_eq!(revote.number(), 1);

        assert_eq!(
            PhaseId::parse("X01"),
            Err(PhaseIdError::UnknownKind {
                phase_id: "X01".to_string()
            })
        );
        assert_eq!(
            PhaseId::parse("D"),
            Err(PhaseIdError::MissingNumber {
                phase_id: "D".to_string()
            })
        );
    }

    #[test]
    fn revote_base_strips_only_numeric_suffixes() {
        assert_eq!(PhaseId::parse("D03").unwrap().revote_base(), "D03");
        assert_eq!(PhaseId::parse("D03R2").unwrap().revote_base(), "D03");
        assert_eq!(PhaseId::parse("D03Rx").unwrap().revote_base(), "D03Rx");
    }

    #[test]
    fn plain_number_requires_the_exact_canonical_form() {
        assert_eq!(PhaseId::parse("D03").unwrap().plain_number(), Some(3));
        assert_eq!(PhaseId::parse("D3").unwrap().plain_number(), Some(3));
        assert_eq!(PhaseId::parse("D03R1").unwrap().plain_number(), None);
        assert_eq!(PhaseId::parse("D03x").unwrap().plain_number(), None);
        assert_eq!(PhaseId::parse("N02").unwrap().plain_number(), Some(2));
    }

    #[test]
    fn compose_is_the_canonical_two_digit_form() {
        assert_eq!(PhaseId::compose(PhaseKind::Day, 1), "D01");
        assert_eq!(PhaseId::compose(PhaseKind::Night, 41), "N41");
        assert_eq!(PhaseId::compose(PhaseKind::Twilight, 255), "T255");

        let composed = PhaseId::compose(PhaseKind::Day, 7);
        let reparsed = PhaseId::parse(&composed).expect("composed id re-parses");
        assert_eq!(reparsed.kind(), PhaseKind::Day);
        assert_eq!(reparsed.number(), 7);
    }
}
