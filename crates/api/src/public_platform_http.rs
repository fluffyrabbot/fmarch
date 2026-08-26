//! Public-platform discovery, discussion, moderation, watch, and profile HTTP boundary.

use super::auth_http::{
    authorization_context, bearer_token, unauthorized_account, unix_now_seconds,
    AccountAuthenticatedRequest, AuthHttpState, AuthenticatedRequest,
};
use super::{ApiError, ApiState};
use attention::WatchTarget;
use axum::extract::{FromRef, FromRequestParts, Path, Query, State};
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use content_reference::{self, Quotation, DEFAULT_POST_CITATION_LIMIT};
use eventstore::{ActorId, EventInput};
use forum::{
    self, ForumReject, PostingState, TopicCommand, TopicEvent, TopicState, TopicVisibility,
};
use principal::PrincipalId;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use social::{
    ProfileBio, ProfileDisplayName, ProfileEdit, ProfileHandle, ProfilePresentation,
    ProfileRevision, ProfileVisibility,
};
use sqlx::postgres::PgPool;
use std::time::Instant;
use trust_safety::{
    self, ModerationCaseStatus, ModerationCommand, ModerationTarget, ReportReasonFamily,
    TrustSafetyReject,
};
use uuid::Uuid;
use wire::{
    AdvanceSubscriptionReadRequest, DiscussionArea, DiscussionPost, DiscussionThreadPage,
    DiscussionTopic, DiscussionTopicPage, MemberMutePage, MemberMuteState, ModerationCase,
    ModerationCaseDetail, ModerationCasePage, ModerationReportReceipt, ProfileEditor,
    PublicInboxPage, PublicPostCitationPage, PublicProfile, PublicSearchFilterValue,
    PublicSearchPage, PublicSearchResult, RejectCode, SubscriptionTargetState,
};

#[derive(Clone)]
pub(super) struct PublicPlatformHttpState {
    pool: PgPool,
    auth: AuthHttpState,
}

impl FromRef<PublicPlatformHttpState> for AuthHttpState {
    fn from_ref(state: &PublicPlatformHttpState) -> Self {
        state.auth.clone()
    }
}

impl PublicPlatformHttpState {
    pub(super) fn new(pool: PgPool, auth: AuthHttpState) -> Self {
        Self { pool, auth }
    }
}

pub(super) fn routes(state: &ApiState) -> Router<ApiState> {
    Router::new()
        .route("/search", get(public_search))
        .route("/inbox", get(public_inbox))
        .route("/mutes", get(member_mutes))
        .route(
            "/mutes/profiles/{handle}",
            get(member_mute_state)
                .put(mute_public_profile)
                .delete(unmute_public_profile),
        )
        .route(
            "/subscriptions/{surface_id}",
            get(subscription_target_state)
                .put(subscribe_to_target)
                .delete(unsubscribe_from_target),
        )
        .route(
            "/subscriptions/{surface_id}/read",
            post(advance_subscription_read),
        )
        .route("/moderation/reports", post(submit_moderation_report))
        .route(
            "/moderation/reports/{report}",
            get(moderation_report_receipt),
        )
        .route("/moderation/cases", get(moderation_cases))
        .route("/moderation/cases/{case}", get(moderation_case))
        .route("/moderation/cases/{case}/actions", post(moderate_case))
        .route(
            "/discussions/areas",
            get(discussion_areas).post(create_discussion_area),
        )
        .route("/discussions/areas/{slug}", get(discussion_area_topics))
        .route(
            "/discussions/areas/{slug}/topics",
            post(create_discussion_topic),
        )
        .route(
            "/discussions/areas/{slug}/topics/{topic}",
            get(discussion_topic_thread),
        )
        .route(
            "/discussions/topics/{topic}/posts",
            post(create_discussion_post),
        )
        .route(
            "/discussions/topics/{topic}/posts/{source_seq}/citations",
            get(discussion_post_citations),
        )
        .route(
            "/discussions/topics/{topic}/moderation",
            post(moderate_discussion_topic),
        )
        .route("/profiles", post(create_profile))
        .route("/profiles/me/editor", get(current_member_profile))
        .route("/profiles/me", axum::routing::put(update_profile))
        .route("/profiles/{handle}", get(public_profile))
        .with_state(PublicPlatformHttpState::new(
            state.pool.clone(),
            state.auth.clone(),
        ))
}

