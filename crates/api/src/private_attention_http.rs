//! Reader-owned review receipts over seat-owned private deliveries.
use super::{unix_now_seconds, ApiError, GameAuthorization, GameHttpState};
use axum::http::StatusCode;
use axum::{
    extract::{Path, State},
    Json,
};
use principal::PrincipalId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use wire::RejectCode;

#[derive(Serialize)]
pub(super) struct PrivateAttentionState {
    reviewed_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ReviewPrivateItem {
    item_id: String,
}

async fn delivered_ids(
    state: &GameHttpState,
    game: Uuid,
    principal: PrincipalId,
) -> Result<Vec<String>, ApiError> {
    let caps = caps::resolve(
        &state.pool,
        &caps::Principal::authenticated(principal),
        game,
    )
    .await?;
    let slots: Vec<String> = caps
        .iter()
        .filter_map(|cap| match cap {
            caps::Capability::SlotOccupant(slot) => Some(slot.clone()),
            _ => None,
        })
        .collect();
    if slots.is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::FORBIDDEN,
            error: RejectCode::NotAuthorized,
            message: "A current seat is required to read private attention.".into(),
        });
    }
    Ok(projections::private_delivery_ids_for_slots(&state.pool, game, &slots).await?)
}

pub(super) async fn read(
    State(state): State<GameHttpState>,
    Path(game): Path<Uuid>,
    authorization: GameAuthorization,
) -> Result<Json<PrivateAttentionState>, ApiError> {
    let principal = authorization.principal_id();
    let ids = delivered_ids(&state, game, principal).await?;
    let reviewed_ids =
        projections::reviewed_private_items(&state.pool, principal, game, &ids).await?;
    Ok(Json(PrivateAttentionState { reviewed_ids }))
}

pub(super) async fn review(
    State(state): State<GameHttpState>,
    Path(game): Path<Uuid>,
    authorization: GameAuthorization,
    Json(input): Json<ReviewPrivateItem>,
) -> Result<Json<PrivateAttentionState>, ApiError> {
    let principal = authorization.principal_id();
    let ids = delivered_ids(&state, game, principal).await?;
    if !ids.contains(&input.item_id) {
        return Err(ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::NotAuthorized,
            message: "This private update is unavailable.".into(),
        });
    }
    projections::review_private_item(
        &state.pool,
        principal,
        game,
        &input.item_id,
        unix_now_seconds(),
    )
    .await?;
    let reviewed_ids =
        projections::reviewed_private_items(&state.pool, principal, game, &ids).await?;
    Ok(Json(PrivateAttentionState { reviewed_ids }))
}
