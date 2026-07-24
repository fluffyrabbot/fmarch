//! Pure automatic DayEvent winner selection.
//!
//! Inputs are canonicalized before policy evaluation. Seeded selection ranks
//! each stable slot identity by a keyed digest, so replay requires no RNG
//! implementation state beyond the seed recorded in the event stream.

use std::collections::BTreeSet;

use crate::{AutoResolvePolicy, ModelError, SlotId};

pub fn select_winners(
    policy: AutoResolvePolicy,
    participant_slots: &[SlotId],
    seed: Option<u64>,
) -> Result<Vec<SlotId>, ModelError> {
    policy.validate()?;
    let mut participants = participant_slots.to_vec();
    participants.sort();
    let unique = participants.iter().cloned().collect::<BTreeSet<_>>();
    if unique.len() != participants.len() {
        let duplicate = participants
            .windows(2)
            .find(|pair| pair[0] == pair[1])
            .expect("a duplicate exists when unique length differs")[0]
            .clone();
        return Err(ModelError::DuplicateAutoParticipant(duplicate));
    }
    let required = policy.winner_count();
    if participants.len() < required as usize {
        return Err(ModelError::InsufficientAutoParticipants {
            required,
            actual: participants.len(),
        });
    }

    match policy {
        AutoResolvePolicy::FirstN { .. } => {}
        AutoResolvePolicy::SeededRandom { .. } => {
            let seed = seed.ok_or(ModelError::MissingAutoSeed)?;
            participants.sort_by(|left, right| {
                seeded_rank(seed, left)
                    .as_bytes()
                    .cmp(seeded_rank(seed, right).as_bytes())
                    .then_with(|| left.cmp(right))
            });
        }
    }
    participants.truncate(required as usize);
    Ok(participants)
}

fn seeded_rank(seed: u64, slot: &SlotId) -> blake3::Hash {
    let mut input = Vec::with_capacity(8 + slot.as_str().len());
    input.extend_from_slice(&seed.to_le_bytes());
    input.extend_from_slice(slot.as_str().as_bytes());
    blake3::hash(&input)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slots(values: &[&str]) -> Vec<SlotId> {
        values
            .iter()
            .map(|value| SlotId::new(*value).unwrap())
            .collect()
    }

    #[test]
    fn first_n_is_canonical_and_seedless() {
        assert_eq!(
            select_winners(
                AutoResolvePolicy::FirstN { winners: 2 },
                &slots(&["slot_3", "slot_1", "slot_2"]),
                None,
            )
            .unwrap(),
            slots(&["slot_1", "slot_2"])
        );
    }

    #[test]
    fn seeded_random_is_replayable_and_seed_sensitive() {
        let participants = slots(&["slot_1", "slot_2", "slot_3", "slot_4"]);
        let first = select_winners(
            AutoResolvePolicy::SeededRandom { winners: 2 },
            &participants,
            Some(41),
        )
        .unwrap();
        let replay = select_winners(
            AutoResolvePolicy::SeededRandom { winners: 2 },
            &participants,
            Some(41),
        )
        .unwrap();
        let other = select_winners(
            AutoResolvePolicy::SeededRandom { winners: 2 },
            &participants,
            Some(42),
        )
        .unwrap();
        assert_eq!(first, replay);
        assert_ne!(first, other);
    }

    #[test]
    fn invalid_inputs_fail_closed() {
        assert!(matches!(
            select_winners(
                AutoResolvePolicy::SeededRandom { winners: 1 },
                &slots(&["slot_1"]),
                None,
            ),
            Err(ModelError::MissingAutoSeed)
        ));
        assert!(matches!(
            select_winners(
                AutoResolvePolicy::FirstN { winners: 2 },
                &slots(&["slot_1"]),
                None,
            ),
            Err(ModelError::InsufficientAutoParticipants {
                required: 2,
                actual: 1
            })
        ));
    }
}
