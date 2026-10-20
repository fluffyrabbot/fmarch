use super::*;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CandidateQuery {
    handle: String,
}

async fn authorize(
    state: &GameHttpState,
    game: Uuid,
    authorization: &GameAuthorization,
) -> Result<(), ApiError> {
    let caps = caps::resolve(
        &state.pool,
        &Principal::authenticated(authorization.principal_id()),
        game,
    )
    .await?;
    if caps.grants(&Capability::HostOf(game)) {
        return Ok(());
    }
    Err(ApiError::Reject {
        status: StatusCode::FORBIDDEN,
        error: RejectCode::NotAuthorized,
        message: "Only this game's host can select setup players.".into(),
    })
}

pub(super) async fn signups(
    State(state): State<GameHttpState>,
    Path(game): Path<Uuid>,
    authorization: GameAuthorization,
) -> Result<Json<Vec<projections::SetupCandidate>>, ApiError> {
    authorize(&state, game, &authorization).await?;
    Ok(Json(
        projections::setup_candidates(&state.pool, game, authorization.principal_id(), None)
            .await?,
    ))
}

pub(super) async fn candidate(
    State(state): State<GameHttpState>,
    Path(game): Path<Uuid>,
    authorization: GameAuthorization,
    Query(query): Query<CandidateQuery>,
) -> Result<Json<projections::SetupCandidate>, ApiError> {
    authorize(&state, game, &authorization).await?;
    let handle = social::ProfileHandle::new(&query.handle).map_err(|_| ApiError::Reject {
        status: StatusCode::BAD_REQUEST,
        error: RejectCode::InvalidArgument,
        message: "Choose a valid player handle.".into(),
    })?;
    let candidate = projections::setup_candidates(
        &state.pool,
        game,
        authorization.principal_id(),
        Some(handle.as_str()),
    )
    .await?
    .into_iter()
    .next()
    .ok_or_else(|| ApiError::Reject {
        status: StatusCode::NOT_FOUND,
        error: RejectCode::InvalidTarget,
        message: "That player is no longer available.".into(),
    })?;
    Ok(Json(candidate))
}
