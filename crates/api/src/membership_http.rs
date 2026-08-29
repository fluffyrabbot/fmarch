//! Closed-community invitation and provenance HTTP adapters.

use crate::auth_http::{unix_now_seconds, AuthHttpState, AuthenticatedRequest};
use crate::authentication::{deliver_auth_credential, AuthCredentialDeliveryRequest};
use crate::identity_delivery::IdentityDeliveryKind;
use crate::{ApiError, ApiState};
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use membership_application::{IssuedCommunityInvitation, MembershipLineageEntry};
use serde::{Deserialize, Serialize};
use wire::RejectCode;

pub(super) fn routes(_state: &ApiState) -> Router<ApiState> {
    Router::new()
        .route("/community/invitations", post(issue_invitation))
        .route("/community/invitation-revocations", post(revoke_invitation))
        .route("/community/membership/lineage", get(own_lineage))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct IssueInvitationRequest {
    account_id: String,
    expires_at: i64,
}

#[derive(Clone, Serialize)]
struct IssueInvitationResponse {
    invitation: IssuedCommunityInvitation,
    delivery_id: uuid::Uuid,
    delivery_status: String,
    delivery_provider_id: String,
}

async fn issue_invitation(
    State(state): State<AuthHttpState>,
    auth: AuthenticatedRequest,
    Json(request): Json<IssueInvitationRequest>,
) -> Result<Json<IssueInvitationResponse>, ApiError> {
    let now = unix_now_seconds();
    if request.expires_at <= now || request.expires_at > now + 60 * 60 * 24 * 30 {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "community invitation expiry must be within 30 days".to_string(),
        });
    }
    let mut tx = state.pool.begin().await?;
    let invitation = membership_application::issue_invitation_in_tx(
        &mut tx,
        state.invitation_target_index.as_ref(),
        auth.context.principal_id,
        request.account_id.as_str(),
        request.expires_at,
        now,
    )
    .await
    .map_err(|error| ApiError::Reject {
        status: StatusCode::FORBIDDEN,
        error: RejectCode::NotAuthorized,
        message: format!("community invitation was rejected: {error}"),
    })?;
    let credential_hash = membership_application::hash_credential(&invitation.credential);
    let delivery = deliver_auth_credential(
        &state,
        &mut tx,
        &AuthCredentialDeliveryRequest {
            delivery_kind: IdentityDeliveryKind::CommunityInvitation,
            account_id: invitation.target_account_id.as_str(),
            principal_id: &auth.context.principal_id,
            credential_hash: credential_hash.as_str(),
            credential_material: invitation.credential.as_str(),
            credential_expires_at: invitation.expires_at,
            now,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(Json(IssueInvitationResponse {
        invitation,
        delivery_id: delivery.delivery_id,
        delivery_status: delivery.status,
        delivery_provider_id: delivery.provider_id,
    }))
}

#[derive(Debug, Clone, Serialize)]
struct MembershipLineageResponse {
    lineage: Vec<MembershipLineageEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RevokeInvitationRequest {
    invitation_id: uuid::Uuid,
}

#[derive(Debug, Clone, Serialize)]
struct RevokeInvitationResponse {
    status: &'static str,
}

async fn revoke_invitation(
    State(state): State<AuthHttpState>,
    auth: AuthenticatedRequest,
    Json(request): Json<RevokeInvitationRequest>,
) -> Result<Json<RevokeInvitationResponse>, ApiError> {
    membership_application::revoke_invitation(
        &state.pool,
        auth.context.principal_id,
        community_membership::InvitationId::from_uuid(request.invitation_id),
        unix_now_seconds(),
    )
    .await
    .map_err(|_| ApiError::Reject {
        status: StatusCode::NOT_FOUND,
        error: RejectCode::NotAuthorized,
        message: "open community invitation was not found".to_string(),
    })?;
    Ok(Json(RevokeInvitationResponse { status: "revoked" }))
}

async fn own_lineage(
    State(state): State<AuthHttpState>,
    auth: AuthenticatedRequest,
) -> Result<Json<MembershipLineageResponse>, ApiError> {
    let lineage =
        membership_application::lineage_for_principal(&state.pool, auth.context.principal_id)
            .await
            .map_err(|error| ApiError::Reject {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                error: RejectCode::Internal,
                message: format!("membership lineage is unavailable: {error}"),
            })?;
    if lineage.is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::FORBIDDEN,
            error: RejectCode::NotAuthorized,
            message: "active community membership is required".to_string(),
        });
    }
    Ok(Json(MembershipLineageResponse { lineage }))
}
