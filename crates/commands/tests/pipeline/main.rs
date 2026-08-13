//! Integration tests for the command pipeline against REAL Postgres.
//!
//! `#[sqlx::test(migrations = "../projections/migrations")]` provisions an
//! ephemeral DB and applies the full schema (event store + projections, incl.
//! the Phase-3 ballot/authority/occupancy/phase tables). Requires `DATABASE_URL`
//! (compose PG :5544); it never silently passes without a DB.
//!
//! The CENTERPIECE is `replacement_preserves_slot_history_and_transfers_authority`
//! — the unfixable User≠Slot call (doc 01): replacement keeps the slot's votes
//! and posts while moving authority from the outgoing to the incoming user.

// Each shared helper is used by at least one of the two deliberately disjoint
// integration targets; it need not be used by both targets independently.
#[allow(dead_code)]
mod common;
mod day_events;
mod quotations;
#[allow(dead_code, unused_imports)]
mod residual;