#[derive(Debug, Clone, Deserialize)]
struct PublicSearchQuery {
    q: String,
    filter: Option<String>,
    cursor: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PublicSearchHttpCursor {
    version: u8,
    query_hash: String,
    filter: String,
    rank: i64,
    updated_seq: i64,
    document_type: projections::PublicSearchDocumentType,
    document_key: String,
}

#[derive(Debug, Clone, Deserialize)]
struct PublicInboxQuery {
    before_seq: Option<i64>,
    limit: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
struct MemberMuteQuery {
    cursor: Option<String>,
    limit: Option<i64>,
}

async fn subscription_target_state(
    State(state): State<PublicPlatformHttpState>,
    Path(surface_id): Path<Uuid>,
    MemberAuthentication(principal_id): MemberAuthentication,
) -> Result<Json<SubscriptionTargetState>, ApiError> {
    let target = subscription_target(surface_id);
    Ok(Json(
        projections::subscription_target_state(&state.pool, principal_id, target)
            .await
            .map_err(subscription_projection_api_error)?
            .into(),
    ))
}

async fn subscribe_to_target(
    State(state): State<PublicPlatformHttpState>,
    Path(surface_id): Path<Uuid>,
    MemberAuthentication(principal_id): MemberAuthentication,
) -> Result<Json<SubscriptionTargetState>, ApiError> {
    let target = subscription_target(surface_id);
    let state = projections::subscribe_to_public_target(
        &state.pool,
        target,
        principal_id,
        unix_now_seconds(),
    )
    .await
    .map_err(subscription_projection_api_error)?;
    Ok(Json(state.into()))
}

async fn unsubscribe_from_target(
    State(state): State<PublicPlatformHttpState>,
    Path(surface_id): Path<Uuid>,
    MemberAuthentication(principal_id): MemberAuthentication,
) -> Result<Json<SubscriptionTargetState>, ApiError> {
    let target = subscription_target(surface_id);
    let state = projections::unsubscribe_from_public_target(
        &state.pool,
        target,
        principal_id,
        unix_now_seconds(),
    )
    .await
    .map_err(subscription_projection_api_error)?;
    Ok(Json(state.into()))
}

async fn advance_subscription_read(
    State(state): State<PublicPlatformHttpState>,
    Path(surface_id): Path<Uuid>,
    MemberAuthentication(principal_id): MemberAuthentication,
    Json(request): Json<AdvanceSubscriptionReadRequest>,
) -> Result<Json<SubscriptionTargetState>, ApiError> {
    let target = subscription_target(surface_id);
    let state = projections::advance_subscription_read_cursor(
        &state.pool,
        target,
        principal_id,
        request.read_through_seq,
        unix_now_seconds(),
    )
    .await
    .map_err(subscription_projection_api_error)?;
    Ok(Json(state.into()))
}

async fn public_inbox(
    State(state): State<PublicPlatformHttpState>,
    Query(query): Query<PublicInboxQuery>,
    MemberAuthentication(principal_id): MemberAuthentication,
) -> Result<Json<PublicInboxPage>, ApiError> {
    if query.before_seq.is_some_and(|seq| seq <= 0) {
        return Err(subscription_bad_request(
            "inbox before_seq must be a positive event sequence",
        ));
    }
    Ok(Json(
        projections::public_inbox(
            &state.pool,
            principal_id,
            query.before_seq,
            query.limit.unwrap_or(50),
        )
        .await?
        .into(),
    ))
}

async fn member_mutes(
    State(state): State<PublicPlatformHttpState>,
    Query(query): Query<MemberMuteQuery>,
    MemberAuthentication(principal_id): MemberAuthentication,
) -> Result<Json<MemberMutePage>, ApiError> {
    let cursor = query
        .cursor
        .as_deref()
        .map(parse_member_mute_cursor)
        .transpose()?;
    let page =
        projections::member_mutes(&state.pool, principal_id, cursor, query.limit.unwrap_or(50))
            .await?;
    Ok(Json(MemberMutePage {
        members: page
            .members
            .into_iter()
            .map(MemberMuteState::from)
            .collect(),
        next_cursor: page
            .next_cursor
            .map(|cursor| format!("{}:{}", cursor.updated_seq, cursor.relationship_id)),
    }))
}

async fn member_mute_state(
    State(state): State<PublicPlatformHttpState>,
    Path(handle): Path<String>,
    MemberAuthentication(principal_id): MemberAuthentication,
) -> Result<Json<MemberMuteState>, ApiError> {
    Ok(Json(
        projections::member_mute_state(&state.pool, principal_id, handle.as_str())
            .await
            .map_err(member_mute_projection_api_error)?
            .into(),
    ))
}

async fn mute_public_profile(
    State(state): State<PublicPlatformHttpState>,
    Path(handle): Path<String>,
    MemberAuthentication(principal_id): MemberAuthentication,
) -> Result<Json<MemberMuteState>, ApiError> {
    Ok(Json(
        projections::mute_public_profile(
            &state.pool,
            principal_id,
            handle.as_str(),
            unix_now_seconds(),
        )
        .await
        .map_err(member_mute_projection_api_error)?
        .into(),
    ))
}

async fn unmute_public_profile(
    State(state): State<PublicPlatformHttpState>,
    Path(handle): Path<String>,
    MemberAuthentication(principal_id): MemberAuthentication,
) -> Result<Json<MemberMuteState>, ApiError> {
    Ok(Json(
        projections::unmute_public_profile(
            &state.pool,
            principal_id,
            handle.as_str(),
            unix_now_seconds(),
        )
        .await
        .map_err(member_mute_projection_api_error)?
        .into(),
    ))
}

/// Extractor form of the member-authentication rule shared by every
/// resource-owning public-platform surface.
struct MemberAuthentication(PrincipalId);

impl<S> FromRequestParts<S> for MemberAuthentication
where
    AuthHttpState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let request = AccountAuthenticatedRequest::from_request_parts(parts, state).await?;
        Ok(Self(request.context.principal_id))
    }
}

/// Anonymous-or-member resolution for public read surfaces: an absent
/// Authorization header means anonymous; a present but invalid credential
/// still rejects with the account-unauthorized error.
struct OptionalMemberAuthentication(Option<PrincipalId>);

impl<S> FromRequestParts<S> for OptionalMemberAuthentication
where
    AuthHttpState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        if !parts.headers.contains_key(AUTHORIZATION) {
            return Ok(Self(None));
        }
        let auth = AuthHttpState::from_ref(state);
        let token = bearer_token(&parts.headers)
            .ok_or_else(unauthorized_account)?
            .to_string();
        let context = authorization_context(&auth, &token).await?;
        Ok(Self(Some(context.principal_id)))
    }
}

/// Member authentication that also resolves the caller's public profile, so
/// discussion write surfaces cannot post without one.
struct DiscussionProfileAuthentication(AuthenticatedDiscussionProfile);

impl FromRequestParts<PublicPlatformHttpState> for DiscussionProfileAuthentication {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &PublicPlatformHttpState,
    ) -> Result<Self, Self::Rejection> {
        let request = AccountAuthenticatedRequest::from_request_parts(parts, state).await?;
        let principal_id = request.context.principal_id;
        let profile_id = projections::public_profile_id_by_principal(&state.pool, principal_id)
            .await?
            .ok_or_else(|| {
                discussion_conflict("create a public profile before posting publicly")
            })?;
        Ok(Self(AuthenticatedDiscussionProfile {
            profile_id,
            principal_id,
        }))
    }
}

fn parse_member_mute_cursor(value: &str) -> Result<projections::MemberMuteCursor, ApiError> {
    let (updated_seq, relationship_id) = value
        .split_once(':')
        .ok_or_else(|| member_mute_bad_request("mute cursor is invalid"))?;
    let updated_seq = updated_seq
        .parse::<i64>()
        .map_err(|_| member_mute_bad_request("mute cursor is invalid"))?;
    let relationship_id = Uuid::parse_str(relationship_id)
        .map_err(|_| member_mute_bad_request("mute cursor is invalid"))?;
    Ok(projections::MemberMuteCursor {
        updated_seq,
        relationship_id,
    })
}

fn member_mute_projection_api_error(error: projections::ProjectionError) -> ApiError {
    match error {
        projections::ProjectionError::MuteTargetNotPublic => ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::Internal,
            message: "public profile was not found".to_string(),
        },
        projections::ProjectionError::CannotMuteSelf => {
            member_mute_bad_request("members cannot mute their own profile")
        }
        projections::ProjectionError::AlreadyMuted => ApiError::Reject {
            status: StatusCode::CONFLICT,
            error: RejectCode::Internal,
            message: "member is already muted".to_string(),
        },
        projections::ProjectionError::NotMuted => ApiError::Reject {
            status: StatusCode::CONFLICT,
            error: RejectCode::Internal,
            message: "member is not muted".to_string(),
        },
        projections::ProjectionError::Store(eventstore::StoreError::Conflict { .. }) => {
            ApiError::Reject {
                status: StatusCode::CONFLICT,
                error: RejectCode::StreamConflict,
                message: "mute changed concurrently; refresh and try again".to_string(),
            }
        }
        error => ApiError::Projection(error),
    }
}

