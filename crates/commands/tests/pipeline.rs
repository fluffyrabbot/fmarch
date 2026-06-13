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

use caps::Principal;
use commands::{handle, Ack, Command, Reject, VoteTarget};
use projections::votecount;
use sqlx::PgPool;
use uuid::Uuid;

// ───────────────────────── helpers ─────────────────────────

fn user(id: &str) -> Principal {
    Principal::user(id)
}

/// Stand up a running game: host H creates it, adds slot S, assigns user A into
/// S, assigns a role, starts the game, and opens a Day phase. Returns (game_id).
async fn setup_game(pool: &PgPool, host: &str, slot: &str, occupant: &str) -> Uuid {
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
        },
    )
    .await
    .expect("create game");
    handle(
        pool,
        &h,
        Command::AddSlot {
            game,
            slot: slot.into(),
        },
    )
    .await
    .expect("add slot");
    handle(
        pool,
        &h,
        Command::AssignSlot {
            game,
            slot: slot.into(),
            user: occupant.into(),
        },
    )
    .await
    .expect("assign slot");
    handle(
        pool,
        &h,
        Command::AssignRole {
            game,
            slot: slot.into(),
            role_key: "vanilla_townie".into(),
        },
    )
    .await
    .expect("assign role");
    handle(
        pool,
        &h,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .expect("start game");
    game
}

/// Count of current ballots targeting `target` in `phase`.
async fn tally_for(pool: &PgPool, game: Uuid, phase: &str, target: &str) -> i64 {
    votecount(pool, game)
        .await
        .unwrap()
        .into_iter()
        .find(|r| r.phase_id == phase && r.candidate_slot == target)
        .map(|r| r.count)
        .unwrap_or(0)
}

// ───────────────────────── THE CENTERPIECE ─────────────────────────

/// REPLACEMENT PROOF (the DOD): slot S occupied by A; A votes (as S) for T and
/// posts as S; then ProcessReplacement(S, A→B). Assert:
///   (a) S's vote STILL tallies for T,
///   (b) S's post is STILL attributed to slot S (in the event log),
///   (c) B now resolves SlotOccupant(S) and can vote as S,
///   (d) A can no longer act as S → NotYourSlot.
/// The slot's history is preserved because it attaches to S, not to the user.
#[sqlx::test(migrations = "../projections/migrations")]
async fn replacement_preserves_slot_history_and_transfers_authority(pool: PgPool) {
    let host = "host_h";
    let slot = "slot_7";
    let a = "user_a";
    let b = "user_b";
    let target = "slot_target";

    let game = setup_game(&pool, host, slot, a).await;
    // A second slot to serve as the vote target.
    handle(
        &pool,
        &user(host),
        Command::AddSlot {
            game,
            slot: target.into(),
        },
    )
    .await
    .unwrap();

    // A acts as S: votes T and posts.
    handle(
        &pool,
        &user(a),
        Command::SubmitVote {
            game,
            actor_slot: slot.into(),
            target: VoteTarget::Slot(target.into()),
        },
    )
    .await
    .expect("A votes as S");
    let post_ack = handle(
        &pool,
        &user(a),
        Command::SubmitPost {
            game,
            actor_slot: slot.into(),
            body: "I am slot 7".into(),
        },
    )
    .await
    .expect("A posts as S");
    assert!(!post_ack.stream_seqs.is_empty());

    // Pre-replacement: S's ballot tallies for T.
    assert_eq!(tally_for(&pool, game, "D01", target).await, 1, "S voted T");

    // ── THE REPLACEMENT: A → B on the SAME slot id S ──
    handle(
        &pool,
        &user(host),
        Command::ProcessReplacement {
            game,
            slot: slot.into(),
            outgoing_user: a.into(),
            incoming_user: b.into(),
        },
    )
    .await
    .expect("host processes replacement");

    // (a) S's vote STILL tallies for T — the ballot is keyed by slot, not user.
    assert_eq!(
        tally_for(&pool, game, "D01", target).await,
        1,
        "(a) S's vote survives replacement (attached to the slot)"
    );

    // (b) S's post is STILL attributed to slot S in the event log.
    let posts = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted'",
    )
    .bind(game)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(posts.len(), 1, "one post");
    assert_eq!(
        posts[0]["slot_or_user"]["slot"], slot,
        "(b) post authorship is the SLOT id, untouched by replacement"
    );

    // (c) B now resolves SlotOccupant(S) and can vote as S.
    let b_caps = caps::resolve(&pool, &user(b), game).await.unwrap();
    assert!(
        b_caps.grants(&caps::Capability::SlotOccupant(slot.to_string())),
        "(c) incoming user B holds SlotOccupant(S)"
    );
    handle(
        &pool,
        &user(b),
        Command::SubmitVote {
            game,
            actor_slot: slot.into(),
            target: VoteTarget::NoLynch,
        },
    )
    .await
    .expect("(c) B can act as S");
    // B's new ballot OVERWRITES S's prior ballot → T drops to 0, no_lynch is 1.
    assert_eq!(tally_for(&pool, game, "D01", target).await, 0);
    assert_eq!(tally_for(&pool, game, "D01", "no_lynch").await, 1);

    // (d) A can no longer act as S → NotYourSlot.
    let a_err = handle(
        &pool,
        &user(a),
        Command::SubmitVote {
            game,
            actor_slot: slot.into(),
            target: VoteTarget::NoLynch,
        },
    )
    .await
    .expect_err("(d) A is no longer the occupant");
    assert_eq!(a_err, Reject::NotYourSlot, "(d) A → NotYourSlot");

    // And A no longer resolves the capability at all.
    let a_caps = caps::resolve(&pool, &user(a), game).await.unwrap();
    assert!(
        !a_caps.grants(&caps::Capability::SlotOccupant(slot.to_string())),
        "(d) outgoing user A lost SlotOccupant(S)"
    );
}

