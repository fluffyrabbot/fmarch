//! Upcaster seam (doc 02).
//!
//! A small pipeline sits between the raw store row and the domain: raw row →
//! version upcast → current typed event. Old events are forever valid; replay
//! code must handle every version ever written, so upcasters are kept
//! indefinitely (doc 02 schema-evolution rules).
//!
//! For v1 this is the identity function. The seam exists so future schema
//! evolution (a v2 payload of some `kind`) is handled HERE — by mapping the old
//! shape forward — rather than scattered through the fold code. Every loaded row
//! passes through this function; that is the contract.

use crate::StoredEvent;

/// Upcast a single stored event to the current in-memory shape.
///
/// v1: identity. When a `(kind, version)` is superseded, branch here on
/// `(ev.kind.as_str(), ev.version)` and rewrite `ev.payload`/`ev.version` to the
/// current shape before returning.
pub fn upcast(ev: StoredEvent) -> StoredEvent {
    match (ev.kind.as_str(), ev.version) {
        // (example for the future)
        // ("VoteSubmitted", 1) => upcast_vote_submitted_v1_to_v2(ev),
        _ => ev,
    }
}
