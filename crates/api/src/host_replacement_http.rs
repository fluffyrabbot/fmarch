//! Seat-scoped candidate selection behind current Replacement authority.

use super::*;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ReplacementCandidateQuery {
    slot_id: String,
    handle: String,
}

pub(super) async fn read(
    State(state): State<GameHttpState>,
    Path(game): Path<Uuid>,
    authorization: GameAuthorization,
    Query(query): Query<ReplacementCandidateQuery>,
) -> Result<Json<wire::HostReplacementCandidate>, ApiError> {
    let authority = resolve_host_console_authority(&state.pool, game, &authorization).await?;
    if !authority.is_some_and(|authority| {
        authority
            .allowed_classes
            .contains(&wire::CohostPermissionClass::Replacement)
    }) {
        return Err(ApiError::Reject {
            status: StatusCode::FORBIDDEN,
            error: RejectCode::NotAuthorized,
            message: "principal cannot select replacements for this game".into(),
        });
    }
    let invalid_query = || ApiError::Reject {
        status: StatusCode::BAD_REQUEST,
        error: RejectCode::InvalidArgument,
        message: "replacement selection requires a canonical slot and valid profile handle".into(),
    };
    if query.slot_id.is_empty()
        || query.slot_id.trim() != query.slot_id
        || query.slot_id.chars().any(char::is_control)
    {
        return Err(invalid_query());
    }
    let handle = social::ProfileHandle::new(&query.handle).map_err(|_| invalid_query())?;
    let candidate =
        projections::host_replacement_candidate(&state.pool, game, &query.slot_id, &handle)
            .await?
            .ok_or_else(|| ApiError::Reject {
                status: StatusCode::NOT_FOUND,
                error: RejectCode::InvalidTarget,
                message: "replacement candidate was not found".into(),
            })?;
    Ok(Json(wire::HostReplacementCandidate {
        slot_id: candidate.slot_id,
        outgoing_persona_id: candidate.outgoing_persona_id,
        principal_id: candidate.principal_id,
        handle: candidate.handle,
        display_name: candidate.display_name,
    }))
}
