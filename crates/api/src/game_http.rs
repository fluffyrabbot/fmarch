//! Public, player, operator, and host game-read HTTP boundary.

use super::auth_http::{
    authorization_context, bearer_token, require_global_admin, require_global_operator,
    unauthorized_session, unix_now_seconds, AuthHttpState, AuthenticatedRequest,
    AuthorizationContext,
};
use super::command_http::command_reject_api_error;
use super::{ApiError, ApiState};
use crate::{live_projection, program_library};
use axum::extract::{FromRef, FromRequestParts, Path, Query, State};
use axum::http::request::Parts;
use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use caps::{Capability, Principal};
use content_reference::{
    PostKind as ContentPostKind, PostRef as ContentPostRef, DEFAULT_POST_CITATION_LIMIT,
};
use principal::PrincipalId;
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPool;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use uuid::Uuid;
use wire::{
    DayEventNarrativeDelta, DayEventRoomDelta, DayEventSchedulerDelta, DayVoteOutcomeDelta,
    GameIndexEntry, GameIndexPage, GameThreadAuthor, HostConsoleAuthorityDelta,
    HostConsoleAuthorityKind, HostConsolePhaseStateDelta, HostConsoleSlotOccupancyDelta,
    HostConsoleStateDelta, HostConsoleThreadPostDelta, HostDayEventDelta, HostPhaseControl,
    HostPromptDelta, HostPromptMetadata, HostPromptPublicResolution, HostPromptRecordedDecision,
    HostTaskAllowedCommand, HostTaskCommandKind, HostTaskDelta, HostTaskKind, HostTaskState,
    HostTaskUrgency, PlayerInvestigationResult, PlayerNotification, PostCitationPage,
    PostCitationsChangedDelta, PostKind, PostRef, ProjectionDelta, PublicGameThreadPage, Quotation,
    RejectCode, ThreadPage, ThreadPost, ThreadPostsDelta,
};

#[derive(Clone)]
pub(super) struct GameHttpState {
    pool: PgPool,
    auth: AuthHttpState,
}

impl FromRef<GameHttpState> for AuthHttpState {
    fn from_ref(state: &GameHttpState) -> Self {
        state.auth.clone()
    }
}

impl GameHttpState {
    fn new(pool: PgPool, auth: AuthHttpState) -> Self {
        Self { pool, auth }
    }
}

pub(super) fn routes(state: &ApiState) -> Router<ApiState> {
    Router::new()
        .route("/admin/games", get(admin_game_index))
        .route("/admin/game-bootstrap", get(admin_game_bootstrap))
        .route("/games", get(game_index))
        .route("/games/{game}", get(public_game_thread))
        .route(
            "/games/{game}/posts/{source_seq}/citations",
            get(public_game_post_citations),
        )
        .route("/games/{game}/votecount", get(votecount))
        .route("/games/{game}/day-vote-outcomes", get(day_vote_outcomes))
        .route("/games/{game}/endgame-summary", get(endgame_summary))
        .route("/games/{game}/export", get(completed_game_export))
        .route(
            "/games/{game}/channels/{channel}/thread",
            get(channel_thread_view),
        )
        .route(
            "/games/{game}/channels/{channel}/posts/{source_seq}/citations",
            get(channel_post_citations),
        )
        .route("/games/{game}/notifications", get(player_notifications))
        .route(
            "/games/{game}/investigation-results",
            get(player_investigation_results),
        )
        .route(
            "/games/{game}/player-command-state",
            get(player_command_state),
        )
        .route(
            "/games/{game}/host-phase-controls",
            get(host_phase_controls),
        )
        .route("/games/{game}/host-prompts", get(host_prompts))
        .route("/games/{game}/host-console-state", get(host_console_state))
        .route("/games/{game}/setup-state", get(host_setup_state))
        .with_state(GameHttpState::new(state.pool.clone(), state.auth.clone()))
}

#[derive(Debug, Clone)]
pub(super) struct GameAuthorization {
    principal_id: PrincipalId,
    global_capabilities: Vec<String>,
}

impl GameAuthorization {
    pub(super) fn from_context(context: &AuthorizationContext) -> Self {
        Self {
            principal_id: context.principal_id,
            global_capabilities: context.global_capabilities.clone(),
        }
    }

    fn fixture_principal(principal_id: PrincipalId) -> Self {
        Self {
            principal_id,
            global_capabilities: Vec::new(),
        }
    }

    pub(super) const fn principal_id(&self) -> PrincipalId {
        self.principal_id
    }

    fn is_global_operator(&self) -> bool {
        self.global_capabilities
            .iter()
            .any(|capability| matches!(capability.as_str(), "GlobalAdmin" | "GlobalMod"))
    }
}

impl GameAuthorization {
    /// Authorizes from raw headers for the two channel routes whose contract
    /// deliberately answers unknown-channel requests with 404 before any
    /// credential check can answer 401.
    async fn authorize(state: &GameHttpState, headers: &HeaderMap) -> Result<Self, ApiError> {
        let token = bearer_token(headers).ok_or_else(unauthorized_session)?;
        let context = authorization_context(&state.auth, token).await?;
        Ok(Self::from_context(&context))
    }
}

impl<S> FromRequestParts<S> for GameAuthorization
where
    AuthHttpState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let request = AuthenticatedRequest::from_request_parts(parts, state).await?;
        Ok(Self::from_context(&request.context))
    }
}