// ───────────────────────── capability enforcement ─────────────────────────

#[sqlx::test(migrations = "../projections/migrations")]
async fn non_host_extend_deadline_is_rejected_host_acks(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;

    // A non-host (the slot occupant) tries to extend the deadline.
    let err = handle(
        &pool,
        &user("user_a"),
        Command::ExtendDeadline {
            game,
            phase: "D01".into(),
            at: 999,
        },
    )
    .await
    .expect_err("non-host cannot extend deadline");
    assert_eq!(err, Reject::NotHost);

    // The host can.
    let ack = handle(
        &pool,
        &user("host_h"),
        Command::ExtendDeadline {
            game,
            phase: "D01".into(),
            at: 999,
        },
    )
    .await
    .expect("host extends deadline");
    assert!(!ack.stream_seqs.is_empty());

    // A cohost (delegated authority) can too.
    handle(
        &pool,
        &user("host_h"),
        Command::AddCohost {
            game,
            user: "user_c".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_c"),
        Command::ExtendDeadline {
            game,
            phase: "D01".into(),
            at: 1000,
        },
    )
    .await
    .expect("cohost extends deadline");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn non_occupant_voting_as_slot_is_not_your_slot(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    handle(
        &pool,
        &user("host_h"),
        Command::AddSlot {
            game,
            slot: "slot_2".into(),
        },
    )
    .await
    .unwrap();

    // user_b is not the occupant of slot_1.
    let err = handle(
        &pool,
        &user("user_b"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .expect_err("non-occupant cannot vote as the slot");
    assert_eq!(err, Reject::NotYourSlot);
}

// ───────────────────────── validation ─────────────────────────

#[sqlx::test(migrations = "../projections/migrations")]
async fn vote_in_locked_phase_is_phase_locked(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    handle(
        &pool,
        &user("host_h"),
        Command::AddSlot {
            game,
            slot: "slot_2".into(),
        },
    )
    .await
    .unwrap();

    // Host locks the thread.
    handle(&pool, &user("host_h"), Command::LockThread { game })
        .await
        .expect("lock");

    let err = handle(
        &pool,
        &user("user_a"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .expect_err("vote in locked phase rejected");
    assert_eq!(err, Reject::PhaseLocked);

    // Unlock → the same vote now acks.
    handle(&pool, &user("host_h"), Command::UnlockThread { game })
        .await
        .unwrap();
    handle(
        &pool,
        &user("user_a"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .expect("vote after unlock");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn dead_slot_voting_is_slot_not_alive(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    handle(
        &pool,
        &user("host_h"),
        Command::AddSlot {
            game,
            slot: "slot_2".into(),
        },
    )
    .await
    .unwrap();

    // Kill slot_1 via a ResolutionApplied envelope (the engine's seam).
    let applied = domain::events::ResolutionApplied {
        phase_id: "N01".into(),
        phase_kind: domain::pack::PhaseKind::Night,
        phase_number: 1,
        run_id: "r1".into(),
        result_version: domain::RESULT_VERSION,
        seed: 1,
        counts: domain::events::ResolutionCounts {
            events: 1,
            kills: 1,
            saves: 0,
        },
        events: vec![domain::events::IndexedEvent {
            index: 0,
            event: domain::InnerEvent::PlayerKilled {
                slot_id: "slot_1".into(),
                cause: "factional_kill".into(),
                attackers: vec![],
                unstoppable: false,
            },
        }],
        started_at: 1,
        finished_at: 2,
    };
    projections::append_and_project(
        &pool,
        game,
        &[eventstore::EventInput::new(
            "ResolutionApplied",
            1,
            serde_json::to_value(&applied).unwrap(),
            eventstore::ActorId::System,
            2,
        )],
    )
    .await
    .unwrap();

    let err = handle(
        &pool,
        &user("user_a"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .expect_err("dead slot cannot vote");
    assert_eq!(err, Reject::SlotNotAlive);
}

// ───────────────────────── running-tally model ─────────────────────────

#[sqlx::test(migrations = "../projections/migrations")]
async fn changing_vote_overwrites_and_withdraw_removes(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    for s in ["slot_2", "slot_3"] {
        handle(
            &pool,
            &user("host_h"),
            Command::AddSlot {
                game,
                slot: s.into(),
            },
        )
        .await
        .unwrap();
    }

    // A votes slot_2, then changes to slot_3 → only ONE ballot counts (overwrite).
    handle(
        &pool,
        &user("user_a"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .unwrap();
    assert_eq!(tally_for(&pool, game, "D01", "slot_2").await, 1);

    handle(
        &pool,
        &user("user_a"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_3".into()),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        tally_for(&pool, game, "D01", "slot_2").await,
        0,
        "overwritten"
    );
    assert_eq!(
        tally_for(&pool, game, "D01", "slot_3").await,
        1,
        "no double count"
    );

    // Withdraw removes the ballot entirely.
    handle(
        &pool,
        &user("user_a"),
        Command::WithdrawVote {
            game,
            actor_slot: "slot_1".into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        tally_for(&pool, game, "D01", "slot_3").await,
        0,
        "withdrawn"
    );
}

// ───────────────────────── conflict surfacing ─────────────────────────

/// An eventstore `Conflict` surfaces — through the real pipeline `handle` — as
/// the retryable `Reject::StreamConflict`. We block the next stream slot with an
/// uncommitted concurrent append, then drive a real `handle` call that races for
/// the same slot; one wins, the other gets the typed retryable reject.
#[sqlx::test(migrations = "../projections/migrations")]
async fn conflict_surfaces_as_retryable_stream_conflict(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;

    // tx_a holds an uncommitted append at the next stream_seq (base+1). It will
    // commit shortly, so a concurrent `handle` that also computed `base` and
    // targets base+1 collides on the UNIQUE constraint → typed Conflict.
    let mut tx_a = pool.begin().await.unwrap();
    eventstore::append_in_tx(
        &mut tx_a,
        game,
        &[eventstore::EventInput::new(
            "ThreadUnlocked",
            1,
            serde_json::json!({ "channel_id": "main" }),
            eventstore::ActorId::Host,
            0,
        )],
    )
    .await
    .unwrap();

    // The pipeline call (its own pool connection). Its append blocks on tx_a's
    // uncommitted row; we commit tx_a mid-flight so the pipeline then trips the
    // UNIQUE violation rather than appending after it.
    let pool2 = pool.clone();
    let handler = async move {
        handle(
            &pool2,
            &user("host_h"),
            Command::ExtendDeadline {
                game,
                phase: "D01".into(),
                at: 5,
            },
        )
        .await
    };
    let committer = async {
        tokio::task::yield_now().await;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        tx_a.commit().await.unwrap();
    };
    let (res, ()) = tokio::join!(handler, committer);

    let err = res.expect_err("the racing handle must lose to tx_a");
    assert_eq!(
        err,
        Reject::StreamConflict,
        "Conflict → retryable StreamConflict"
    );
    assert!(err.is_retryable(), "the caller is told to reload + retry");
}

// A trivial Ack sanity helper kept to ensure the type is exercised.
#[allow(dead_code)]
fn _ack_shape(a: &Ack) -> usize {
    a.stream_seqs.len()
}
