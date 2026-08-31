//! Closed-community invitation and provenance HTTP adapters.

use crate::auth_http::{
    require_global_admin, unauthorized_session, unix_now_seconds, AuthHttpState,
    AuthenticatedRequest,
};
use crate::authentication::{deliver_auth_credential, AuthCredentialDeliveryRequest};
use crate::authority::AuthorizedUnitOfWork;
use crate::identity_delivery::IdentityDeliveryKind;
use crate::{ApiError, ApiState};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use membership_application::{
    CommunityStewardshipSnapshot, IssuedCommunityInvitation, MembershipApplicationError,
    MembershipLineageEntry,
};
use serde::{Deserialize, Serialize};
use wire::RejectCode;

pub(super) fn routes(_state: &ApiState) -> Router<ApiState> {
    Router::new()
        .route("/community/invitations", post(issue_invitation))
        .route("/community/invitation-revocations", post(revoke_invitation))
        .route("/community/membership/lineage", get(own_lineage))
        .route("/admin/community/stewardship", get(community_stewardship))
        .route(
            "/admin/community/membership-suspensions",
            post(suspend_membership),
        )
        .route(
            "/admin/community/membership-restorations",
            post(restore_membership),
        )
        .route(
            "/admin/community/invitation-revocations",
            post(steward_revoke_invitation),
        )
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
    let mut authority = AuthorizedUnitOfWork::begin(&state, &auth).await?;
    let principal_id = authority.principal_id();
    let invitation = membership_application::issue_invitation_in_tx(
        authority.transaction(),
        state.invitation_target_index.as_ref(),
        principal_id,
        request.account_id.as_str(),
        request.expires_at,
        now,
    )
    .await
    .map_err(|error| match error {
        MembershipApplicationError::QuotaExceeded {
            retry_after_seconds,
        } => ApiError::RateLimited {
            retry_after_seconds,
            message: "community invitation quota is exhausted".to_string(),
        },
        error => ApiError::Reject {
            status: StatusCode::FORBIDDEN,
            error: RejectCode::NotAuthorized,
            message: format!("community invitation was rejected: {error}"),
        },
    })?;
    let credential_hash = membership_application::hash_credential(&invitation.credential);
    let delivery = deliver_auth_credential(
        &state,
        authority.transaction(),
        &AuthCredentialDeliveryRequest {
            delivery_kind: IdentityDeliveryKind::CommunityInvitation,
            account_id: invitation.target_account_id.as_str(),
            principal_id: &principal_id,
            credential_hash: credential_hash.as_str(),
            credential_material: invitation.credential.as_str(),
            credential_expires_at: invitation.expires_at,
            now,
        },
    )
    .await?;
    authority.commit().await?;
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
    let mut authority = AuthorizedUnitOfWork::begin(&state, &auth).await?;
    let principal_id = authority.principal_id();
    membership_application::revoke_invitation_for_sponsor_in_tx(
        authority.transaction(),
        principal_id,
        community_membership::InvitationId::from_uuid(request.invitation_id),
        unix_now_seconds(),
    )
    .await
    .map_err(|_| ApiError::Reject {
        status: StatusCode::NOT_FOUND,
        error: RejectCode::NotAuthorized,
        message: "open community invitation was not found".to_string(),
    })?;
    authority.commit().await?;
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

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct StewardshipQuery {
    root_membership_id: Option<uuid::Uuid>,
}

async fn community_stewardship(
    State(state): State<AuthHttpState>,
    auth: AuthenticatedRequest,
    Query(query): Query<StewardshipQuery>,
) -> Result<Json<CommunityStewardshipSnapshot>, ApiError> {
    require_global_admin(&state, auth.bearer.as_str(), "community stewardship").await?;
    let snapshot = membership_application::community_stewardship_snapshot(
        &state.pool,
        query
            .root_membership_id
            .map(community_membership::MembershipId::from_uuid),
        unix_now_seconds(),
    )
    .await
    .map_err(stewardship_error)?;
    Ok(Json(snapshot))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct SuspendMembershipRequest {
    membership_id: uuid::Uuid,
    reason: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RestoreMembershipRequest {
    membership_id: uuid::Uuid,
}

async fn suspend_membership(
    State(state): State<AuthHttpState>,
    auth: AuthenticatedRequest,
    Json(request): Json<SuspendMembershipRequest>,
) -> Result<Json<StewardshipMutationResponse>, ApiError> {
    let actor = require_global_admin(
        &state,
        auth.bearer.as_str(),
        "community membership suspension",
    )
    .await?;
    let mut authority = AuthorizedUnitOfWork::begin(&state, &auth).await?;
    let committed_actor = authority.require_global_admin("community membership suspension")?;
    if committed_actor != actor {
        return Err(unauthorized_session());
    }
    membership_application::steward_membership_in_tx(
        authority.transaction(),
        committed_actor,
        community_membership::MembershipId::from_uuid(request.membership_id),
        community_membership::MembershipCommand::Suspend {
            reason: request.reason,
        },
        unix_now_seconds(),
    )
    .await
    .map_err(stewardship_error)?;
    authority.commit().await?;
    Ok(Json(StewardshipMutationResponse {
        status: "suspended",
    }))
}

async fn restore_membership(
    State(state): State<AuthHttpState>,
    auth: AuthenticatedRequest,
    Json(request): Json<RestoreMembershipRequest>,
) -> Result<Json<StewardshipMutationResponse>, ApiError> {
    let actor = require_global_admin(
        &state,
        auth.bearer.as_str(),
        "community membership restoration",
    )
    .await?;
    let mut authority = AuthorizedUnitOfWork::begin(&state, &auth).await?;
    let committed_actor = authority.require_global_admin("community membership restoration")?;
    if committed_actor != actor {
        return Err(unauthorized_session());
    }
    membership_application::steward_membership_in_tx(
        authority.transaction(),
        committed_actor,
        community_membership::MembershipId::from_uuid(request.membership_id),
        community_membership::MembershipCommand::Restore,
        unix_now_seconds(),
    )
    .await
    .map_err(stewardship_error)?;
    authority.commit().await?;
    Ok(Json(StewardshipMutationResponse { status: "active" }))
}

async fn steward_revoke_invitation(
    State(state): State<AuthHttpState>,
    auth: AuthenticatedRequest,
    Json(request): Json<RevokeInvitationRequest>,
) -> Result<Json<RevokeInvitationResponse>, ApiError> {
    let actor = require_global_admin(
        &state,
        auth.bearer.as_str(),
        "community invitation revocation",
    )
    .await?;
    let mut authority = AuthorizedUnitOfWork::begin(&state, &auth).await?;
    let committed_actor = authority.require_global_admin("community invitation revocation")?;
    if committed_actor != actor {
        return Err(unauthorized_session());
    }
    membership_application::steward_revoke_invitation_in_tx(
        authority.transaction(),
        committed_actor,
        community_membership::InvitationId::from_uuid(request.invitation_id),
        unix_now_seconds(),
    )
    .await
    .map_err(stewardship_error)?;
    authority.commit().await?;
    Ok(Json(RevokeInvitationResponse { status: "revoked" }))
}

#[derive(Debug, Clone, Serialize)]
struct StewardshipMutationResponse {
    status: &'static str,
}

fn stewardship_error(error: MembershipApplicationError) -> ApiError {
    ApiError::Reject {
        status: match &error {
            MembershipApplicationError::Unavailable => StatusCode::NOT_FOUND,
            MembershipApplicationError::Membership(_)
            | MembershipApplicationError::Invitation(_) => StatusCode::CONFLICT,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        },
        error: RejectCode::NotAuthorized,
        message: format!("community stewardship operation failed: {error}"),
    }
}