fn member_mute_bad_request(message: &str) -> ApiError {
    ApiError::Reject {
        status: StatusCode::BAD_REQUEST,
        error: RejectCode::Internal,
        message: message.to_string(),
    }
}

fn subscription_target(surface_id: Uuid) -> WatchTarget {
    WatchTarget { surface_id }
}

fn subscription_projection_api_error(error: projections::ProjectionError) -> ApiError {
    match error {
        projections::ProjectionError::SubscriptionTargetNotPublic => ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::Internal,
            message: "subscription target is not public".to_string(),
        },
        projections::ProjectionError::AlreadySubscribed => ApiError::Reject {
            status: StatusCode::CONFLICT,
            error: RejectCode::Internal,
            message: "member is already subscribed to this target".to_string(),
        },
        projections::ProjectionError::NotSubscribed => ApiError::Reject {
            status: StatusCode::CONFLICT,
            error: RejectCode::Internal,
            message: "member is not subscribed to this target".to_string(),
        },
        projections::ProjectionError::InvalidSubscriptionReadCursor => {
            subscription_bad_request("read cursor must advance within the public target")
        }
        projections::ProjectionError::Store(eventstore::StoreError::Conflict { .. }) => {
            ApiError::Reject {
                status: StatusCode::CONFLICT,
                error: RejectCode::StreamConflict,
                message: "subscription changed concurrently; refresh and try again".to_string(),
            }
        }
        error => ApiError::Projection(error),
    }
}

fn subscription_bad_request(message: &str) -> ApiError {
    ApiError::Reject {
        status: StatusCode::BAD_REQUEST,
        error: RejectCode::Internal,
        message: message.to_string(),
    }
}

async fn public_search(
    State(state): State<PublicPlatformHttpState>,
    Query(query): Query<PublicSearchQuery>,
    headers: HeaderMap,
    OptionalMemberAuthentication(viewer_principal_id): OptionalMemberAuthentication,
) -> Result<Json<PublicSearchPage>, ApiError> {
    let started = Instant::now();
    let normalized_query = query.q.trim();
    if normalized_query.chars().count() < 2 || normalized_query.chars().count() > 200 {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::InvalidArgument,
            message: "search query must contain between 2 and 200 characters".to_string(),
        });
    }
    let (filter, filter_value) = match query.filter.as_deref().unwrap_or("all") {
        "all" => (
            projections::PublicSearchFilter::All,
            PublicSearchFilterValue::All,
        ),
        value => {
            let Some(group) = projections::PublicSearchGroup::parse(value) else {
                return Err(ApiError::Reject {
                    status: StatusCode::BAD_REQUEST,
                    error: RejectCode::InvalidArgument,
                    message: "search filter must be all, discussions, profiles, or games"
                        .to_string(),
                });
            };
            let filter_value = match group {
                projections::PublicSearchGroup::Discussions => PublicSearchFilterValue::Discussions,
                projections::PublicSearchGroup::Profiles => PublicSearchFilterValue::Profiles,
                projections::PublicSearchGroup::Games => PublicSearchFilterValue::Games,
            };
            (projections::PublicSearchFilter::Group(group), filter_value)
        }
    };
    let filter_label = filter_value.as_str();
    let page_kind = if query.cursor.is_some() {
        "continuation"
    } else {
        "first"
    };
    let limit = query.limit.unwrap_or(20).clamp(1, 50);
    let cursor = query
        .cursor
        .as_deref()
        .map(|value| parse_public_search_cursor(value, normalized_query, filter_label))
        .transpose()?;
    let page = projections::public_search(
        &state.pool,
        normalized_query,
        filter,
        cursor,
        limit,
        viewer_principal_id,
    )
    .await?;
    let result_count = page.results.len();
    let has_next_page = page.next_cursor.is_some();
    let traffic_class = public_search_traffic_class(&headers);
    let next_cursor = page
        .next_cursor
        .map(|cursor| encode_public_search_cursor(cursor, normalized_query, filter_label))
        .transpose()?;
    tracing::info!(
        event = "public_search_completed",
        filter = filter_label,
        page = page_kind,
        limit,
        result_count,
        has_next_page,
        traffic_class,
        selectivity_signal_basis_points = page_fill_basis_points(result_count, limit),
        elapsed_ms = started.elapsed().as_millis(),
        "Public search completed"
    );
    Ok(Json(PublicSearchPage {
        query: normalized_query.to_string(),
        filter: filter_value,
        results: page
            .results
            .into_iter()
            .map(PublicSearchResult::from)
            .collect(),
        next_cursor,
    }))
}

fn public_search_traffic_class(headers: &HeaderMap) -> &'static str {
    const HEADER: &str = "x-fmarch-search-observation";
    const STAGING_CANARY: &str = "staging-canary-v1";

    if headers.get(HEADER).and_then(|value| value.to_str().ok()) == Some(STAGING_CANARY) {
        "staging_canary"
    } else {
        "external"
    }
}

fn page_fill_basis_points(result_count: usize, limit: i64) -> u16 {
    let limit = usize::try_from(limit.max(1)).expect("positive search limit fits usize");
    let bounded_count = result_count.min(limit);
    u16::try_from((bounded_count * 10_000) / limit)
        .expect("bounded search page fill fits basis points")
}

fn encode_public_search_cursor(
    cursor: projections::PublicSearchCursor,
    query: &str,
    filter: &str,
) -> Result<String, ApiError> {
    let payload = PublicSearchHttpCursor {
        version: 1,
        query_hash: public_search_query_hash(query),
        filter: filter.to_string(),
        rank: cursor.rank,
        updated_seq: cursor.updated_seq,
        document_type: cursor.document_type,
        document_key: cursor.document_key,
    };
    let bytes = serde_json::to_vec(&payload).map_err(|_| ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message: "failed to encode search cursor".to_string(),
    })?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn parse_public_search_cursor(
    value: &str,
    query: &str,
    filter: &str,
) -> Result<projections::PublicSearchCursor, ApiError> {
    if value.len() > 1024 {
        return Err(invalid_public_search_cursor());
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| invalid_public_search_cursor())?;
    let payload: PublicSearchHttpCursor =
        serde_json::from_slice(&bytes).map_err(|_| invalid_public_search_cursor())?;
    if payload.version != 1
        || payload.query_hash != public_search_query_hash(query)
        || payload.filter != filter
        || payload.document_key.is_empty()
    {
        return Err(invalid_public_search_cursor());
    }
    Ok(projections::PublicSearchCursor {
        rank: payload.rank,
        updated_seq: payload.updated_seq,
        document_type: payload.document_type,
        document_key: payload.document_key,
    })
}

