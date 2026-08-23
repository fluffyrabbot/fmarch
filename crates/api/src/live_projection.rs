use sqlx::PgPool;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use uuid::Uuid;
use wire::{ProjectionDelta, VoteCountClearedDelta, VoteCountDelta};

#[derive(Debug, Clone)]
pub(super) struct LiveProjectionChangeSet {
    pub(super) game: Uuid,
    pub(super) previous_vote_counts: Option<Vec<VoteCountDelta>>,
    pub(super) thread_after_seq: Option<i64>,
    pub(super) thread_dirty: bool,
    pub(super) host_console_dirty: bool,
    pub(super) host_prompts_dirty: bool,
    pub(super) player_private_dirty: bool,
    pub(super) player_command_state_dirty: bool,
}

#[derive(Debug, Clone)]
pub(super) struct LiveProjectionUpdate {
    pub(super) game: Uuid,
    pub(super) deltas: Vec<ProjectionDelta>,
    pub(super) thread_after_seq: Option<i64>,
    pub(super) thread_dirty: bool,
    pub(super) host_console_dirty: bool,
    pub(super) host_prompts_dirty: bool,
    pub(super) player_private_dirty: bool,
    pub(super) player_command_state_dirty: bool,
}

#[derive(Clone)]
pub(super) struct LiveProjectionPublisher {
    sender: broadcast::Sender<LiveProjectionUpdate>,
    inflight: Arc<Mutex<HashMap<Uuid, usize>>>,
}

pub(super) struct LiveProjectionInflightGuard {
    publisher: LiveProjectionPublisher,
    game: Uuid,
}

impl Drop for LiveProjectionInflightGuard {
    fn drop(&mut self) {
        self.publisher.end_inflight(self.game);
    }
}

impl LiveProjectionPublisher {
    pub(super) fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity.clamp(1, 65_536));
        Self {
            sender,
            inflight: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(super) fn subscribe(&self) -> broadcast::Receiver<LiveProjectionUpdate> {
        self.sender.subscribe()
    }

    pub(super) fn inflight_guard(&self, game: Uuid) -> LiveProjectionInflightGuard {
        self.begin_inflight(game);
        LiveProjectionInflightGuard {
            publisher: self.clone(),
            game,
        }
    }

    fn begin_inflight(&self, game: Uuid) {
        let mut inflight = lock_inflight(&self.inflight);
        *inflight.entry(game).or_insert(0) += 1;
    }

    fn end_inflight(&self, game: Uuid) {
        let mut inflight = lock_inflight(&self.inflight);
        let Some(count) = inflight.get_mut(&game) else {
            return;
        };
        *count = count.saturating_sub(1);
        if *count == 0 {
            inflight.remove(&game);
        }
    }

    pub(super) fn has_inflight(&self, game: Uuid) -> bool {
        lock_inflight(&self.inflight)
            .get(&game)
            .is_some_and(|count| *count > 0)
    }

    pub(super) async fn publish(&self, pool: &PgPool, change: LiveProjectionChangeSet) {
        let current = if change.previous_vote_counts.is_some() {
            let Ok(current) = vote_count_rows(pool, change.game).await else {
                return;
            };
            current
        } else {
            Vec::new()
        };
        if let Some(update) = assemble_update(change, current) {
            let _ = self.sender.send(update);
        }
    }
}

fn lock_inflight(
    inflight: &Mutex<HashMap<Uuid, usize>>,
) -> std::sync::MutexGuard<'_, HashMap<Uuid, usize>> {
    inflight
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub(super) async fn thread_high_water_seq(
    pool: &PgPool,
    game: Uuid,
) -> Result<i64, projections::ProjectionError> {
    projections::thread_high_water_seq(pool, game).await
}

pub(super) async fn vote_count_rows(
    pool: &PgPool,
    game: Uuid,
) -> Result<Vec<VoteCountDelta>, projections::ProjectionError> {
    let rows = projections::votecount(pool, game).await?;
    Ok(rows.into_iter().map(VoteCountDelta::from).collect())
}

pub(super) async fn vote_count_deltas(
    pool: &PgPool,
    game: Uuid,
) -> Result<Vec<ProjectionDelta>, projections::ProjectionError> {
    Ok(vote_count_rows(pool, game)
        .await?
        .into_iter()
        .map(ProjectionDelta::VoteCountChanged)
        .collect())
}

