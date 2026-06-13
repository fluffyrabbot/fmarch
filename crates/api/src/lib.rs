//! `api` — the first network boundary over the command pipeline.
//!
//! The command crate remains pre-HTTP. This crate owns HTTP/WebSocket decoding,
//! temporary dev-principal extraction, and mapping command outcomes into `wire`
//! messages.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use caps::Principal;
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPool;
use uuid::Uuid;
use wire::{
    AckMsg, CapabilityGrant, ClientEnvelope, Hello, ProjectionDelta, RejectCode, RejectMsg,
    ServerEnvelope, ServerMsg, VoteCountDelta, PROTOCOL_VERSION,
};

#[derive(Clone)]
pub struct ApiState {
    pool: PgPool,
    server_name: String,
}

impl ApiState {
    pub fn new(pool: PgPool) -> Self {
        ApiState {
            pool,
            server_name: "fmarch-dev".to_string(),
        }
    }

    pub fn with_server_name(mut self, name: impl Into<String>) -> Self {
        self.server_name = name.into();
        self
    }
}

pub fn router(pool: PgPool) -> Router {
    router_with_state(ApiState::new(pool))
}

pub fn router_with_state(state: ApiState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/commands", post(command))
        .route("/games/{game}/votecount", get(votecount))
        .route("/ws", get(ws))
        .with_state(state)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Health {
    pub ok: bool,
}

async fn healthz() -> Json<Health> {
    Json(Health { ok: true })
}

async fn command(
    State(state): State<ApiState>,
    Json(envelope): Json<ClientEnvelope>,
) -> impl IntoResponse {
    if envelope.v != PROTOCOL_VERSION {
        return Json(ServerEnvelope::new(
            envelope.id,
            ServerMsg::Reject(protocol_reject("unsupported protocol version")),
        ));
    }

    let wire::ClientMsg::Command(msg) = envelope.body else {
        return Json(ServerEnvelope::new(
            envelope.id,
            ServerMsg::Reject(protocol_reject("expected command message")),
        ));
    };

    let principal = Principal::user(msg.principal_user_id);
    let body = match commands::handle(&state.pool, &principal, msg.command.into()).await {
        Ok(ack) => ServerMsg::Ack(AckMsg::from(ack)),
        Err(reject) => ServerMsg::Reject(RejectMsg::from(reject)),
    };
    Json(ServerEnvelope::new(envelope.id, body))
}

async fn votecount(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
) -> Result<Json<Vec<ProjectionDelta>>, ApiError> {
    let rows = projections::votecount(&state.pool, game).await?;
    Ok(Json(
        rows.into_iter()
            .map(VoteCountDelta::from)
            .map(ProjectionDelta::VoteCountChanged)
            .collect(),
    ))
}

#[derive(Debug, Clone, Deserialize)]
struct WsParams {
    principal_user_id: Option<String>,
    game: Option<Uuid>,
}

async fn ws(
    State(state): State<ApiState>,
    Query(params): Query<WsParams>,
    upgrade: WebSocketUpgrade,
) -> impl IntoResponse {
    upgrade.on_upgrade(move |socket| ws_session(socket, state, params))
}

async fn ws_session(mut socket: WebSocket, state: ApiState, params: WsParams) {
    let hello = hello_for(&state, params.principal_user_id.as_deref(), params.game).await;
    if let Ok(text) = serde_json::to_string(&ServerEnvelope::new(0, ServerMsg::Hello(hello))) {
        let _ = socket.send(Message::Text(text.into())).await;
    }
}

async fn hello_for(state: &ApiState, principal_user_id: Option<&str>, game: Option<Uuid>) -> Hello {
    let caps = match (principal_user_id, game) {
        (Some(user), Some(game)) => caps::resolve(&state.pool, &Principal::user(user), game)
            .await
            .map(|set| set.iter().map(CapabilityGrant::from).collect())
            .unwrap_or_default(),
        _ => Vec::new(),
    };

    Hello {
        protocol_v: PROTOCOL_VERSION,
        server: state.server_name.clone(),
        caps,
    }
}

fn protocol_reject(message: impl Into<String>) -> RejectMsg {
    RejectMsg {
        error: RejectCode::Internal,
        retryable: false,
        message: message.into(),
    }
}

#[derive(Debug)]
pub enum ApiError {
    Projection(projections::ProjectionError),
}

impl From<projections::ProjectionError> for ApiError {
    fn from(err: projections::ProjectionError) -> Self {
        ApiError::Projection(err)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let message = match self {
            ApiError::Projection(err) => err.to_string(),
        };
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(RejectMsg {
                error: RejectCode::Internal,
                retryable: false,
                message,
            }),
        )
            .into_response()
    }
}
