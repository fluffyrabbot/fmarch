use sqlx::PgPool;
use std::collections::HashSet;
use tokio::sync::broadcast;
use uuid::Uuid;
use wire::{ProjectionDelta, VoteCountClearedDelta, VoteCountDelta};

#[derive(Debug, Clone)]
pub(super) struct LiveProjectionChangeSet {
    pub(super) game: Uuid,
    pub(super) previous_vote_counts: Option<Vec<VoteCountDelta>>,
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
    pub(super) thread_dirty: bool,
    pub(super) host_console_dirty: bool,
    pub(super) host_prompts_dirty: bool,
    pub(super) player_private_dirty: bool,
    pub(super) player_command_state_dirty: bool,
}

#[derive(Clone)]
pub(super) struct LiveProjectionPublisher {
    sender: broadcast::Sender<LiveProjectionUpdate>,
}

impl LiveProjectionPublisher {
    pub(super) fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity.clamp(1, 65_536));
        Self { sender }
    }

    pub(super) fn subscribe(&self) -> broadcast::Receiver<LiveProjectionUpdate> {
        self.sender.subscribe()
    }

    pub(super) async fn publish(&self, pool: &PgPool, change: LiveProjectionChangeSet) {
        let Ok(current) = vote_count_rows(pool, change.game).await else {
            return;
        };
        if let Some(update) = assemble_update(change, current) {
            let _ = self.sender.send(update);
        }
    }
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
    let mut deltas: Vec<_> = current
        .iter()
        .cloned()
        .map(ProjectionDelta::VoteCountChanged)
        .collect();

    if let Some(previous) = change.previous_vote_counts {
        let current_keys: HashSet<_> = current
            .iter()
            .map(|delta| (delta.phase_id.as_str(), delta.candidate_slot.as_str()))
            .collect();
        deltas.extend(
            previous
                .into_iter()
                .filter(|delta| {
                    !current_keys
                        .contains(&(delta.phase_id.as_str(), delta.candidate_slot.as_str()))
                })
                .map(VoteCountClearedDelta::from)
                .map(ProjectionDelta::VoteCountCleared),
        );
    }

    if deltas.is_empty()
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

#[cfg(test)]
mod tests {
    use super::*;

    fn vote(game: Uuid, candidate_slot: &str, count: i64) -> VoteCountDelta {
        VoteCountDelta {
            game,
            phase_id: "D01".to_string(),
            candidate_slot: candidate_slot.to_string(),
            count,
        }
    }

    fn change(game: Uuid) -> LiveProjectionChangeSet {
        LiveProjectionChangeSet {
            game,
            previous_vote_counts: None,
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
                    phase_id: "D01".to_string(),
                    candidate_slot: "slot-1".to_string(),
                }),
            ]
        );
    }

    #[test]
    fn update_assembly_suppresses_empty_clean_publications() {
        assert!(assemble_update(change(Uuid::new_v4()), Vec::new()).is_none());
    }

    #[tokio::test]
    async fn bounded_receiver_reports_lag_and_then_continues() {
        let publisher = LiveProjectionPublisher::new(1);
        let mut receiver = publisher.subscribe();
        let game = Uuid::new_v4();
        let update = LiveProjectionUpdate {
            game,
            deltas: Vec::new(),
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