fn assemble_update(
    change: LiveProjectionChangeSet,
    current: Vec<VoteCountDelta>,
) -> Option<LiveProjectionUpdate> {
    let mut deltas = Vec::new();
    if let Some(previous) = change.previous_vote_counts {
        let current_keys: HashSet<(domain::phase::PhaseId, String)> = current
            .iter()
            .map(|delta| (delta.phase_id.clone(), delta.candidate_slot.clone()))
            .collect();
        let previous_counts: HashMap<(domain::phase::PhaseId, String), i64> = previous
            .iter()
            .map(|delta| {
                (
                    (delta.phase_id.clone(), delta.candidate_slot.clone()),
                    delta.count,
                )
            })
            .collect();
        let vanished = previous
            .into_iter()
            .filter(|delta| {
                !current_keys.contains(&(delta.phase_id.clone(), delta.candidate_slot.clone()))
            })
            .collect::<Vec<_>>();
        deltas.extend(current.into_iter().filter_map(|delta| {
            let key = (delta.phase_id.clone(), delta.candidate_slot.clone());
            match previous_counts.get(&key) {
                Some(&count) if count == delta.count => None,
                _ => Some(ProjectionDelta::VoteCountChanged(delta)),
            }
        }));
        deltas.extend(
            vanished
                .into_iter()
                .map(VoteCountClearedDelta::from)
                .map(ProjectionDelta::VoteCountCleared),
        );
    }

    if deltas.is_empty()
        && change.thread_after_seq.is_none()
        && !change.thread_dirty
        && !change.host_console_dirty
        && !change.host_prompts_dirty
        && !change.player_private_dirty
        && !change.player_command_state_dirty
    {
        return None;
    }

    Some(LiveProjectionUpdate {
        game: change.game,
        deltas,
        thread_after_seq: change.thread_after_seq,
        thread_dirty: change.thread_dirty,
        host_console_dirty: change.host_console_dirty,
        host_prompts_dirty: change.host_prompts_dirty,
        player_private_dirty: change.player_private_dirty,
        player_command_state_dirty: change.player_command_state_dirty,
    })
}

pub(super) enum LiveProjectionReceive {
    Update(LiveProjectionUpdate),
    Lagged { dropped_messages: u64 },
    Closed,
}

pub(super) async fn receive(
    receiver: &mut broadcast::Receiver<LiveProjectionUpdate>,
) -> LiveProjectionReceive {
    match receiver.recv().await {
        Ok(update) => LiveProjectionReceive::Update(update),
        Err(broadcast::error::RecvError::Lagged(dropped_messages)) => {
            LiveProjectionReceive::Lagged { dropped_messages }
        }
        Err(broadcast::error::RecvError::Closed) => LiveProjectionReceive::Closed,
    }
}