async fn votecount(
    State(state): State<GameHttpState>,
    Path(game): Path<Uuid>,
) -> Result<Json<Vec<ProjectionDelta>>, ApiError> {
    Ok(Json(current_votecount_deltas(&state.pool, game).await?))
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EndgameSummaryResponse {
    pub game: Uuid,
    pub completed: bool,
    pub winner: Option<EndgameWinner>,
    pub slots: Vec<EndgameSlotReveal>,
    pub vote_history: Vec<EndgameDayVote>,
    pub boundary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EndgameWinner {
    pub alignment: String,
    pub reason: String,
    pub phase_id: domain::phase::PhaseId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EndgameSlotReveal {
    pub slot_id: String,
    pub alive: bool,
    pub status: String,
    pub role_key: Option<String>,
    pub alignment: Option<String>,
    pub role_revealed: bool,
    pub alignment_revealed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EndgameDayVote {
    pub phase_id: domain::phase::PhaseId,
    pub source_seq: i64,
    pub event_index: i32,
    pub status: String,
    pub winner_slot: Option<String>,
    pub tallies: BTreeMap<String, f64>,
    pub votes: BTreeMap<String, String>,
    pub majority: Option<f64>,
    pub reason: Option<String>,
}

/// Public game read in the votecount access class. Role and alignment facts
/// are gated per-slot by the projection's reveal flags, so mid-game death
/// flips honor pack death_reveal policy and full reveal arrives only when
/// GameCompleted/WinReached fold the flip.
async fn endgame_summary(
    State(state): State<GameHttpState>,
    Path(game): Path<Uuid>,
) -> Result<Json<EndgameSummaryResponse>, ApiError> {
    let completed = commands::game_completed(&state.pool, game)
        .await
        .map_err(command_reject_api_error)?;
    let result = projections::game_result(&state.pool, game).await?;
    let vote_history = if completed {
        let mut history = Vec::new();
        for outcome in projections::day_vote_outcomes(&state.pool, game).await? {
            let delta = DayVoteOutcomeDelta::try_from(outcome)?;
            history.push(EndgameDayVote {
                phase_id: delta.phase_id,
                source_seq: delta.source_seq,
                event_index: delta.event_index,
                status: delta.status,
                winner_slot: delta.winner_slot,
                tallies: delta.tallies,
                votes: delta.votes,
                majority: delta.majority,
                reason: delta.reason,
            });
        }
        history
    } else {
        Vec::new()
    };
    let slots = projections::slot_state(&state.pool, game)
        .await?
        .into_iter()
        .map(|slot| EndgameSlotReveal {
            slot_id: slot.slot_id,
            alive: slot.alive,
            status: slot.status,
            role_key: if slot.role_revealed {
                slot.role_key
            } else {
                None
            },
            alignment: if slot.alignment_revealed {
                slot.alignment
            } else {
                None
            },
            role_revealed: slot.role_revealed,
            alignment_revealed: slot.alignment_revealed,
        })
        .collect();
    Ok(Json(EndgameSummaryResponse {
        game,
        completed,
        winner: result.map(|row| EndgameWinner {
            alignment: row.winner,
            reason: row.reason,
            phase_id: row.phase_id,
        }),
        slots,
        vote_history,
        boundary: "Endgame summary is reveal-gated: per-slot role and alignment appear only \
                   after the projection's reveal flags flip (death_reveal policy mid-game, \
                   GameCompleted/WinReached at the end). Per-day vote history appears only \
                   after GameCompleted. The winner fact is folded from the engine's terminal \
                   WinReached."
            .to_string(),
    }))
}

async fn completed_game_export(
    State(state): State<GameHttpState>,
    Path(game): Path<Uuid>,
    authorization: GameAuthorization,
) -> Result<Json<projections::CompletedGameExport>, ApiError> {
    let capabilities = caps::resolve(
        &state.pool,
        &Principal::authenticated(authorization.principal_id()),
        game,
    )
    .await?;
    if !capabilities.grants(&Capability::CohostOf(game)) {
        return Err(ApiError::Reject {
            status: StatusCode::FORBIDDEN,
            error: RejectCode::NotAuthorized,
            message: "completed-game export requires HostOf(game) or CohostOf(game)".to_string(),
        });
    }
    Ok(Json(
        projections::export_completed_game(&state.pool, game).await?,
    ))
}
pub(super) async fn current_votecount_deltas(
    pool: &PgPool,
    game: Uuid,
) -> Result<Vec<ProjectionDelta>, projections::ProjectionError> {
    live_projection::vote_count_deltas(pool, game).await
}

async fn day_vote_outcomes(
    State(state): State<GameHttpState>,
    Path(game): Path<Uuid>,
) -> Result<Json<Vec<ProjectionDelta>>, ApiError> {
    let rows = projections::day_vote_outcomes(&state.pool, game).await?;
    Ok(Json(
        rows.into_iter()
            .map(|row| {
                DayVoteOutcomeDelta::try_from(row).map(ProjectionDelta::DayVoteOutcomeApplied)
            })
            .collect::<Result<Vec<_>, _>>()?,
    ))
}

#[derive(Debug, Clone, Deserialize)]
struct ThreadQuery {
    before_seq: Option<i64>,
    limit: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
struct GameIndexQuery {
    cursor: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct AdminGameBootstrapResponse {
    packs: Vec<AdminGameBootstrapPack>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct AdminGameBootstrapPack {
    key: String,
    name: String,
}

async fn game_index(
    State(state): State<GameHttpState>,
    Query(query): Query<GameIndexQuery>,
) -> Result<Json<GameIndexPage>, ApiError> {
    let cursor = query
        .cursor
        .as_deref()
        .map(parse_game_index_cursor)
        .transpose()?;
    Ok(Json(
        projections::game_index(&state.pool, cursor, query.limit.unwrap_or(12))
            .await?
            .into(),
    ))
}

async fn admin_game_index(
    State(state): State<GameHttpState>,
    Query(query): Query<GameIndexQuery>,
    request: AuthenticatedRequest,
) -> Result<Json<GameIndexPage>, ApiError> {
    require_global_operator(&state.auth, &request.bearer, "admin game discovery").await?;
    let cursor = query
        .cursor
        .as_deref()
        .map(parse_game_index_cursor)
        .transpose()?;
    Ok(Json(
        projections::operator_game_index(&state.pool, cursor, query.limit.unwrap_or(100))
            .await?
            .into(),
    ))
}

async fn admin_game_bootstrap(
    State(state): State<GameHttpState>,
    request: AuthenticatedRequest,
) -> Result<Json<AdminGameBootstrapResponse>, ApiError> {
    require_global_admin(&state.auth, &request.bearer, "game bootstrap").await?;
    Ok(Json(AdminGameBootstrapResponse {
        packs: product_pack_catalog()?,
    }))
}

async fn public_game_thread(
    State(state): State<GameHttpState>,
    Path(game): Path<Uuid>,
    Query(query): Query<ThreadQuery>,
) -> Result<Json<PublicGameThreadPage>, ApiError> {
    let game_row = projections::public_game_by_id(&state.pool, game)
        .await?
        .ok_or_else(|| ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::UnknownGame,
            message: "public game was not found".to_string(),
        })?;
    let page = projections::public_thread_view(
        &state.pool,
        game,
        query.before_seq,
        query.limit.unwrap_or(50),
    )
    .await?;
    Ok(Json(PublicGameThreadPage {
        game: GameIndexEntry::from(game_row),
        posts: page.posts.into_iter().map(ThreadPost::from).collect(),
        next_before_seq: page.next_before_seq,
    }))
}

fn parse_game_index_cursor(value: &str) -> Result<projections::GameIndexCursor, ApiError> {
    let (updated_seq, game_id) = value.split_once(':').ok_or_else(|| ApiError::Reject {
        status: StatusCode::BAD_REQUEST,
        error: RejectCode::StreamConflict,
        message: "invalid game index cursor; refresh the board and try again".to_string(),
    })?;
    let updated_seq = updated_seq.parse::<i64>().map_err(|_| ApiError::Reject {
        status: StatusCode::BAD_REQUEST,
        error: RejectCode::StreamConflict,
        message: "invalid game index cursor; refresh the board and try again".to_string(),
    })?;
    let game_id = Uuid::parse_str(game_id).map_err(|_| ApiError::Reject {
        status: StatusCode::BAD_REQUEST,
        error: RejectCode::StreamConflict,
        message: "invalid game index cursor; refresh the board and try again".to_string(),
    })?;
    Ok(projections::GameIndexCursor {
        updated_seq,
        game_id,
    })
}

#[derive(Debug, Clone, Deserialize)]
struct ChannelThreadQuery {
    before_seq: Option<i64>,
    limit: Option<i64>,
}

async fn channel_thread_view(
    State(state): State<GameHttpState>,
    Path((game, channel)): Path<(Uuid, String)>,
    Query(query): Query<ChannelThreadQuery>,
    headers: HeaderMap,
) -> Result<Json<ThreadPage>, ApiError> {
    if channel == "main" {
        return Err(ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::NotAuthorized,
            message: "the public main thread is available only at /games/{game}".to_string(),
        });
    }
    let authorization = GameAuthorization::authorize(&state, &headers).await?;
    require_channel_thread_access(
        &state.pool,
        game,
        channel.as_str(),
        Some(authorization.principal_id()),
    )
    .await?;

    let page = projections::thread_view_for_channel(
        &state.pool,
        game,
        channel.as_str(),
        query.before_seq,
        query.limit.unwrap_or(50),
    )
    .await?;
    Ok(Json(ThreadPage::from(page)))
}

#[derive(Debug, Clone, Deserialize)]
struct PostCitationQuery {
    limit: Option<i64>,
}

async fn public_game_post_citations(
    State(state): State<GameHttpState>,
    Path((game, source_seq)): Path<(Uuid, i64)>,
    Query(query): Query<PostCitationQuery>,
) -> Result<Json<PostCitationPage>, ApiError> {
    if projections::public_game_by_id(&state.pool, game)
        .await?
        .is_none()
    {
        return Err(ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::UnknownGame,
            message: "public game was not found".to_string(),
        });
    }
    let page = projections::visible_incoming_citations(
        &state.pool,
        ContentPostRef {
            kind: ContentPostKind::GamePost,
            scope_id: game,
            source_seq,
        },
        Some("main"),
        query.limit.unwrap_or(DEFAULT_POST_CITATION_LIMIT),
    )
    .await?
    .ok_or_else(|| ApiError::Reject {
        status: StatusCode::NOT_FOUND,
        error: RejectCode::NotAuthorized,
        message: "game post was not found".to_string(),
    })?;
    Ok(Json(PostCitationPage::from(page)))
}

async fn channel_post_citations(
    State(state): State<GameHttpState>,
    Path((game, channel, source_seq)): Path<(Uuid, String, i64)>,
    Query(query): Query<PostCitationQuery>,
    headers: HeaderMap,
) -> Result<Json<PostCitationPage>, ApiError> {
    if channel == "main" {
        return Err(ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::NotAuthorized,
            message: "the public main thread is available only at /games/{game}".to_string(),
        });
    }
    let authorization = GameAuthorization::authorize(&state, &headers).await?;
    require_channel_thread_access(
        &state.pool,
        game,
        channel.as_str(),
        Some(authorization.principal_id()),
    )
    .await?;
    game_post_citations(&state.pool, game, channel.as_str(), source_seq, query.limit).await
}

async fn game_post_citations(
    pool: &PgPool,
    game: Uuid,
    channel_id: &str,
    source_seq: i64,
    limit: Option<i64>,
) -> Result<Json<PostCitationPage>, ApiError> {
    let page = projections::visible_incoming_citations(
        pool,
        ContentPostRef {
            kind: ContentPostKind::GamePost,
            scope_id: game,
            source_seq,
        },
        Some(channel_id),
        limit.unwrap_or(DEFAULT_POST_CITATION_LIMIT),
    )
    .await?
    .ok_or_else(|| ApiError::Reject {
        status: StatusCode::NOT_FOUND,
        error: RejectCode::NotAuthorized,
        message: "game post was not found".to_string(),
    })?;
    Ok(Json(PostCitationPage::from(page)))
}

pub(super) async fn current_thread_posts_delta(
    pool: &PgPool,
    game: Uuid,
    channel: &str,
) -> Result<ProjectionDelta, projections::ProjectionError> {
    let page = if channel == "main" {
        projections::public_thread_view(pool, game, None, 50).await?
    } else {
        projections::thread_view_for_channel(pool, game, channel, None, 50).await?
    };
    Ok(ProjectionDelta::ThreadPostsChanged(ThreadPostsDelta {
        game,
        posts: page.posts.into_iter().map(ThreadPost::from).collect(),
    }))
}

pub(super) async fn current_thread_posts_after_delta(
    pool: &PgPool,
    game: Uuid,
    channel: &str,
    after_seq: i64,
) -> Result<Option<ProjectionDelta>, projections::ProjectionError> {
    let page = if channel == "main" {
        projections::public_thread_view_after(pool, game, after_seq, 50).await?
    } else {
        projections::thread_view_for_channel_after(pool, game, channel, after_seq, 50).await?
    };
    if page.posts.is_empty() {
        return Ok(None);
    }
    Ok(Some(ProjectionDelta::ThreadPostsChanged(
        ThreadPostsDelta {
            game,
            posts: page.posts.into_iter().map(ThreadPost::from).collect(),
        },
    )))
}

pub(super) async fn current_post_citations_deltas(
    pool: &PgPool,
    game: Uuid,
    channel: &str,
    extra_quoting_seqs: &[i64],
) -> Result<Vec<ProjectionDelta>, projections::ProjectionError> {
    let page = if channel == "main" {
        projections::public_thread_view(pool, game, None, 50).await?
    } else {
        projections::thread_view_for_channel(pool, game, channel, None, 50).await?
    };
    let present_source_seqs: Vec<i64> = page.posts.iter().map(|post| post.source_seq).collect();
    let mut quoting_source_seqs = extra_quoting_seqs.to_vec();
    for post in &page.posts {
        if !post.quotations.is_empty() {
            quoting_source_seqs.push(post.source_seq);
        }
    }
    quoting_source_seqs.sort_unstable();
    quoting_source_seqs.dedup();
    let counts = projections::off_page_game_citation_counts(
        pool,
        game,
        channel,
        &quoting_source_seqs,
        &present_source_seqs,
    )
    .await?;
    Ok(counts
        .into_iter()
        .map(|(source_seq, citation_count)| {
            ProjectionDelta::PostCitationsChanged(PostCitationsChangedDelta {
                quoted: PostRef {
                    kind: PostKind::GamePost,
                    scope_id: game,
                    source_seq,
                },
                citation_count,
            })
        })
        .collect())
}

/// The addressable roster for every channel this principal can read.
///
/// Read capability is the whole authorisation: a room the actor cannot read
/// contributes no roster, so the composer can never suggest a seat the write
/// model would refuse, and a suggestion list can never become an oracle for a
/// room the actor is outside of.
async fn channel_mention_targets(
    pool: &PgPool,
    game: Uuid,
    caps: &caps::CapabilitySet,
) -> Result<Vec<ChannelMentionTargets>, ApiError> {
    let mut channels: BTreeSet<String> = BTreeSet::new();
    channels.insert("main".to_string());
    if caps.grants(&Capability::DeadViewer(game)) {
        channels.insert("dead".to_string());
    }
    for cap in caps.iter() {
        if let Capability::ChannelMember(channel) = cap {
            channels.insert(channel.clone());
        }
    }
    let mut targets = Vec::with_capacity(channels.len());
    for channel_id in channels {
        let slots = projections::channel_audience_slots(pool, game, &channel_id).await?;
        targets.push(ChannelMentionTargets { channel_id, slots });
    }
    Ok(targets)
}

pub(super) async fn require_channel_thread_access(
    pool: &PgPool,
    game: Uuid,
    channel: &str,
    principal_id: Option<PrincipalId>,
) -> Result<(), ApiError> {
    let Some(principal_id) = principal_id else {
        return Err(ApiError::Reject {
            status: StatusCode::FORBIDDEN,
            error: RejectCode::NotAuthorized,
            message: "principal cannot read channel thread for this game".to_string(),
        });
    };

    let caps = caps::resolve(pool, &Principal::authenticated(principal_id), game).await?;
    let channel_cap = Capability::ChannelMember(channel.to_string());
    let dead_channel_cap = Capability::DeadViewer(game);
    let spectator_channel_cap = Capability::SpectatorOf(game);
    if caps.grants(&Capability::HostOf(game))
        || caps.grants(&Capability::CohostOf(game))
        || caps.grants(&channel_cap)
        || (channel == "dead" && caps.grants(&dead_channel_cap))
        || (channel == "spectator" && caps.grants(&spectator_channel_cap))
    {
        return Ok(());
    }

    Err(ApiError::Reject {
        status: StatusCode::FORBIDDEN,
        error: RejectCode::NotAuthorized,
        message: "principal cannot read channel thread for this game".to_string(),
    })
}

async fn player_notifications(
    State(state): State<GameHttpState>,
    Path(game): Path<Uuid>,
    authorization: GameAuthorization,
) -> Result<Json<Vec<PlayerNotification>>, ApiError> {
    Ok(Json(
        player_notifications_for_principal(&state.pool, game, authorization.principal_id()).await?,
    ))
}

async fn player_investigation_results(
    State(state): State<GameHttpState>,
    Path(game): Path<Uuid>,
    authorization: GameAuthorization,
) -> Result<Json<Vec<PlayerInvestigationResult>>, ApiError> {
    Ok(Json(
        player_investigation_results_for_principal(&state.pool, game, authorization.principal_id())
            .await?,
    ))
}

pub(super) async fn player_notifications_for_principal(
    pool: &PgPool,
    game: Uuid,
    principal_id: PrincipalId,
) -> Result<Vec<PlayerNotification>, ApiError> {
    let caps = caps::resolve(pool, &Principal::authenticated(principal_id), game).await?;
    let rows = if caps.grants(&Capability::CohostOf(game)) {
        projections::player_notifications(pool, game).await?
    } else {
        let mut rows = Vec::new();
        let mut has_readable_slot = false;
        for cap in caps.iter() {
            let Capability::SlotOccupant(slot) = cap else {
                continue;
            };
            has_readable_slot = true;
            rows.extend(projections::player_notifications_for_slot(pool, game, slot).await?);
        }
        if !has_readable_slot {
            return Err(ApiError::Reject {
                status: StatusCode::FORBIDDEN,
                error: RejectCode::NotAuthorized,
                message: "principal cannot read player notifications for this game".to_string(),
            });
        }
        rows
    };

    Ok(rows.into_iter().map(PlayerNotification::from).collect())
}

pub(super) async fn player_investigation_results_for_principal(
    pool: &PgPool,
    game: Uuid,
    principal_id: PrincipalId,
) -> Result<Vec<PlayerInvestigationResult>, ApiError> {
    let caps = caps::resolve(pool, &Principal::authenticated(principal_id), game).await?;
    let rows = if caps.grants(&Capability::CohostOf(game)) {
        projections::player_investigation_results(pool, game).await?
    } else {
        let mut rows = Vec::new();
        let mut has_readable_slot = false;
        for cap in caps.iter() {
            let Capability::SlotOccupant(slot) = cap else {
                continue;
            };
            has_readable_slot = true;
            rows.extend(
                projections::player_investigation_results_for_slot(pool, game, slot).await?,
            );
        }
        if !has_readable_slot {
            return Err(ApiError::Reject {
                status: StatusCode::FORBIDDEN,
                error: RejectCode::NotAuthorized,
                message: "principal cannot read investigation results for this game".to_string(),
            });
        }
        rows
    };

    Ok(rows
        .into_iter()
        .map(PlayerInvestigationResult::try_from)
        .collect::<Result<Vec<_>, _>>()?)
}

#[derive(Debug, Clone, Deserialize)]
struct PlayerCommandStateQuery {
    #[serde(default)]
    slot_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlayerCommandStateResponse {
    pub game: Uuid,
    pub actor_slot: Option<String>,
    pub actor_alive: bool,
    pub actor_status: String,
    pub role_key: Option<String>,
    pub role: Option<PlayerCommandRoleView>,
    pub game_completed: bool,
    pub phase: Option<PlayerCommandPhaseState>,
    pub actions: Vec<PlayerCommandAction>,
    pub current_actions: Vec<PlayerCommandCurrentAction>,
    pub vote_targets: Vec<PlayerVoteTarget>,
    pub current_vote: Option<PlayerVoteTarget>,
    /// At most one attention item per open DayEvent the slot can act on.
    pub day_events: Vec<PlayerDayEventAttention>,
    /// Self-scoped private DayEvent rooms for the current slot. Locked and
    /// terminal rooms remain visible as read-only history while membership is
    /// retained; revoked rooms disappear from this projection immediately.
    pub day_event_rooms: Vec<DayEventRoomDelta>,
    #[serde(default)]
    pub post_policies: Vec<HostSetupPostPolicyState>,
    /// The seats a mention may address in each channel this actor can read.
    /// It rides along with the command state the composer already loads, so
    /// typing `@` costs no round trip and reaches no profile corpus: a game
    /// thread addresses a seat, and only a seat that can read the room.
    #[serde(default)]
    pub mention_targets: Vec<ChannelMentionTargets>,
    pub boundary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChannelMentionTargets {
    pub channel_id: String,
    pub slots: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerCommandPhaseState {
    pub phase_id: domain::phase::PhaseId,
    pub locked: bool,
    pub deadline: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerCommandRoleView {
    pub key: String,
    pub alignment: Option<String>,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerCommandAction {
    pub source: String,
    pub template_id: String,
    pub ability: String,
    pub window: String,
    pub label: String,
    pub detail: String,
    pub targets: Vec<String>,
    pub target_options: Vec<String>,
    pub grant_id: Option<String>,
}

/// A night action the actor has already submitted this phase (and may withdraw).
/// Additive to the command-state read: the client renders the current pick and,
/// carrying `action_id`, can build a `WithdrawAction`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerCommandCurrentAction {
    pub action_id: String,
    pub template_id: String,
    pub targets: Vec<String>,
    pub grant_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerVoteTarget {
    pub kind: String,
    pub slot_id: Option<String>,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerDayEventAttention {
    pub event_id: String,
    pub template_key: String,
    pub phase_id: Option<domain::phase::PhaseId>,
    pub participation_status: String,
    pub participant_count: u32,
    pub minimum_participants: u32,
    pub maximum_participants: Option<u32>,
    pub reward_keys: Vec<String>,
    pub can_submit: bool,
    pub can_withdraw: bool,
}

async fn player_command_state(
    State(state): State<GameHttpState>,
    Path(game): Path<Uuid>,
    Query(query): Query<PlayerCommandStateQuery>,
    authorization: GameAuthorization,
) -> Result<Json<PlayerCommandStateResponse>, ApiError> {
    let caps = caps::resolve(
        &state.pool,
        &Principal::authenticated(authorization.principal_id()),
        game,
    )
    .await?;
    let actor_slot = match query.slot_id {
        Some(slot) if caps.grants(&Capability::SlotOccupant(slot.clone())) => slot,
        Some(_) => {
            return Err(ApiError::Reject {
                status: StatusCode::FORBIDDEN,
                error: RejectCode::NotYourSlot,
                message: "principal cannot act as requested slot".to_string(),
            });
        }
        None => caps
            .iter()
            .find_map(|cap| match cap {
                Capability::SlotOccupant(slot) => Some(slot.clone()),
                _ => None,
            })
            .ok_or_else(|| ApiError::Reject {
                status: StatusCode::FORBIDDEN,
                error: RejectCode::NotAuthorized,
                message: "principal cannot read player command state for this game".to_string(),
            })?,
    };

    let phase = projections::phase_state(&state.pool, game).await?;
    let slots = projections::slot_state(&state.pool, game).await?;
    let actor = slots
        .iter()
        .find(|slot| slot.slot_id == actor_slot)
        .ok_or_else(|| ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::UnknownSlot,
            message: "actor slot does not exist in this game".to_string(),
        })?;
    // One verified, content-addressed load feeds every command-state decision.
    // The artifact is immutable for the game, so refetching it for role, vote,
    // and action views only adds database transfer and hashing work.
    let pack = load_pack_for_game(&state, game).await?;
    let role_key = actor.role_key.clone();
    let role = match role_key.as_deref() {
        Some(key) => player_role_view(pack.document(), key),
        None => None,
    };
    let game_completed = commands::game_completed(&state.pool, game)
        .await
        .map_err(command_reject_api_error)?;
    let phase_view = phase.as_ref().map(player_phase_state).transpose()?;
    let current_vote = match phase.as_ref() {
        Some(phase) if actor.alive && !game_completed => {
            current_player_vote(&state, game, &phase.phase_id, &actor.slot_id).await?
        }
        _ => None,
    };
    let vote_targets = if actor.alive && !game_completed {
        match phase.as_ref() {
            Some(phase)
                if !phase.locked && phase.phase_id.kind() == domain::phase::PhaseKind::Day =>
            {
                available_vote_targets(pack.document(), &slots, actor)
            }
            _ => Vec::new(),
        }
    } else {
        Vec::new()
    };
    let (actions, current_actions) = if actor.alive && !game_completed {
        match (phase.as_ref(), role_key.as_deref()) {
            (Some(phase), Some(role_key)) if !phase.locked => {
                // One stream fold, two outputs: the templates still open to submit
                // (filtered by available_role_actions) and the actions already
                // submitted this phase (rendered as current_actions, withdrawable).
                let submitted = commands::active_actions_view_for_actor_phase(
                    &state.pool,
                    game,
                    &phase.phase_id,
                    &actor.slot_id,
                )
                .await
                .map_err(command_reject_api_error)?;
                let active_templates: BTreeSet<String> = submitted
                    .iter()
                    .map(|action| action.template_id.clone())
                    .collect();
                let actions = available_role_actions(
                    pack.document(),
                    phase,
                    &slots,
                    actor,
                    role_key,
                    &active_templates,
                )?;
                let current_actions = submitted
                    .into_iter()
                    .map(|action| PlayerCommandCurrentAction {
                        action_id: action.action_id,
                        template_id: action.template_id,
                        targets: action.targets,
                        grant_id: action.grant_id,
                    })
                    .collect();
                (actions, current_actions)
            }
            _ => (Vec::new(), Vec::new()),
        }
    } else {
        (Vec::new(), Vec::new())
    };
    let day_event_workspace =
        load_player_day_event_workspace(&state.pool, game, actor, game_completed).await?;
    let mention_targets = channel_mention_targets(&state.pool, game, &caps).await?;
    let post_policies = projections::post_policies(&state.pool, game)
        .await?
        .into_iter()
        .map(|policy| HostSetupPostPolicyState {
            channel_id: policy.channel_id,
            allow_media_only: policy.allow_media_only,
        })
        .collect();

    Ok(Json(PlayerCommandStateResponse {
        game,
        actor_slot: Some(actor_slot),
        actor_alive: actor.alive,
        actor_status: actor.status.clone(),
        role_key,
        role,
        game_completed,
        phase: phase_view,
        actions,
        current_actions,
        vote_targets,
        current_vote,
        day_events: day_event_workspace.attention,
        day_event_rooms: day_event_workspace.rooms,
        post_policies,
        mention_targets,
        boundary: if game_completed {
            "The game is complete; role actions, votes, and posts are closed while final role and alignment facts are public.".to_string()
        } else {
            "Role-action availability is derived from committed phase_state, slot_state, the actor role in the game pack, and conservative target candidates. Final command validation still happens at /commands.".to_string()
        },
    }))
}

/// Reusable authority-checked DayEvent attention read for local proof and
/// non-HTTP adapters. The returned items are assembled by the same function as
/// the player command-state handler.
pub async fn load_player_day_event_attention_for_principal(
    pool: &PgPool,
    game: Uuid,
    principal_id: PrincipalId,
    requested_slot: Option<&str>,
) -> Result<Vec<PlayerDayEventAttention>, ApiError> {
    let caps = caps::resolve(pool, &Principal::authenticated(principal_id), game).await?;
    let actor_slot = match requested_slot {
        Some(slot) if caps.grants(&Capability::SlotOccupant(slot.to_string())) => slot.to_string(),
        Some(_) => {
            return Err(ApiError::Reject {
                status: StatusCode::FORBIDDEN,
                error: RejectCode::NotYourSlot,
                message: "principal cannot act as requested slot".to_string(),
            });
        }
        None => caps
            .iter()
            .find_map(|cap| match cap {
                Capability::SlotOccupant(slot) => Some(slot.clone()),
                _ => None,
            })
            .ok_or_else(|| ApiError::Reject {
                status: StatusCode::FORBIDDEN,
                error: RejectCode::NotAuthorized,
                message: "principal cannot read player command state for this game".to_string(),
            })?,
    };
    let slots = projections::slot_state(pool, game).await?;
    let actor = slots
        .iter()
        .find(|slot| slot.slot_id == actor_slot)
        .ok_or_else(|| ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::UnknownSlot,
            message: "actor slot does not exist in this game".to_string(),
        })?;
    let game_completed = commands::game_completed(pool, game)
        .await
        .map_err(command_reject_api_error)?;
    Ok(
        load_player_day_event_workspace(pool, game, actor, game_completed)
            .await?
            .attention,
    )
}

struct PlayerDayEventWorkspace {
    attention: Vec<PlayerDayEventAttention>,
    rooms: Vec<DayEventRoomDelta>,
}

async fn load_player_day_event_workspace(
    pool: &PgPool,
    game: Uuid,
    actor: &projections::SlotStateRow,
    game_completed: bool,
) -> Result<PlayerDayEventWorkspace, ApiError> {
    let event_rows = projections::day_events(pool, game).await?;
    let participation = projections::day_event_participation_for_game(pool, game).await?;
    let private_members = projections::private_channel_members(pool, game).await?;
    let mut attention = Vec::new();
    let mut rooms = Vec::new();

    for event in &event_rows {
        if let Some(room) = day_event_room_delta(event, &private_members) {
            if private_members.iter().any(|member| {
                member.channel_id == room.channel_id && member.slot_id == actor.slot_id
            }) {
                rooms.push(DayEventRoomDelta {
                    posting_allowed: room.posting_allowed && !game_completed,
                    ..room
                });
            }
        }

        if game_completed || event.state != "open" {
            continue;
        }
        let eligible = match event.definition.participation.who {
            game_platform::ParticipantFilter::AliveSlots => actor.alive,
            game_platform::ParticipantFilter::AllOccupied => true,
            game_platform::ParticipantFilter::HostInvited
            | game_platform::ParticipantFilter::ChannelMembers => false,
        };
        if !eligible {
            continue;
        }
        let event_participation = participation
            .iter()
            .filter(|row| row.event_id == event.event_id)
            .collect::<Vec<_>>();
        let submitted = event_participation
            .iter()
            .any(|row| row.actor_slot == actor.slot_id);
        let at_capacity = event
            .definition
            .participation
            .limits
            .maximum
            .is_some_and(|maximum| event_participation.len() >= maximum as usize);
        attention.push(PlayerDayEventAttention {
            event_id: event.event_id.clone(),
            template_key: event.definition.template_key.as_str().to_string(),
            phase_id: event.phase_id.clone(),
            participation_status: if submitted {
                "submitted".to_string()
            } else {
                "available".to_string()
            },
            participant_count: event_participation.len() as u32,
            minimum_participants: event.definition.participation.limits.minimum,
            maximum_participants: event.definition.participation.limits.maximum,
            reward_keys: event
                .definition
                .rewards
                .iter()
                .map(|reward| reward.reward_key.as_str().to_string())
                .collect(),
            can_submit: !submitted && !at_capacity,
            can_withdraw: submitted,
        });
    }
    Ok(PlayerDayEventWorkspace { attention, rooms })
}

fn day_event_room_delta(
    event: &projections::DayEventRow,
    private_members: &[projections::PrivateChannelMemberRow],
) -> Option<DayEventRoomDelta> {
    let membership = event.definition.channel_policy.membership()?;
    let channel_id = event
        .definition
        .channel_policy
        .channel_id(&event.definition.id)
        .to_string();
    Some(DayEventRoomDelta {
        event_id: event.event_id.clone(),
        channel_id: channel_id.clone(),
        template_key: event.definition.template_key.as_str().to_string(),
        state: event.state.clone(),
        membership,
        member_count: private_members
            .iter()
            .filter(|member| member.channel_id == channel_id)
            .count() as u32,
        posting_allowed: event.state == "open",
    })
}

/// Self-scoped role identity for the requesting SlotOccupant. The caller has
/// already authenticated the game-owned pack; an unknown role key degrades to
/// `None` rather than exposing any other slot's role state.
fn player_role_view(pack: &domain::Pack, role_key: &str) -> Option<PlayerCommandRoleView> {
    let role = pack.roles.get(role_key)?;
    Some(PlayerCommandRoleView {
        key: role_key.to_string(),
        alignment: role.alignment.clone(),
        description: role.description.clone(),
    })
}

fn available_vote_targets(
    pack: &domain::Pack,
    slots: &[projections::SlotStateRow],
    actor: &projections::SlotStateRow,
) -> Vec<PlayerVoteTarget> {
    let mut targets: Vec<PlayerVoteTarget> = slots
        .iter()
        .filter(|slot| slot.alive)
        .filter(|slot| pack.vote.self_vote_allowed || slot.slot_id != actor.slot_id)
        .map(|slot| PlayerVoteTarget {
            kind: "slot".to_string(),
            slot_id: Some(slot.slot_id.clone()),
            label: slot_label(&slot.slot_id),
        })
        .collect();
    targets.sort_by(|a, b| {
        slot_sort_key(a.slot_id.as_deref().unwrap_or_default())
            .cmp(&slot_sort_key(b.slot_id.as_deref().unwrap_or_default()))
    });
    if pack.vote.no_lynch_allowed {
        targets.push(PlayerVoteTarget {
            kind: "no_lynch".to_string(),
            slot_id: None,
            label: "No lynch".to_string(),
        });
    }
    targets
}

async fn current_player_vote(
    state: &GameHttpState,
    game: Uuid,
    phase_id: &domain::phase::PhaseId,
    actor_slot: &str,
) -> Result<Option<PlayerVoteTarget>, ApiError> {
    let ballot = projections::current_ballot(&state.pool, game, phase_id, actor_slot).await?;
    Ok(ballot.map(|row| player_vote_target_from_projection_target(&row.target)))
}

fn player_vote_target_from_projection_target(target: &str) -> PlayerVoteTarget {
    if target == "no_lynch" {
        PlayerVoteTarget {
            kind: "no_lynch".to_string(),
            slot_id: None,
            label: "No lynch".to_string(),
        }
    } else {
        PlayerVoteTarget {
            kind: "slot".to_string(),
            slot_id: Some(target.to_string()),
            label: slot_label(target),
        }
    }
}

fn available_role_actions(
    pack: &domain::Pack,
    phase: &projections::PhaseStateRow,
    slots: &[projections::SlotStateRow],
    actor: &projections::SlotStateRow,
    role_key: &str,
    active_templates: &std::collections::BTreeSet<String>,
) -> Result<Vec<PlayerCommandAction>, ApiError> {
    let role = pack.roles.get(role_key).ok_or_else(|| ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message: format!("role `{role_key}` is missing from game pack {}", pack.name),
    })?;
    let phase_kind = phase.phase_id.kind();

    Ok(role
        .actions
        .iter()
        .filter(|action| action.window.matches_phase_kind(phase_kind))
        .filter(|action| {
            action.has_modifier(domain::Modifier::Simultaneous)
                || !active_templates.contains(&action.id)
        })
        .filter_map(|action| {
            let target_options = target_options_for_action(action, slots, actor);
            let targets = default_targets_for_action(action, &target_options)?;
            Some(PlayerCommandAction {
                source: "role".to_string(),
                template_id: action.id.clone(),
                ability: format!("{:?}", action.ability),
                window: format!("{:?}", action.window),
                label: action_label(action),
                detail: action_detail(action, &targets),
                targets,
                target_options,
                grant_id: None,
            })
        })
        .collect())
}

/// Canonical candidate ordering: sort by the trailing slot ordinal (so `slot_10`
/// sorts after `slot_2`), separator-agnostic, with the raw id as a stable
/// tiebreak. `slot_state` returns rows `ORDER BY slot_id`, which is
/// Postgres-collation dependent for raw TEXT ids; sorting candidates here makes
/// the default target (`target_options.first()` and the first vote candidate)
/// deterministic across environments regardless of hyphen/underscore separators.
fn slot_sort_key(slot_id: &str) -> (u64, &str) {
    let ordinal = slot_id
        .rsplit(['-', '_'])
        .next()
        .and_then(|tail| tail.parse::<u64>().ok())
        .unwrap_or(u64::MAX);
    (ordinal, slot_id)
}

fn target_options_for_action(
    action: &domain::pack::ActionTemplate,
    slots: &[projections::SlotStateRow],
    actor: &projections::SlotStateRow,
) -> Vec<String> {
    if action.targets == domain::pack::TargetSpec::None {
        return Vec::new();
    }
    let target_state = action
        .constraints
        .target_state
        .unwrap_or(domain::pack::TargetState::Alive);
    let mut options: Vec<String> = slots
        .iter()
        .filter(|slot| {
            if !action.constraints.self_allowed && slot.slot_id == actor.slot_id {
                return false;
            }
            match target_state {
                domain::pack::TargetState::Any => true,
                domain::pack::TargetState::Alive => slot.alive,
                domain::pack::TargetState::Dead => !slot.alive,
            }
        })
        .map(|slot| slot.slot_id.clone())
        .collect();
    options.sort_by(|a, b| slot_sort_key(a).cmp(&slot_sort_key(b)));
    options
}

fn default_targets_for_action(
    action: &domain::pack::ActionTemplate,
    target_options: &[String],
) -> Option<Vec<String>> {
    match action.targets {
        domain::pack::TargetSpec::None => Some(Vec::new()),
        domain::pack::TargetSpec::One => target_options.first().cloned().map(|target| vec![target]),
        domain::pack::TargetSpec::Many | domain::pack::TargetSpec::Group => {
            if target_options.is_empty() {
                None
            } else {
                Some(
                    target_options
                        .iter()
                        .take(action.constraints.max_targets as usize)
                        .cloned()
                        .collect(),
                )
            }
        }
    }
}

fn action_label(action: &domain::pack::ActionTemplate) -> String {
    let action_name = action.id.replace('_', " ");
    match action.ability {
        domain::IrAbility::Kill => format!("Submit {action_name}"),
        domain::IrAbility::Protect => format!("Submit {action_name}"),
        domain::IrAbility::Investigate => format!("Submit {action_name}"),
        _ => format!("Submit {action_name}"),
    }
}

fn slot_label(slot_id: &str) -> String {
    let suffix: String = slot_id.chars().filter(|ch| ch.is_ascii_digit()).collect();
    if suffix.is_empty() {
        slot_id.to_string()
    } else {
        format!("Slot {suffix}")
    }
}

fn action_detail(action: &domain::pack::ActionTemplate, targets: &[String]) -> String {
    if targets.is_empty() {
        action.id.clone()
    } else {
        format!("{} -> {}", action.id, targets.join(", "))
    }
}

fn player_phase_state(
    phase: &projections::PhaseStateRow,
) -> Result<PlayerCommandPhaseState, ApiError> {
    Ok(PlayerCommandPhaseState {
        phase_id: phase.phase_id.clone(),
        locked: phase.locked,
        deadline: phase.deadline,
    })
}

#[cfg(test)]
fn phase_id_for_api(phase_id: &str) -> Result<domain::phase::PhaseId, ApiError> {
    domain::phase::PhaseId::parse(phase_id).map_err(|_| ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message: format!("invalid phase id `{phase_id}`"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase_id_for_api_accepts_only_canonical_revote_ids() {
        assert_eq!(phase_id_for_api("D03").unwrap().number(), 3);
        assert_eq!(phase_id_for_api("D03R1").unwrap().number(), 3);
        assert_eq!(phase_id_for_api("N12R2").unwrap().number(), 12);
        for invalid in ["D00", "D3", "D003", "D01junk", "D01R0", "D01R02"] {
            assert!(
                phase_id_for_api(invalid).is_err(),
                "{invalid} must be rejected"
            );
        }
    }

    #[test]
    fn slot_sort_key_orders_candidates_by_numeric_ordinal() {
        let mut slots = vec!["slot_10", "slot-2", "slot_1", "slot-3"];
        slots.sort_by(|a, b| slot_sort_key(a).cmp(&slot_sort_key(b)));
        // Numeric, not lexical (lexical would sort "slot_10" before "slot-2"), and
        // separator-agnostic so mixed hyphen/underscore ids interleave by ordinal.
        assert_eq!(slots, ["slot_1", "slot-2", "slot-3", "slot_10"]);
    }

    #[test]
    fn host_console_authority_exposes_effective_cohost_policy() {
        let authority = build_host_console_authority(
            PrincipalId::fixture("cohost_c"),
            false,
            BTreeSet::from([
                commands::CohostPermissionClass::Lifecycle,
                commands::CohostPermissionClass::PhaseResolve,
            ]),
        );

        assert_eq!(authority.capability, HostConsoleAuthorityKind::CohostOf);
        assert_eq!(
            authority.denied_classes,
            [
                wire::CohostPermissionClass::PhaseResolve,
                wire::CohostPermissionClass::Lifecycle,
            ]
        );
        assert!(!authority
            .allowed_classes
            .contains(&wire::CohostPermissionClass::PhaseResolve));
        assert!(authority
            .allowed_classes
            .contains(&wire::CohostPermissionClass::Deadline));

        let host =
            build_host_console_authority(PrincipalId::fixture("host_h"), true, BTreeSet::new());
        assert_eq!(host.capability, HostConsoleAuthorityKind::HostOf);
        assert_eq!(host.allowed_classes.len(), 12);
        assert!(host.denied_classes.is_empty());

        let operator = build_host_console_operator_authority(PrincipalId::fixture("operator_o"));
        assert_eq!(
            operator.capability,
            HostConsoleAuthorityKind::GlobalOperator
        );
        assert!(operator.allowed_classes.is_empty());
    }

    #[test]
    fn host_task_selector_uses_stable_instance_ids_and_effective_permissions() {
        let prompts = vec![
            host_prompt_row("prompt:one", "pending"),
            host_prompt_row("prompt:resolved", "resolved"),
        ];
        let host =
            build_host_console_authority(PrincipalId::fixture("host_h"), true, BTreeSet::new());
        let tasks =
            select_host_tasks(&prompts, &[], &host).expect("canonical host prompt task phase id");

        assert_eq!(tasks.len(), 1, "resolved facts are history, not tasks");
        assert_eq!(tasks[0].id, "engine-host-prompt:prompt:one");
        assert_eq!(tasks[0].kind, HostTaskKind::EngineHostPrompt);
        assert_eq!(tasks[0].source_id, "prompt:one");
        assert_eq!(tasks[0].state, HostTaskState::Ready);
        assert_eq!(
            tasks[0].allowed_commands,
            [HostTaskAllowedCommand {
                kind: HostTaskCommandKind::ResolveHostPrompt,
                permission_class: wire::CohostPermissionClass::HostPromptResolve,
            }]
        );
        assert_eq!(tasks[0].blocked_reason, None);

        let denied_cohost = build_host_console_authority(
            PrincipalId::fixture("cohost_c"),
            false,
            BTreeSet::from([commands::CohostPermissionClass::HostPromptResolve]),
        );
        let tasks = select_host_tasks(&prompts, &[], &denied_cohost)
            .expect("canonical host prompt task phase id");
        assert_eq!(tasks[0].id, "engine-host-prompt:prompt:one");
        assert_eq!(tasks[0].state, HostTaskState::Blocked);
        assert!(tasks[0].allowed_commands.is_empty());
        assert_eq!(
            tasks[0].blocked_reason.as_deref(),
            Some("cohost policy denies host_prompt_resolve")
        );
    }

    #[test]
    fn locked_day_event_selects_a_permission_aware_host_task() {
        let event = day_event_row("locked");
        let host =
            build_host_console_authority(PrincipalId::fixture("host_h"), true, BTreeSet::new());
        let tasks = select_host_tasks(&[], std::slice::from_ref(&event), &host)
            .expect("canonical day event task phase id");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "day-event-resolve:event-cookie");
        assert_eq!(tasks[0].kind, HostTaskKind::DayEventResolve);
        assert_eq!(tasks[0].source_id, "event-cookie");
        assert_eq!(
            tasks[0].allowed_commands,
            [HostTaskAllowedCommand {
                kind: HostTaskCommandKind::ResolveDayEvent,
                permission_class: wire::CohostPermissionClass::DayEventResolve,
            }]
        );

        let denied = build_host_console_authority(
            PrincipalId::fixture("cohost_c"),
            false,
            BTreeSet::from([commands::CohostPermissionClass::DayEventResolve]),
        );
        let tasks = select_host_tasks(&[], std::slice::from_ref(&event), &denied)
            .expect("canonical day event task phase id");
        assert_eq!(tasks[0].state, HostTaskState::Blocked);
        assert!(tasks[0].allowed_commands.is_empty());
        assert_eq!(
            tasks[0].blocked_reason.as_deref(),
            Some("cohost policy denies day_event_resolve")
        );

        let resolved = day_event_row("resolved");
        assert!(select_host_tasks(&[], &[resolved], &host)
            .expect("canonical resolved day event task phase id")
            .is_empty());
    }

    fn host_prompt_row(prompt_id: &str, status: &str) -> projections::HostPromptRow {
        projections::HostPromptRow {
            game_id: Uuid::nil(),
            phase_id: domain::phase::PhaseId::parse("D01").expect("canonical fixture phase id"),
            event_index: 0,
            prompt_id: prompt_id.to_string(),
            kind: "skip_next_day".to_string(),
            subject_slot: Some("slot_1".to_string()),
            reason: "beloved_princess_death".to_string(),
            phase_kind: "Day".to_string(),
            phase_number: 1,
            metadata: serde_json::json!({}),
            status: status.to_string(),
            decision: None,
            public_resolution: None,
            resolved_at: None,
        }
    }

    fn day_event_row(state: &str) -> projections::DayEventRow {
        projections::DayEventRow {
            game_id: Uuid::nil(),
            event_id: "event-cookie".to_string(),
            definition: serde_json::from_value(serde_json::json!({
                "id": "event-cookie",
                "program_id": "program-bakery",
                "template_key": "theme.raffle",
                "phase_scope": { "kind": "during_day", "number": 1 },
                "schedule": { "kind": "host_opened" },
                "participation": {
                    "who": "alive_slots",
                    "mode": "opt_in",
                    "limits": { "minimum": 1, "maximum": null }
                },
                "state": "scheduled",
                "resolution": "host_decision",
                "rewards": [{
                    "reward_key": "cookie",
                    "display_name_theme_key": "theme.cookie",
                    "effects": [{
                        "recipient": { "kind": "winner" },
                        "operation": { "kind": "mark", "effect": "marked" }
                    }]
                }],
                "narrative": {
                    "opened": null,
                    "locked": null,
                    "resolved": null,
                    "cancelled": null
                },
                "channel_policy": { "visibility": "public_main" }
            }))
            .unwrap(),
            state: state.to_string(),
            phase_id: Some(
                domain::phase::PhaseId::parse("D01").expect("canonical fixture phase id"),
            ),
            opened_at: Some(1),
            locked_at: Some(2),
            open_due_at: None,
            open_observed_at: None,
            lock_due_at: None,
            lock_observed_at: None,
            auto_seed: None,
            cancelled_reason: None,
            decision: None,
            resolution_evidence: None,
            winner_slots: Vec::new(),
            reward_keys_applied: Vec::new(),
            scheduled_seq: 1,
            updated_seq: 2,
        }
    }
}

async fn load_pack_for_game(
    state: &GameHttpState,
    game: Uuid,
) -> Result<Arc<domain::ValidatedPack>, ApiError> {
    let artifact = pack_artifact_for_game(state, game).await?;
    resolve_pack_artifact(&artifact)
}

fn resolve_pack_artifact(
    artifact: &content_registry::PackArtifactSnapshot,
) -> Result<Arc<domain::ValidatedPack>, ApiError> {
    content_registry::verify_pack_artifact(artifact).map_err(|err| ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message: format!(
            "resolve game-owned pack {}@{}#{}: {err}",
            artifact.pack_ref.key, artifact.pack_ref.version, artifact.pack_ref.content_hash
        ),
    })
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostPrompt {
    pub game: Uuid,
    pub phase_id: domain::phase::PhaseId,
    pub event_index: i32,
    pub prompt_id: String,
    pub kind: String,
    pub subject_slot: Option<String>,
    pub reason: String,
    pub metadata: HostPromptMetadata,
    pub status: String,
    pub decision: Option<HostPromptRecordedDecision>,
    pub public_resolution: Option<HostPromptPublicResolution>,
    pub resolved_at: Option<i64>,
}

impl TryFrom<projections::HostPromptRow> for HostPrompt {
    type Error = wire::ProjectionAdapterError;

    fn try_from(row: projections::HostPromptRow) -> Result<Self, Self::Error> {
        let delta = HostPromptDelta::try_from(row)?;
        Ok(HostPrompt {
            game: delta.game,
            phase_id: delta.phase_id,
            event_index: delta.event_index,
            prompt_id: delta.prompt_id,
            kind: delta.kind,
            subject_slot: delta.subject_slot,
            reason: delta.reason,
            metadata: delta.metadata,
            status: delta.status,
            decision: delta.decision,
            public_resolution: delta.public_resolution,
            resolved_at: delta.resolved_at,
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
struct HostConsoleStateQuery {
    #[serde(default)]
    slot_id: Option<String>,
    #[serde(default)]
    limit: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostConsoleStateResponse {
    pub game: Uuid,
    pub authority: HostConsoleAuthorityDelta,
    pub completed: bool,
    pub phase: Option<HostConsolePhaseState>,
    pub slots: Vec<HostConsoleSlotOccupancy>,
    pub thread_posts: Vec<HostConsoleThreadPost>,
    pub day_event_scheduler: Option<DayEventSchedulerDelta>,
    pub day_events: Vec<HostDayEventDelta>,
    pub tasks: Vec<HostTaskDelta>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostConsolePhaseState {
    pub phase_id: domain::phase::PhaseId,
    pub locked: bool,
    pub deadline: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostConsoleSlotOccupancy {
    pub slot_id: String,
    pub occupancy_id: String,
    pub persona_id: String,
    pub public_name: String,
    /// Host-only operational binding. Public game/read-model responses expose
    /// the persona fields above, never this principal.
    pub assigned_principal_id: PrincipalId,
    pub alive: bool,
    pub status: String,
    pub status_tags: Vec<String>,
    pub role_key: Option<String>,
    pub alignment: Option<String>,
    pub role_revealed: bool,
    pub alignment_revealed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostConsoleThreadPost {
    pub stream_seq: i64,
    pub author: GameThreadAuthor,
    pub phase_id: Option<domain::phase::PhaseId>,
    pub body: String,
    #[serde(default)]
    pub quotations: Vec<Quotation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostSetupStateResponse {
    pub game: Uuid,
    pub created: bool,
    pub pack: HostSetupPackState,
    pub program_catalog: Vec<HostSetupProgramOption>,
    pub attached_programs: Vec<HostSetupAttachedProgram>,
    pub phase: Option<HostConsolePhaseState>,
    pub slots: Vec<HostSetupSlotState>,
    pub post_policies: Vec<HostSetupPostPolicyState>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostSetupProgramOption {
    pub program_ref: game_platform::DayProgramRef,
    pub display_name: String,
    pub theme_ref: Option<String>,
    pub event_count: usize,
    pub compatibility: HostSetupProgramCompatibility,
    pub schedule_previews: Vec<HostSetupProgramSchedulePreview>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostSetupProgramCompatibility {
    pub attachable: bool,
    pub issues: Vec<HostSetupProgramCompatibilityIssue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostSetupProgramCompatibilityIssue {
    pub code: String,
    pub event_id: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostSetupProgramSchedulePreview {
    pub event_id: String,
    pub template_key: String,
    pub participant_filter: String,
    pub participation_mode: String,
    pub resolution_mode: String,
    pub channel_policy: game_platform::EventChannelPolicy,
    pub reward_keys: Vec<String>,
    pub mode: String,
    pub phase_id: Option<domain::phase::PhaseId>,
    pub open_at: Option<i64>,
    pub open_offset: Option<i64>,
    pub lock_at: Option<i64>,
    pub lock_offset: Option<i64>,
    pub trigger: Option<game_platform::ProgramTrigger>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostSetupAttachedProgram {
    pub program_id: String,
    pub version: i64,
    pub display_name: String,
    pub theme_ref: Option<String>,
    pub content_hash: String,
    pub event_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostSetupPackState {
    pub key: String,
    pub name: String,
    pub valid: bool,
    pub role_keys: Vec<String>,
    pub roles: Vec<HostSetupRoleOption>,
    pub start_phase_options: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostSetupRoleOption {
    pub key: String,
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostSetupSlotState {
    pub slot_id: String,
    pub persona_id: Option<String>,
    pub public_name: Option<String>,
    pub assigned_principal_id: Option<PrincipalId>,
    pub alive: bool,
    pub status: String,
    pub status_tags: Vec<String>,
    pub role_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostSetupPostPolicyState {
    pub channel_id: String,
    pub allow_media_only: bool,
}

impl From<HostConsoleStateResponse> for HostConsoleStateDelta {
    fn from(response: HostConsoleStateResponse) -> Self {
        HostConsoleStateDelta {
            game: response.game,
            authority: response.authority,
            completed: response.completed,
            phase: response.phase.map(HostConsolePhaseStateDelta::from),
            slots: response
                .slots
                .into_iter()
                .map(HostConsoleSlotOccupancyDelta::from)
                .collect(),
            thread_posts: response
                .thread_posts
                .into_iter()
                .map(HostConsoleThreadPostDelta::from)
                .collect(),
            day_event_scheduler: response.day_event_scheduler,
            day_events: response.day_events,
            tasks: response.tasks,
        }
    }
}

impl From<HostConsolePhaseState> for HostConsolePhaseStateDelta {
    fn from(phase: HostConsolePhaseState) -> Self {
        HostConsolePhaseStateDelta {
            phase_id: phase.phase_id,
            locked: phase.locked,
            deadline: phase.deadline,
        }
    }
}

impl From<HostConsoleSlotOccupancy> for HostConsoleSlotOccupancyDelta {
    fn from(slot: HostConsoleSlotOccupancy) -> Self {
        HostConsoleSlotOccupancyDelta {
            slot_id: slot.slot_id,
            occupancy_id: slot.occupancy_id,
            persona_id: slot.persona_id,
            public_name: slot.public_name,
            assigned_principal_id: slot.assigned_principal_id,
            alive: slot.alive,
            status: slot.status,
            status_tags: slot.status_tags,
            role_key: slot.role_key,
            alignment: slot.alignment,
            role_revealed: slot.role_revealed,
            alignment_revealed: slot.alignment_revealed,
        }
    }
}

impl From<HostConsoleThreadPost> for HostConsoleThreadPostDelta {
    fn from(post: HostConsoleThreadPost) -> Self {
        HostConsoleThreadPostDelta {
            stream_seq: post.stream_seq,
            author: post.author,
            phase_id: post.phase_id,
            body: post.body,
            quotations: post.quotations,
        }
    }
}

async fn host_phase_controls(
    State(state): State<GameHttpState>,
    Path(game): Path<Uuid>,
    authorization: GameAuthorization,
) -> Result<Json<Vec<HostPhaseControl>>, ApiError> {
    require_host_audit_access(
        &state.pool,
        game,
        &authorization,
        "principal cannot read host phase-control audit for this game",
    )
    .await?;

    Ok(Json(
        projections::host_phase_controls(&state.pool, game)
            .await?
            .into_iter()
            .map(HostPhaseControl::from)
            .collect(),
    ))
}

async fn host_prompts(
    State(state): State<GameHttpState>,
    Path(game): Path<Uuid>,
    authorization: GameAuthorization,
) -> Result<Json<Vec<HostPrompt>>, ApiError> {
    require_host_audit_access(
        &state.pool,
        game,
        &authorization,
        "principal cannot read host prompts for this game",
    )
    .await?;

    Ok(Json(
        projections::host_prompts(&state.pool, game)
            .await?
            .into_iter()
            .map(HostPrompt::try_from)
            .collect::<Result<Vec<_>, _>>()?,
    ))
}

async fn host_console_state(
    State(state): State<GameHttpState>,
    Path(game): Path<Uuid>,
    Query(query): Query<HostConsoleStateQuery>,
    authorization: GameAuthorization,
) -> Result<Json<HostConsoleStateResponse>, ApiError> {
    let authority = resolve_host_console_authority(&state.pool, game, &authorization)
        .await?
        .ok_or_else(|| ApiError::Reject {
            status: StatusCode::FORBIDDEN,
            error: RejectCode::NotAuthorized,
            message: "principal cannot read host console state for this game".to_string(),
        })?;

    Ok(Json(
        load_host_console_state(
            &state.pool,
            game,
            authority,
            query.slot_id.as_deref(),
            query.limit,
        )
        .await?,
    ))
}

/// Reusable authority-checked host-console read for local proof and non-HTTP
/// adapters. It preserves the same capability resolution and response assembly
/// as the network handler.
pub async fn load_host_console_state_for_principal(
    pool: &PgPool,
    game: Uuid,
    principal_id: PrincipalId,
    limit: Option<i64>,
) -> Result<HostConsoleStateResponse, ApiError> {
    let authorization = GameAuthorization::fixture_principal(principal_id);
    let authority = resolve_host_console_authority(pool, game, &authorization)
        .await?
        .ok_or_else(|| ApiError::Reject {
            status: StatusCode::FORBIDDEN,
            error: RejectCode::NotAuthorized,
            message: "principal cannot read host console state for this game".to_string(),
        })?;
    load_host_console_state(pool, game, authority, None, limit).await
}

async fn host_setup_state(
    State(state): State<GameHttpState>,
    Path(game): Path<Uuid>,
    authorization: GameAuthorization,
) -> Result<Json<HostSetupStateResponse>, ApiError> {
    require_host_audit_access(
        &state.pool,
        game,
        &authorization,
        "principal cannot read host setup state for this game",
    )
    .await?;

    Ok(Json(load_host_setup_state(&state, game).await?))
}

pub(super) async fn load_host_console_state(
    pool: &PgPool,
    game: Uuid,
    authority: HostConsoleAuthorityDelta,
    slot_id: Option<&str>,
    limit: Option<i64>,
) -> Result<HostConsoleStateResponse, ApiError> {
    let completed = commands::game_completed(pool, game)
        .await
        .map_err(command_reject_api_error)?;
    let phase = projections::phase_state(pool, game)
        .await?
        .map(|row| HostConsolePhaseState {
            phase_id: row.phase_id,
            locked: row.locked,
            deadline: row.deadline,
        });

    let slot_states = projections::slot_state(pool, game).await?;
    let assigned_principals = projections::slot_occupants(pool, game).await?;
    let mut slots = Vec::new();
    for row in projections::slot_occupancy(pool, game).await? {
        if slot_id.is_some_and(|slot_id| row.slot_id != slot_id) {
            continue;
        }
        let slot_state = slot_states
            .iter()
            .find(|state| state.slot_id == row.slot_id);
        let assigned_principal_id =
            assigned_principals
                .get(&row.slot_id)
                .copied()
                .ok_or_else(|| ApiError::Reject {
                    status: StatusCode::INTERNAL_SERVER_ERROR,
                    error: RejectCode::Internal,
                    message: format!(
                        "open slot occupancy `{}` has no active principal binding",
                        row.slot_id
                    ),
                })?;
        slots.push(HostConsoleSlotOccupancy {
            slot_id: row.slot_id,
            occupancy_id: row.occupancy_id,
            persona_id: row.persona_id,
            public_name: row.public_name,
            assigned_principal_id,
            alive: slot_state.map(|state| state.alive).unwrap_or(true),
            status: slot_state
                .map(|state| state.status.clone())
                .unwrap_or_else(|| "alive".to_string()),
            status_tags: slot_state
                .map(|state| state.status_tags.clone())
                .unwrap_or_default(),
            role_key: slot_state.and_then(|state| state.role_key.clone()),
            alignment: slot_state.and_then(|state| state.alignment.clone()),
            role_revealed: slot_state.map(|state| state.role_revealed).unwrap_or(false),
            alignment_revealed: slot_state
                .map(|state| state.alignment_revealed)
                .unwrap_or(false),
        });
    }

    // The host console is operational authority, not a moderation bypass.
    // Globally hidden public posts must disappear from every presentation of
    // the main thread, including host/global-operator HTTP and live snapshots.
    let thread_posts = projections::public_thread_view(pool, game, None, limit.unwrap_or(25))
        .await?
        .posts
        .into_iter()
        .filter(|post| {
            slot_id.is_none_or(|slot_id| {
                matches!(
                    &post.author,
                    projections::GameThreadAuthor::Slot {
                        slot_id: author_slot_id
                    } if author_slot_id == slot_id
                )
            })
        })
        .map(|post| HostConsoleThreadPost {
            stream_seq: post.stream_seq,
            author: post.author.into(),
            phase_id: post.phase_id,
            body: post.body,
            quotations: post.quotations.into_iter().map(Quotation::from).collect(),
        })
        .collect();
    let host_prompts = projections::host_prompts(pool, game).await?;
    let day_event_rows = projections::day_events(pool, game).await?;
    let day_event_scheduler =
        commands::day_scheduler::day_event_scheduler_status(pool, game, unix_now_seconds())
            .await
            .map_err(|error| ApiError::Reject {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                error: RejectCode::Internal,
                message: error.to_string(),
            })?
            .map(|status| DayEventSchedulerDelta {
                pending: status.pending,
                next_due_at: status.next_due_at,
                auto_resolve_pending: status.auto_resolve_pending,
                narrative_pending: status.narrative_pending,
                wake_seq: status.wake_seq,
                last_observed_wake_seq: status.last_observed_wake_seq,
                lease_until: status.lease_until,
                retry_not_before: status.retry_not_before,
                last_attempt_at: status.last_attempt_at,
                last_success_at: status.last_success_at,
                last_failure_at: status.last_failure_at,
                consecutive_failures: status.consecutive_failures,
                total_attempts: status.total_attempts,
                total_successes: status.total_successes,
                last_error: status.last_error,
            });
    let day_event_participation = projections::day_event_participation_for_game(pool, game).await?;
    let day_event_narratives = projections::day_event_narratives(pool, game).await?;
    let private_channel_members = projections::private_channel_members(pool, game).await?;
    let tasks = select_host_tasks(&host_prompts, &day_event_rows, &authority)?;
    let day_events = day_event_rows
        .iter()
        .map(|event| HostDayEventDelta {
            event_id: event.event_id.clone(),
            state: event.state.clone(),
            phase_id: event.phase_id.clone(),
            definition: event.definition.clone(),
            room: day_event_room_delta(event, &private_channel_members),
            participant_slots: day_event_participation
                .iter()
                .filter(|row| row.event_id == event.event_id)
                .map(|row| row.actor_slot.clone())
                .collect(),
            open_due_at: event.open_due_at,
            open_observed_at: event.open_observed_at,
            lock_due_at: event.lock_due_at,
            lock_observed_at: event.lock_observed_at,
            auto_seed: event.auto_seed,
            resolution_evidence: event.resolution_evidence.clone(),
            winner_slots: event.winner_slots.clone(),
            reward_keys_applied: event.reward_keys_applied.clone(),
            narratives: day_event_narratives
                .iter()
                .filter(|row| row.event_id == event.event_id)
                .map(|row| DayEventNarrativeDelta {
                    lifecycle: row.lifecycle,
                    template_key: row.template_key.clone(),
                    template_hash: row.template_hash.as_str().to_string(),
                    channel_id: row.channel_id.clone(),
                    status: row.status.clone(),
                    body: row.rendered_body.clone(),
                    source_seq: row.source_seq,
                    published_seq: row.published_seq,
                })
                .collect(),
        })
        .collect();

    Ok(HostConsoleStateResponse {
        game,
        authority,
        completed,
        phase,
        slots,
        thread_posts,
        day_event_scheduler,
        day_events,
        tasks,
    })
}

/// HostTasks are permission-aware selectors over authoritative projections,
/// never a second mutable rules model. Resolved prompts disappear because their
/// durable completion remains available in `host_prompt` history.
fn select_host_tasks(
    prompts: &[projections::HostPromptRow],
    day_events: &[projections::DayEventRow],
    authority: &HostConsoleAuthorityDelta,
) -> Result<Vec<HostTaskDelta>, ApiError> {
    let can_resolve_prompt = authority
        .allowed_classes
        .contains(&wire::CohostPermissionClass::HostPromptResolve);
    let mut tasks: Vec<_> = prompts
        .iter()
        .filter(|prompt| prompt.status == "pending")
        .map(|prompt| -> Result<_, ApiError> {
            let (state, allowed_commands, blocked_reason) = if can_resolve_prompt {
                (
                    HostTaskState::Ready,
                    vec![HostTaskAllowedCommand {
                        kind: HostTaskCommandKind::ResolveHostPrompt,
                        permission_class: wire::CohostPermissionClass::HostPromptResolve,
                    }],
                    None,
                )
            } else {
                (
                    HostTaskState::Blocked,
                    Vec::new(),
                    Some(match authority.capability {
                        HostConsoleAuthorityKind::CohostOf => {
                            "cohost policy denies host_prompt_resolve".to_string()
                        }
                        HostConsoleAuthorityKind::GlobalOperator => {
                            "global operators have read-only host console access".to_string()
                        }
                        HostConsoleAuthorityKind::HostOf => {
                            "host prompt resolution is unavailable".to_string()
                        }
                    }),
                )
            };
            Ok(HostTaskDelta {
                id: format!("engine-host-prompt:{}", prompt.prompt_id),
                kind: HostTaskKind::EngineHostPrompt,
                state,
                urgency: HostTaskUrgency::Attention,
                intent: prompt.reason.clone(),
                consequence: format!("resolve pack-defined {} policy", prompt.kind),
                phase_id: Some(prompt.phase_id.clone()),
                subject_slot: prompt.subject_slot.clone(),
                source_id: prompt.prompt_id.clone(),
                allowed_commands,
                blocked_reason,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let can_resolve_day_event = authority
        .allowed_classes
        .contains(&wire::CohostPermissionClass::DayEventResolve);
    for event in day_events.iter().filter(|event| {
        event.state == "locked"
            && event.definition.resolution == game_platform::DayEventResolutionMode::HostDecision
    }) {
        let (state, allowed_commands, blocked_reason) = if can_resolve_day_event {
            (
                HostTaskState::Ready,
                vec![HostTaskAllowedCommand {
                    kind: HostTaskCommandKind::ResolveDayEvent,
                    permission_class: wire::CohostPermissionClass::DayEventResolve,
                }],
                None,
            )
        } else {
            (
                HostTaskState::Blocked,
                Vec::new(),
                Some(match authority.capability {
                    HostConsoleAuthorityKind::CohostOf => {
                        "cohost policy denies day_event_resolve".to_string()
                    }
                    HostConsoleAuthorityKind::GlobalOperator => {
                        "global operators have read-only host console access".to_string()
                    }
                    HostConsoleAuthorityKind::HostOf => {
                        "DayEvent resolution is unavailable".to_string()
                    }
                }),
            )
        };
        tasks.push(HostTaskDelta {
            id: format!("day-event-resolve:{}", event.event_id),
            kind: HostTaskKind::DayEventResolve,
            state,
            urgency: HostTaskUrgency::Attention,
            intent: format!("Resolve {}", event.definition.template_key.as_str()),
            consequence: format!(
                "apply {} reward binding{} atomically",
                event.definition.rewards.len(),
                if event.definition.rewards.len() == 1 {
                    ""
                } else {
                    "s"
                }
            ),
            phase_id: event.phase_id.clone(),
            subject_slot: None,
            source_id: event.event_id.clone(),
            allowed_commands,
            blocked_reason,
        });
    }
    Ok(tasks)
}

pub(super) async fn resolve_host_console_authority(
    pool: &PgPool,
    game: Uuid,
    authorization: &GameAuthorization,
) -> Result<Option<HostConsoleAuthorityDelta>, ApiError> {
    let principal_id = authorization.principal_id();
    let capabilities = caps::resolve(pool, &Principal::authenticated(principal_id), game).await?;
    let is_host = capabilities
        .iter()
        .any(|cap| cap == &Capability::HostOf(game));
    let is_cohost = capabilities
        .iter()
        .any(|cap| cap == &Capability::CohostOf(game));
    if !is_host && !is_cohost {
        return if authorization.is_global_operator() {
            Ok(Some(build_host_console_operator_authority(principal_id)))
        } else {
            Ok(None)
        };
    }
    let denied = if is_host {
        BTreeSet::new()
    } else {
        projections::cohost_denied_classes(pool, game)
            .await?
            .into_iter()
            .filter_map(|class| commands::CohostPermissionClass::parse(&class))
            .collect()
    };
    Ok(Some(build_host_console_authority(
        principal_id,
        is_host,
        denied,
    )))
}

fn build_host_console_authority(
    principal_id: PrincipalId,
    is_host: bool,
    denied: BTreeSet<commands::CohostPermissionClass>,
) -> HostConsoleAuthorityDelta {
    let allowed_classes = commands::CohostPermissionClass::ALL
        .into_iter()
        .filter(|class| !denied.contains(class))
        .map(wire::CohostPermissionClass::from)
        .collect();
    let denied_classes = denied
        .into_iter()
        .map(wire::CohostPermissionClass::from)
        .collect();

    HostConsoleAuthorityDelta {
        principal_id,
        capability: if is_host {
            HostConsoleAuthorityKind::HostOf
        } else {
            HostConsoleAuthorityKind::CohostOf
        },
        allowed_classes,
        denied_classes,
    }
}

fn build_host_console_operator_authority(principal_id: PrincipalId) -> HostConsoleAuthorityDelta {
    HostConsoleAuthorityDelta {
        principal_id,
        capability: HostConsoleAuthorityKind::GlobalOperator,
        allowed_classes: Vec::new(),
        denied_classes: Vec::new(),
    }
}

async fn load_host_setup_state(
    state: &GameHttpState,
    game: Uuid,
) -> Result<HostSetupStateResponse, ApiError> {
    let pack_artifact = pack_artifact_for_game(state, game).await?;
    let pack_ref = pack_artifact.pack_ref.clone();
    let pack = resolve_pack_artifact(&pack_artifact)?;
    let program_catalog = product_day_program_catalog(pack.document())?;
    let attached_programs = projections::day_programs(&state.pool, game)
        .await?
        .into_iter()
        .map(|row| HostSetupAttachedProgram {
            program_id: row.program_id,
            version: row.version,
            display_name: row.display_name,
            theme_ref: row.theme_ref,
            content_hash: row.content_hash,
            event_count: row.document.events.len(),
        })
        .collect();
    let phase = projections::phase_state(&state.pool, game)
        .await?
        .map(|row| HostConsolePhaseState {
            phase_id: row.phase_id,
            locked: row.locked,
            deadline: row.deadline,
        });
    let slot_occupancy = projections::slot_occupancy(&state.pool, game).await?;
    let assigned_principals = projections::slot_occupants(&state.pool, game).await?;
    let slots = projections::slot_state(&state.pool, game)
        .await?
        .into_iter()
        .map(|slot| {
            let occupancy = slot_occupancy
                .iter()
                .find(|occupancy| occupancy.slot_id == slot.slot_id);
            let assigned_principal_id = assigned_principals.get(&slot.slot_id).cloned();
            HostSetupSlotState {
                slot_id: slot.slot_id,
                persona_id: occupancy.map(|occupancy| occupancy.persona_id.clone()),
                public_name: occupancy.map(|occupancy| occupancy.public_name.clone()),
                assigned_principal_id,
                alive: slot.alive,
                status: slot.status,
                status_tags: slot.status_tags,
                role_key: slot.role_key,
            }
        })
        .collect();
    let main_policy = projections::post_policy(&state.pool, game, "main").await?;
    let roles = pack
        .document()
        .roles
        .iter()
        .map(|(key, role)| HostSetupRoleOption {
            key: key.clone(),
            label: role_label(key, role.description.as_str()),
            description: role.description.clone(),
        })
        .collect();

    Ok(HostSetupStateResponse {
        game,
        created: true,
        pack: HostSetupPackState {
            key: pack_ref.key,
            name: pack.document().name.clone(),
            valid: true,
            role_keys: pack.document().roles.keys().cloned().collect(),
            roles,
            start_phase_options: start_phase_options(&pack.document().phases),
        },
        program_catalog,
        attached_programs,
        phase,
        slots,
        post_policies: vec![HostSetupPostPolicyState {
            channel_id: main_policy.channel_id,
            allow_media_only: main_policy.allow_media_only,
        }],
    })
}

async fn pack_artifact_for_game(
    state: &GameHttpState,
    game: Uuid,
) -> Result<content_registry::PackArtifactSnapshot, ApiError> {
    projections::game_pack_artifact(&state.pool, game)
        .await?
        .ok_or_else(|| ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::UnknownGame,
            message: "game projection has no canonical pack artifact".to_string(),
        })
}

fn product_day_program_catalog(
    pack: &domain::Pack,
) -> Result<Vec<HostSetupProgramOption>, ApiError> {
    build_product_day_program_catalog(pack).map_err(|message| ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message,
    })
}

fn build_product_day_program_catalog(
    pack: &domain::Pack,
) -> Result<Vec<HostSetupProgramOption>, String> {
    let library =
        program_library::load_checked_in_program_library().map_err(|error| error.to_string())?;
    let mut programs = Vec::new();
    for artifact in library.for_audience(program_library::ProgramAudience::Product) {
        let compatibility = commands::day_program::inspect(pack, &artifact.document);
        let compilation = compatibility.compilation.as_ref().ok_or_else(|| {
            format!(
                "validate day program {}@{} for pack {}: {}",
                artifact.program_ref.id,
                artifact.program_ref.version,
                pack.name,
                compatibility.summary()
            )
        })?;
        let schedule_previews = compilation
            .events
            .iter()
            .map(|event| {
                let schedule = game_platform::day_schedule::compile(&event.schedule);
                let mut preview = HostSetupProgramSchedulePreview {
                    event_id: event.id.as_str().to_string(),
                    template_key: event.template_key.as_str().to_string(),
                    participant_filter: match event.participation.who {
                        game_platform::ParticipantFilter::AliveSlots => "alive_slots",
                        game_platform::ParticipantFilter::AllOccupied => "all_occupied",
                        game_platform::ParticipantFilter::HostInvited => "host_invited",
                        game_platform::ParticipantFilter::ChannelMembers => "channel_members",
                    }
                    .to_string(),
                    participation_mode: match event.participation.mode {
                        game_platform::ParticipationMode::OptIn => "opt_in",
                        game_platform::ParticipationMode::SubmitChoice => "submit_choice",
                        game_platform::ParticipationMode::SubmitFreeformRef => {
                            "submit_freeform_ref"
                        }
                        game_platform::ParticipationMode::VoteAmongOptions => "vote_among_options",
                    }
                    .to_string(),
                    resolution_mode: match event.resolution {
                        game_platform::DayEventResolutionMode::HostDecision => "host_decision",
                        game_platform::DayEventResolutionMode::Auto {
                            policy: game_platform::AutoResolvePolicy::FirstN { .. },
                        } => "auto_first_n",
                        game_platform::DayEventResolutionMode::Auto {
                            policy: game_platform::AutoResolvePolicy::SeededRandom { .. },
                        } => "auto_seeded_random",
                    }
                    .to_string(),
                    channel_policy: event.channel_policy,
                    reward_keys: event
                        .rewards
                        .iter()
                        .map(|reward| reward.reward_key.as_str().to_string())
                        .collect(),
                    mode: String::new(),
                    phase_id: None,
                    open_at: None,
                    open_offset: None,
                    lock_at: None,
                    lock_offset: None,
                    trigger: None,
                };
                match schedule.opening {
                    game_platform::day_schedule::ScheduleOpening::Manual => {
                        preview.mode = "host_opened".to_string();
                    }
                    game_platform::day_schedule::ScheduleOpening::Absolute { open_at } => {
                        preview.mode = "absolute".to_string();
                        preview.open_at = Some(open_at);
                    }
                    game_platform::day_schedule::ScheduleOpening::RelativeToPhase {
                        phase_id,
                        open_offset,
                    } => {
                        preview.mode = "relative_to_phase".to_string();
                        preview.phase_id = Some(phase_id);
                        preview.open_offset = Some(open_offset);
                    }
                    game_platform::day_schedule::ScheduleOpening::OnTrigger { trigger } => {
                        preview.mode = "on_trigger".to_string();
                        preview.trigger = Some(trigger);
                    }
                }
                match schedule.lock {
                    Some(game_platform::day_schedule::ScheduleLock::Absolute { lock_at }) => {
                        preview.lock_at = Some(lock_at);
                    }
                    Some(game_platform::day_schedule::ScheduleLock::RelativeToPhase {
                        lock_offset,
                        ..
                    }) => {
                        preview.lock_offset = Some(lock_offset);
                    }
                    None => {}
                }
                preview
            })
            .collect();
        let compatibility = HostSetupProgramCompatibility {
            attachable: compatibility.attachable(),
            issues: compatibility
                .issues
                .into_iter()
                .map(|issue| HostSetupProgramCompatibilityIssue {
                    code: issue.code.as_str().to_string(),
                    event_id: issue.event_id,
                    message: issue.message,
                })
                .collect(),
        };
        programs.push(HostSetupProgramOption {
            program_ref: artifact.program_ref.clone(),
            display_name: artifact.document.display_name.clone(),
            theme_ref: artifact
                .document
                .theme_ref
                .as_ref()
                .map(ToString::to_string),
            event_count: artifact.document.events.len(),
            compatibility,
            schedule_previews,
        });
    }
    programs.sort_by(|left, right| {
        left.program_ref
            .id
            .cmp(&right.program_ref.id)
            .then(left.program_ref.version.cmp(&right.program_ref.version))
    });
    Ok(programs)
}

#[cfg(test)]
mod day_program_catalog_tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn setup_catalog_annotates_compatibility_for_every_product_pack() {
        let product_packs = product_pack_catalog().unwrap();
        assert_eq!(
            product_packs
                .iter()
                .map(|pack| pack.key.as_str())
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "chinese_structured",
                "default_open",
                "epicmafia",
                "mafia_universe",
                "mafiascum",
            ]),
            "every newly shipped pack must declare the expected catalog compatibility"
        );
        for product_pack in product_packs {
            let pack_key = product_pack.key;
            let pack_ref = content_registry::pack_ref(&pack_key).unwrap();
            let pack = content_registry::resolve_pack(pack_ref).unwrap();
            let catalog = product_day_program_catalog(pack).unwrap();
            assert_eq!(catalog.len(), 4);
            assert!(catalog
                .iter()
                .all(|option| option.compatibility.attachable
                    && option.compatibility.issues.is_empty()));
            let modes = catalog
                .iter()
                .map(|option| {
                    (
                        option.program_ref.id.as_str(),
                        option.schedule_previews[0].mode.as_str(),
                    )
                })
                .collect::<BTreeMap<_, _>>();
            assert_eq!(
                modes,
                BTreeMap::from([
                    ("host-judged-showcase", "on_trigger"),
                    ("opt-in-quest", "relative_to_phase"),
                    ("private-opt-in-circle", "host_opened"),
                    ("raffle", "host_opened"),
                ]),
                "unexpected product program schedule preview for {pack_key}"
            );
            let private_preview = catalog
                .iter()
                .find(|option| option.program_ref.id.as_str() == "private-opt-in-circle")
                .unwrap()
                .schedule_previews
                .first()
                .unwrap();
            assert_eq!(
                private_preview.channel_policy,
                game_platform::EventChannelPolicy::Private {
                    membership: game_platform::EventChannelMembership::Participants,
                }
            );
        }
    }
}

fn product_pack_catalog() -> Result<Vec<AdminGameBootstrapPack>, ApiError> {
    let registry = content_registry::product_registry().map_err(|err| ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message: format!("initialize embedded content registry: {err}"),
    })?;
    let mut packs = Vec::with_capacity(registry.packs().len());
    for artifact in registry.packs() {
        packs.push(AdminGameBootstrapPack {
            key: artifact.pack_ref.key.clone(),
            name: humanize_identifier(artifact.document.name.as_str()),
        });
    }
    packs.sort_by(|left, right| left.name.cmp(&right.name).then(left.key.cmp(&right.key)));
    Ok(packs)
}

fn role_label(key: &str, description: &str) -> String {
    description
        .split('.')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 80)
        .map(str::to_string)
        .unwrap_or_else(|| humanize_identifier(key))
}

fn humanize_identifier(value: &str) -> String {
    value
        .split(['_', '-'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut characters = part.chars();
            match characters.next() {
                Some(first) => first.to_uppercase().chain(characters).collect(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn start_phase_options(phases: &domain::pack::PhasePolicy) -> Vec<String> {
    let mut options = BTreeSet::new();
    for kind in &phases.cadence {
        options.insert(
            domain::phase::PhaseId::compose(*kind, 1)
                .expect("one is a valid canonical phase ordinal")
                .to_string(),
        );
    }
    if options.is_empty() {
        options.insert(
            domain::phase::PhaseId::compose(domain::phase::PhaseKind::Day, 1)
                .expect("one is a valid canonical phase ordinal")
                .to_string(),
        );
    }
    options.into_iter().collect()
}

pub(super) async fn require_host_audit_access(
    pool: &PgPool,
    game: Uuid,
    authorization: &GameAuthorization,
    message: &'static str,
) -> Result<(), ApiError> {
    let principal_id = authorization.principal_id();
    let caps = caps::resolve(pool, &Principal::authenticated(principal_id), game).await?;
    if caps.grants(&Capability::HostOf(game)) || caps.grants(&Capability::CohostOf(game)) {
        return Ok(());
    }
    if authorization.is_global_operator() {
        return Ok(());
    }

    Err(ApiError::Reject {
        status: StatusCode::FORBIDDEN,
        error: RejectCode::NotAuthorized,
        message: message.to_string(),
    })
}