fn public_search_query_hash(query: &str) -> String {
    format!("{:x}", Sha256::digest(query.as_bytes()))
}

fn invalid_public_search_cursor() -> ApiError {
    ApiError::Reject {
        status: StatusCode::BAD_REQUEST,
        error: RejectCode::InvalidArgument,
        message: "invalid search cursor; restart the search and try again".to_string(),
    }
}

#[derive(Debug, Clone, Deserialize)]
struct DiscussionPageQuery {
    cursor: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
struct DiscussionPostQuery {
    before_seq: Option<i64>,
    limit: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
struct PostCitationQuery {
    limit: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
struct CreateDiscussionAreaRequest {
    slug: String,
    title: String,
    description: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CreateDiscussionTopicRequest {
    title: String,
    body: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CreateDiscussionPostRequest {
    body: String,
    #[serde(default)]
    quotations: Vec<Quotation>,
}

#[derive(Debug, Clone, Deserialize)]
struct ModerateDiscussionTopicRequest {
    posting_state: Option<String>,
    visibility: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct SubmitModerationReportRequest {
    surface_id: Uuid,
    source_seq: i64,
    reason_family: String,
    #[serde(default)]
    details: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ModerationCaseQuery {
    status: Option<String>,
    cursor: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
struct ModerateCaseRequest {
    action: String,
    reason: String,
}

async fn discussion_areas(
    State(state): State<PublicPlatformHttpState>,
) -> Result<Json<Vec<DiscussionArea>>, ApiError> {
    Ok(Json(
        projections::discussion_areas(&state.pool)
            .await?
            .into_iter()
            .map(DiscussionArea::from)
            .collect(),
    ))
}

async fn discussion_area_topics(
    State(state): State<PublicPlatformHttpState>,
    Path(slug): Path<String>,
    Query(query): Query<DiscussionPageQuery>,
    OptionalMemberAuthentication(viewer_principal_id): OptionalMemberAuthentication,
) -> Result<Json<DiscussionTopicPage>, ApiError> {
    let area = projections::discussion_area_by_slug(&state.pool, slug.as_str())
        .await?
        .ok_or_else(|| discussion_not_found("discussion area"))?;
    let cursor = query
        .cursor
        .as_deref()
        .map(parse_discussion_topic_cursor)
        .transpose()?;
    let page = projections::discussion_topics(
        &state.pool,
        area.area_id,
        cursor,
        query.limit.unwrap_or(20),
        viewer_principal_id,
    )
    .await?;
    Ok(Json(DiscussionTopicPage {
        area: DiscussionArea::from(area),
        topics: page.topics.into_iter().map(DiscussionTopic::from).collect(),
        next_cursor: page
            .next_cursor
            .map(|cursor| format!("{}:{}", cursor.updated_seq, cursor.topic_id)),
    }))
}

async fn discussion_topic_thread(
    State(state): State<PublicPlatformHttpState>,
    Path((slug, topic)): Path<(String, Uuid)>,
    Query(query): Query<DiscussionPostQuery>,
    OptionalMemberAuthentication(viewer_principal_id): OptionalMemberAuthentication,
) -> Result<Json<DiscussionThreadPage>, ApiError> {
    let area = projections::discussion_area_by_slug(&state.pool, slug.as_str())
        .await?
        .ok_or_else(|| discussion_not_found("discussion area"))?;
    let topic = visible_discussion_topic(&state, topic).await?;
    if topic.area_id != area.area_id {
        return Err(discussion_not_found("discussion topic"));
    }
    let page = projections::discussion_posts(
        &state.pool,
        topic.topic_id,
        query.before_seq,
        query.limit.unwrap_or(50),
        viewer_principal_id,
    )
    .await?;
    Ok(Json(DiscussionThreadPage {
        area: DiscussionArea::from(area),
        topic: DiscussionTopic::from(topic),
        posts: page.posts.into_iter().map(DiscussionPost::from).collect(),
        next_before_seq: page.next_before_seq,
    }))
}

async fn create_discussion_area(
    State(state): State<PublicPlatformHttpState>,
    auth: AuthenticatedRequest,
    Json(request): Json<CreateDiscussionAreaRequest>,
) -> Result<(StatusCode, Json<DiscussionArea>), ApiError> {
    let principal_id = require_global_mod(&state, &auth.bearer, "discussion area creation").await?;

    let slug = validate_discussion_slug(request.slug.as_str())?;
    let title = validate_discussion_text(request.title.as_str(), "discussion area title", 160)?;
    let description = validate_discussion_text(
        request.description.as_str(),
        "discussion area description",
        500,
    )?;
    if projections::discussion_area_by_slug(&state.pool, slug.as_str())
        .await?
        .is_some()
    {
        return Err(discussion_conflict(
            "discussion area already exists; choose a new area slug",
        ));
    }
    let area_id = Uuid::new_v4();
    let created = forum::AreaCreated {
        slug: slug.clone(),
        title,
        description,
    };
    projections::append_discussion_and_project(
        &state.pool,
        area_id,
        &[EventInput::new(
            created.kind(),
            1,
            created.payload(),
            ActorId::Principal(principal_id),
            unix_now_seconds(),
        )],
    )
    .await?;
    let area = projections::discussion_area_by_slug(&state.pool, slug.as_str())
        .await?
        .expect("projected discussion area is readable");
    Ok((StatusCode::CREATED, Json(DiscussionArea::from(area))))
}

async fn create_discussion_topic(
    State(state): State<PublicPlatformHttpState>,
    Path(slug): Path<String>,
    DiscussionProfileAuthentication(profile): DiscussionProfileAuthentication,
    Json(request): Json<CreateDiscussionTopicRequest>,
) -> Result<(StatusCode, Json<DiscussionTopic>), ApiError> {
    let area = projections::discussion_area_by_slug(&state.pool, slug.as_str())
        .await?
        .ok_or_else(|| discussion_not_found("discussion area"))?;
    let title = validate_discussion_text(request.title.as_str(), "discussion topic title", 180)?;
    let body = validate_discussion_text(request.body.as_str(), "discussion post", 10_000)?;
    let topic_id = Uuid::new_v4();
    let events = forum::decide_topic(
        None,
        TopicCommand::Create {
            topic_id,
            area_id: area.area_id,
            title,
            opening_body: body,
            author_profile_id: profile.profile_id,
        },
    )
    .map_err(forum_reject_api_error)?;
    append_forum_events(&state.pool, topic_id, 0, events, profile.principal_id).await?;
    let topic = projections::discussion_topic_by_id(&state.pool, topic_id)
        .await?
        .expect("projected discussion topic is readable");
    Ok((StatusCode::CREATED, Json(DiscussionTopic::from(topic))))
}

async fn create_discussion_post(
    State(state): State<PublicPlatformHttpState>,
    Path(topic): Path<Uuid>,
    DiscussionProfileAuthentication(profile): DiscussionProfileAuthentication,
    Json(request): Json<CreateDiscussionPostRequest>,
) -> Result<(StatusCode, Json<DiscussionTopic>), ApiError> {
    let current = projections::discussion_topic_by_id(&state.pool, topic)
        .await?
        .ok_or_else(|| discussion_not_found("discussion topic"))?;
    let topic_state = forum_topic_state(&current)?;
    let thread = projections::quotation_thread_for_discussion(
        &state.pool,
        topic,
        Some(profile.principal_id),
    )
    .await?;
    let quotations = content_reference::decide_quotations(&thread, &request.quotations)
        .map_err(content_reference_reject_api_error)?;
    let body = if request.body.trim().is_empty() {
        if quotations.is_empty() {
            validate_discussion_text(request.body.as_str(), "discussion post", 10_000)?;
        }
        String::new()
    } else {
        validate_discussion_text(request.body.as_str(), "discussion post", 10_000)?
    };
    let events = forum::decide_topic(
        Some(&topic_state),
        TopicCommand::SubmitPost {
            body,
            author_profile_id: profile.profile_id,
            quotations,
        },
    )
    .map_err(forum_reject_api_error)?;
    append_forum_events(
        &state.pool,
        topic,
        current.version,
        events,
        profile.principal_id,
    )
    .await?;
    let topic = projections::discussion_topic_by_id(&state.pool, topic)
        .await?
        .expect("projected discussion topic is readable");
    Ok((StatusCode::CREATED, Json(DiscussionTopic::from(topic))))
}

async fn discussion_post_citations(
    State(state): State<PublicPlatformHttpState>,
    Path((topic, source_seq)): Path<(Uuid, i64)>,
    Query(query): Query<PostCitationQuery>,
    OptionalMemberAuthentication(viewer_principal_id): OptionalMemberAuthentication,
) -> Result<Json<PublicPostCitationPage>, ApiError> {
    let _topic = visible_discussion_topic(&state, topic).await?;
    let page = projections::visible_public_incoming_citations(
        &state.pool,
        content_reference::PublicContentRef::new(topic, source_seq),
        viewer_principal_id,
        query.limit.unwrap_or(DEFAULT_POST_CITATION_LIMIT),
    )
    .await?
    .ok_or_else(|| discussion_not_found("discussion post"))?;
    Ok(Json(PublicPostCitationPage::from(page)))
}

async fn moderate_discussion_topic(
    State(state): State<PublicPlatformHttpState>,
    Path(topic): Path<Uuid>,
    auth: AuthenticatedRequest,
    Json(request): Json<ModerateDiscussionTopicRequest>,
) -> Result<Json<DiscussionTopic>, ApiError> {
    let principal_id = require_global_mod(&state, &auth.bearer, "discussion moderation").await?;
    let current = projections::discussion_topic_by_id(&state.pool, topic)
        .await?
        .ok_or_else(|| discussion_not_found("discussion topic"))?;
    let topic_state = forum_topic_state(&current)?;
    let command = match (
        request.posting_state.as_deref(),
        request.visibility.as_deref(),
    ) {
        (Some(posting_state), None) => TopicCommand::SetPostingState {
            posting_state: PostingState::parse(posting_state).map_err(forum_reject_api_error)?,
        },
        (None, Some(visibility)) => TopicCommand::SetVisibility {
            visibility: TopicVisibility::parse(visibility).map_err(forum_reject_api_error)?,
        },
        _ => {
            return Err(ApiError::Reject {
                status: StatusCode::BAD_REQUEST,
                error: RejectCode::Internal,
                message:
                    "discussion moderation must change exactly one of posting_state or visibility"
                        .to_string(),
            })
        }
    };
    let events =
        forum::decide_topic(Some(&topic_state), command).map_err(forum_reject_api_error)?;
    append_forum_events(&state.pool, topic, current.version, events, principal_id).await?;
    let topic = projections::discussion_topic_by_id(&state.pool, topic)
        .await?
        .expect("projected discussion topic is readable");
    Ok(Json(DiscussionTopic::from(topic)))
}

async fn submit_moderation_report(
    State(state): State<PublicPlatformHttpState>,
    request: AccountAuthenticatedRequest,
    Json(request_body): Json<SubmitModerationReportRequest>,
) -> Result<(StatusCode, Json<ModerationReportReceipt>), ApiError> {
    let principal_id = request.context.principal_id;
    let request = request_body;
    if request.source_seq <= 0 {
        return Err(moderation_bad_request("report source_seq must be positive"));
    }
    let details = request.details.trim();
    if details.len() > 1_000 {
        return Err(moderation_bad_request(
            "report details must contain at most 1000 bytes",
        ));
    }
    let target = ModerationTarget {
        public: content_reference::PublicContentRef::new(request.surface_id, request.source_seq),
    };
    let reason = ReportReasonFamily::parse(request.reason_family.as_str())
        .map_err(moderation_reject_api_error)?;
    let receipt = projections::submit_moderation_report(
        &state.pool,
        target,
        Uuid::new_v4(),
        principal_id,
        reason,
        details.to_string(),
        unix_now_seconds(),
    )
    .await
    .map_err(moderation_projection_api_error)?;
    Ok((StatusCode::CREATED, Json(receipt.into())))
}

async fn moderation_report_receipt(
    State(state): State<PublicPlatformHttpState>,
    Path(report): Path<Uuid>,
    request: AccountAuthenticatedRequest,
) -> Result<Json<ModerationReportReceipt>, ApiError> {
    let principal_id = request.context.principal_id;
    let receipt = projections::moderation_report_receipt(&state.pool, report, principal_id)
        .await?
        .ok_or_else(|| discussion_not_found("moderation report receipt"))?;
    Ok(Json(receipt.into()))
}

async fn moderation_cases(
    State(state): State<PublicPlatformHttpState>,
    Query(query): Query<ModerationCaseQuery>,
    auth: AuthenticatedRequest,
) -> Result<Json<ModerationCasePage>, ApiError> {
    require_global_mod(&state, &auth.bearer, "moderation queue access").await?;
    let status = match query.status.as_deref().unwrap_or("open") {
        "all" => None,
        value => {
            ModerationCaseStatus::parse(value).map_err(moderation_reject_api_error)?;
            Some(value)
        }
    };
    let cursor = query
        .cursor
        .as_deref()
        .map(parse_moderation_case_cursor)
        .transpose()?;
    let page =
        projections::moderation_cases(&state.pool, status, cursor, query.limit.unwrap_or(25))
            .await?;
    Ok(Json(ModerationCasePage {
        cases: page.cases.into_iter().map(ModerationCase::from).collect(),
        next_cursor: page
            .next_cursor
            .map(|cursor| format!("{}:{}", cursor.updated_seq, cursor.case_id)),
    }))
}

async fn moderation_case(
    State(state): State<PublicPlatformHttpState>,
    Path(case): Path<Uuid>,
    auth: AuthenticatedRequest,
) -> Result<Json<ModerationCaseDetail>, ApiError> {
    require_global_mod(&state, &auth.bearer, "moderation case access").await?;
    let detail = projections::moderation_case_by_id(&state.pool, case)
        .await?
        .ok_or_else(|| discussion_not_found("moderation case"))?;
    Ok(Json(detail.into()))
}

async fn moderate_case(
    State(state): State<PublicPlatformHttpState>,
    Path(case): Path<Uuid>,
    auth: AuthenticatedRequest,
    Json(request): Json<ModerateCaseRequest>,
) -> Result<Json<ModerationCaseDetail>, ApiError> {
    let principal_id = require_global_mod(&state, &auth.bearer, "moderation case action").await?;
    let reason = validate_discussion_text(request.reason.as_str(), "moderation reason", 500)?;
    let current = projections::moderation_case_state(&state.pool, case)
        .await?
        .ok_or_else(|| discussion_not_found("moderation case"))?;
    let command = match request.action.as_str() {
        "hide" => ModerationCommand::Hide { reason },
        "dismiss" => ModerationCommand::Dismiss { reason },
        "restore" => ModerationCommand::Restore { reason },
        _ => {
            return Err(moderation_bad_request(
                "moderation action must be hide, dismiss, or restore",
            ))
        }
    };
    let events = trust_safety::decide_moderation(Some(&current), command)
        .map_err(moderation_reject_api_error)?;
    match projections::append_moderation_and_project_expected(
        &state.pool,
        case,
        current.version,
        events,
        principal_id,
        unix_now_seconds(),
    )
    .await
    {
        Ok(()) => {}
        Err(projections::ProjectionError::Store(eventstore::StoreError::Conflict { .. })) => {
            return Err(discussion_conflict(
                "moderation case changed concurrently; refresh and try again",
            ));
        }
        Err(error) => return Err(ApiError::Projection(error)),
    }
    let detail = projections::moderation_case_by_id(&state.pool, case)
        .await?
        .expect("actioned moderation case is readable");
    Ok(Json(detail.into()))
}

fn parse_moderation_case_cursor(
    value: &str,
) -> Result<projections::ModerationCaseCursor, ApiError> {
    let (updated_seq, case_id) = value
        .split_once(':')
        .ok_or_else(|| moderation_bad_request("invalid moderation cursor"))?;
    Ok(projections::ModerationCaseCursor {
        updated_seq: updated_seq
            .parse()
            .map_err(|_| moderation_bad_request("invalid moderation cursor"))?,
        case_id: Uuid::parse_str(case_id)
            .map_err(|_| moderation_bad_request("invalid moderation cursor"))?,
    })
}

fn moderation_projection_api_error(error: projections::ProjectionError) -> ApiError {
    match error {
        projections::ProjectionError::DuplicateModerationReport => ApiError::Reject {
            status: StatusCode::CONFLICT,
            error: RejectCode::StreamConflict,
            message: "this active report already exists".to_string(),
        },
        projections::ProjectionError::ModerationReportRateLimited => ApiError::RateLimited {
            retry_after_seconds: 86_400,
            message: "the reporter submission limit has been reached".to_string(),
        },
        projections::ProjectionError::ModerationTargetNotPublic => ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::NotAuthorized,
            message: "the moderation target is not public".to_string(),
        },
        error => ApiError::Projection(error),
    }
}

fn moderation_reject_api_error(reject: TrustSafetyReject) -> ApiError {
    match reject {
        TrustSafetyReject::InvalidReportReason | TrustSafetyReject::InvalidModerationCaseStatus => {
            moderation_bad_request(reject.to_string())
        }
        _ => discussion_conflict(reject.to_string().as_str()),
    }
}

fn moderation_bad_request(message: impl Into<String>) -> ApiError {
    ApiError::Reject {
        status: StatusCode::BAD_REQUEST,
        error: RejectCode::Internal,
        message: message.into(),
    }
}

async fn visible_discussion_topic(
    state: &PublicPlatformHttpState,
    topic_id: Uuid,
) -> Result<projections::DiscussionTopicRow, ApiError> {
    let topic = projections::discussion_topic_by_id(&state.pool, topic_id)
        .await?
        .ok_or_else(|| discussion_not_found("discussion topic"))?;
    if topic.visibility != TopicVisibility::Visible.as_str() {
        return Err(discussion_not_found("discussion topic"));
    }
    Ok(topic)
}

struct AuthenticatedDiscussionProfile {
    profile_id: Uuid,
    principal_id: PrincipalId,
}

async fn require_global_mod(
    state: &PublicPlatformHttpState,
    token: &str,
    action: &str,
) -> Result<PrincipalId, ApiError> {
    let authorization = authorization_context(&state.auth, token).await?;
    if authorization
        .global_capabilities
        .iter()
        .any(|capability| matches!(capability.as_str(), "GlobalAdmin" | "GlobalMod"))
    {
        return Ok(authorization.principal_id);
    }
    Err(ApiError::Reject {
        status: StatusCode::FORBIDDEN,
        error: RejectCode::NotAuthorized,
        message: format!("{action} requires GlobalMod"),
    })
}

fn parse_discussion_topic_cursor(
    value: &str,
) -> Result<projections::DiscussionTopicCursor, ApiError> {
    let (updated_seq, topic_id) = value.split_once(':').ok_or_else(|| {
        discussion_conflict("invalid discussion cursor; refresh the area and try again")
    })?;
    let updated_seq = updated_seq.parse::<i64>().map_err(|_| {
        discussion_conflict("invalid discussion cursor; refresh the area and try again")
    })?;
    let topic_id = Uuid::parse_str(topic_id).map_err(|_| {
        discussion_conflict("invalid discussion cursor; refresh the area and try again")
    })?;
    Ok(projections::DiscussionTopicCursor {
        updated_seq,
        topic_id,
    })
}

fn validate_discussion_slug(value: &str) -> Result<String, ApiError> {
    let slug = value.trim().to_ascii_lowercase();
    if !(2..=48).contains(&slug.len())
        || slug.starts_with('-')
        || slug.ends_with('-')
        || !slug
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "discussion area slug must be 2 to 48 lowercase letters, digits, or hyphens"
                .to_string(),
        });
    }
    Ok(slug)
}

fn validate_discussion_text(value: &str, label: &str, max_len: usize) -> Result<String, ApiError> {
    let text = value.trim();
    if text.is_empty() || text.len() > max_len {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: format!("{label} must contain 1 to {max_len} bytes"),
        });
    }
    Ok(text.to_string())
}

fn forum_topic_state(topic: &projections::DiscussionTopicRow) -> Result<TopicState, ApiError> {
    Ok(TopicState {
        topic_id: topic.topic_id,
        area_id: topic.area_id,
        posting_state: PostingState::parse(topic.posting_state.as_str())
            .map_err(forum_reject_api_error)?,
        visibility: TopicVisibility::parse(topic.visibility.as_str())
            .map_err(forum_reject_api_error)?,
        version: topic.version,
    })
}

async fn append_forum_events(
    pool: &PgPool,
    topic_id: Uuid,
    expected_version: i64,
    events: Vec<TopicEvent>,
    principal_id: PrincipalId,
) -> Result<(), ApiError> {
    let occurred_at = unix_now_seconds();
    let events: Vec<_> = events
        .into_iter()
        .map(|event| {
            EventInput::new(
                event.kind(),
                1,
                event.payload(),
                ActorId::Principal(principal_id),
                occurred_at,
            )
        })
        .collect();
    match projections::append_discussion_and_project_expected(
        pool,
        topic_id,
        expected_version,
        events.as_slice(),
    )
    .await
    {
        Ok(_) => Ok(()),
        Err(projections::ProjectionError::Store(eventstore::StoreError::Conflict { .. })) => Err(
            discussion_conflict("discussion changed concurrently; refresh and try again"),
        ),
        Err(error) => Err(ApiError::Projection(error)),
    }
}

fn forum_reject_api_error(reject: ForumReject) -> ApiError {
    let status = match reject {
        ForumReject::InvalidPostingState | ForumReject::InvalidVisibility => {
            StatusCode::BAD_REQUEST
        }
        ForumReject::TopicNotFound => StatusCode::NOT_FOUND,
        _ => StatusCode::CONFLICT,
    };
    ApiError::Reject {
        status,
        error: if status == StatusCode::NOT_FOUND {
            RejectCode::NotAuthorized
        } else if status == StatusCode::BAD_REQUEST {
            RejectCode::Internal
        } else {
            RejectCode::StreamConflict
        },
        message: reject.to_string(),
    }
}

fn content_reference_reject_api_error(
    reject: content_reference::ContentReferenceReject,
) -> ApiError {
    let status = match reject {
        content_reference::ContentReferenceReject::InvalidQuotationTarget
        | content_reference::ContentReferenceReject::InvalidQuotationExcerpt
        | content_reference::ContentReferenceReject::TooManyQuotations
        | content_reference::ContentReferenceReject::QuotationChainTooDeep
        | content_reference::ContentReferenceReject::DuplicateQuotation => StatusCode::BAD_REQUEST,
        content_reference::ContentReferenceReject::QuotationNotFound => StatusCode::NOT_FOUND,
        content_reference::ContentReferenceReject::InvalidPostKind => StatusCode::BAD_REQUEST,
    };
    ApiError::Reject {
        status,
        error: RejectCode::Internal,
        message: reject.to_string(),
    }
}

fn discussion_not_found(resource: &str) -> ApiError {
    ApiError::Reject {
        status: StatusCode::NOT_FOUND,
        error: RejectCode::NotAuthorized,
        message: format!("{resource} was not found"),
    }
}

fn discussion_conflict(message: &str) -> ApiError {
    ApiError::Reject {
        status: StatusCode::CONFLICT,
        error: RejectCode::StreamConflict,
        message: message.to_string(),
    }
}

#[derive(Debug, Clone, Deserialize)]
struct CreateProfileRequest {
    handle: String,
    display_name: String,
    bio: String,
    visibility: String,
}

#[derive(Debug, Clone, Deserialize)]
struct UpdateProfileRequest {
    display_name: String,
    bio: String,
    visibility: String,
    expected_revision: i64,
}

async fn public_profile(
    State(state): State<PublicPlatformHttpState>,
    Path(handle): Path<String>,
) -> Result<Json<PublicProfile>, ApiError> {
    let profile = projections::public_profile_by_handle(&state.pool, handle.as_str())
        .await?
        .ok_or_else(profile_not_found)?;
    Ok(Json(PublicProfile::from(profile)))
}

async fn current_member_profile(
    State(state): State<PublicPlatformHttpState>,
    MemberAuthentication(owner): MemberAuthentication,
) -> Result<Json<ProfileEditor>, ApiError> {
    let profile = profile_application::owner_profile(&state.pool, &owner)
        .await
        .map_err(profile_application_api_error)?
        .ok_or_else(profile_not_found)?;
    Ok(Json(profile_editor_from_owner(profile)?))
}

async fn create_profile(
    State(state): State<PublicPlatformHttpState>,
    MemberAuthentication(owner): MemberAuthentication,
    Json(request): Json<CreateProfileRequest>,
) -> Result<(StatusCode, Json<ProfileEditor>), ApiError> {
    let presentation = profile_presentation_from_input(
        request.handle.as_str(),
        request.display_name.as_str(),
        request.bio.as_str(),
        request.visibility.as_str(),
    )?;
    profile_application::create_profile(&state.pool, owner, presentation, unix_now_seconds())
        .await
        .map_err(profile_application_api_error)?;
    let profile = profile_application::owner_profile(&state.pool, &owner)
        .await
        .map_err(profile_application_api_error)?
        .ok_or_else(profile_not_found)?;
    Ok((
        StatusCode::CREATED,
        Json(profile_editor_from_owner(profile)?),
    ))
}

async fn update_profile(
    State(state): State<PublicPlatformHttpState>,
    MemberAuthentication(owner): MemberAuthentication,
    Json(request): Json<UpdateProfileRequest>,
) -> Result<Json<ProfileEditor>, ApiError> {
    let profile = profile_application::owner_profile(&state.pool, &owner)
        .await
        .map_err(profile_application_api_error)?
        .ok_or_else(profile_not_found)?;
    let edit = profile_edit_from_input(
        request.display_name.as_str(),
        request.bio.as_str(),
        request.visibility.as_str(),
    )?;
    let expected_revision = profile_revision(request.expected_revision)?;
    profile_application::update_profile(
        &state.pool,
        profile.profile_id,
        owner,
        expected_revision,
        edit,
        unix_now_seconds(),
    )
    .await
    .map_err(profile_application_api_error)?;
    let profile = profile_application::owner_profile(&state.pool, &owner)
        .await
        .map_err(profile_application_api_error)?
        .ok_or_else(profile_not_found)?;
    Ok(Json(profile_editor_from_owner(profile)?))
}

fn profile_presentation_from_input(
    handle: &str,
    display_name: &str,
    bio: &str,
    visibility: &str,
) -> Result<ProfilePresentation, ApiError> {
    Ok(ProfilePresentation::new(
        ProfileHandle::new(handle).map_err(profile_value_api_error)?,
        ProfileDisplayName::new(display_name).map_err(profile_value_api_error)?,
        ProfileBio::new(bio).map_err(profile_value_api_error)?,
        visibility
            .parse::<ProfileVisibility>()
            .map_err(profile_value_api_error)?,
    ))
}

fn profile_edit_from_input(
    display_name: &str,
    bio: &str,
    visibility: &str,
) -> Result<ProfileEdit, ApiError> {
    Ok(ProfileEdit::new(
        ProfileDisplayName::new(display_name).map_err(profile_value_api_error)?,
        ProfileBio::new(bio).map_err(profile_value_api_error)?,
        visibility
            .parse::<ProfileVisibility>()
            .map_err(profile_value_api_error)?,
    ))
}

fn profile_revision(value: i64) -> Result<ProfileRevision, ApiError> {
    u64::try_from(value)
        .map(ProfileRevision::new)
        .map_err(|_| profile_value_api_error(social::ProfileValueError::InvalidRevision))
}

fn profile_editor_from_owner(
    profile: profile_application::OwnerProfile,
) -> Result<ProfileEditor, ApiError> {
    let revision =
        i64::try_from(profile.revision.as_u64()).map_err(|_| profile_service_unavailable())?;
    Ok(ProfileEditor {
        handle: profile.presentation.handle.into_inner(),
        display_name: profile.presentation.display_name.into_inner(),
        bio: profile.presentation.bio.into_inner(),
        visibility: profile.presentation.visibility.to_string(),
        revision,
    })
}

fn profile_value_api_error(error: social::ProfileValueError) -> ApiError {
    ApiError::Reject {
        status: StatusCode::BAD_REQUEST,
        error: RejectCode::Internal,
        message: error.to_string(),
    }
}

fn profile_application_api_error(error: profile_application::ProfileApplicationError) -> ApiError {
    use profile_application::ProfileApplicationError;
    match error {
        ProfileApplicationError::ProfileAlreadyExists => {
            profile_conflict("this account already has a profile; edit its current profile")
        }
        ProfileApplicationError::HandleAlreadyExists => {
            profile_conflict("profile handle is already in use; choose another handle")
        }
        ProfileApplicationError::Decision(social::ProfileDecisionError::NotOwner) => {
            ApiError::Reject {
                status: StatusCode::FORBIDDEN,
                error: RejectCode::NotAuthorized,
                message: "profile editing requires the owning account".to_string(),
            }
        }
        ProfileApplicationError::Decision(social::ProfileDecisionError::NoChanges) => {
            ApiError::Reject {
                status: StatusCode::BAD_REQUEST,
                error: RejectCode::Internal,
                message: "profile edit does not change its presentation".to_string(),
            }
        }
        ProfileApplicationError::ProfileNotFound
        | ProfileApplicationError::Decision(social::ProfileDecisionError::NotFound)
        | ProfileApplicationError::Decision(social::ProfileDecisionError::Redacted) => {
            profile_not_found()
        }
        error if error.is_revision_conflict() => {
            profile_conflict("profile changed concurrently; refresh and try again")
        }
        ProfileApplicationError::PrivateClaim(_)
        | ProfileApplicationError::HandleIndexConfiguration(_)
        | ProfileApplicationError::InvalidState(_)
        | ProfileApplicationError::Fold(_) => profile_service_unavailable(),
        ProfileApplicationError::Projection(error) => ApiError::Projection(error),
        ProfileApplicationError::Database(error) => ApiError::Db(error),
        ProfileApplicationError::Decision(_) => profile_service_unavailable(),
    }
}

fn profile_service_unavailable() -> ApiError {
    ApiError::Reject {
        status: StatusCode::SERVICE_UNAVAILABLE,
        error: RejectCode::Internal,
        message: "profile service is temporarily unavailable".to_string(),
    }
}

fn profile_not_found() -> ApiError {
    ApiError::Reject {
        status: StatusCode::NOT_FOUND,
        error: RejectCode::NotAuthorized,
        message: "profile was not found or is not public".to_string(),
    }
}

fn profile_conflict(message: &str) -> ApiError {
    ApiError::Reject {
        status: StatusCode::CONFLICT,
        error: RejectCode::StreamConflict,
        message: message.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::public_search_traffic_class;
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn public_search_canary_classification_is_exact_and_authority_free() {
        let mut headers = HeaderMap::new();
        assert_eq!(public_search_traffic_class(&headers), "external");

        headers.insert(
            "x-fmarch-search-observation",
            HeaderValue::from_static("staging-canary-v1"),
        );
        assert_eq!(public_search_traffic_class(&headers), "staging_canary");

        headers.insert(
            "x-fmarch-search-observation",
            HeaderValue::from_static("staging-canary-v2"),
        );
        assert_eq!(public_search_traffic_class(&headers), "external");

        headers.insert(
            "x-fmarch-search-observation",
            HeaderValue::from_bytes(&[0xff]).expect("opaque header value is valid"),
        );
        assert_eq!(public_search_traffic_class(&headers), "external");
    }
}
