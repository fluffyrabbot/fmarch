//! Authenticated, reader-owned checkpoints scoped to an authorized game channel.
use super::{
    post_unavailable, require_channel_thread_access, unix_now_seconds, ApiError, GameAuthorization,
    GameHttpState,
};
use attention::{ReadingCheckpoint, ReadingPosition};
use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use principal::PrincipalId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use wire::RejectCode;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct WriteCheckpoint {
    expected_revision: i64,
    position: ReadingPosition,
}
#[derive(Serialize)]
pub(super) struct CheckpointView {
    #[serde(flatten)]
    checkpoint: ReadingCheckpoint,
    available: bool,
}
async fn authorize(
    state: &GameHttpState,
    game: Uuid,
    channel: &str,
    principal: PrincipalId,
) -> Result<(), ApiError> {
    if channel == "main" {
        if projections::public_game_by_id(&state.pool, game)
            .await?
            .is_none()
        {
            return Err(post_unavailable());
        }
        Ok(())
    } else {
        require_channel_thread_access(&state.pool, game, channel, Some(principal)).await
    }
}
async fn visible(
    state: &GameHttpState,
    game: Uuid,
    channel: &str,
    position: ReadingPosition,
) -> Result<bool, ApiError> {
    Ok(projections::thread_window(
        &state.pool,
        game,
        channel,
        projections::ThreadPosition::Around(position.source_seq),
        1,
        channel == "main",
    )
    .await?
    .is_some())
}
async fn view(
    state: &GameHttpState,
    game: Uuid,
    channel: &str,
    principal: PrincipalId,
) -> Result<CheckpointView, ApiError> {
    let checkpoint = projections::reading_checkpoint(&state.pool, principal, game, channel).await?;
    let available = match checkpoint.position {
        Some(position) => visible(state, game, channel, position).await?,
        None => false,
    };
    Ok(CheckpointView {
        checkpoint,
        available,
    })
}
pub(super) async fn read(
    State(state): State<GameHttpState>,
    Path((game, channel)): Path<(Uuid, String)>,
    authorization: GameAuthorization,
) -> Result<Response, ApiError> {
    let principal = authorization.principal_id();
    authorize(&state, game, &channel, principal).await?;
    Ok((
        [(header::CACHE_CONTROL, "private, no-store")],
        Json(view(&state, game, &channel, principal).await?),
    )
        .into_response())
}
pub(super) async fn write(
    State(state): State<GameHttpState>,
    Path((game, channel)): Path<(Uuid, String)>,
    authorization: GameAuthorization,
    Json(input): Json<WriteCheckpoint>,
) -> Result<Response, ApiError> {
    let principal = authorization.principal_id();
    authorize(&state, game, &channel, principal).await?;
    if !input.position.is_valid() || !(0..9_007_199_254_740_991).contains(&input.expected_revision)
    {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::StreamConflict,
            message: "Invalid reading checkpoint.".into(),
        });
    }
    if !visible(&state, game, &channel, input.position).await? {
        return Err(post_unavailable());
    }
    let status = match projections::set_reading_checkpoint(
        &state.pool,
        principal,
        game,
        &channel,
        input.expected_revision,
        input.position,
        unix_now_seconds(),
    )
    .await
    {
        Ok(()) => StatusCode::OK,
        Err(projections::ProjectionError::Store(eventstore::StoreError::Conflict { .. })) => {
            StatusCode::CONFLICT
        }
        Err(error) => return Err(error.into()),
    };
    Ok((
        status,
        [(header::CACHE_CONTROL, "private, no-store")],
        Json(view(&state, game, &channel, principal).await?),
    )
        .into_response())
}