pub(super) fn try_receive(
    receiver: &mut broadcast::Receiver<LiveProjectionUpdate>,
) -> Option<LiveProjectionReceive> {
    match receiver.try_recv() {
        Ok(update) => Some(LiveProjectionReceive::Update(update)),
        Err(broadcast::error::TryRecvError::Lagged(dropped_messages)) => {
            Some(LiveProjectionReceive::Lagged { dropped_messages })
        }
        Err(broadcast::error::TryRecvError::Closed) => Some(LiveProjectionReceive::Closed),
        Err(broadcast::error::TryRecvError::Empty) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn phase_id() -> domain::phase::PhaseId {
        domain::phase::PhaseId::parse("D01").expect("static test phase id is canonical")
    }

    fn vote(game: Uuid, candidate_slot: &str, count: i64) -> VoteCountDelta {
        VoteCountDelta {
            game,
            phase_id: phase_id(),
            candidate_slot: candidate_slot.to_string(),
            count,
        }
    }

    fn change(game: Uuid) -> LiveProjectionChangeSet {
        LiveProjectionChangeSet {
            game,
            previous_vote_counts: None,
            thread_after_seq: None,
            thread_dirty: false,
            host_console_dirty: false,
            host_prompts_dirty: false,
            player_private_dirty: false,
            player_command_state_dirty: false,
        }
    }

    #[test]
    fn update_assembly_preserves_current_order_then_emits_removed_vote_counts() {
        let game = Uuid::new_v4();
        let mut change = change(game);
        change.previous_vote_counts = Some(vec![vote(game, "slot-1", 1), vote(game, "slot-2", 1)]);

        let update = assemble_update(change, vec![vote(game, "slot-2", 2)]).unwrap();

        assert_eq!(
            update.deltas,
            vec![
                ProjectionDelta::VoteCountChanged(vote(game, "slot-2", 2)),
                ProjectionDelta::VoteCountCleared(VoteCountClearedDelta {
                    game,
                    phase_id: phase_id(),
                    candidate_slot: "slot-1".to_string(),
                }),
            ]
        );
    }

    #[test]
    fn update_assembly_omits_unchanged_vote_counts() {
        let game = Uuid::new_v4();
        let mut change = change(game);
        change.previous_vote_counts = Some(vec![vote(game, "slot-1", 1), vote(game, "slot-2", 2)]);

        let update = assemble_update(
            change,
            vec![vote(game, "slot-1", 1), vote(game, "slot-2", 3)],
        )
        .unwrap();

        assert_eq!(
            update.deltas,
            vec![ProjectionDelta::VoteCountChanged(vote(game, "slot-2", 3))]
        );
    }

    #[test]
    fn update_assembly_skips_vote_io_without_a_previous_snapshot() {
        let game = Uuid::new_v4();
        let mut change = change(game);
        change.thread_dirty = true;
        let update = assemble_update(change, vec![vote(game, "slot-1", 4)]).unwrap();
        assert!(update.deltas.is_empty());
        assert!(update.thread_dirty);
    }

    #[test]
    fn update_assembly_suppresses_empty_clean_publications() {
        assert!(assemble_update(change(Uuid::new_v4()), Vec::new()).is_none());
    }

    #[test]
    fn inflight_guard_tracks_nested_same_game_publications() {
        let publisher = LiveProjectionPublisher::new(8);
        let game = Uuid::new_v4();
        assert!(!publisher.has_inflight(game));
        let outer = publisher.inflight_guard(game);
        assert!(publisher.has_inflight(game));
        {
            let inner = publisher.inflight_guard(game);
            assert!(publisher.has_inflight(game));
            drop(inner);
            assert!(publisher.has_inflight(game));
        }
        drop(outer);
        assert!(!publisher.has_inflight(game));
    }

    #[test]
    fn try_receive_is_empty_until_a_publication_arrives() {
        let publisher = LiveProjectionPublisher::new(8);
        let mut receiver = publisher.subscribe();
        assert!(try_receive(&mut receiver).is_none());
        let game = Uuid::new_v4();
        let update = LiveProjectionUpdate {
            game,
            deltas: Vec::new(),
            thread_after_seq: None,
            thread_dirty: true,
            host_console_dirty: false,
            host_prompts_dirty: false,
            player_private_dirty: false,
            player_command_state_dirty: false,
        };
        publisher.sender.send(update).unwrap();
        assert!(matches!(
            try_receive(&mut receiver),
            Some(LiveProjectionReceive::Update(received)) if received.game == game
        ));
        assert!(try_receive(&mut receiver).is_none());
    }

    #[tokio::test]
    async fn bounded_receiver_reports_lag_and_then_continues() {
        let publisher = LiveProjectionPublisher::new(1);
        let mut receiver = publisher.subscribe();
        let game = Uuid::new_v4();
        let update = LiveProjectionUpdate {
            game,
            deltas: Vec::new(),
            thread_after_seq: None,
            thread_dirty: true,
            host_console_dirty: false,
            host_prompts_dirty: false,
            player_private_dirty: false,
            player_command_state_dirty: false,
        };
        publisher.sender.send(update.clone()).unwrap();
        publisher.sender.send(update).unwrap();

        assert!(matches!(
            receive(&mut receiver).await,
            LiveProjectionReceive::Lagged {
                dropped_messages: 1
            }
        ));
        assert!(matches!(
            receive(&mut receiver).await,
            LiveProjectionReceive::Update(update) if update.game == game
        ));
    }
}
