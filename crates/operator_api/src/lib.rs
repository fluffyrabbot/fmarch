//! `operator_api` — host/operator audit and proof-report HTTP surfaces.
//!
//! Public gameplay transport stays in `api`; this crate owns the read-only
//! operator pages and audit endpoints over committed proof/projection evidence.

use axum::extract::{Path, Query, State};
use axum::http::header::AUTHORIZATION;
use axum::http::header::{HeaderValue, RETRY_AFTER};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse};
use axum::routing::get;
use axum::{Json, Router};
use caps::{Capability, Principal};
use commands::operator_proof::{
    audit_operator_proof_status_values,
    build_operator_proof_run_status as shared_build_operator_proof_run_status,
    proof_run_artifact_status, proof_run_manifest, proof_run_status_audit_report_artifact_state,
    proof_run_summary_label as shared_proof_run_summary_label,
    OperatorDeterminismFuzzFamily as SharedOperatorDeterminismFuzzFamily,
    OperatorDeterminismFuzzFamilyStatus as SharedOperatorDeterminismFuzzFamilyStatus,
    OperatorDeterminismFuzzReport as SharedOperatorDeterminismFuzzReport,
    OperatorLargeActionGraphPerformanceReport as SharedOperatorLargeActionGraphPerformanceReport,
    OperatorProjectionRebuildAuditReport as SharedOperatorProjectionRebuildAuditReport,
    OperatorProjectionRebuildAuditTable as SharedOperatorProjectionRebuildAuditTable,
    OperatorProofRunArtifactCounts as SharedOperatorProofRunArtifactCounts,
    OperatorProofRunArtifactStateKind as SharedOperatorProofRunArtifactStateKind,
    OperatorProofRunArtifactStatus as SharedOperatorProofRunArtifactStatus,
    OperatorProofRunFixture, OperatorProofRunGoNoGoReport as SharedOperatorProofRunGoNoGoReport,
    OperatorProofRunGoNoGoRetentionChange as SharedOperatorProofRunGoNoGoRetentionChange,
    OperatorProofRunGoNoGoRetentionReport as SharedOperatorProofRunGoNoGoRetentionReport,
    OperatorProofRunStatus as SharedOperatorProofRunStatus,
    OperatorProofRunStatusAuditReport as SharedOperatorProofRunStatusAuditReport,
    OperatorProofRunStatusRow as SharedOperatorProofRunStatusRow,
    OperatorResolutionDiff as SharedOperatorResolutionDiff,
    OperatorResolutionDiffPath as SharedOperatorResolutionDiffPath,
    OperatorResolutionDiffPhase as SharedOperatorResolutionDiffPhase,
    OperatorResolutionDiffReport as SharedOperatorResolutionDiffReport,
    OperatorTraceInspectionReport as SharedOperatorTraceInspectionReport,
    OperatorTraceInspectionRun as SharedOperatorTraceInspectionRun, ProofRunArtifactFreshness,
    ProofRunArtifactState,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPool;
use std::{fs, path::Path as FsPath};
use uuid::Uuid;
use wire::{HostPhaseControl, RejectCode, RejectMsg, ResolutionTraceInspectionReport};

#[derive(Clone)]
pub struct OperatorApiState {
    pool: PgPool,
}

impl OperatorApiState {
    pub fn new(pool: PgPool) -> Self {
        OperatorApiState { pool }
    }
}

pub fn router(pool: PgPool) -> Router {
    router_with_state(OperatorApiState::new(pool))
}

pub fn router_with_state(state: OperatorApiState) -> Router {
    Router::new()
        .route(
            "/games/{game}/host-phase-controls/view",
            get(host_phase_controls_view),
        )
        .route("/games/{game}/operator", get(operator_index))
        .route(
            "/games/{game}/operator/proof-runs",
            get(operator_proof_runs),
        )
        .route(
            "/games/{game}/operator/proof-runs/status",
            get(operator_proof_runs_status),
        )
        .route(
            "/games/{game}/operator/proof-runs/status-audit",
            get(operator_proof_run_status_audit),
        )
        .route(
            "/games/{game}/operator/proof-runs/status-audit/view",
            get(operator_proof_run_status_audit_view),
        )
        .route(
            "/games/{game}/operator/proof-runs/go-no-go",
            get(operator_proof_run_go_no_go),
        )
        .route(
            "/games/{game}/operator/proof-runs/go-no-go/view",
            get(operator_proof_run_go_no_go_view),
        )
        .route(
            "/games/{game}/operator/proof-runs/retention",
            get(operator_proof_run_retention),
        )
        .route(
            "/games/{game}/operator/proof-runs/retention/view",
            get(operator_proof_run_retention_view),
        )
        .route(
            "/games/{game}/operator/proof-runs/projection-rebuild",
            get(operator_proof_run_projection_rebuild),
        )
        .route(
            "/games/{game}/operator/proof-runs/projection-rebuild/view",
            get(operator_proof_run_projection_rebuild_view),
        )
        .route(
            "/games/{game}/operator/proof-runs/resolution-diff",
            get(operator_proof_run_resolution_diff),
        )
        .route(
            "/games/{game}/operator/proof-runs/resolution-diff/view",
            get(operator_proof_run_resolution_diff_view),
        )
        .route(
            "/games/{game}/operator/proof-runs/trace-inspection",
            get(operator_proof_run_trace_inspection),
        )
        .route(
            "/games/{game}/operator/proof-runs/trace-inspection/view",
            get(operator_proof_run_trace_inspection_view),
        )
        .route(
            "/games/{game}/operator/proof-runs/large-action-graph-performance",
            get(operator_proof_run_large_action_graph_performance),
        )
        .route(
            "/games/{game}/operator/proof-runs/large-action-graph-performance/view",
            get(operator_proof_run_large_action_graph_performance_view),
        )
        .route(
            "/games/{game}/operator/proof-runs/determinism-fuzz",
            get(operator_proof_run_determinism_fuzz),
        )
        .route(
            "/games/{game}/operator/proof-runs/determinism-fuzz/view",
            get(operator_proof_run_determinism_fuzz_view),
        )
        .route("/games/{game}/projection-audit", get(projection_audit))
        .route(
            "/games/{game}/projection-audit/view",
            get(projection_audit_view),
        )
        .route("/games/{game}/resolution-audit", get(resolution_audit))
        .route(
            "/games/{game}/resolution-audit/view",
            get(resolution_audit_view),
        )
        .route("/games/{game}/resolution-traces", get(resolution_traces))
        .route(
            "/games/{game}/resolution-traces/view",
            get(resolution_traces_view),
        )
        .with_state(state)
}

#[derive(Debug, Clone, Deserialize)]
struct OperatorProofRunsQuery {
    #[serde(default)]
    fixture: Option<OperatorProofRunFixture>,
}

#[derive(Debug, Clone, Deserialize)]
struct OperatorProofStatusAuditQuery {
    #[serde(default)]
    fixture: Option<OperatorProofStatusAuditFixture>,
}

#[derive(Debug, Clone, Deserialize)]
struct OperatorProofGoNoGoQuery {
    #[serde(default)]
    fixture: Option<OperatorProofGoNoGoFixture>,
}

#[derive(Debug, Clone, Deserialize)]
struct OperatorProofRetentionQuery {
    #[serde(default)]
    fixture: Option<OperatorProofRetentionFixture>,
}

#[derive(Debug, Clone, Deserialize)]
struct OperatorProofProjectionRebuildQuery {
    #[serde(default)]
    fixture: Option<OperatorProofProjectionRebuildFixture>,
}

#[derive(Debug, Clone, Deserialize)]
struct OperatorProofResolutionDiffQuery {
    #[serde(default)]
    fixture: Option<OperatorProofResolutionDiffFixture>,
}

#[derive(Debug, Clone, Deserialize)]
struct OperatorProofTraceInspectionQuery {
    #[serde(default)]
    fixture: Option<OperatorProofTraceInspectionFixture>,
}

#[derive(Debug, Clone, Deserialize)]
struct OperatorProofLargeActionGraphPerformanceQuery {
    #[serde(default)]
    fixture: Option<OperatorProofLargeActionGraphPerformanceFixture>,
}

#[derive(Debug, Clone, Deserialize)]
struct OperatorProofDeterminismFuzzQuery {
    #[serde(default)]
    fixture: Option<OperatorProofDeterminismFuzzFixture>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum OperatorProofProjectionRebuildFixture {
    MissingReport,
    StaleReport,
    DriftedReport,
    RecoveredReport,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum OperatorProofResolutionDiffFixture {
    MissingReport,
    StaleReport,
    DriftedReport,
    MatchedReport,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum OperatorProofTraceInspectionFixture {
    MissingReport,
    StaleReport,
    MalformedReport,
    FilteredRun,
    EmptyTrace,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum OperatorProofLargeActionGraphPerformanceFixture {
    MissingReport,
    StaleReport,
    ThresholdRegressed,
    RecoveredReport,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum OperatorProofDeterminismFuzzFixture {
    MissingReport,
    StaleReport,
    FailedSeed,
    RecoveredReport,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum OperatorProofRetentionFixture {
    NewlyMissingArtifact,
    StalePreviouslyTrusted,
    RecoveredArtifact,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum OperatorProofGoNoGoFixture {
    MissingProductionArtifact,
    StaleProductionArtifact,
    DriftedProductionArtifact,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum OperatorProofStatusAuditFixture {
    ArtifactStateDrift,
    SavedReportMalformed,
    SavedReportStale,
    SavedReportDrifted,
}

#[derive(Debug, Clone, Serialize)]
struct OperatorProofStatusAuditResponse {
    #[serde(flatten)]
    report: SharedOperatorProofRunStatusAuditReport,
    artifact: SharedOperatorProofRunArtifactStatus,
}

#[derive(Debug, Clone, Serialize)]
struct OperatorProofGoNoGoResponse {
    #[serde(flatten)]
    report: SharedOperatorProofRunGoNoGoReport,
    fixture: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
struct OperatorProofRetentionResponse {
    #[serde(flatten)]
    report: SharedOperatorProofRunGoNoGoRetentionReport,
    fixture: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
struct OperatorProofProjectionRebuildResponse {
    #[serde(flatten)]
    report: SharedOperatorProjectionRebuildAuditReport,
    fixture: Option<&'static str>,
    artifact_state: &'static str,
}

#[derive(Debug, Clone, Serialize)]
struct OperatorProofResolutionDiffResponse {
    #[serde(flatten)]
    report: SharedOperatorResolutionDiffReport,
    fixture: Option<&'static str>,
    artifact_state: &'static str,
}

#[derive(Debug, Clone, Serialize)]
struct OperatorProofTraceInspectionResponse {
    #[serde(flatten)]
    report: SharedOperatorTraceInspectionReport,
    fixture: Option<&'static str>,
    artifact_state: &'static str,
}

#[derive(Debug, Clone, Serialize)]
struct OperatorProofLargeActionGraphPerformanceResponse {
    #[serde(flatten)]
    report: SharedOperatorLargeActionGraphPerformanceReport,
    fixture: Option<&'static str>,
    artifact_state: &'static str,
}

#[derive(Debug, Clone, Serialize)]
struct OperatorProofDeterminismFuzzResponse {
    #[serde(flatten)]
    report: SharedOperatorDeterminismFuzzReport,
    fixture: Option<&'static str>,
    artifact_state: &'static str,
}

async fn operator_index(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Html<String>, ApiError> {
    let principal_user_id = require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator index for this game",
    )
    .await?;

    Ok(Html(render_operator_index_html(game, &principal_user_id)))
}

async fn operator_proof_runs(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<OperatorProofRunsQuery>,
) -> Result<Html<String>, ApiError> {
    let principal_user_id = require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator proof-run index for this game",
    )
    .await?;

    Ok(Html(render_operator_proof_runs_html(
        game,
        &principal_user_id,
        query.fixture,
    )))
}

async fn operator_proof_runs_status(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<OperatorProofRunsQuery>,
) -> Result<Json<SharedOperatorProofRunStatus>, ApiError> {
    require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator proof-run status for this game",
    )
    .await?;

    Ok(Json(shared_build_operator_proof_run_status(
        game,
        query.fixture,
    )))
}

async fn operator_proof_run_status_audit(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<OperatorProofStatusAuditQuery>,
) -> Result<Json<OperatorProofStatusAuditResponse>, ApiError> {
    require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator proof-run status audit for this game",
    )
    .await?;

    Ok(Json(load_operator_proof_status_audit_response(
        query.fixture,
    )?))
}

async fn operator_proof_run_status_audit_view(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<OperatorProofStatusAuditQuery>,
) -> Result<Html<String>, ApiError> {
    let principal_user_id = require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator proof-run status audit view for this game",
    )
    .await?;

    let response = load_operator_proof_status_audit_response(query.fixture)?;
    Ok(Html(render_operator_proof_status_audit_html(
        game,
        &principal_user_id,
        query.fixture,
        &response,
    )))
}

async fn operator_proof_run_go_no_go(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<OperatorProofGoNoGoQuery>,
) -> Result<Json<OperatorProofGoNoGoResponse>, ApiError> {
    require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator proof artifact go/no-go for this game",
    )
    .await?;

    Ok(Json(load_operator_proof_go_no_go_response(query.fixture)?))
}

async fn operator_proof_run_go_no_go_view(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<OperatorProofGoNoGoQuery>,
) -> Result<Html<String>, ApiError> {
    let principal_user_id = require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator proof artifact go/no-go view for this game",
    )
    .await?;

    let response = load_operator_proof_go_no_go_response(query.fixture)?;
    Ok(Html(render_operator_proof_go_no_go_html(
        game,
        &principal_user_id,
        &response,
    )))
}

async fn operator_proof_run_retention(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<OperatorProofRetentionQuery>,
) -> Result<Json<OperatorProofRetentionResponse>, ApiError> {
    require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator proof artifact retention for this game",
    )
    .await?;

    Ok(Json(load_operator_proof_retention_response(query.fixture)?))
}

async fn operator_proof_run_retention_view(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<OperatorProofRetentionQuery>,
) -> Result<Html<String>, ApiError> {
    let principal_user_id = require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator proof artifact retention view for this game",
    )
    .await?;

    let response = load_operator_proof_retention_response(query.fixture)?;
    Ok(Html(render_operator_proof_retention_html(
        game,
        &principal_user_id,
        &response,
    )))
}

async fn operator_proof_run_projection_rebuild(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<OperatorProofProjectionRebuildQuery>,
) -> Result<Json<OperatorProofProjectionRebuildResponse>, ApiError> {
    require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator projection rebuild artifact for this game",
    )
    .await?;

    Ok(Json(load_operator_proof_projection_rebuild_response(
        query.fixture,
    )?))
}

async fn operator_proof_run_projection_rebuild_view(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<OperatorProofProjectionRebuildQuery>,
) -> Result<Html<String>, ApiError> {
    let principal_user_id = require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator projection rebuild artifact view for this game",
    )
    .await?;

    let response = load_operator_proof_projection_rebuild_response(query.fixture)?;
    Ok(Html(render_operator_proof_projection_rebuild_html(
        game,
        &principal_user_id,
        &response,
    )))
}

async fn operator_proof_run_resolution_diff(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<OperatorProofResolutionDiffQuery>,
) -> Result<Json<OperatorProofResolutionDiffResponse>, ApiError> {
    require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator resolution diff artifact for this game",
    )
    .await?;

    Ok(Json(load_operator_proof_resolution_diff_response(
        query.fixture,
    )?))
}

async fn operator_proof_run_resolution_diff_view(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<OperatorProofResolutionDiffQuery>,
) -> Result<Html<String>, ApiError> {
    let principal_user_id = require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator resolution diff artifact view for this game",
    )
    .await?;

    let response = load_operator_proof_resolution_diff_response(query.fixture)?;
    Ok(Html(render_operator_proof_resolution_diff_html(
        game,
        &principal_user_id,
        &response,
    )))
}

async fn operator_proof_run_trace_inspection(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<OperatorProofTraceInspectionQuery>,
) -> Result<Json<OperatorProofTraceInspectionResponse>, ApiError> {
    require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator trace inspection artifact for this game",
    )
    .await?;

    Ok(Json(load_operator_proof_trace_inspection_response(
        query.fixture,
    )?))
}

async fn operator_proof_run_trace_inspection_view(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<OperatorProofTraceInspectionQuery>,
) -> Result<Html<String>, ApiError> {
    let principal_user_id = require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator trace inspection artifact view for this game",
    )
    .await?;

    let response = load_operator_proof_trace_inspection_response(query.fixture)?;
    Ok(Html(render_operator_proof_trace_inspection_html(
        game,
        &principal_user_id,
        &response,
    )))
}

async fn operator_proof_run_large_action_graph_performance(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<OperatorProofLargeActionGraphPerformanceQuery>,
) -> Result<Json<OperatorProofLargeActionGraphPerformanceResponse>, ApiError> {
    require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator large action graph performance artifact for this game",
    )
    .await?;

    Ok(Json(
        load_operator_proof_large_action_graph_performance_response(query.fixture)?,
    ))
}

async fn operator_proof_run_large_action_graph_performance_view(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<OperatorProofLargeActionGraphPerformanceQuery>,
) -> Result<Html<String>, ApiError> {
    let principal_user_id = require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator large action graph performance artifact view for this game",
    )
    .await?;

    let response = load_operator_proof_large_action_graph_performance_response(query.fixture)?;
    Ok(Html(
        render_operator_proof_large_action_graph_performance_html(
            game,
            &principal_user_id,
            &response,
        ),
    ))
}

async fn operator_proof_run_determinism_fuzz(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<OperatorProofDeterminismFuzzQuery>,
) -> Result<Json<OperatorProofDeterminismFuzzResponse>, ApiError> {
    require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator determinism fuzz artifact for this game",
    )
    .await?;

    Ok(Json(load_operator_proof_determinism_fuzz_response(
        query.fixture,
    )?))
}

async fn operator_proof_run_determinism_fuzz_view(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<OperatorProofDeterminismFuzzQuery>,
) -> Result<Html<String>, ApiError> {
    let principal_user_id = require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read operator determinism fuzz artifact view for this game",
    )
    .await?;

    let response = load_operator_proof_determinism_fuzz_response(query.fixture)?;
    Ok(Html(render_operator_proof_determinism_fuzz_html(
        game,
        &principal_user_id,
        &response,
    )))
}

async fn host_phase_controls_view(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Html<String>, ApiError> {
    require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read host phase-control audit for this game",
    )
    .await?;

    let controls: Vec<HostPhaseControl> = projections::host_phase_controls(&state.pool, game)
        .await?
        .into_iter()
        .map(HostPhaseControl::from)
        .collect();
    Ok(Html(render_host_phase_controls_html(game, &controls)))
}

async fn projection_audit(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<projections::ProjectionAuditReport>, ApiError> {
    require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read projection rebuild audit for this game",
    )
    .await?;

    Ok(Json(projections::audit_rebuild(&state.pool, game).await?))
}

async fn projection_audit_view(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Html<String>, ApiError> {
    require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read projection rebuild audit for this game",
    )
    .await?;

    let report = projections::audit_rebuild(&state.pool, game).await?;
    Ok(Html(render_projection_audit_html(&report)))
}

async fn resolution_audit(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<commands::ResolutionEnvelopeAuditReport>, ApiError> {
    require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read resolution replay audit for this game",
    )
    .await?;

    Ok(Json(
        commands::audit_resolution_envelopes(&state.pool, game)
            .await
            .map_err(command_api_error)?,
    ))
}

async fn resolution_audit_view(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Html<String>, ApiError> {
    require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read resolution replay audit for this game",
    )
    .await?;

    let report = commands::audit_resolution_envelopes(&state.pool, game)
        .await
        .map_err(command_api_error)?;
    Ok(Html(render_resolution_audit_html(&report)))
}

#[derive(Debug, Clone, Deserialize)]
struct ResolutionTraceQuery {
    run_id: Option<String>,
}

async fn resolution_traces(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<ResolutionTraceQuery>,
) -> Result<Json<ResolutionTraceInspectionReport>, ApiError> {
    require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read resolution traces for this game",
    )
    .await?;

    Ok(Json(
        commands::inspect_resolution_traces(&state.pool, game, query.run_id.as_deref())
            .await
            .map_err(command_api_error)?
            .into(),
    ))
}

async fn resolution_traces_view(
    State(state): State<OperatorApiState>,
    Path(game): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<ResolutionTraceQuery>,
) -> Result<Html<String>, ApiError> {
    require_host_audit_access(
        &state,
        &headers,
        game,
        "principal cannot read resolution traces for this game",
    )
    .await?;

    let report = commands::inspect_resolution_traces(&state.pool, game, query.run_id.as_deref())
        .await
        .map_err(command_api_error)?;
    Ok(Html(render_resolution_trace_html(&report)))
}

async fn require_host_audit_access(
    state: &OperatorApiState,
    headers: &HeaderMap,
    game: Uuid,
    message: &'static str,
) -> Result<String, ApiError> {
    let token = bearer_token(headers).ok_or_else(unauthorized_operator_session)?;
    let (principal_user_id, global_capabilities) =
        active_operator_session(&state.pool, token).await?;
    let caps = caps::resolve(
        &state.pool,
        &Principal::user(principal_user_id.as_str()),
        game,
    )
    .await?;
    if caps.grants(&Capability::HostOf(game)) || caps.grants(&Capability::CohostOf(game)) {
        return Ok(principal_user_id);
    }
    if global_capabilities
        .iter()
        .any(|capability| capability == "GlobalAdmin" || capability == "GlobalMod")
    {
        return Ok(principal_user_id);
    }

    Err(ApiError::Reject {
        status: StatusCode::FORBIDDEN,
        error: RejectCode::NotAuthorized,
        message: message.to_string(),
    })
}

async fn active_operator_session(
    pool: &PgPool,
    token: &str,
) -> Result<(String, Vec<String>), ApiError> {
    sqlx::query_as::<_, (String, Vec<String>)>(
        r#"
        SELECT principal_user_id, global_capabilities
        FROM auth_session
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::BIGINT
        "#,
    )
    .bind(hash_session_token(token))
    .fetch_optional(pool)
    .await?
    .ok_or_else(unauthorized_operator_session)
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|token| !token.is_empty())
}

fn hash_session_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn unauthorized_operator_session() -> ApiError {
    ApiError::Reject {
        status: StatusCode::UNAUTHORIZED,
        error: RejectCode::NotAuthorized,
        message: "operator session token is missing, expired, or revoked".to_string(),
    }
}

fn render_operator_index_html(game: Uuid, principal_user_id: &str) -> String {
    struct Link<'a> {
        label: &'a str,
        detail: &'a str,
        href: String,
    }

    let links = [
        Link {
            label: "Projection Rebuild Audit",
            detail: "HTML drift report for rebuildable read models.",
            href: format!("/games/{game}/projection-audit/view"),
        },
        Link {
            label: "Projection Rebuild JSON",
            detail: "Machine-readable rollback rebuild audit.",
            href: format!("/games/{game}/projection-audit"),
        },
        Link {
            label: "Resolution Replay Audit",
            detail: "HTML comparison of stored and replayed resolution envelopes.",
            href: format!("/games/{game}/resolution-audit/view"),
        },
        Link {
            label: "Resolution Replay JSON",
            detail: "Machine-readable replay audit with compact diff paths.",
            href: format!("/games/{game}/resolution-audit"),
        },
        Link {
            label: "Resolution Trace Inspection",
            detail:
                "HTML trace browser for decisions, edges, generated actions, effects, and notes.",
            href: format!("/games/{game}/resolution-traces/view"),
        },
        Link {
            label: "Resolution Trace JSON",
            detail: "Machine-readable trace inspection, optionally filtered by run_id.",
            href: format!("/games/{game}/resolution-traces"),
        },
        Link {
            label: "Host Phase-Control Audit",
            detail: "Machine-readable prompt-driven phase movement audit rows.",
            href: format!("/games/{game}/host-phase-controls"),
        },
        Link {
            label: "Host Phase-Control View",
            detail: "HTML inspection of prompt-driven phase movement audit rows.",
            href: format!("/games/{game}/host-phase-controls/view"),
        },
        Link {
            label: "Operator Proof-Run Index",
            detail: "Read-only local command index for Phase 7 proof lanes.",
            href: format!("/games/{game}/operator/proof-runs"),
        },
        Link {
            label: "Operator Proof-Run Status Audit",
            detail: "HTML status-contract audit over saved local proof-run evidence.",
            href: format!("/games/{game}/operator/proof-runs/status-audit/view"),
        },
        Link {
            label: "Operator Proof-Run Status Audit JSON",
            detail: "Machine-readable status-contract audit over saved local proof-run evidence.",
            href: format!("/games/{game}/operator/proof-runs/status-audit"),
        },
        Link {
            label: "Operator Proof Artifact Go/No-Go",
            detail: "HTML go/no-go report for saved local proof-run artifacts.",
            href: format!("/games/{game}/operator/proof-runs/go-no-go/view"),
        },
        Link {
            label: "Operator Proof Artifact Go/No-Go JSON",
            detail: "Machine-readable go/no-go report for saved local proof-run artifacts.",
            href: format!("/games/{game}/operator/proof-runs/go-no-go"),
        },
        Link {
            label: "Operator Proof Artifact Retention",
            detail: "HTML retention comparison for saved local proof-run artifacts.",
            href: format!("/games/{game}/operator/proof-runs/retention/view"),
        },
        Link {
            label: "Operator Proof Artifact Retention JSON",
            detail: "Machine-readable retention comparison for saved local proof-run artifacts.",
            href: format!("/games/{game}/operator/proof-runs/retention"),
        },
        Link {
            label: "Operator Projection Rebuild Report",
            detail: "HTML projection rebuild report for a saved local artifact.",
            href: format!("/games/{game}/operator/proof-runs/projection-rebuild/view"),
        },
        Link {
            label: "Operator Projection Rebuild Report JSON",
            detail: "Machine-readable projection rebuild report for a saved local artifact.",
            href: format!("/games/{game}/operator/proof-runs/projection-rebuild"),
        },
        Link {
            label: "Operator Resolution Diff Report",
            detail: "HTML resolution replay diff report for a saved local artifact.",
            href: format!("/games/{game}/operator/proof-runs/resolution-diff/view"),
        },
        Link {
            label: "Operator Resolution Diff Report JSON",
            detail: "Machine-readable resolution replay diff report for a saved local artifact.",
            href: format!("/games/{game}/operator/proof-runs/resolution-diff"),
        },
        Link {
            label: "Operator Trace Inspection Report",
            detail: "HTML trace inspection report for a saved local artifact.",
            href: format!("/games/{game}/operator/proof-runs/trace-inspection/view"),
        },
        Link {
            label: "Operator Trace Inspection Report JSON",
            detail: "Machine-readable trace inspection report for a saved local artifact.",
            href: format!("/games/{game}/operator/proof-runs/trace-inspection"),
        },
        Link {
            label: "Operator Large Action Graph Performance Report",
            detail: "HTML performance report for the saved dense local action graph artifact.",
            href: format!("/games/{game}/operator/proof-runs/large-action-graph-performance/view"),
        },
        Link {
            label: "Operator Large Action Graph Performance Report JSON",
            detail: "Machine-readable dense action graph performance report.",
            href: format!("/games/{game}/operator/proof-runs/large-action-graph-performance"),
        },
        Link {
            label: "Operator Determinism Fuzz Report",
            detail: "HTML seeded scenario-family determinism report for saved local evidence.",
            href: format!("/games/{game}/operator/proof-runs/determinism-fuzz/view"),
        },
        Link {
            label: "Operator Determinism Fuzz Report JSON",
            detail: "Machine-readable seeded determinism report.",
            href: format!("/games/{game}/operator/proof-runs/determinism-fuzz"),
        },
    ];

    let mut html = String::new();
    html.push_str("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">");
    html.push_str("<title>Operator Index</title>");
    html.push_str(
        "<style>\
         body{font-family:system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;margin:24px;color:#18202a;background:#f8fafc;}\
         main{max-width:960px;margin:0 auto;}\
         h1{font-size:24px;margin:0 0 8px;}\
         p{color:#516070;margin:0 0 18px;}\
         .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0 22px;}\
         .metric{background:#fff;border:1px solid #d8dee8;border-radius:6px;padding:10px 12px;}\
         .label{display:block;font-size:12px;color:#516070;text-transform:uppercase;}\
         .value{display:block;font-size:16px;font-weight:650;margin-top:4px;word-break:break-word;}\
         table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d8dee8;border-radius:6px;overflow:hidden;}\
         th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e7ebf1;padding:10px 12px;font-size:13px;}\
         th{background:#edf2f7;color:#334155;}\
         a{color:#0f5e9c;font-weight:650;text-decoration:none;}\
         a:hover{text-decoration:underline;}\
         code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;}\
         .detail{color:#516070;}\
         </style>",
    );
    html.push_str("</head><body><main>");
    html.push_str("<h1>Operator Index</h1>");
    html.push_str("<p>Read-only host and cohost operational surfaces for this game.</p>");
    html.push_str("<section class=\"meta\">");
    metric(&mut html, "Game", &game.to_string(), None);
    metric(&mut html, "Principal", principal_user_id, None);
    html.push_str("</section><table><thead><tr><th>Surface</th><th>Scope</th><th>Link</th></tr></thead><tbody>");
    for link in links {
        html.push_str("<tr><td><a href=\"");
        html_escape_into(&mut html, &link.href);
        html.push_str("\">");
        html_escape_into(&mut html, link.label);
        html.push_str("</a></td><td class=\"detail\">");
        html_escape_into(&mut html, link.detail);
        html.push_str("</td><td><code>");
        html_escape_into(&mut html, &link.href);
        html.push_str("</code></td></tr>");
    }
    html.push_str("</tbody></table></main></body></html>");
    html
}

fn render_operator_proof_runs_html(
    game: Uuid,
    principal_user_id: &str,
    fixture: Option<OperatorProofRunFixture>,
) -> String {
    let status = shared_build_operator_proof_run_status(game, fixture);

    let mut html = String::new();
    html.push_str("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">");
    html.push_str("<title>Operator Proof-Run Index</title>");
    html.push_str(
        "<style>\
         body{font-family:system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;margin:24px;color:#18202a;background:#f8fafc;}\
         main{max-width:1180px;margin:0 auto;}\
         h1{font-size:24px;margin:0 0 8px;}\
         h2{font-size:18px;margin:28px 0 12px;}\
         p{color:#516070;margin:0 0 18px;}\
         .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0 22px;}\
         .metric{background:#fff;border:1px solid #d8dee8;border-radius:6px;padding:10px 12px;}\
         .label{display:block;font-size:12px;color:#516070;text-transform:uppercase;}\
         .value{display:block;font-size:16px;font-weight:650;margin-top:4px;word-break:break-word;}\
         table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d8dee8;border-radius:6px;overflow:hidden;margin:0 0 20px;}\
         th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e7ebf1;padding:10px 12px;font-size:13px;}\
         th{background:#edf2f7;color:#334155;}\
         code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-word;}\
         .detail{color:#516070;}\
         </style>",
    );
    html.push_str("</head><body><main>");
    html.push_str("<h1>Operator Proof-Run Index</h1>");
    html.push_str("<p>Read-only local command index. These entries document commands to run from the workspace; this server page does not execute background jobs.</p>");
    html.push_str("<section class=\"meta\">");
    metric(&mut html, "Game", &game.to_string(), None);
    metric(&mut html, "Principal", principal_user_id, None);
    metric(&mut html, "Execution", "local-only command copy", None);
    metric(
        &mut html,
        "Manifest",
        &format!("v{}", status.manifest_version),
        None,
    );
    metric(
        &mut html,
        "Production Artifacts",
        &shared_proof_run_summary_label(&status.summary.production),
        None,
    );
    metric(
        &mut html,
        "Fixture Artifacts",
        &shared_proof_run_summary_label(&status.summary.fixtures),
        None,
    );
    html.push_str("</section>");
    for family in &status.families {
        render_proof_run_table(&mut html, &family.heading, &family.runs);
    }
    html.push_str("</main></body></html>");
    html
}

fn render_proof_run_table(
    html: &mut String,
    heading: &str,
    rows: &[SharedOperatorProofRunStatusRow],
) {
    html.push_str("<h2>");
    html_escape_into(html, heading);
    html.push_str("</h2><table><thead><tr><th>Family</th><th>Scope</th><th>Command</th><th>Artifact</th><th>Proof Boundary</th></tr></thead><tbody>");
    for row in rows {
        html.push_str("<tr id=\"");
        html_escape_into(html, &row.row_id);
        html.push_str("\"><td><a href=\"#");
        html_escape_into(html, &row.row_id);
        html.push_str("\">");
        html_escape_into(html, &row.family);
        html.push_str("</a></td><td>");
        html_escape_into(html, &row.scope);
        html.push_str("</td><td><code>");
        html_escape_into(html, &row.command);
        html.push_str("</code></td><td class=\"detail\">");
        if let Some(artifact) = &row.artifact {
            render_artifact_cell(html, artifact);
        }
        html.push_str("</td><td class=\"detail\">");
        html_escape_into(html, &row.proof_boundary);
        html.push_str("</td></tr>");
    }
    html.push_str("</tbody></table>");
}

const OPERATOR_PROOF_STATUS_SNAPSHOT_PATH: &str =
    "crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json";
const OPERATOR_PROOF_STATUS_CURRENT_PATH: &str =
    "target/operator-proof/current-status-audit-check.json";
const OPERATOR_PROOF_STATUS_AUDIT_REPORT_PATH: &str =
    "target/operator-proof/current-status-audit-report.json";
const OPERATOR_PROOF_GO_NO_GO_REPORT_PATH: &str =
    "target/operator-proof/current-artifact-go-no-go-report.json";
const OPERATOR_PROOF_RETENTION_REPORT_PATH: &str =
    "target/operator-proof/current-artifact-retention-report.json";
const OPERATOR_PROOF_PROJECTION_REBUILD_REPORT_PATH: &str =
    "target/operator-proof/current-projection-rebuild-report.json";
const OPERATOR_PROOF_RESOLUTION_DIFF_REPORT_PATH: &str =
    "target/operator-proof/current-resolution-diff-report.json";
const OPERATOR_PROOF_TRACE_INSPECTION_REPORT_PATH: &str =
    "target/operator-proof/current-trace-inspection-report.json";
const OPERATOR_PROOF_LARGE_ACTION_GRAPH_PERFORMANCE_REPORT_PATH: &str =
    "target/operator-proof/current-large-action-graph-performance-report.json";
const OPERATOR_PROOF_DETERMINISM_FUZZ_REPORT_PATH: &str =
    "target/operator-proof/current-determinism-fuzz-report.json";

fn load_operator_proof_projection_rebuild_response(
    fixture: Option<OperatorProofProjectionRebuildFixture>,
) -> Result<OperatorProofProjectionRebuildResponse, ApiError> {
    let mut report: SharedOperatorProjectionRebuildAuditReport =
        read_workspace_json_as(OPERATOR_PROOF_PROJECTION_REBUILD_REPORT_PATH)?;
    let mut artifact_state = if report.ok { "trusted" } else { "drifted" };
    if let Some(fixture) = fixture {
        artifact_state = apply_projection_rebuild_fixture(&mut report, fixture);
    }
    Ok(OperatorProofProjectionRebuildResponse {
        report,
        fixture: fixture.map(projection_rebuild_fixture_label),
        artifact_state,
    })
}

fn apply_projection_rebuild_fixture(
    report: &mut SharedOperatorProjectionRebuildAuditReport,
    fixture: OperatorProofProjectionRebuildFixture,
) -> &'static str {
    match fixture {
        OperatorProofProjectionRebuildFixture::MissingReport => {
            report.ok = false;
            report.table_count = 0;
            report.matched_table_count = 0;
            report.drifted_table_count = 0;
            report.tables.clear();
            "missing"
        }
        OperatorProofProjectionRebuildFixture::StaleReport => "stale",
        OperatorProofProjectionRebuildFixture::DriftedReport => {
            report.ok = false;
            report.table_count = report.table_count.max(1);
            report.matched_table_count = report.matched_table_count.saturating_sub(1);
            report.drifted_table_count = report.drifted_table_count.max(1);
            report.tables = vec![projection_rebuild_table_fixture("slot_state", false, 6, 5)];
            "drifted"
        }
        OperatorProofProjectionRebuildFixture::RecoveredReport => {
            report.ok = true;
            report.table_count = report.table_count.max(1);
            report.matched_table_count = report.table_count;
            report.drifted_table_count = 0;
            if report.tables.is_empty() {
                report
                    .tables
                    .push(projection_rebuild_table_fixture("slot_state", true, 6, 6));
            }
            for table in &mut report.tables {
                table.matches = true;
                table.before = None;
                table.rebuilt = None;
            }
            "trusted"
        }
    }
}

fn projection_rebuild_table_fixture(
    table: &str,
    matches: bool,
    before_rows: usize,
    rebuilt_rows: usize,
) -> SharedOperatorProjectionRebuildAuditTable {
    SharedOperatorProjectionRebuildAuditTable {
        table: table.to_string(),
        matches,
        before_rows,
        rebuilt_rows,
        before: (!matches).then(|| serde_json::json!([{"slot_id": "slot_1"}])),
        rebuilt: (!matches).then(|| serde_json::json!([])),
    }
}

fn projection_rebuild_fixture_label(
    fixture: OperatorProofProjectionRebuildFixture,
) -> &'static str {
    match fixture {
        OperatorProofProjectionRebuildFixture::MissingReport => "missing-report",
        OperatorProofProjectionRebuildFixture::StaleReport => "stale-report",
        OperatorProofProjectionRebuildFixture::DriftedReport => "drifted-report",
        OperatorProofProjectionRebuildFixture::RecoveredReport => "recovered-report",
    }
}

fn load_operator_proof_resolution_diff_response(
    fixture: Option<OperatorProofResolutionDiffFixture>,
) -> Result<OperatorProofResolutionDiffResponse, ApiError> {
    let mut report: SharedOperatorResolutionDiffReport =
        read_workspace_json_as(OPERATOR_PROOF_RESOLUTION_DIFF_REPORT_PATH)?;
    let mut artifact_state = if report.ok && report.diff_count == 0 {
        "trusted"
    } else {
        "drifted"
    };
    if let Some(fixture) = fixture {
        artifact_state = apply_resolution_diff_fixture(&mut report, fixture);
    }
    Ok(OperatorProofResolutionDiffResponse {
        report,
        fixture: fixture.map(resolution_diff_fixture_label),
        artifact_state,
    })
}

fn apply_resolution_diff_fixture(
    report: &mut SharedOperatorResolutionDiffReport,
    fixture: OperatorProofResolutionDiffFixture,
) -> &'static str {
    match fixture {
        OperatorProofResolutionDiffFixture::MissingReport => {
            report.ok = false;
            report.audited_phase_count = 0;
            report.matched_phase_count = 0;
            report.drifted_phase_count = 0;
            report.skipped_phase_count = 0;
            report.diff_count = 0;
            report.first_drift_paths.clear();
            report.phases.clear();
            "missing"
        }
        OperatorProofResolutionDiffFixture::StaleReport => "stale",
        OperatorProofResolutionDiffFixture::DriftedReport => {
            report.ok = false;
            report.audited_phase_count = report.audited_phase_count.max(1);
            report.matched_phase_count = report.matched_phase_count.saturating_sub(1);
            report.drifted_phase_count = 1;
            report.skipped_phase_count = 0;
            report.diff_count = 1;
            report.first_drift_paths = vec![SharedOperatorResolutionDiffPath {
                phase_id: "D01".to_string(),
                run_id: "resolution:D01".to_string(),
                envelope: "applied".to_string(),
                path: "$.winner".to_string(),
            }];
            report.phases = vec![resolution_diff_phase_fixture(false)];
            "drifted"
        }
        OperatorProofResolutionDiffFixture::MatchedReport => {
            report.ok = true;
            report.audited_phase_count = report.audited_phase_count.max(1);
            report.matched_phase_count = report.audited_phase_count;
            report.drifted_phase_count = 0;
            report.skipped_phase_count = 0;
            report.diff_count = 0;
            report.first_drift_paths.clear();
            if report.phases.is_empty() {
                report.phases.push(resolution_diff_phase_fixture(true));
            }
            for phase in &mut report.phases {
                phase.status = "matched".to_string();
                phase.applied_matches = true;
                phase.trace_matches = true;
                phase.diff_count = 0;
                phase.reason = None;
                phase.diffs.clear();
            }
            "trusted"
        }
    }
}

fn resolution_diff_phase_fixture(matched: bool) -> SharedOperatorResolutionDiffPhase {
    SharedOperatorResolutionDiffPhase {
        phase_id: "D01".to_string(),
        run_id: "resolution:D01".to_string(),
        status: if matched { "matched" } else { "drifted" }.to_string(),
        applied_matches: matched,
        trace_matches: true,
        diff_count: usize::from(!matched),
        reason: (!matched).then(|| "fixture drift".to_string()),
        diffs: (!matched)
            .then(|| {
                vec![SharedOperatorResolutionDiff {
                    envelope: "applied".to_string(),
                    path: "$.winner".to_string(),
                    expected: serde_json::json!("slot_1"),
                    actual: serde_json::json!("slot_2"),
                }]
            })
            .unwrap_or_default(),
    }
}

fn resolution_diff_fixture_label(fixture: OperatorProofResolutionDiffFixture) -> &'static str {
    match fixture {
        OperatorProofResolutionDiffFixture::MissingReport => "missing-report",
        OperatorProofResolutionDiffFixture::StaleReport => "stale-report",
        OperatorProofResolutionDiffFixture::DriftedReport => "drifted-report",
        OperatorProofResolutionDiffFixture::MatchedReport => "matched-report",
    }
}

fn load_operator_proof_trace_inspection_response(
    fixture: Option<OperatorProofTraceInspectionFixture>,
) -> Result<OperatorProofTraceInspectionResponse, ApiError> {
    let mut report: SharedOperatorTraceInspectionReport =
        read_workspace_json_as(OPERATOR_PROOF_TRACE_INSPECTION_REPORT_PATH)?;
    let mut artifact_state = if report.ok && report.trace_count > 0 {
        "trusted"
    } else {
        "drifted"
    };
    if let Some(fixture) = fixture {
        artifact_state = apply_trace_inspection_fixture(&mut report, fixture);
    }
    Ok(OperatorProofTraceInspectionResponse {
        report,
        fixture: fixture.map(trace_inspection_fixture_label),
        artifact_state,
    })
}

fn apply_trace_inspection_fixture(
    report: &mut SharedOperatorTraceInspectionReport,
    fixture: OperatorProofTraceInspectionFixture,
) -> &'static str {
    match fixture {
        OperatorProofTraceInspectionFixture::MissingReport => {
            report.ok = false;
            clear_trace_inspection_report(report);
            "missing"
        }
        OperatorProofTraceInspectionFixture::StaleReport => "stale",
        OperatorProofTraceInspectionFixture::MalformedReport => {
            report.ok = false;
            clear_trace_inspection_report(report);
            "malformed"
        }
        OperatorProofTraceInspectionFixture::FilteredRun => {
            report.ok = true;
            report.trace_count = 1;
            report.traces = vec![trace_inspection_run_fixture("filtered:run", true)];
            recompute_trace_inspection_counts(report);
            "trusted"
        }
        OperatorProofTraceInspectionFixture::EmptyTrace => {
            report.ok = false;
            clear_trace_inspection_report(report);
            "drifted"
        }
    }
}

fn clear_trace_inspection_report(report: &mut SharedOperatorTraceInspectionReport) {
    report.trace_count = 0;
    report.decision_count = 0;
    report.edge_count = 0;
    report.generated_count = 0;
    report.effect_change_count = 0;
    report.visibility_count = 0;
    report.note_count = 0;
    report.traces.clear();
}

fn recompute_trace_inspection_counts(report: &mut SharedOperatorTraceInspectionReport) {
    report.trace_count = report.traces.len();
    report.decision_count = report.traces.iter().map(|trace| trace.decision_count).sum();
    report.edge_count = report.traces.iter().map(|trace| trace.edge_count).sum();
    report.generated_count = report
        .traces
        .iter()
        .map(|trace| trace.generated_count)
        .sum();
    report.effect_change_count = report
        .traces
        .iter()
        .map(|trace| trace.effect_change_count)
        .sum();
    report.visibility_count = report
        .traces
        .iter()
        .map(|trace| trace.visibility_count)
        .sum();
    report.note_count = report.traces.iter().map(|trace| trace.note_count).sum();
}

fn trace_inspection_run_fixture(
    run_id: &str,
    include_rows: bool,
) -> SharedOperatorTraceInspectionRun {
    SharedOperatorTraceInspectionRun {
        phase_id: "N01".to_string(),
        run_id: run_id.to_string(),
        applied_stream_seq: Some(14),
        trace_stream_seq: 15,
        trace_version: 1,
        decision_count: usize::from(include_rows),
        edge_count: usize::from(include_rows),
        generated_count: usize::from(include_rows),
        effect_change_count: usize::from(include_rows),
        visibility_count: 0,
        note_count: usize::from(include_rows),
        decisions: include_rows
            .then(|| vec![serde_json::json!({"stage": "resolve", "outcome": "applied"})])
            .unwrap_or_default(),
        edges: include_rows
            .then(|| vec![serde_json::json!({"from": "slot_1", "to": "slot_2", "kind": "visit"})])
            .unwrap_or_default(),
        generated: include_rows
            .then(|| vec![serde_json::json!({"action_id": "generated:1", "actor": "slot_1"})])
            .unwrap_or_default(),
        effect_changes: include_rows
            .then(|| vec![serde_json::json!({"effect": "dead", "target": "slot_2"})])
            .unwrap_or_default(),
        visibility: Vec::new(),
        notes: include_rows
            .then(|| vec![serde_json::json!({"note": "fixture trace"})])
            .unwrap_or_default(),
    }
}

fn trace_inspection_fixture_label(fixture: OperatorProofTraceInspectionFixture) -> &'static str {
    match fixture {
        OperatorProofTraceInspectionFixture::MissingReport => "missing-report",
        OperatorProofTraceInspectionFixture::StaleReport => "stale-report",
        OperatorProofTraceInspectionFixture::MalformedReport => "malformed-report",
        OperatorProofTraceInspectionFixture::FilteredRun => "filtered-run",
        OperatorProofTraceInspectionFixture::EmptyTrace => "empty-trace",
    }
}

fn load_operator_proof_large_action_graph_performance_response(
    fixture: Option<OperatorProofLargeActionGraphPerformanceFixture>,
) -> Result<OperatorProofLargeActionGraphPerformanceResponse, ApiError> {
    let mut report: SharedOperatorLargeActionGraphPerformanceReport =
        read_workspace_json_as(OPERATOR_PROOF_LARGE_ACTION_GRAPH_PERFORMANCE_REPORT_PATH)?;
    let mut artifact_state = if report.ok && report.resolve_elapsed_ms <= report.threshold_ms {
        "trusted"
    } else {
        "drifted"
    };
    if let Some(fixture) = fixture {
        artifact_state = apply_large_action_graph_performance_fixture(&mut report, fixture);
    }
    Ok(OperatorProofLargeActionGraphPerformanceResponse {
        report,
        fixture: fixture.map(large_action_graph_performance_fixture_label),
        artifact_state,
    })
}

fn apply_large_action_graph_performance_fixture(
    report: &mut SharedOperatorLargeActionGraphPerformanceReport,
    fixture: OperatorProofLargeActionGraphPerformanceFixture,
) -> &'static str {
    match fixture {
        OperatorProofLargeActionGraphPerformanceFixture::MissingReport => {
            report.ok = false;
            report.roster_count = 0;
            report.submitted_action_count = 0;
            report.resolution_inner_event_count = 0;
            report.stream_event_count = 0;
            report.trace_row_count = 0;
            "missing"
        }
        OperatorProofLargeActionGraphPerformanceFixture::StaleReport => "stale",
        OperatorProofLargeActionGraphPerformanceFixture::ThresholdRegressed => {
            report.ok = false;
            report.resolve_elapsed_ms = report.threshold_ms.saturating_add(1);
            "drifted"
        }
        OperatorProofLargeActionGraphPerformanceFixture::RecoveredReport => {
            report.ok = true;
            report.resolve_elapsed_ms = report.resolve_elapsed_ms.min(report.threshold_ms);
            report.replay_audit_ok = true;
            report.replay_audited = 1;
            report.replay_skipped = 0;
            report.projection_rebuild_ok = true;
            report.pgo_triggered = true;
            report.babysitter_death = true;
            report.hider_death = true;
            report.lovers_linked = true;
            "trusted"
        }
    }
}

fn large_action_graph_performance_fixture_label(
    fixture: OperatorProofLargeActionGraphPerformanceFixture,
) -> &'static str {
    match fixture {
        OperatorProofLargeActionGraphPerformanceFixture::MissingReport => "missing-report",
        OperatorProofLargeActionGraphPerformanceFixture::StaleReport => "stale-report",
        OperatorProofLargeActionGraphPerformanceFixture::ThresholdRegressed => {
            "threshold-regressed"
        }
        OperatorProofLargeActionGraphPerformanceFixture::RecoveredReport => "recovered-report",
    }
}

fn load_operator_proof_determinism_fuzz_response(
    fixture: Option<OperatorProofDeterminismFuzzFixture>,
) -> Result<OperatorProofDeterminismFuzzResponse, ApiError> {
    let mut report: SharedOperatorDeterminismFuzzReport =
        read_workspace_json_as(OPERATOR_PROOF_DETERMINISM_FUZZ_REPORT_PATH)?;
    let mut artifact_state = if report.ok
        && report.failed_family_count == 0
        && report.passed_family_count == report.family_count
    {
        "trusted"
    } else {
        "drifted"
    };
    if let Some(fixture) = fixture {
        artifact_state = apply_determinism_fuzz_fixture(&mut report, fixture);
    }
    Ok(OperatorProofDeterminismFuzzResponse {
        report,
        fixture: fixture.map(determinism_fuzz_fixture_label),
        artifact_state,
    })
}

fn apply_determinism_fuzz_fixture(
    report: &mut SharedOperatorDeterminismFuzzReport,
    fixture: OperatorProofDeterminismFuzzFixture,
) -> &'static str {
    match fixture {
        OperatorProofDeterminismFuzzFixture::MissingReport => {
            report.ok = false;
            report.family_count = 0;
            report.passed_family_count = 0;
            report.failed_family_count = 0;
            report.seed_count = 0;
            report.families.clear();
            "missing"
        }
        OperatorProofDeterminismFuzzFixture::StaleReport => "stale",
        OperatorProofDeterminismFuzzFixture::FailedSeed => {
            report.ok = false;
            report.failed_family_count = 1;
            report.passed_family_count = report.family_count.saturating_sub(1);
            report.first_failing_seed = Some(7101);
            if let Some(family) = report.families.get_mut(2) {
                family.status = SharedOperatorDeterminismFuzzFamilyStatus::Failed;
                family.first_failing_seed = Some(7101);
            } else {
                report.families = vec![determinism_fuzz_family_fixture(false)];
                report.family_count = 1;
                report.passed_family_count = 0;
            }
            "drifted"
        }
        OperatorProofDeterminismFuzzFixture::RecoveredReport => {
            report.ok = true;
            report.failed_family_count = 0;
            report.first_failing_seed = None;
            if report.families.is_empty() {
                report.families = vec![determinism_fuzz_family_fixture(true)];
            }
            for family in &mut report.families {
                family.status = SharedOperatorDeterminismFuzzFamilyStatus::Passed;
                family.first_failing_seed = None;
            }
            report.family_count = report.families.len();
            report.passed_family_count = report.family_count;
            report.seed_count = report.families.iter().map(|family| family.seed_count).sum();
            "trusted"
        }
    }
}

fn determinism_fuzz_family_fixture(passed: bool) -> SharedOperatorDeterminismFuzzFamily {
    SharedOperatorDeterminismFuzzFamily {
        id: "seeded-trigger-dependency".to_string(),
        selector: "seeded_trigger_dependency_graphs_replay_audit_and_rebuild_deterministically"
            .to_string(),
        pack: "mafiascum".to_string(),
        phase_scope: "N01".to_string(),
        seeds: vec![7101, 7202, 7303, 7404, 7505],
        seed_count: 5,
        status: if passed {
            SharedOperatorDeterminismFuzzFamilyStatus::Passed
        } else {
            SharedOperatorDeterminismFuzzFamilyStatus::Failed
        },
        first_failing_seed: (!passed).then_some(7101),
    }
}

fn determinism_fuzz_fixture_label(fixture: OperatorProofDeterminismFuzzFixture) -> &'static str {
    match fixture {
        OperatorProofDeterminismFuzzFixture::MissingReport => "missing-report",
        OperatorProofDeterminismFuzzFixture::StaleReport => "stale-report",
        OperatorProofDeterminismFuzzFixture::FailedSeed => "failed-seed",
        OperatorProofDeterminismFuzzFixture::RecoveredReport => "recovered-report",
    }
}

fn load_operator_proof_retention_response(
    fixture: Option<OperatorProofRetentionFixture>,
) -> Result<OperatorProofRetentionResponse, ApiError> {
    let mut report: SharedOperatorProofRunGoNoGoRetentionReport =
        read_workspace_json_as(OPERATOR_PROOF_RETENTION_REPORT_PATH)?;
    if let Some(fixture) = fixture {
        apply_retention_fixture(&mut report, fixture);
    }
    Ok(OperatorProofRetentionResponse {
        report,
        fixture: fixture.map(retention_fixture_label),
    })
}

fn apply_retention_fixture(
    report: &mut SharedOperatorProofRunGoNoGoRetentionReport,
    fixture: OperatorProofRetentionFixture,
) {
    match fixture {
        OperatorProofRetentionFixture::NewlyMissingArtifact => {
            report.recoveries.clear();
            report.regressions = vec![retention_change(
                "proof-run-checked-game-specific-audit-bundle",
                "target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json",
                "trusted",
                "missing",
                "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin prove_game_specific_audits -- --output target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json crates/commands/fixtures/night-passing.json",
            )];
        }
        OperatorProofRetentionFixture::StalePreviouslyTrusted => {
            report.recoveries.clear();
            report.regressions = vec![retention_change(
                "proof-run-game-specific-audit-artifact-retention",
                "target/operator-proof/game-specific-audit-bundle-20260613T001500Z.json",
                "trusted",
                "stale",
                "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin prove_game_specific_audits -- --compare-with target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json --output target/operator-proof/game-specific-audit-bundle-20260613T001500Z.json crates/commands/fixtures/night-passing.json",
            )];
        }
        OperatorProofRetentionFixture::RecoveredArtifact => {
            report.regressions.clear();
            report.recoveries = vec![retention_change(
                "proof-run-checked-game-specific-audit-bundle",
                "target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json",
                "missing",
                "trusted",
                "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin prove_game_specific_audits -- --output target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json crates/commands/fixtures/night-passing.json",
            )];
        }
    }
    report.ok = report.regressions.is_empty();
}

fn retention_change(
    row_id: &str,
    artifact_path: &str,
    previous_state: &str,
    latest_state: &str,
    command: &str,
) -> SharedOperatorProofRunGoNoGoRetentionChange {
    SharedOperatorProofRunGoNoGoRetentionChange {
        row_id: row_id.to_string(),
        artifact_path: artifact_path.to_string(),
        previous_state: previous_state.to_string(),
        latest_state: latest_state.to_string(),
        command: command.to_string(),
    }
}

fn retention_fixture_label(fixture: OperatorProofRetentionFixture) -> &'static str {
    match fixture {
        OperatorProofRetentionFixture::NewlyMissingArtifact => "newly-missing-artifact",
        OperatorProofRetentionFixture::StalePreviouslyTrusted => "stale-previously-trusted",
        OperatorProofRetentionFixture::RecoveredArtifact => "recovered-artifact",
    }
}

fn load_operator_proof_go_no_go_response(
    fixture: Option<OperatorProofGoNoGoFixture>,
) -> Result<OperatorProofGoNoGoResponse, ApiError> {
    let mut report: SharedOperatorProofRunGoNoGoReport =
        read_workspace_json_as(OPERATOR_PROOF_GO_NO_GO_REPORT_PATH)?;
    if let Some(fixture) = fixture {
        apply_go_no_go_fixture(&mut report, fixture);
    }
    Ok(OperatorProofGoNoGoResponse {
        report,
        fixture: fixture.map(go_no_go_fixture_label),
    })
}

fn apply_go_no_go_fixture(
    report: &mut SharedOperatorProofRunGoNoGoReport,
    fixture: OperatorProofGoNoGoFixture,
) {
    let state = match fixture {
        OperatorProofGoNoGoFixture::MissingProductionArtifact => "missing",
        OperatorProofGoNoGoFixture::StaleProductionArtifact => "stale",
        OperatorProofGoNoGoFixture::DriftedProductionArtifact => "drifted",
    };
    if let Some(row) = report.rows.iter_mut().find(|row| !row.fixture) {
        row.state = state.to_string();
    }
    recompute_go_no_go_counts(report);
}

fn go_no_go_fixture_label(fixture: OperatorProofGoNoGoFixture) -> &'static str {
    match fixture {
        OperatorProofGoNoGoFixture::MissingProductionArtifact => "missing-production-artifact",
        OperatorProofGoNoGoFixture::StaleProductionArtifact => "stale-production-artifact",
        OperatorProofGoNoGoFixture::DriftedProductionArtifact => "drifted-production-artifact",
    }
}

fn recompute_go_no_go_counts(report: &mut SharedOperatorProofRunGoNoGoReport) {
    let mut production = SharedOperatorProofRunArtifactCounts::default();
    let mut fixtures = SharedOperatorProofRunArtifactCounts::default();
    for row in &report.rows {
        let counts = if row.fixture {
            &mut fixtures
        } else {
            &mut production
        };
        record_go_no_go_state(counts, row.state.as_str());
    }
    report.production = production;
    report.fixtures = fixtures;
    report.ok = report.production.non_trusted == 0;
}

fn record_go_no_go_state(counts: &mut SharedOperatorProofRunArtifactCounts, state: &str) {
    counts.total_artifact_rows += 1;
    match state {
        "trusted" => counts.trusted += 1,
        "stale" => counts.stale += 1,
        "missing" => counts.missing += 1,
        "malformed" => counts.malformed += 1,
        "path_mismatch" => counts.path_mismatch += 1,
        "version_mismatch" => counts.version_mismatch += 1,
        "input_mismatch" => counts.input_mismatch += 1,
        "drifted" => counts.drifted += 1,
        _ => counts.malformed += 1,
    }
    counts.non_trusted = counts.total_artifact_rows.saturating_sub(counts.trusted);
}

fn load_operator_proof_status_audit_response(
    fixture: Option<OperatorProofStatusAuditFixture>,
) -> Result<OperatorProofStatusAuditResponse, ApiError> {
    if matches!(
        fixture,
        None | Some(OperatorProofStatusAuditFixture::SavedReportMalformed)
            | Some(OperatorProofStatusAuditFixture::SavedReportStale)
    ) {
        let report: SharedOperatorProofRunStatusAuditReport =
            read_workspace_json_as(OPERATOR_PROOF_STATUS_AUDIT_REPORT_PATH)?;
        let artifact = match fixture {
            Some(OperatorProofStatusAuditFixture::SavedReportMalformed) => {
                proof_run_artifact_status(
                    OPERATOR_PROOF_STATUS_AUDIT_REPORT_PATH,
                    ProofRunArtifactState::Malformed,
                )
            }
            Some(OperatorProofStatusAuditFixture::SavedReportStale) => proof_run_artifact_status(
                OPERATOR_PROOF_STATUS_AUDIT_REPORT_PATH,
                ProofRunArtifactState::Stale {
                    freshness: ProofRunArtifactFreshness {
                        modified_at_unix_seconds: 946_684_800,
                        age_seconds: 86_401,
                        max_age_seconds: proof_run_manifest().artifact_freshness_max_age_seconds,
                    },
                },
            ),
            _ => operator_proof_status_audit_report_artifact(),
        };
        return Ok(OperatorProofStatusAuditResponse { report, artifact });
    }
    let expected = read_workspace_json(OPERATOR_PROOF_STATUS_SNAPSHOT_PATH)?;
    let mut actual = read_workspace_json(OPERATOR_PROOF_STATUS_CURRENT_PATH)?;
    if matches!(
        fixture,
        Some(OperatorProofStatusAuditFixture::ArtifactStateDrift)
            | Some(OperatorProofStatusAuditFixture::SavedReportDrifted)
    ) {
        apply_operator_status_audit_drift_fixture(&mut actual);
    }
    let mut report = audit_operator_proof_status_values(
        OPERATOR_PROOF_STATUS_SNAPSHOT_PATH,
        expected,
        OPERATOR_PROOF_STATUS_CURRENT_PATH,
        actual,
    );
    report.artifact_path = OPERATOR_PROOF_STATUS_AUDIT_REPORT_PATH.to_string();
    let artifact = proof_run_artifact_status(
        OPERATOR_PROOF_STATUS_AUDIT_REPORT_PATH,
        ProofRunArtifactState::Drifted {
            diff_count: report.diffs.len(),
            freshness: ProofRunArtifactFreshness {
                modified_at_unix_seconds: 0,
                age_seconds: 0,
                max_age_seconds: proof_run_manifest().artifact_freshness_max_age_seconds,
            },
        },
    );
    Ok(OperatorProofStatusAuditResponse { report, artifact })
}

fn operator_proof_status_audit_report_artifact() -> SharedOperatorProofRunArtifactStatus {
    let manifest = proof_run_manifest();
    proof_run_artifact_status(
        OPERATOR_PROOF_STATUS_AUDIT_REPORT_PATH,
        proof_run_status_audit_report_artifact_state(
            OPERATOR_PROOF_STATUS_AUDIT_REPORT_PATH,
            OPERATOR_PROOF_STATUS_SNAPSHOT_PATH,
            OPERATOR_PROOF_STATUS_CURRENT_PATH,
            manifest.version,
            manifest.artifact_freshness_max_age_seconds,
        ),
    )
}

fn read_workspace_json_as<T: serde::de::DeserializeOwned>(path: &str) -> Result<T, ApiError> {
    let path_on_disk = FsPath::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path);
    let bytes = fs::read(&path_on_disk).map_err(|err| {
        internal_api_error(format!(
            "operator proof-run status audit could not read {path}: {err}"
        ))
    })?;
    serde_json::from_slice(&bytes).map_err(|err| {
        internal_api_error(format!(
            "operator proof-run status audit could not parse {path}: {err}"
        ))
    })
}

fn read_workspace_json(path: &str) -> Result<serde_json::Value, ApiError> {
    read_workspace_json_as(path)
}

fn apply_operator_status_audit_drift_fixture(actual: &mut serde_json::Value) {
    let Some(families) = actual["families"].as_array_mut() else {
        return;
    };
    for family in families {
        let Some(runs) = family["runs"].as_array_mut() else {
            continue;
        };
        for run in runs {
            if run["id"] == "checked-game-specific-audit-bundle" {
                run["artifact"]["state"] = serde_json::Value::String("missing".to_string());
                return;
            }
        }
    }
}

fn render_operator_proof_determinism_fuzz_html(
    game: Uuid,
    principal_user_id: &str,
    response: &OperatorProofDeterminismFuzzResponse,
) -> String {
    let status_class = if response.report.ok { "ok" } else { "drift" };
    let status_text = if response.report.ok {
        "passed"
    } else {
        "failed seed"
    };
    let mut html = String::new();
    html.push_str("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">");
    html.push_str("<title>Operator Determinism Fuzz Report</title>");
    html.push_str(
        "<style>\
         body{font-family:system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;margin:24px;color:#18202a;background:#f8fafc;}\
         main{max-width:1120px;margin:0 auto;}\
         h1{font-size:24px;margin:0 0 8px;}\
         h2{font-size:18px;margin:28px 0 12px;}\
         p{color:#516070;margin:0 0 18px;}\
         .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0 22px;}\
         .metric{background:#fff;border:1px solid #d8dee8;border-radius:6px;padding:10px 12px;}\
         .label{display:block;font-size:12px;color:#516070;text-transform:uppercase;}\
         .value{display:block;font-size:16px;font-weight:650;margin-top:4px;word-break:break-word;}\
         table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d8dee8;border-radius:6px;overflow:hidden;margin:0 0 20px;}\
         th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e7ebf1;padding:10px 12px;font-size:13px;}\
         th{background:#edf2f7;color:#334155;}\
         code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-word;}\
         .ok{color:#1f7a4d}.drift{color:#b42318}.detail{color:#516070}\
         </style>",
    );
    html.push_str("</head><body><main>");
    html.push_str("<h1>Operator Determinism Fuzz Report</h1>");
    html.push_str("<p>Read-only local evidence. This page reads a saved seeded scenario-family report and does not execute fuzz commands.</p>");
    html.push_str("<section class=\"meta\">");
    metric(&mut html, "Game", &game.to_string(), None);
    metric(&mut html, "Principal", principal_user_id, None);
    metric(&mut html, "Status", status_text, Some(status_class));
    metric(&mut html, "Artifact State", response.artifact_state, None);
    metric(&mut html, "Report", &response.report.artifact_path, None);
    metric(
        &mut html,
        "Families",
        &response.report.family_count.to_string(),
        None,
    );
    metric(
        &mut html,
        "Seeds",
        &response.report.seed_count.to_string(),
        None,
    );
    metric(
        &mut html,
        "Elapsed",
        &format!("{} ms", response.report.elapsed_ms),
        None,
    );
    if let Some(seed) = response.report.first_failing_seed {
        metric(
            &mut html,
            "First Failing Seed",
            &seed.to_string(),
            Some("drift"),
        );
    }
    if let Some(fixture) = response.fixture {
        metric(&mut html, "Fixture", fixture, None);
    }
    html.push_str("</section>");
    html.push_str("<h2>Command</h2><table><tbody><tr><td><code>");
    html_escape_into(&mut html, &response.report.command);
    html.push_str("</code></td></tr><tr><td class=\"detail\">");
    html_escape_into(&mut html, &response.report.proof_boundary);
    html.push_str("</td></tr></tbody></table>");
    html.push_str("<h2>Seed Families</h2><table><thead><tr><th>Family</th><th>Pack</th><th>Phase</th><th>Seeds</th><th>Status</th></tr></thead><tbody>");
    if response.report.families.is_empty() {
        html.push_str("<tr><td colspan=\"5\" class=\"detail\">No seed family rows.</td></tr>");
    }
    for family in &response.report.families {
        let family_status_class =
            if family.status == SharedOperatorDeterminismFuzzFamilyStatus::Passed {
                "ok"
            } else {
                "drift"
            };
        html.push_str("<tr><td><code>");
        html_escape_into(&mut html, &family.selector);
        html.push_str("</code></td><td>");
        html_escape_into(&mut html, &family.pack);
        html.push_str("</td><td>");
        html_escape_into(&mut html, &family.phase_scope);
        html.push_str("</td><td>");
        html_escape_into(&mut html, &format!("{:?}", family.seeds));
        html.push_str("</td><td class=\"");
        html.push_str(family_status_class);
        html.push_str("\">");
        html_escape_into(
            &mut html,
            &format!("{:?}", family.status).to_ascii_lowercase(),
        );
        if let Some(seed) = family.first_failing_seed {
            html.push_str(" seed ");
            html_escape_into(&mut html, &seed.to_string());
        }
        html.push_str("</td></tr>");
    }
    html.push_str("</tbody></table>");
    html.push_str("</main></body></html>");
    html
}

fn render_operator_proof_large_action_graph_performance_html(
    game: Uuid,
    principal_user_id: &str,
    response: &OperatorProofLargeActionGraphPerformanceResponse,
) -> String {
    let status_class = if response.report.ok
        && response.report.resolve_elapsed_ms <= response.report.threshold_ms
    {
        "ok"
    } else {
        "drift"
    };
    let status_text = if status_class == "ok" {
        "within ceiling"
    } else {
        "regressed"
    };
    let mut html = String::new();
    html.push_str("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">");
    html.push_str("<title>Operator Large Action Graph Performance Report</title>");
    html.push_str(
        "<style>\
         body{font-family:system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;margin:24px;color:#18202a;background:#f8fafc;}\
         main{max-width:1040px;margin:0 auto;}\
         h1{font-size:24px;margin:0 0 8px;}\
         h2{font-size:18px;margin:28px 0 12px;}\
         p{color:#516070;margin:0 0 18px;}\
         .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0 22px;}\
         .metric{background:#fff;border:1px solid #d8dee8;border-radius:6px;padding:10px 12px;}\
         .label{display:block;font-size:12px;color:#516070;text-transform:uppercase;}\
         .value{display:block;font-size:16px;font-weight:650;margin-top:4px;word-break:break-word;}\
         table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d8dee8;border-radius:6px;overflow:hidden;margin:0 0 20px;}\
         th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e7ebf1;padding:10px 12px;font-size:13px;}\
         th{background:#edf2f7;color:#334155;}\
         .ok{color:#1f7a4d}.drift{color:#b42318}\
         </style>",
    );
    html.push_str("</head><body><main>");
    html.push_str("<h1>Operator Large Action Graph Performance Report</h1>");
    html.push_str("<p>Read-only local evidence. This page reads the saved dense Mafiascum N01 performance artifact and does not execute the performance command.</p>");
    html.push_str("<section class=\"meta\">");
    metric(&mut html, "Game", &game.to_string(), None);
    metric(&mut html, "Principal", principal_user_id, None);
    metric(&mut html, "Status", status_text, Some(status_class));
    metric(&mut html, "Artifact State", response.artifact_state, None);
    metric(&mut html, "Report", &response.report.artifact_path, None);
    metric(
        &mut html,
        "Report Game",
        &response.report.game_id.to_string(),
        None,
    );
    metric(&mut html, "Pack", &response.report.pack, None);
    metric(&mut html, "Phase", &response.report.phase_id, None);
    metric(
        &mut html,
        "Elapsed",
        &format!("{} ms", response.report.resolve_elapsed_ms),
        Some(status_class),
    );
    metric(
        &mut html,
        "Ceiling",
        &format!("{} ms", response.report.threshold_ms),
        None,
    );
    if let Some(fixture) = response.fixture {
        metric(&mut html, "Fixture", fixture, None);
    }
    html.push_str("</section>");
    html.push_str("<h2>Graph Dimensions</h2><table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>");
    for (label, value) in [
        ("Roster slots", response.report.roster_count.to_string()),
        (
            "Submitted actions",
            response.report.submitted_action_count.to_string(),
        ),
        (
            "Resolution inner events",
            response.report.resolution_inner_event_count.to_string(),
        ),
        (
            "Stream events",
            response.report.stream_event_count.to_string(),
        ),
        ("Trace rows", response.report.trace_row_count.to_string()),
    ] {
        html.push_str("<tr><td>");
        html_escape_into(&mut html, label);
        html.push_str("</td><td>");
        html_escape_into(&mut html, &value);
        html.push_str("</td></tr>");
    }
    html.push_str("</tbody></table>");
    html.push_str(
        "<h2>Audit Gates</h2><table><thead><tr><th>Gate</th><th>Status</th></tr></thead><tbody>",
    );
    for (label, ok) in [
        ("Replay audit", response.report.replay_audit_ok),
        ("Projection rebuild", response.report.projection_rebuild_ok),
        ("PGO trigger exercised", response.report.pgo_triggered),
        (
            "Babysitter death exercised",
            response.report.babysitter_death,
        ),
        ("Hider death exercised", response.report.hider_death),
        ("Lovers link exercised", response.report.lovers_linked),
    ] {
        html.push_str("<tr><td>");
        html_escape_into(&mut html, label);
        html.push_str("</td><td class=\"");
        html.push_str(if ok { "ok" } else { "drift" });
        html.push_str("\">");
        html.push_str(if ok { "passed" } else { "failed" });
        html.push_str("</td></tr>");
    }
    html.push_str("</tbody></table>");
    html.push_str("</main></body></html>");
    html
}

fn render_operator_proof_trace_inspection_html(
    game: Uuid,
    principal_user_id: &str,
    response: &OperatorProofTraceInspectionResponse,
) -> String {
    let status_class = if response.report.ok { "ok" } else { "drift" };
    let status_text = if response.report.ok {
        "available"
    } else {
        "unavailable"
    };
    let mut html = String::new();
    html.push_str("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">");
    html.push_str("<title>Operator Trace Inspection Report</title>");
    html.push_str(
        "<style>\
         body{font-family:system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;margin:24px;color:#18202a;background:#f8fafc;}\
         main{max-width:1180px;margin:0 auto;}\
         h1{font-size:24px;margin:0 0 8px;}\
         h2{font-size:18px;margin:28px 0 12px;}\
         p{color:#516070;margin:0 0 18px;}\
         .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0 22px;}\
         .metric{background:#fff;border:1px solid #d8dee8;border-radius:6px;padding:10px 12px;}\
         .label{display:block;font-size:12px;color:#516070;text-transform:uppercase;}\
         .value{display:block;font-size:16px;font-weight:650;margin-top:4px;word-break:break-word;}\
         table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d8dee8;border-radius:6px;overflow:hidden;margin:0 0 20px;}\
         th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e7ebf1;padding:10px 12px;font-size:13px;}\
         th{background:#edf2f7;color:#334155;}\
         code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-word;}\
         .detail{color:#516070;}\
         .ok{color:#1f7a4d}.drift{color:#b42318}\
         </style>",
    );
    html.push_str("</head><body><main>");
    html.push_str("<h1>Operator Trace Inspection Report</h1>");
    html.push_str("<p>Read-only local evidence. This page reads a saved trace inspection report and does not execute trace commands.</p>");
    html.push_str("<section class=\"meta\">");
    metric(&mut html, "Game", &game.to_string(), None);
    metric(&mut html, "Principal", principal_user_id, None);
    metric(&mut html, "Status", status_text, Some(status_class));
    metric(&mut html, "Artifact State", response.artifact_state, None);
    metric(&mut html, "Report", &response.report.artifact_path, None);
    metric(
        &mut html,
        "Report Game",
        &response.report.game_id.to_string(),
        None,
    );
    metric(
        &mut html,
        "Traces",
        &response.report.trace_count.to_string(),
        None,
    );
    metric(
        &mut html,
        "Decisions",
        &response.report.decision_count.to_string(),
        None,
    );
    metric(
        &mut html,
        "Edges",
        &response.report.edge_count.to_string(),
        None,
    );
    metric(
        &mut html,
        "Generated",
        &response.report.generated_count.to_string(),
        None,
    );
    metric(
        &mut html,
        "Effects",
        &response.report.effect_change_count.to_string(),
        None,
    );
    metric(
        &mut html,
        "Notes",
        &response.report.note_count.to_string(),
        None,
    );
    metric(
        &mut html,
        "Fixture",
        response.fixture.unwrap_or("none"),
        None,
    );
    html.push_str("</section>");
    html.push_str("<h2>Trace Runs</h2>");
    if response.report.traces.is_empty() {
        html.push_str("<p class=\"detail\">No trace rows.</p>");
    } else {
        html.push_str("<table><thead><tr><th>Phase</th><th>Run</th><th>Version</th><th>Counts</th><th>Detail</th></tr></thead><tbody>");
        for trace in &response.report.traces {
            html.push_str("<tr><td><code>");
            html_escape_into(&mut html, &trace.phase_id);
            html.push_str("</code></td><td><code>");
            html_escape_into(&mut html, &trace.run_id);
            html.push_str("</code></td><td>");
            html_escape_into(&mut html, &trace.trace_version.to_string());
            html.push_str("</td><td><code>");
            html_escape_into(
                &mut html,
                &format!(
                    "decisions {}; edges {}; generated {}; effects {}; visibility {}; notes {}",
                    trace.decision_count,
                    trace.edge_count,
                    trace.generated_count,
                    trace.effect_change_count,
                    trace.visibility_count,
                    trace.note_count
                ),
            );
            html.push_str("</code></td><td><code>");
            html_escape_into(
                &mut html,
                &serde_json::to_string(&serde_json::json!({
                    "decisions": trace.decisions,
                    "edges": trace.edges,
                    "generated": trace.generated,
                    "effect_changes": trace.effect_changes,
                    "visibility": trace.visibility,
                    "notes": trace.notes
                }))
                .unwrap_or_else(|_| "{}".to_string()),
            );
            html.push_str("</code></td></tr>");
        }
        html.push_str("</tbody></table>");
    }
    html.push_str("</main></body></html>");
    html
}

fn render_operator_proof_resolution_diff_html(
    game: Uuid,
    principal_user_id: &str,
    response: &OperatorProofResolutionDiffResponse,
) -> String {
    let status_class = if response.report.ok { "ok" } else { "drift" };
    let status_text = if response.report.ok {
        "matched"
    } else {
        "drifted"
    };
    let mut html = String::new();
    html.push_str("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">");
    html.push_str("<title>Operator Resolution Diff Report</title>");
    html.push_str(
        "<style>\
         body{font-family:system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;margin:24px;color:#18202a;background:#f8fafc;}\
         main{max-width:1180px;margin:0 auto;}\
         h1{font-size:24px;margin:0 0 8px;}\
         h2{font-size:18px;margin:28px 0 12px;}\
         p{color:#516070;margin:0 0 18px;}\
         .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0 22px;}\
         .metric{background:#fff;border:1px solid #d8dee8;border-radius:6px;padding:10px 12px;}\
         .label{display:block;font-size:12px;color:#516070;text-transform:uppercase;}\
         .value{display:block;font-size:16px;font-weight:650;margin-top:4px;word-break:break-word;}\
         table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d8dee8;border-radius:6px;overflow:hidden;margin:0 0 20px;}\
         th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e7ebf1;padding:10px 12px;font-size:13px;}\
         th{background:#edf2f7;color:#334155;}\
         code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-word;}\
         .detail{color:#516070;}\
         .ok{color:#1f7a4d}.drift{color:#b42318}\
         </style>",
    );
    html.push_str("</head><body><main>");
    html.push_str("<h1>Operator Resolution Diff Report</h1>");
    html.push_str("<p>Read-only local evidence. This page reads a saved resolution replay diff report and does not execute replay commands.</p>");
    html.push_str("<section class=\"meta\">");
    metric(&mut html, "Game", &game.to_string(), None);
    metric(&mut html, "Principal", principal_user_id, None);
    metric(&mut html, "Status", status_text, Some(status_class));
    metric(&mut html, "Artifact State", response.artifact_state, None);
    metric(&mut html, "Report", &response.report.artifact_path, None);
    metric(
        &mut html,
        "Report Game",
        &response.report.game_id.to_string(),
        None,
    );
    metric(
        &mut html,
        "Audited",
        &response.report.audited_phase_count.to_string(),
        None,
    );
    metric(
        &mut html,
        "Matched",
        &response.report.matched_phase_count.to_string(),
        None,
    );
    metric(
        &mut html,
        "Drifted",
        &response.report.drifted_phase_count.to_string(),
        None,
    );
    metric(
        &mut html,
        "Skipped",
        &response.report.skipped_phase_count.to_string(),
        None,
    );
    metric(
        &mut html,
        "Diffs",
        &response.report.diff_count.to_string(),
        None,
    );
    metric(
        &mut html,
        "Fixture",
        response.fixture.unwrap_or("none"),
        None,
    );
    html.push_str("</section>");
    if !response.report.first_drift_paths.is_empty() {
        html.push_str("<h2>First Drift Paths</h2><table><thead><tr><th>Phase</th><th>Run</th><th>Envelope</th><th>Path</th></tr></thead><tbody>");
        for drift in &response.report.first_drift_paths {
            html.push_str("<tr><td><code>");
            html_escape_into(&mut html, &drift.phase_id);
            html.push_str("</code></td><td><code>");
            html_escape_into(&mut html, &drift.run_id);
            html.push_str("</code></td><td><code>");
            html_escape_into(&mut html, &drift.envelope);
            html.push_str("</code></td><td><code>");
            html_escape_into(&mut html, &drift.path);
            html.push_str("</code></td></tr>");
        }
        html.push_str("</tbody></table>");
    }
    html.push_str("<h2>Resolution Phases</h2>");
    if response.report.phases.is_empty() {
        html.push_str("<p class=\"detail\">No phase rows.</p>");
    } else {
        html.push_str("<table><thead><tr><th>Phase</th><th>Run</th><th>Status</th><th>Applied</th><th>Trace</th><th>Diffs</th><th>Detail</th></tr></thead><tbody>");
        for phase in &response.report.phases {
            html.push_str("<tr><td><code>");
            html_escape_into(&mut html, &phase.phase_id);
            html.push_str("</code></td><td><code>");
            html_escape_into(&mut html, &phase.run_id);
            html.push_str("</code></td><td><code>");
            html_escape_into(&mut html, &phase.status);
            html.push_str("</code></td><td><code>");
            html_escape_into(
                &mut html,
                if phase.applied_matches {
                    "matched"
                } else {
                    "drifted"
                },
            );
            html.push_str("</code></td><td><code>");
            html_escape_into(
                &mut html,
                if phase.trace_matches {
                    "matched"
                } else {
                    "drifted"
                },
            );
            html.push_str("</code></td><td>");
            html_escape_into(&mut html, &phase.diff_count.to_string());
            html.push_str("</td><td><code>");
            if phase.diffs.is_empty() {
                html.push_str("none");
            } else {
                html_escape_into(
                    &mut html,
                    &serde_json::to_string(&phase.diffs).unwrap_or_else(|_| "[]".to_string()),
                );
            }
            html.push_str("</code></td></tr>");
        }
        html.push_str("</tbody></table>");
    }
    html.push_str("</main></body></html>");
    html
}

fn render_operator_proof_projection_rebuild_html(
    game: Uuid,
    principal_user_id: &str,
    response: &OperatorProofProjectionRebuildResponse,
) -> String {
    let status_class = if response.report.ok { "ok" } else { "drift" };
    let status_text = if response.report.ok {
        "matched"
    } else {
        "drifted"
    };
    let mut html = String::new();
    html.push_str("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">");
    html.push_str("<title>Operator Projection Rebuild Report</title>");
    html.push_str(
        "<style>\
         body{font-family:system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;margin:24px;color:#18202a;background:#f8fafc;}\
         main{max-width:1180px;margin:0 auto;}\
         h1{font-size:24px;margin:0 0 8px;}\
         h2{font-size:18px;margin:28px 0 12px;}\
         p{color:#516070;margin:0 0 18px;}\
         .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0 22px;}\
         .metric{background:#fff;border:1px solid #d8dee8;border-radius:6px;padding:10px 12px;}\
         .label{display:block;font-size:12px;color:#516070;text-transform:uppercase;}\
         .value{display:block;font-size:16px;font-weight:650;margin-top:4px;word-break:break-word;}\
         table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d8dee8;border-radius:6px;overflow:hidden;margin:0 0 20px;}\
         th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e7ebf1;padding:10px 12px;font-size:13px;}\
         th{background:#edf2f7;color:#334155;}\
         code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-word;}\
         .detail{color:#516070;}\
         .ok{color:#1f7a4d}.drift{color:#b42318}\
         </style>",
    );
    html.push_str("</head><body><main>");
    html.push_str("<h1>Operator Projection Rebuild Report</h1>");
    html.push_str("<p>Read-only local evidence. This page reads a saved rollback-only projection rebuild report and does not execute rebuild commands.</p>");
    html.push_str("<section class=\"meta\">");
    metric(&mut html, "Game", &game.to_string(), None);
    metric(&mut html, "Principal", principal_user_id, None);
    metric(&mut html, "Status", status_text, Some(status_class));
    metric(&mut html, "Artifact State", response.artifact_state, None);
    metric(&mut html, "Report", &response.report.artifact_path, None);
    metric(
        &mut html,
        "Report Game",
        &response.report.game_id.to_string(),
        None,
    );
    metric(&mut html, "Isolation", &response.report.isolation, None);
    metric(
        &mut html,
        "Tables",
        &response.report.table_count.to_string(),
        None,
    );
    metric(
        &mut html,
        "Matched",
        &response.report.matched_table_count.to_string(),
        None,
    );
    metric(
        &mut html,
        "Drifted",
        &response.report.drifted_table_count.to_string(),
        None,
    );
    metric(
        &mut html,
        "Fixture",
        response.fixture.unwrap_or("none"),
        None,
    );
    html.push_str("</section>");
    html.push_str("<h2>Projection Tables</h2>");
    if response.report.tables.is_empty() {
        html.push_str("<p class=\"detail\">No table rows.</p>");
    } else {
        html.push_str("<table><thead><tr><th>Table</th><th>Status</th><th>Before Rows</th><th>Rebuilt Rows</th><th>Diff Snapshot</th></tr></thead><tbody>");
        for table in &response.report.tables {
            html.push_str("<tr><td><code>");
            html_escape_into(&mut html, &table.table);
            html.push_str("</code></td><td><code>");
            html_escape_into(&mut html, if table.matches { "matched" } else { "drifted" });
            html.push_str("</code></td><td>");
            html_escape_into(&mut html, &table.before_rows.to_string());
            html.push_str("</td><td>");
            html_escape_into(&mut html, &table.rebuilt_rows.to_string());
            html.push_str("</td><td><code>");
            if table.matches {
                html.push_str("none");
            } else {
                html_escape_into(
                    &mut html,
                    &serde_json::to_string(&serde_json::json!({
                        "before": table.before,
                        "rebuilt": table.rebuilt
                    }))
                    .unwrap_or_else(|_| "{}".to_string()),
                );
            }
            html.push_str("</code></td></tr>");
        }
        html.push_str("</tbody></table>");
    }
    html.push_str("</main></body></html>");
    html
}

fn render_operator_proof_go_no_go_html(
    game: Uuid,
    principal_user_id: &str,
    response: &OperatorProofGoNoGoResponse,
) -> String {
    let status_class = if response.report.ok { "ok" } else { "drift" };
    let status_text = if response.report.ok { "go" } else { "no-go" };
    let mut html = String::new();
    html.push_str("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">");
    html.push_str("<title>Operator Proof Artifact Go/No-Go</title>");
    html.push_str(
        "<style>\
         body{font-family:system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;margin:24px;color:#18202a;background:#f8fafc;}\
         main{max-width:1180px;margin:0 auto;}\
         h1{font-size:24px;margin:0 0 8px;}\
         h2{font-size:18px;margin:28px 0 12px;}\
         p{color:#516070;margin:0 0 18px;}\
         .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0 22px;}\
         .metric{background:#fff;border:1px solid #d8dee8;border-radius:6px;padding:10px 12px;}\
         .label{display:block;font-size:12px;color:#516070;text-transform:uppercase;}\
         .value{display:block;font-size:16px;font-weight:650;margin-top:4px;word-break:break-word;}\
         table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d8dee8;border-radius:6px;overflow:hidden;margin:0 0 20px;}\
         th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e7ebf1;padding:10px 12px;font-size:13px;}\
         th{background:#edf2f7;color:#334155;}\
         code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-word;}\
         .detail{color:#516070;}\
         .ok{color:#1f7a4d}.drift{color:#b42318}\
         </style>",
    );
    html.push_str("</head><body><main>");
    html.push_str("<h1>Operator Proof Artifact Go/No-Go</h1>");
    html.push_str("<p>Read-only local evidence. This page reads a saved go/no-go report and does not execute proof commands.</p>");
    html.push_str("<section class=\"meta\">");
    metric(&mut html, "Game", &game.to_string(), None);
    metric(&mut html, "Principal", principal_user_id, None);
    metric(&mut html, "Status", status_text, Some(status_class));
    metric(
        &mut html,
        "Production",
        &shared_proof_run_summary_label(&response.report.production),
        None,
    );
    metric(
        &mut html,
        "Fixtures",
        &shared_proof_run_summary_label(&response.report.fixtures),
        None,
    );
    metric(&mut html, "Report", &response.report.artifact_path, None);
    metric(
        &mut html,
        "Fixture",
        response.fixture.unwrap_or("none"),
        None,
    );
    html.push_str("</section>");

    html.push_str("<h2>Artifact Rows</h2><table><thead><tr><th>Row</th><th>Scope</th><th>State</th><th>Artifact</th><th>Rerun Command</th></tr></thead><tbody>");
    for row in &response.report.rows {
        html.push_str("<tr id=\"");
        html_escape_into(&mut html, &row.row_id);
        html.push_str("\"><td><code>");
        html_escape_into(&mut html, &row.row_id);
        html.push_str("</code><br><span class=\"detail\">");
        html_escape_into(&mut html, &row.family);
        html.push_str("</span></td><td>");
        html_escape_into(&mut html, &row.scope);
        html.push_str("</td><td><code>");
        html_escape_into(&mut html, &row.state);
        html.push_str("</code></td><td><code>");
        html_escape_into(&mut html, &row.artifact_path);
        html.push_str("</code>");
        if let Some(metadata) = &row.trusted_metadata {
            let game_id = metadata.game_id.map(|game_id| game_id.to_string());
            render_optional_artifact_text(&mut html, "game_id", game_id.as_deref());
            render_optional_artifact_u64(
                &mut html,
                "manifest_version",
                metadata.manifest_version.map(u64::from),
            );
            render_optional_artifact_bool(
                &mut html,
                "retention_comparison.normalized_match",
                metadata.retention_comparison_normalized_match,
            );
            render_optional_artifact_u64(
                &mut html,
                "resolve_elapsed_ms",
                metadata.resolve_elapsed_ms,
            );
            render_optional_artifact_u64(&mut html, "threshold_ms", metadata.threshold_ms);
            render_optional_artifact_u64(&mut html, "trace_row_count", metadata.trace_row_count);
            render_optional_artifact_bool(
                &mut html,
                "phase_trace_anchored",
                metadata.phase_trace_anchored,
            );
            render_optional_artifact_bool(
                &mut html,
                "decision_trace_anchored",
                metadata.decision_trace_anchored,
            );
            render_optional_artifact_u64(
                &mut html,
                "projection_table_count",
                metadata.projection_table_count,
            );
            render_optional_artifact_u64(
                &mut html,
                "resolution_phase_count",
                metadata.resolution_phase_count,
            );
            render_optional_artifact_u64(&mut html, "family_count", metadata.family_count);
            render_optional_artifact_u64(&mut html, "seed_count", metadata.seed_count);
            render_optional_artifact_u64(
                &mut html,
                "expected_family_count",
                metadata.expected_family_count,
            );
            render_optional_artifact_u64(
                &mut html,
                "expected_seed_count",
                metadata.expected_seed_count,
            );
            render_optional_artifact_u64(&mut html, "case_count", metadata.case_count);
            render_optional_artifact_u64(
                &mut html,
                "expected_case_count",
                metadata.expected_case_count,
            );
            render_optional_artifact_u64(
                &mut html,
                "manifest_family_count",
                metadata.manifest_family_count,
            );
            render_optional_artifact_u64(
                &mut html,
                "manifest_case_count",
                metadata.manifest_case_count,
            );
            render_optional_artifact_u64(
                &mut html,
                "missing_family_count",
                metadata.missing_family_count,
            );
            render_optional_artifact_u64(
                &mut html,
                "unexpected_family_count",
                metadata.unexpected_family_count,
            );
            render_optional_artifact_u64(
                &mut html,
                "count_mismatch_count",
                metadata.count_mismatch_count,
            );
            render_optional_artifact_u64(
                &mut html,
                "evidence_failure_count",
                metadata.evidence_failure_count,
            );
            render_optional_artifact_bool(
                &mut html,
                "family_manifest_matched",
                metadata.family_manifest_matched,
            );
            render_optional_artifact_bool(&mut html, "gap_audit_ok", metadata.gap_audit_ok);
        }
        html.push_str("</td><td><code>");
        html_escape_into(&mut html, &row.command);
        html.push_str("</code></td></tr>");
    }
    html.push_str("</tbody></table>");
    html.push_str("</main></body></html>");
    html
}

fn render_operator_proof_retention_html(
    game: Uuid,
    principal_user_id: &str,
    response: &OperatorProofRetentionResponse,
) -> String {
    let status_class = if response.report.ok { "ok" } else { "drift" };
    let status_text = if response.report.ok {
        "matched"
    } else {
        "regressed"
    };
    let mut html = String::new();
    html.push_str("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">");
    html.push_str("<title>Operator Proof Artifact Retention</title>");
    html.push_str(
        "<style>\
         body{font-family:system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;margin:24px;color:#18202a;background:#f8fafc;}\
         main{max-width:1180px;margin:0 auto;}\
         h1{font-size:24px;margin:0 0 8px;}\
         h2{font-size:18px;margin:28px 0 12px;}\
         p{color:#516070;margin:0 0 18px;}\
         .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0 22px;}\
         .metric{background:#fff;border:1px solid #d8dee8;border-radius:6px;padding:10px 12px;}\
         .label{display:block;font-size:12px;color:#516070;text-transform:uppercase;}\
         .value{display:block;font-size:16px;font-weight:650;margin-top:4px;word-break:break-word;}\
         table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d8dee8;border-radius:6px;overflow:hidden;margin:0 0 20px;}\
         th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e7ebf1;padding:10px 12px;font-size:13px;}\
         th{background:#edf2f7;color:#334155;}\
         code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-word;}\
         .detail{color:#516070;}\
         .ok{color:#1f7a4d}.drift{color:#b42318}\
         </style>",
    );
    html.push_str("</head><body><main>");
    html.push_str("<h1>Operator Proof Artifact Retention</h1>");
    html.push_str("<p>Read-only local evidence. This page reads a saved retention comparison report and does not execute proof commands.</p>");
    html.push_str("<section class=\"meta\">");
    metric(&mut html, "Game", &game.to_string(), None);
    metric(&mut html, "Principal", principal_user_id, None);
    metric(&mut html, "Status", status_text, Some(status_class));
    metric(
        &mut html,
        "Regressions",
        &response.report.regressions.len().to_string(),
        None,
    );
    metric(
        &mut html,
        "Recoveries",
        &response.report.recoveries.len().to_string(),
        None,
    );
    metric(&mut html, "Report", &response.report.artifact_path, None);
    metric(&mut html, "Previous", &response.report.previous_path, None);
    metric(&mut html, "Latest", &response.report.latest_path, None);
    metric(
        &mut html,
        "Fixture",
        response.fixture.unwrap_or("none"),
        None,
    );
    html.push_str("</section>");
    render_retention_change_table(&mut html, "Regressions", &response.report.regressions);
    render_retention_change_table(&mut html, "Recoveries", &response.report.recoveries);
    html.push_str("</main></body></html>");
    html
}

fn render_retention_change_table(
    html: &mut String,
    heading: &str,
    rows: &[SharedOperatorProofRunGoNoGoRetentionChange],
) {
    html.push_str("<h2>");
    html_escape_into(html, heading);
    html.push_str("</h2>");
    if rows.is_empty() {
        html.push_str("<p class=\"detail\">No rows.</p>");
        return;
    }
    html.push_str("<table><thead><tr><th>Row</th><th>Artifact</th><th>Previous</th><th>Latest</th><th>Rerun Command</th></tr></thead><tbody>");
    for row in rows {
        html.push_str("<tr><td><code>");
        html_escape_into(html, &row.row_id);
        html.push_str("</code></td><td><code>");
        html_escape_into(html, &row.artifact_path);
        html.push_str("</code></td><td><code>");
        html_escape_into(html, &row.previous_state);
        html.push_str("</code></td><td><code>");
        html_escape_into(html, &row.latest_state);
        html.push_str("</code></td><td><code>");
        html_escape_into(html, &row.command);
        html.push_str("</code></td></tr>");
    }
    html.push_str("</tbody></table>");
}

fn render_operator_proof_status_audit_html(
    game: Uuid,
    principal_user_id: &str,
    fixture: Option<OperatorProofStatusAuditFixture>,
    response: &OperatorProofStatusAuditResponse,
) -> String {
    let report = &response.report;
    let status_class = if report.ok { "ok" } else { "drift" };
    let status_text = if report.ok { "matched" } else { "drifted" };
    let mut html = String::new();
    html.push_str("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">");
    html.push_str("<title>Operator Proof-Run Status Audit</title>");
    html.push_str(
        "<style>\
         body{font-family:system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;margin:24px;color:#18202a;background:#f8fafc;}\
         main{max-width:1180px;margin:0 auto;}\
         h1{font-size:24px;margin:0 0 8px;}\
         h2{font-size:18px;margin:28px 0 12px;}\
         p{color:#516070;margin:0 0 18px;}\
         .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0 22px;}\
         .metric{background:#fff;border:1px solid #d8dee8;border-radius:6px;padding:10px 12px;}\
         .label{display:block;font-size:12px;color:#516070;text-transform:uppercase;}\
         .value{display:block;font-size:16px;font-weight:650;margin-top:4px;word-break:break-word;}\
         table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d8dee8;border-radius:6px;overflow:hidden;margin:0 0 20px;}\
         th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e7ebf1;padding:10px 12px;font-size:13px;}\
         th{background:#edf2f7;color:#334155;}\
         code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-word;}\
         pre{white-space:pre-wrap;background:#111827;color:#f8fafc;border-radius:6px;padding:10px;margin:6px 0 0;}\
         .detail{color:#516070;}\
         .ok{color:#1f7a4d}.drift{color:#b42318}\
         </style>",
    );
    html.push_str("</head><body><main>");
    html.push_str("<h1>Operator Proof-Run Status Audit</h1>");
    html.push_str("<p>Read-only local evidence. This page reads a saved audit report and does not execute proof commands.</p>");
    html.push_str("<section class=\"meta\">");
    metric(&mut html, "Game", &game.to_string(), None);
    metric(&mut html, "Principal", principal_user_id, None);
    metric(&mut html, "Status", status_text, Some(status_class));
    metric(&mut html, "Diffs", &report.diffs.len().to_string(), None);
    metric(
        &mut html,
        "Report",
        OPERATOR_PROOF_STATUS_AUDIT_REPORT_PATH,
        None,
    );
    metric(&mut html, "Expected", &report.expected_path, None);
    metric(&mut html, "Actual", &report.actual_path, None);
    metric(
        &mut html,
        "Fixture",
        match fixture {
            Some(OperatorProofStatusAuditFixture::ArtifactStateDrift) => "artifact-state-drift",
            Some(OperatorProofStatusAuditFixture::SavedReportMalformed) => "saved-report-malformed",
            Some(OperatorProofStatusAuditFixture::SavedReportStale) => "saved-report-stale",
            Some(OperatorProofStatusAuditFixture::SavedReportDrifted) => "saved-report-drifted",
            None => "none",
        },
        None,
    );
    html.push_str("</section>");

    html.push_str("<h2>Report Artifact</h2><table><thead><tr><th>Path</th><th>Status</th></tr></thead><tbody><tr><td><code>");
    html_escape_into(&mut html, &response.artifact.path);
    html.push_str("</code></td><td class=\"detail\">");
    render_artifact_cell(&mut html, &response.artifact);
    html.push_str("</td></tr></tbody></table>");

    html.push_str("<h2>Normalized Fields</h2><table><thead><tr><th>Path</th></tr></thead><tbody>");
    for field in &report.normalized_fields {
        html.push_str("<tr><td><code>");
        html_escape_into(&mut html, field);
        html.push_str("</code></td></tr>");
    }
    html.push_str("</tbody></table>");

    html.push_str("<h2>Diffs</h2>");
    if report.diffs.is_empty() {
        html.push_str("<p class=\"detail\">No status audit drift.</p>");
    } else {
        html.push_str(
            "<table><thead><tr><th>Path</th><th>Expected</th><th>Actual</th></tr></thead><tbody>",
        );
        for diff in &report.diffs {
            html.push_str("<tr><td><code>");
            html_escape_into(&mut html, &diff.path);
            html.push_str("</code></td><td><pre>");
            html_escape_into(&mut html, &json_compact(&diff.expected));
            html.push_str("</pre></td><td><pre>");
            html_escape_into(&mut html, &json_compact(&diff.actual));
            html.push_str("</pre></td></tr>");
        }
        html.push_str("</tbody></table>");
    }
    html.push_str("</main></body></html>");
    html
}

fn json_compact(value: &serde_json::Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}

fn render_artifact_cell(html: &mut String, artifact: &SharedOperatorProofRunArtifactStatus) {
    html.push_str("<code>");
    html_escape_into(html, &artifact.path);
    html.push_str("</code>");
    match artifact.state {
        SharedOperatorProofRunArtifactStateKind::Missing => {
            html.push_str("<br><span>artifact not present locally</span>");
        }
        SharedOperatorProofRunArtifactStateKind::Malformed => {
            html.push_str("<br><span>artifact metadata unreadable</span>");
        }
        SharedOperatorProofRunArtifactStateKind::PathMismatch => {
            html.push_str("<br><span>artifact path mismatch</span><br><span>reported_path: ");
            html_escape_into(html, &artifact.reported_path.clone().unwrap_or_default());
            html.push_str("</span>");
        }
        SharedOperatorProofRunArtifactStateKind::VersionMismatch => {
            html.push_str(
                "<br><span>artifact manifest version incompatible</span><br><span>artifact_version: ",
            );
            html_escape_into(
                html,
                &artifact.artifact_version.unwrap_or_default().to_string(),
            );
            html.push_str("</span><br><span>expected_version: ");
            html_escape_into(
                html,
                &artifact.expected_version.unwrap_or_default().to_string(),
            );
            html.push_str("</span>");
        }
        SharedOperatorProofRunArtifactStateKind::InputMismatch => {
            html.push_str("<br><span>artifact input mismatch</span>");
            render_optional_artifact_text(html, "expected_path", artifact.expected_path.as_deref());
            render_optional_artifact_text(html, "actual_path", artifact.actual_path.as_deref());
            render_optional_artifact_text(
                html,
                "reported_expected_path",
                artifact.reported_expected_path.as_deref(),
            );
            render_optional_artifact_text(
                html,
                "reported_actual_path",
                artifact.reported_actual_path.as_deref(),
            );
        }
        SharedOperatorProofRunArtifactStateKind::Drifted => {
            html.push_str("<br><span>artifact drifted</span>");
            render_artifact_freshness(html, artifact);
            render_optional_artifact_u64(html, "diff_count", artifact.diff_count);
        }
        SharedOperatorProofRunArtifactStateKind::Stale => {
            html.push_str("<br><span>artifact stale</span>");
            render_artifact_freshness(html, artifact);
        }
        SharedOperatorProofRunArtifactStateKind::Trusted => {
            if let Some(artifact_version) = artifact.artifact_version {
                html.push_str("<br><span>artifact_version: ");
                html_escape_into(html, &artifact_version.to_string());
                html.push_str("</span>");
            }
            render_optional_artifact_text(html, "expected_path", artifact.expected_path.as_deref());
            render_optional_artifact_text(html, "actual_path", artifact.actual_path.as_deref());
            render_optional_artifact_u64(html, "diff_count", artifact.diff_count);
            if let Some(metadata) = &artifact.trusted_metadata {
                let game_id = metadata.game_id.map(|game_id| game_id.to_string());
                render_optional_artifact_text(html, "game_id", game_id.as_deref());
                render_optional_artifact_u64(
                    html,
                    "manifest_version",
                    metadata.manifest_version.map(u64::from),
                );
                render_optional_artifact_bool(
                    html,
                    "retention_comparison.normalized_match",
                    metadata.retention_comparison_normalized_match,
                );
                render_optional_artifact_u64(
                    html,
                    "resolve_elapsed_ms",
                    metadata.resolve_elapsed_ms,
                );
                render_optional_artifact_u64(html, "threshold_ms", metadata.threshold_ms);
                render_optional_artifact_u64(html, "trace_row_count", metadata.trace_row_count);
                render_optional_artifact_bool(
                    html,
                    "phase_trace_anchored",
                    metadata.phase_trace_anchored,
                );
                render_optional_artifact_bool(
                    html,
                    "decision_trace_anchored",
                    metadata.decision_trace_anchored,
                );
                render_optional_artifact_u64(
                    html,
                    "projection_table_count",
                    metadata.projection_table_count,
                );
                render_optional_artifact_u64(
                    html,
                    "resolution_phase_count",
                    metadata.resolution_phase_count,
                );
                render_optional_artifact_u64(html, "family_count", metadata.family_count);
                render_optional_artifact_u64(html, "seed_count", metadata.seed_count);
                render_optional_artifact_u64(
                    html,
                    "expected_family_count",
                    metadata.expected_family_count,
                );
                render_optional_artifact_u64(
                    html,
                    "expected_seed_count",
                    metadata.expected_seed_count,
                );
                render_optional_artifact_u64(html, "case_count", metadata.case_count);
                render_optional_artifact_u64(
                    html,
                    "expected_case_count",
                    metadata.expected_case_count,
                );
                render_optional_artifact_u64(
                    html,
                    "manifest_family_count",
                    metadata.manifest_family_count,
                );
                render_optional_artifact_u64(
                    html,
                    "manifest_case_count",
                    metadata.manifest_case_count,
                );
                render_optional_artifact_u64(
                    html,
                    "missing_family_count",
                    metadata.missing_family_count,
                );
                render_optional_artifact_u64(
                    html,
                    "unexpected_family_count",
                    metadata.unexpected_family_count,
                );
                render_optional_artifact_u64(
                    html,
                    "count_mismatch_count",
                    metadata.count_mismatch_count,
                );
                render_optional_artifact_u64(
                    html,
                    "evidence_failure_count",
                    metadata.evidence_failure_count,
                );
                render_optional_artifact_bool(
                    html,
                    "family_manifest_matched",
                    metadata.family_manifest_matched,
                );
                render_optional_artifact_bool(html, "gap_audit_ok", metadata.gap_audit_ok);
            }
            render_artifact_freshness(html, artifact);
        }
    }
}

fn render_optional_artifact_text(html: &mut String, label: &str, value: Option<&str>) {
    if let Some(value) = value {
        html.push_str("<br><span>");
        html_escape_into(html, label);
        html.push_str(": ");
        html_escape_into(html, value);
        html.push_str("</span>");
    }
}

fn render_optional_artifact_u64(html: &mut String, label: &str, value: Option<u64>) {
    if let Some(value) = value {
        html.push_str("<br><span>");
        html_escape_into(html, label);
        html.push_str(": ");
        html_escape_into(html, &value.to_string());
        html.push_str("</span>");
    }
}

fn render_optional_artifact_bool(html: &mut String, label: &str, value: Option<bool>) {
    if let Some(value) = value {
        html.push_str("<br><span>");
        html_escape_into(html, label);
        html.push_str(": ");
        html_escape_into(html, &value.to_string());
        html.push_str("</span>");
    }
}

fn render_artifact_freshness(html: &mut String, artifact: &SharedOperatorProofRunArtifactStatus) {
    if let Some(modified_at_unix_seconds) = artifact.modified_at_unix_seconds {
        html.push_str("<br><span>modified_at_unix_seconds: ");
        html_escape_into(html, &modified_at_unix_seconds.to_string());
        html.push_str("</span>");
    }
    if let Some(age_seconds) = artifact.age_seconds {
        html.push_str("<br><span>age_seconds: ");
        html_escape_into(html, &age_seconds.to_string());
        html.push_str("</span>");
    }
    if let Some(freshness_max_age_seconds) = artifact.freshness_max_age_seconds {
        html.push_str("<br><span>freshness_max_age_seconds: ");
        html_escape_into(html, &freshness_max_age_seconds.to_string());
        html.push_str("</span>");
    }
}

fn render_host_phase_controls_html(game: Uuid, controls: &[HostPhaseControl]) -> String {
    let mut html = String::new();
    html.push_str("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">");
    html.push_str("<title>Host Phase-Control Audit</title>");
    html.push_str(
        "<style>\
         body{font-family:system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;margin:24px;color:#18202a;background:#f8fafc;}\
         main{max-width:1180px;margin:0 auto;}\
         h1{font-size:24px;margin:0 0 8px;}\
         p{color:#516070;margin:0 0 18px;}\
         .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0;}\
         .metric{background:#fff;border:1px solid #d8dee8;border-radius:6px;padding:10px 12px;}\
         .label{display:block;font-size:12px;color:#516070;text-transform:uppercase;}\
         .value{display:block;font-size:18px;font-weight:650;margin-top:4px;}\
         table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d8dee8;border-radius:6px;overflow:hidden;}\
         th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e7ebf1;padding:8px 10px;font-size:13px;}\
         th{background:#edf2f7;color:#334155;}\
         code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;}\
         .empty{color:#64748b;}\
         </style>",
    );
    html.push_str("</head><body><main>");
    html.push_str("<h1>Host Phase-Control Audit</h1>");
    html.push_str("<p>Read-only prompt-driven phase movement rows folded from the event log.</p>");
    html.push_str("<section class=\"meta\">");
    metric(&mut html, "Game", &game.to_string(), None);
    metric(&mut html, "Rows", &controls.len().to_string(), None);
    html.push_str("</section>");

    if controls.is_empty() {
        html.push_str(
            "<p class=\"empty\">No host phase-control rows are stored for this game.</p>",
        );
    } else {
        html.push_str("<table><thead><tr>");
        html.push_str(
            "<th>Prompt</th><th>Reason</th><th>Movement</th><th>Resolved</th><th>Seq</th>",
        );
        html.push_str("</tr></thead><tbody>");
        for control in controls {
            html.push_str("<tr><td><code>");
            html_escape_into(&mut html, &control.prompt_id);
            html.push_str("</code><br>");
            html_escape_into(&mut html, &optional_str(control.prompt_kind.as_deref()));
            html.push_str("</td><td>");
            html_escape_into(&mut html, &optional_str(control.prompt_reason.as_deref()));
            html.push_str("<br><code>");
            html_escape_into(&mut html, &control.reason);
            html.push_str("</code></td><td><code>");
            html_escape_into(&mut html, &control.source_phase_id);
            html.push_str("</code> -> <code>");
            html_escape_into(&mut html, &control.target_phase_id);
            html.push_str("</code><br>skipped: <code>");
            html_escape_into(
                &mut html,
                &optional_str(control.skipped_phase_id.as_deref()),
            );
            html.push_str("</code></td><td>");
            html_escape_into(&mut html, &optional_str(control.resolved_by.as_deref()));
            html.push_str("<br>at: <code>");
            html_escape_into(&mut html, &optional_i64(control.resolved_at));
            html.push_str("</code></td><td>source: <code>");
            html_escape_into(&mut html, &control.source_seq.to_string());
            html.push_str("</code><br>stream: <code>");
            html_escape_into(&mut html, &control.stream_seq.to_string());
            html.push_str("</code><br>occurred: <code>");
            html_escape_into(&mut html, &control.occurred_at.to_string());
            html.push_str("</code></td></tr>");
        }
        html.push_str("</tbody></table>");
    }

    html.push_str("</main></body></html>");
    html
}

fn render_resolution_audit_html(report: &commands::ResolutionEnvelopeAuditReport) -> String {
    let status_class = if report.ok { "ok" } else { "drift" };
    let status_text = if report.ok { "matched" } else { "drifted" };
    let mut html = String::new();
    html.push_str("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">");
    html.push_str("<title>Resolution Replay Audit</title>");
    html.push_str(
        "<style>\
         body{font-family:system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;margin:24px;color:#18202a;background:#f8fafc;}\
         main{max-width:1180px;margin:0 auto;}\
         h1{font-size:24px;margin:0 0 8px;}\
         h2{font-size:18px;margin:28px 0 12px;}\
         .meta,.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0;}\
         .metric{background:#fff;border:1px solid #d8dee8;border-radius:6px;padding:10px 12px;}\
         .label{display:block;font-size:12px;color:#516070;text-transform:uppercase;}\
         .value{display:block;font-size:18px;font-weight:650;margin-top:4px;}\
         .ok{color:#1f7a4d}.drift{color:#b42318}.skipped{color:#7a5a00}\
         table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d8dee8;border-radius:6px;overflow:hidden;}\
         th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e7ebf1;padding:8px 10px;font-size:13px;}\
         th{background:#edf2f7;color:#334155;}\
         code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}\
         code{font-size:12px;}\
         pre{white-space:pre-wrap;word-break:break-word;background:#111827;color:#f8fafc;border-radius:6px;padding:10px;margin:6px 0 0;font-size:12px;}\
         .path-list{margin:8px 0 0;padding-left:18px;}\
         .audit-link{color:#0f5e9c;font-weight:650;text-decoration:none;}\
         .audit-link:hover{text-decoration:underline;}\
         .audit-diff{margin:0 0 12px;}\
         .audit-diff:last-child{margin-bottom:0;}\
         .audit-detail-link{display:inline-block;margin:0 8px 6px 0;}\
         .empty{color:#64748b;}\
         </style>",
    );
    html.push_str("</head><body><main>");
    html.push_str("<h1>Resolution Replay Audit</h1>");
    html.push_str("<section class=\"meta\">");
    metric(&mut html, "Game", &report.game_id.to_string(), None);
    metric(&mut html, "Status", status_text, Some(status_class));
    metric(&mut html, "Audited", &report.audited.to_string(), None);
    metric(
        &mut html,
        "Skipped",
        &report.skipped.to_string(),
        Some("skipped"),
    );
    html.push_str("</section>");

    html.push_str("<h2>Summary</h2><section class=\"summary\">");
    metric(
        &mut html,
        "Matched",
        &report.summary.matched.to_string(),
        Some("ok"),
    );
    metric(
        &mut html,
        "Drifted",
        &report.summary.drifted.to_string(),
        Some("drift"),
    );
    metric(
        &mut html,
        "Skipped",
        &report.summary.skipped.to_string(),
        Some("skipped"),
    );
    html.push_str("</section>");

    html.push_str("<h2>First Drift Paths</h2>");
    if report.summary.first_drift_paths.is_empty() {
        html.push_str("<p class=\"empty\">No drift paths.</p>");
    } else {
        html.push_str("<ol class=\"path-list\">");
        for path in &report.summary.first_drift_paths {
            html.push_str("<li>");
            if let Some(diff_id) = audit_summary_diff_id(report, path) {
                html.push_str("<a class=\"audit-link\" href=\"#");
                html_escape_into(&mut html, &diff_id);
                html.push_str("\">");
            }
            html.push_str("<code>");
            html_escape_into(&mut html, &path.phase_id);
            html.push_str(" / ");
            html_escape_into(&mut html, &path.run_id);
            html.push_str(" / ");
            html_escape_into(&mut html, &json_label(&path.envelope));
            html.push_str(" / ");
            html_escape_into(&mut html, &path.path);
            html.push_str("</code>");
            if audit_summary_diff_id(report, path).is_some() {
                html.push_str("</a>");
            }
            html.push_str("</li>");
        }
        html.push_str("</ol>");
    }

    html.push_str("<h2>Phases</h2><table><thead><tr>");
    html.push_str(
        "<th>Phase</th><th>Run</th><th>Status</th><th>Envelope Checks</th><th>Diffs</th>",
    );
    html.push_str("</tr></thead><tbody>");
    for (phase_index, phase) in report.phases.iter().enumerate() {
        let phase_row_id = audit_phase_row_id(phase_index);
        html.push_str("<tr id=\"");
        html_escape_into(&mut html, &phase_row_id);
        html.push_str("\"><td><a class=\"audit-link\" href=\"#");
        html_escape_into(&mut html, &phase_row_id);
        html.push_str("\"><code>");
        html_escape_into(&mut html, &phase.phase_id);
        html.push_str("</code></a></td><td><code>");
        html_escape_into(&mut html, &phase.run_id);
        html.push_str("</code></td><td class=\"");
        let phase_status = json_label(&phase.status);
        html_escape_into(&mut html, status_class_for(&phase_status));
        html.push_str("\">");
        html_escape_into(&mut html, &phase_status);
        html.push_str("</td><td>");
        html.push_str(if phase.applied_matches {
            "applied matched"
        } else {
            "applied drifted"
        });
        html.push_str("<br>");
        html.push_str(if phase.trace_matches {
            "trace matched"
        } else {
            "trace drifted"
        });
        if let Some(reason) = &phase.reason {
            html.push_str("<br><code>");
            html_escape_into(&mut html, reason);
            html.push_str("</code>");
        }
        html.push_str("</td><td>");
        if phase.diffs.is_empty() {
            html.push_str("<span class=\"empty\">No diffs.</span>");
        } else {
            for (diff_index, diff) in phase.diffs.iter().enumerate() {
                let diff_id = audit_diff_row_id(phase_index, diff_index);
                let expected_id = audit_diff_value_id(phase_index, diff_index, "expected");
                let actual_id = audit_diff_value_id(phase_index, diff_index, "actual");
                html.push_str("<section class=\"audit-diff\" id=\"");
                html_escape_into(&mut html, &diff_id);
                html.push_str("\"><a class=\"audit-link\" href=\"#");
                html_escape_into(&mut html, &diff_id);
                html.push_str("\"><code>");
                html_escape_into(&mut html, &json_label(&diff.envelope));
                html.push_str(" ");
                html_escape_into(&mut html, &diff.path);
                html.push_str("</code></a><br><a class=\"audit-link audit-detail-link\" href=\"#");
                html_escape_into(&mut html, &expected_id);
                html.push_str(
                    "\">expected JSON</a><a class=\"audit-link audit-detail-link\" href=\"#",
                );
                html_escape_into(&mut html, &actual_id);
                html.push_str("\">actual JSON</a><pre id=\"");
                html_escape_into(&mut html, &expected_id);
                html.push_str("\">expected:\n");
                html_escape_into(&mut html, &pretty_json(&diff.expected));
                html.push_str("</pre><pre id=\"");
                html_escape_into(&mut html, &actual_id);
                html.push_str("\">actual:\n");
                html_escape_into(&mut html, &pretty_json(&diff.actual));
                html.push_str("</pre></section>");
            }
        }
        html.push_str("</td></tr>");
    }
    html.push_str("</tbody></table></main></body></html>");
    html
}

fn render_projection_audit_html(report: &projections::ProjectionAuditReport) -> String {
    let status_class = if report.ok { "ok" } else { "drift" };
    let status_text = if report.ok { "matched" } else { "drifted" };
    let drifted = report.tables.iter().filter(|table| !table.matches).count();
    let mut html = String::new();
    html.push_str("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">");
    html.push_str("<title>Projection Rebuild Audit</title>");
    html.push_str(
        "<style>\
         body{font-family:system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;margin:24px;color:#18202a;background:#f8fafc;}\
         main{max-width:1180px;margin:0 auto;}\
         h1{font-size:24px;margin:0 0 8px;}\
         h2{font-size:18px;margin:28px 0 12px;}\
         .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0;}\
         .metric{background:#fff;border:1px solid #d8dee8;border-radius:6px;padding:10px 12px;}\
         .label{display:block;font-size:12px;color:#516070;text-transform:uppercase;}\
         .value{display:block;font-size:18px;font-weight:650;margin-top:4px;}\
         .ok{color:#1f7a4d}.drift{color:#b42318}.skipped{color:#7a5a00}\
         table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d8dee8;border-radius:6px;overflow:hidden;}\
         th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e7ebf1;padding:8px 10px;font-size:13px;}\
         th{background:#edf2f7;color:#334155;}\
         code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}\
         code{font-size:12px;}\
         pre{white-space:pre-wrap;word-break:break-word;background:#111827;color:#f8fafc;border-radius:6px;padding:10px;margin:6px 0 0;font-size:12px;}\
         .projection-link{color:#0f5e9c;font-weight:650;text-decoration:none;}\
         .projection-link:hover{text-decoration:underline;}\
         .projection-detail-link{display:inline-block;margin:0 8px 0 0;}\
         .empty{color:#64748b;}\
         </style>",
    );
    html.push_str("</head><body><main>");
    html.push_str("<h1>Projection Rebuild Audit</h1><section class=\"meta\">");
    metric(&mut html, "Game", &report.game_id.to_string(), None);
    metric(&mut html, "Status", status_text, Some(status_class));
    metric(&mut html, "Tables", &report.tables.len().to_string(), None);
    if let Some(first_drift_id) = projection_first_drift_table_id(report) {
        metric_link(
            &mut html,
            "Drifted",
            &drifted.to_string(),
            Some("drift"),
            &first_drift_id,
        );
    } else {
        metric(&mut html, "Drifted", &drifted.to_string(), Some("drift"));
    }
    html.push_str("</section>");

    html.push_str("<h2>Tables</h2><table><thead><tr>");
    html.push_str("<th>Table</th><th>Status</th><th>Rows</th><th>Drift</th>");
    html.push_str("</tr></thead><tbody>");
    for (table_index, table) in report.tables.iter().enumerate() {
        let row_class = if table.matches { "ok" } else { "drift" };
        let row_status = if table.matches { "matched" } else { "drifted" };
        let table_row_id = projection_table_row_id(table_index);
        html.push_str("<tr id=\"");
        html_escape_into(&mut html, &table_row_id);
        html.push_str("\"><td><a class=\"projection-link\" href=\"#");
        html_escape_into(&mut html, &table_row_id);
        html.push_str("\"><code>");
        html_escape_into(&mut html, &table.table);
        html.push_str("</code></a></td><td class=\"");
        html_escape_into(&mut html, row_class);
        html.push_str("\">");
        html_escape_into(&mut html, row_status);
        html.push_str("</td><td>");
        html_escape_into(
            &mut html,
            &format!(
                "before: {} / rebuilt: {}",
                table.before_rows, table.rebuilt_rows
            ),
        );
        html.push_str("</td><td>");
        if table.matches {
            html.push_str("<span class=\"empty\">No drift.</span>");
        } else {
            let before_id = projection_table_value_id(table_index, "before");
            let rebuilt_id = projection_table_value_id(table_index, "rebuilt");
            html.push_str("<section><a class=\"projection-link projection-detail-link\" href=\"#");
            html_escape_into(&mut html, &before_id);
            html.push_str("\"><code>before</code></a>");
            if let Some(before) = &table.before {
                json_pre_with_id(&mut html, &before_id, before);
            }
            html.push_str(
                "</section><section><a class=\"projection-link projection-detail-link\" href=\"#",
            );
            html_escape_into(&mut html, &rebuilt_id);
            html.push_str("\"><code>rebuilt</code></a>");
            if let Some(rebuilt) = &table.rebuilt {
                json_pre_with_id(&mut html, &rebuilt_id, rebuilt);
            }
            html.push_str("</section>");
        }
        html.push_str("</td></tr>");
    }
    html.push_str("</tbody></table></main></body></html>");
    html
}

fn render_resolution_trace_html(report: &commands::ResolutionTraceInspectionReport) -> String {
    let mut html = String::new();
    html.push_str("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">");
    html.push_str("<title>Resolution Trace Inspection</title>");
    html.push_str(
        "<style>\
         body{font-family:system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;margin:24px;color:#18202a;background:#f8fafc;}\
         main{max-width:1180px;margin:0 auto;}\
         h1{font-size:24px;margin:0 0 8px;}\
         h2{font-size:20px;margin:28px 0 10px;}\
         h3{font-size:16px;margin:20px 0 8px;}\
         .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0;}\
         .metric{background:#fff;border:1px solid #d8dee8;border-radius:6px;padding:10px 12px;}\
         .label{display:block;font-size:12px;color:#516070;text-transform:uppercase;}\
         .value{display:block;font-size:18px;font-weight:650;margin-top:4px;}\
         table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d8dee8;border-radius:6px;overflow:hidden;}\
         th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e7ebf1;padding:8px 10px;font-size:13px;}\
         th{background:#edf2f7;color:#334155;}\
         code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}\
         code{font-size:12px;}\
         pre{white-space:pre-wrap;word-break:break-word;background:#111827;color:#f8fafc;border-radius:6px;padding:10px;margin:0;font-size:12px;}\
         .trace-nav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px;}\
         .trace-nav a{color:#0f5e9c;font-size:13px;font-weight:650;text-decoration:none;background:#fff;border:1px solid #d8dee8;border-radius:6px;padding:6px 8px;}\
         .trace-nav a:hover{text-decoration:underline;}\
         .trace-graph td:first-child{font-weight:650;color:#334155;}\
         .row-link,.detail-link{color:#0f5e9c;font-weight:650;text-decoration:none;}\
         .row-link:hover,.detail-link:hover{text-decoration:underline;}\
         .detail-link{display:inline-block;margin:0 0 6px;}\
         .empty{color:#64748b;}\
         </style>",
    );
    html.push_str("</head><body><main>");
    html.push_str("<h1>Resolution Trace Inspection</h1><section class=\"meta\">");
    metric(&mut html, "Game", &report.game_id.to_string(), None);
    metric(&mut html, "Traces", &report.traces.len().to_string(), None);
    html.push_str("</section>");

    if report.traces.is_empty() {
        html.push_str("<p class=\"empty\">No stored resolution traces matched this query.</p>");
    }

    for run in &report.traces {
        let run_anchor = dom_id_fragment(&run.run_id);
        html.push_str("<section id=\"");
        html_escape_into(&mut html, &format!("trace-run-{run_anchor}"));
        html.push_str("\"><h2>");
        html_escape_into(&mut html, &run.phase_id);
        html.push_str(" / ");
        html_escape_into(&mut html, &run.run_id);
        html.push_str("</h2><section class=\"meta\">");
        metric(
            &mut html,
            "Applied Seq",
            &optional_i64(run.applied_stream_seq),
            None,
        );
        metric(
            &mut html,
            "Trace Seq",
            &run.trace_stream_seq.to_string(),
            None,
        );
        metric(
            &mut html,
            "Trace Version",
            &run.trace_version.to_string(),
            None,
        );
        metric(
            &mut html,
            "Decisions",
            &run.decisions.len().to_string(),
            None,
        );
        metric(&mut html, "Edges", &run.edges.len().to_string(), None);
        metric(
            &mut html,
            "Generated",
            &run.generated.len().to_string(),
            None,
        );
        metric(
            &mut html,
            "Effect Changes",
            &run.effect_changes.len().to_string(),
            None,
        );
        metric(
            &mut html,
            "Visibility",
            &run.visibility.len().to_string(),
            None,
        );
        html.push_str("</section>");

        html.push_str("<nav class=\"trace-nav\" aria-label=\"Trace sections\">");
        for (label, section) in [
            ("Trace Graph", "graph"),
            ("Decisions", "decisions"),
            ("Redirect Edges", "redirect-edges"),
            ("Generated Actions", "generated-actions"),
            ("Effect Changes", "effect-changes"),
            ("Visibility", "visibility"),
            ("Notes", "notes"),
        ] {
            html.push_str("<a href=\"#");
            html_escape_into(&mut html, &trace_section_id(&run_anchor, section));
            html.push_str("\">");
            html_escape_into(&mut html, label);
            html.push_str("</a>");
        }
        html.push_str("</nav>");
        render_trace_graph_navigation(&mut html, &run_anchor, run);

        html.push_str("<h3 id=\"");
        html_escape_into(&mut html, &trace_section_id(&run_anchor, "decisions"));
        html.push_str("\">Decisions</h3>");
        if run.decisions.is_empty() {
            html.push_str("<p class=\"empty\">No decisions.</p>");
        } else {
            html.push_str("<table><thead><tr><th>#</th><th>Event</th><th>Stage</th><th>Source</th><th>Outcome</th><th>Detail</th></tr></thead><tbody>");
            for row in &run.decisions {
                let row_id = trace_row_id(&run_anchor, "decision", row.row_index);
                let detail_id = trace_detail_id(&run_anchor, "decision", row.row_index);
                html.push_str("<tr id=\"");
                html_escape_into(&mut html, &row_id);
                html.push_str("\"><td><a class=\"row-link\" href=\"#");
                html_escape_into(&mut html, &row_id);
                html.push_str("\">");
                html_escape_into(&mut html, &row.row_index.to_string());
                html.push_str("</a></td><td>");
                html_escape_into(&mut html, &optional_usize(row.event_index));
                html.push_str("</td><td>");
                html_escape_into(&mut html, &row.stage);
                html.push_str("</td><td><code>");
                html_escape_into(&mut html, &row.source);
                html.push_str("</code></td><td>");
                html_escape_into(&mut html, &row.outcome);
                html.push_str("</td><td><a class=\"detail-link\" href=\"#");
                html_escape_into(&mut html, &detail_id);
                html.push_str("\">JSON detail</a>");
                json_pre_with_id(&mut html, &detail_id, &row.detail);
                html.push_str("</td></tr>");
            }
            html.push_str("</tbody></table>");
        }

        html.push_str("<h3 id=\"");
        html_escape_into(&mut html, &trace_section_id(&run_anchor, "redirect-edges"));
        html.push_str("\">Redirect Edges</h3>");
        if run.edges.is_empty() {
            html.push_str("<p class=\"empty\">No redirect edges.</p>");
        } else {
            html.push_str("<table><thead><tr><th>#</th><th>Kind</th><th>From</th><th>To</th><th>Detail</th></tr></thead><tbody>");
            for row in &run.edges {
                let row_id = trace_row_id(&run_anchor, "edge", row.row_index);
                let detail_id = trace_detail_id(&run_anchor, "edge", row.row_index);
                html.push_str("<tr id=\"");
                html_escape_into(&mut html, &row_id);
                html.push_str("\"><td><a class=\"row-link\" href=\"#");
                html_escape_into(&mut html, &row_id);
                html.push_str("\">");
                html_escape_into(&mut html, &row.row_index.to_string());
                html.push_str("</a></td><td>");
                html_escape_into(&mut html, &row.kind);
                html.push_str("</td><td><code>");
                html_escape_into(&mut html, &row.from);
                html.push_str("</code></td><td><code>");
                html_escape_into(&mut html, &row.to);
                html.push_str("</code></td><td><a class=\"detail-link\" href=\"#");
                html_escape_into(&mut html, &detail_id);
                html.push_str("\">JSON detail</a>");
                json_pre_with_id(&mut html, &detail_id, &row.detail);
                html.push_str("</td></tr>");
            }
            html.push_str("</tbody></table>");
        }

        html.push_str("<h3 id=\"");
        html_escape_into(
            &mut html,
            &trace_section_id(&run_anchor, "generated-actions"),
        );
        html.push_str("\">Generated Actions</h3>");
        if run.generated.is_empty() {
            html.push_str("<p class=\"empty\">No generated actions.</p>");
        } else {
            html.push_str("<table><thead><tr><th>#</th><th>Action</th><th>Source</th><th>Actor</th><th>Targets</th><th>Detail</th></tr></thead><tbody>");
            for row in &run.generated {
                let row_id = trace_row_id(&run_anchor, "generated", row.row_index);
                let detail_id = trace_detail_id(&run_anchor, "generated", row.row_index);
                html.push_str("<tr id=\"");
                html_escape_into(&mut html, &row_id);
                html.push_str("\"><td><a class=\"row-link\" href=\"#");
                html_escape_into(&mut html, &row_id);
                html.push_str("\">");
                html_escape_into(&mut html, &row.row_index.to_string());
                html.push_str("</a></td><td><code>");
                html_escape_into(&mut html, &row.action_id);
                html.push_str("</code></td><td><code>");
                html_escape_into(&mut html, &row.source);
                html.push_str("</code></td><td>");
                html_escape_into(&mut html, &row.actor);
                html.push_str("</td><td>");
                html_escape_into(&mut html, &row.targets.join(", "));
                html.push_str("</td><td><a class=\"detail-link\" href=\"#");
                html_escape_into(&mut html, &detail_id);
                html.push_str("\">JSON detail</a>");
                json_pre_with_id(&mut html, &detail_id, &row.detail);
                html.push_str("</td></tr>");
            }
            html.push_str("</tbody></table>");
        }

        html.push_str("<h3 id=\"");
        html_escape_into(&mut html, &trace_section_id(&run_anchor, "effect-changes"));
        html.push_str("\">Effect Changes</h3>");
        if run.effect_changes.is_empty() {
            html.push_str("<p class=\"empty\">No effect changes.</p>");
        } else {
            html.push_str("<table><thead><tr><th>#</th><th>Effect</th><th>Target</th><th>Operation</th><th>Detail</th></tr></thead><tbody>");
            for row in &run.effect_changes {
                let row_id = trace_row_id(&run_anchor, "effect", row.row_index);
                let detail_id = trace_detail_id(&run_anchor, "effect", row.row_index);
                html.push_str("<tr id=\"");
                html_escape_into(&mut html, &row_id);
                html.push_str("\"><td><a class=\"row-link\" href=\"#");
                html_escape_into(&mut html, &row_id);
                html.push_str("\">");
                html_escape_into(&mut html, &row.row_index.to_string());
                html.push_str("</a></td><td>");
                html_escape_into(&mut html, &row.effect);
                html.push_str("</td><td>");
                html_escape_into(&mut html, &row.target);
                html.push_str("</td><td>");
                html_escape_into(&mut html, &row.operation);
                html.push_str("</td><td><a class=\"detail-link\" href=\"#");
                html_escape_into(&mut html, &detail_id);
                html.push_str("\">JSON detail</a>");
                json_pre_with_id(&mut html, &detail_id, &row.detail);
                html.push_str("</td></tr>");
            }
            html.push_str("</tbody></table>");
        }

        html.push_str("<h3 id=\"");
        html_escape_into(&mut html, &trace_section_id(&run_anchor, "visibility"));
        html.push_str("\">Visibility</h3>");
        if run.visibility.is_empty() {
            html.push_str("<p class=\"empty\">No visibility rows.</p>");
        } else {
            html.push_str("<table><thead><tr><th>#</th><th>Event</th><th>Audience</th><th>Policy</th><th>Detail</th></tr></thead><tbody>");
            for row in &run.visibility {
                let row_id = trace_row_id(&run_anchor, "visibility", row.row_index);
                let detail_id = trace_detail_id(&run_anchor, "visibility", row.row_index);
                html.push_str("<tr id=\"");
                html_escape_into(&mut html, &row_id);
                html.push_str("\"><td><a class=\"row-link\" href=\"#");
                html_escape_into(&mut html, &row_id);
                html.push_str("\">");
                html_escape_into(&mut html, &row.row_index.to_string());
                html.push_str("</a></td><td>");
                html_escape_into(&mut html, &row.event_index.to_string());
                html.push_str("</td><td>");
                html_escape_into(&mut html, &row.audience.join(", "));
                html.push_str("</td><td>");
                html_escape_into(&mut html, &row.policy);
                html.push_str("</td><td><a class=\"detail-link\" href=\"#");
                html_escape_into(&mut html, &detail_id);
                html.push_str("\">JSON detail</a>");
                json_pre_with_id(&mut html, &detail_id, &row.detail);
                html.push_str("</td></tr>");
            }
            html.push_str("</tbody></table>");
        }

        html.push_str("<h3 id=\"");
        html_escape_into(&mut html, &trace_section_id(&run_anchor, "notes"));
        html.push_str("\">Notes</h3>");
        if run.notes.is_empty() {
            html.push_str("<p class=\"empty\">No notes.</p>");
        } else {
            html.push_str("<table><thead><tr><th>#</th><th>Note</th></tr></thead><tbody>");
            for row in &run.notes {
                let row_id = trace_row_id(&run_anchor, "note", row.row_index);
                html.push_str("<tr id=\"");
                html_escape_into(&mut html, &row_id);
                html.push_str("\"><td><a class=\"row-link\" href=\"#");
                html_escape_into(&mut html, &row_id);
                html.push_str("\">");
                html_escape_into(&mut html, &row.row_index.to_string());
                html.push_str("</a></td><td>");
                html_escape_into(&mut html, &row.note);
                html.push_str("</td></tr>");
            }
            html.push_str("</tbody></table>");
        }
        html.push_str("</section>");
    }

    html.push_str("</main></body></html>");
    html
}

fn render_trace_graph_navigation(
    html: &mut String,
    run_anchor: &str,
    run: &commands::ResolutionTraceInspectionRun,
) {
    html.push_str("<h3 id=\"");
    html_escape_into(html, &trace_section_id(run_anchor, "graph"));
    html.push_str("\">Trace Graph</h3>");
    if run.decisions.is_empty()
        && run.edges.is_empty()
        && run.generated.is_empty()
        && run.effect_changes.is_empty()
        && run.visibility.is_empty()
        && run.notes.is_empty()
    {
        html.push_str("<p class=\"empty\">No graph rows.</p>");
        return;
    }

    html.push_str("<table class=\"trace-graph\"><thead><tr><th>Kind</th><th>From</th><th>To</th><th>Row</th><th>Detail</th></tr></thead><tbody>");
    for row in &run.decisions {
        let row_id = trace_row_id(run_anchor, "decision", row.row_index);
        let detail_id = trace_detail_id(run_anchor, "decision", row.row_index);
        render_trace_graph_row(
            html,
            "decision",
            &optional_usize(row.event_index),
            &row.outcome,
            &row_id,
            Some(&detail_id),
        );
    }
    for row in &run.edges {
        let row_id = trace_row_id(run_anchor, "edge", row.row_index);
        let detail_id = trace_detail_id(run_anchor, "edge", row.row_index);
        render_trace_graph_row(
            html,
            &row.kind,
            &row.from,
            &row.to,
            &row_id,
            Some(&detail_id),
        );
    }
    for row in &run.generated {
        let row_id = trace_row_id(run_anchor, "generated", row.row_index);
        let detail_id = trace_detail_id(run_anchor, "generated", row.row_index);
        render_trace_graph_row(
            html,
            "generated",
            &row.source,
            &row.action_id,
            &row_id,
            Some(&detail_id),
        );
    }
    for row in &run.effect_changes {
        let row_id = trace_row_id(run_anchor, "effect", row.row_index);
        let detail_id = trace_detail_id(run_anchor, "effect", row.row_index);
        let to = format!("{}:{}", row.operation, row.effect);
        render_trace_graph_row(html, "effect", &row.target, &to, &row_id, Some(&detail_id));
    }
    for row in &run.visibility {
        let row_id = trace_row_id(run_anchor, "visibility", row.row_index);
        let detail_id = trace_detail_id(run_anchor, "visibility", row.row_index);
        render_trace_graph_row(
            html,
            "visibility",
            &format!("event:{}", row.event_index),
            &row.audience.join(", "),
            &row_id,
            Some(&detail_id),
        );
    }
    for row in &run.notes {
        let row_id = trace_row_id(run_anchor, "note", row.row_index);
        render_trace_graph_row(html, "note", "trace", &row.note, &row_id, None);
    }
    html.push_str("</tbody></table>");
}

fn render_trace_graph_row(
    html: &mut String,
    kind: &str,
    from: &str,
    to: &str,
    row_id: &str,
    detail_id: Option<&str>,
) {
    html.push_str("<tr><td>");
    html_escape_into(html, kind);
    html.push_str("</td><td><code>");
    html_escape_into(html, from);
    html.push_str("</code></td><td><code>");
    html_escape_into(html, to);
    html.push_str("</code></td><td><a class=\"row-link\" href=\"#");
    html_escape_into(html, row_id);
    html.push_str("\">row</a></td><td>");
    if let Some(detail_id) = detail_id {
        html.push_str("<a class=\"detail-link\" href=\"#");
        html_escape_into(html, detail_id);
        html.push_str("\">JSON detail</a>");
    } else {
        html.push_str("<span class=\"empty\">No JSON detail.</span>");
    }
    html.push_str("</td></tr>");
}

fn metric(html: &mut String, label: &str, value: &str, class: Option<&str>) {
    html.push_str("<div class=\"metric\"><span class=\"label\">");
    html_escape_into(html, label);
    html.push_str("</span><span class=\"value");
    if let Some(class) = class {
        html.push(' ');
        html_escape_into(html, class);
    }
    html.push_str("\">");
    html_escape_into(html, value);
    html.push_str("</span></div>");
}

fn metric_link(html: &mut String, label: &str, value: &str, class: Option<&str>, href: &str) {
    html.push_str("<div class=\"metric\"><span class=\"label\">");
    html_escape_into(html, label);
    html.push_str("</span><a class=\"value projection-link");
    if let Some(class) = class {
        html.push(' ');
        html_escape_into(html, class);
    }
    html.push_str("\" href=\"#");
    html_escape_into(html, href);
    html.push_str("\">");
    html_escape_into(html, value);
    html.push_str("</a></div>");
}

fn optional_i64(value: Option<i64>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "none".to_string())
}

fn optional_usize(value: Option<usize>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "none".to_string())
}

fn optional_str(value: Option<&str>) -> String {
    value.unwrap_or("none").to_string()
}

fn status_class_for(status: &str) -> &'static str {
    match status {
        "matched" => "ok",
        "drifted" => "drift",
        "skipped" => "skipped",
        _ => "",
    }
}

fn json_label<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| "unknown".to_string())
}

fn pretty_json(value: &serde_json::Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

fn json_pre_with_id(html: &mut String, id: &str, value: &serde_json::Value) {
    html.push_str("<pre id=\"");
    html_escape_into(html, id);
    html.push_str("\">");
    html_escape_into(html, &pretty_json(value));
    html.push_str("</pre>");
}

fn audit_summary_diff_id(
    report: &commands::ResolutionEnvelopeAuditReport,
    path: &commands::ResolutionEnvelopeAuditDriftPath,
) -> Option<String> {
    report
        .phases
        .iter()
        .enumerate()
        .find_map(|(phase_index, phase)| {
            if phase.phase_id != path.phase_id || phase.run_id != path.run_id {
                return None;
            }
            phase
                .diffs
                .iter()
                .enumerate()
                .find(|(_, diff)| diff.envelope == path.envelope && diff.path == path.path)
                .map(|(diff_index, _)| audit_diff_row_id(phase_index, diff_index))
        })
}

fn audit_phase_row_id(phase_index: usize) -> String {
    format!("audit-phase-row-{phase_index}")
}

fn audit_diff_row_id(phase_index: usize, diff_index: usize) -> String {
    format!("audit-diff-row-{phase_index}-{diff_index}")
}

fn audit_diff_value_id(phase_index: usize, diff_index: usize, side: &str) -> String {
    format!("audit-diff-{side}-{phase_index}-{diff_index}")
}

fn projection_first_drift_table_id(report: &projections::ProjectionAuditReport) -> Option<String> {
    report
        .tables
        .iter()
        .position(|table| !table.matches)
        .map(projection_table_row_id)
}

fn projection_table_row_id(table_index: usize) -> String {
    format!("projection-table-row-{table_index}")
}

fn projection_table_value_id(table_index: usize, side: &str) -> String {
    format!("projection-table-{side}-{table_index}")
}

fn trace_section_id(run_anchor: &str, section: &str) -> String {
    format!("trace-{section}-{run_anchor}")
}

fn trace_row_id(run_anchor: &str, kind: &str, row_index: usize) -> String {
    format!("trace-{kind}-row-{run_anchor}-{row_index}")
}

fn trace_detail_id(run_anchor: &str, kind: &str, row_index: usize) -> String {
    format!("trace-{kind}-detail-{run_anchor}-{row_index}")
}

fn dom_id_fragment(input: &str) -> String {
    input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

fn html_escape_into(out: &mut String, input: &str) {
    for ch in input.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
}

fn internal_api_error(message: impl Into<String>) -> ApiError {
    ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message: message.into(),
    }
}

fn command_api_error(reject: commands::Reject) -> ApiError {
    let status = match reject {
        commands::Reject::NotAuthorized | commands::Reject::NotHost => StatusCode::FORBIDDEN,
        commands::Reject::UnknownGame
        | commands::Reject::UnknownSlot
        | commands::Reject::UnknownPrompt => StatusCode::NOT_FOUND,
        _ => StatusCode::BAD_REQUEST,
    };
    let error = RejectCode::from(&reject);
    ApiError::Reject {
        status,
        error,
        message: reject.to_string(),
    }
}

#[derive(Debug)]
pub enum ApiError {
    Projection(projections::ProjectionError),
    Capability(caps::CapError),
    Db(sqlx::Error),
    Reject {
        status: StatusCode,
        error: RejectCode,
        message: String,
    },
}

impl From<projections::ProjectionError> for ApiError {
    fn from(err: projections::ProjectionError) -> Self {
        ApiError::Projection(err)
    }
}

impl From<caps::CapError> for ApiError {
    fn from(err: caps::CapError) -> Self {
        ApiError::Capability(err)
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        ApiError::Db(err)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let capacity_exhausted = match &self {
            ApiError::Projection(error) => projection_capacity_error(error),
            ApiError::Capability(error) => capability_capacity_error(error),
            ApiError::Db(error) => sqlx_capacity_error(error),
            ApiError::Reject { .. } => false,
        };
        if capacity_exhausted {
            let mut response = (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(RejectMsg {
                    error: RejectCode::Internal,
                    retryable: true,
                    message: "database capacity is temporarily unavailable; retry shortly"
                        .to_string(),
                }),
            )
                .into_response();
            response
                .headers_mut()
                .insert(RETRY_AFTER, HeaderValue::from_static("1"));
            return response;
        }

        let (status, error, message) = match self {
            ApiError::Projection(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                RejectCode::Internal,
                err.to_string(),
            ),
            ApiError::Capability(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                RejectCode::Internal,
                err.to_string(),
            ),
            ApiError::Db(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                RejectCode::Internal,
                err.to_string(),
            ),
            ApiError::Reject {
                status,
                error,
                message,
            } => (status, error, message),
        };
        (
            status,
            Json(RejectMsg {
                error,
                retryable: false,
                message,
            }),
        )
            .into_response()
    }
}

fn sqlx_capacity_error(error: &sqlx::Error) -> bool {
    match error {
        sqlx::Error::PoolTimedOut | sqlx::Error::PoolClosed => true,
        sqlx::Error::Database(error) => matches!(error.code().as_deref(), Some("57014" | "55P03")),
        _ => false,
    }
}

fn projection_capacity_error(error: &projections::ProjectionError) -> bool {
    match error {
        projections::ProjectionError::Db(error) => sqlx_capacity_error(error),
        projections::ProjectionError::Store(eventstore::StoreError::Db(error)) => {
            sqlx_capacity_error(error)
        }
        _ => false,
    }
}

fn capability_capacity_error(error: &caps::CapError) -> bool {
    match error {
        caps::CapError::Db(error) => sqlx_capacity_error(error),
        caps::CapError::Projection(error) => projection_capacity_error(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use commands::operator_proof::{
        proof_run_artifact_state_at, proof_run_artifact_status,
        proof_run_command_placeholder_errors, proof_run_command_placeholders, proof_run_manifest,
        proof_run_row_id, proof_run_summary, render_proof_run_command,
        OperatorProofRunArtifactStatus, OperatorProofRunStatus, OperatorProofRunStatusFamily,
        OperatorProofRunStatusRow, ProofRunArtifactFreshness, ProofRunArtifactState,
        ProofRunManifest, ProofRunSpec, PROOF_RUN_STATUS_CONTRACT_VERSION,
    };

    #[test]
    fn database_pool_timeout_is_a_retryable_503() {
        let response = ApiError::Projection(projections::ProjectionError::Store(
            eventstore::StoreError::Db(sqlx::Error::PoolTimedOut),
        ))
        .into_response();

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.headers()[RETRY_AFTER], "1");
    }
    use std::{collections::HashSet, env, fs, path::Path as FsPath, time::SystemTime};

    const COMMANDS_PIPELINE_RS: &str = include_str!("../../commands/tests/pipeline.rs");
    const ENGINE_AND_PACKS_MD: &str = include_str!("../../../docs/arch/09-engine-and-packs.md");
    const ENGINE_PORT_CHECKLIST_MD: &str =
        include_str!("../../../docs/arch/11-engine-port-checklist.md");

    #[test]
    fn proof_run_manifest_test_selectors_exist_in_commands_pipeline() {
        let manifest = proof_run_manifest();
        assert_eq!(manifest.version, 1);
        assert!(
            manifest.artifact_freshness_max_age_seconds > 0,
            "artifact freshness ceiling should be positive"
        );
        assert!(
            !manifest.families.is_empty(),
            "proof-run manifest should expose at least one family"
        );

        let mut selector_count = 0;
        let mut ids = HashSet::new();
        for family in &manifest.families {
            assert!(!family.heading.trim().is_empty(), "family heading required");
            assert!(
                !family.runs.is_empty(),
                "family {} should list at least one run",
                family.heading
            );
            for run in &family.runs {
                assert!(!run.id.trim().is_empty(), "run id required");
                assert!(
                    run.id
                        .chars()
                        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-'),
                    "proof-run id {} must use lowercase ascii, digits, and hyphens only",
                    run.id
                );
                assert!(
                    ids.insert(run.id.clone()),
                    "duplicate proof-run id {}",
                    run.id
                );
                assert!(!run.family.trim().is_empty(), "run family required");
                assert!(!run.scope.trim().is_empty(), "run scope required");
                assert!(
                    !run.command_template.trim().is_empty(),
                    "run command template required for {}",
                    run.family
                );
                assert!(
                    matches!(run.scope.as_str(), "Game-specific" | "Local-only"),
                    "unknown proof-run scope {} for {}",
                    run.scope,
                    run.family
                );
                let placeholders = proof_run_command_placeholders(&run.command_template);
                let placeholder_errors =
                    proof_run_command_placeholder_errors(&run.command_template);
                assert!(
                    placeholder_errors.is_empty(),
                    "invalid command template placeholders for {}: {}",
                    run.family,
                    placeholder_errors.join(", ")
                );
                if run.scope == "Game-specific" {
                    assert!(
                        placeholders.iter().any(|placeholder| placeholder == "game"),
                        "game-specific proof run {} must include {{game}}",
                        run.family
                    );
                } else {
                    assert!(
                        !placeholders.iter().any(|placeholder| placeholder == "game"),
                        "local-only proof run {} must not include {{game}}",
                        run.family
                    );
                }
                if run.command_template.contains(" cargo test ") {
                    assert!(
                        run.test_selector.is_some(),
                        "cargo test proof run {} must declare test_selector",
                        run.family
                    );
                }
                assert!(
                    !run.proof_boundary.trim().is_empty(),
                    "proof boundary required for {}",
                    run.family
                );
                if let Some(artifact_path) = &run.artifact_path {
                    assert_eq!(
                        run.scope, "Local-only",
                        "artifact path should only be listed for local-only proof runs"
                    );
                    assert!(
                        !artifact_path.contains('{') && !artifact_path.contains('}'),
                        "artifact path for {} must not contain placeholders",
                        run.family
                    );
                    assert!(
                        !FsPath::new(artifact_path).is_absolute(),
                        "artifact path for {} must be workspace-relative",
                        run.family
                    );
                    assert!(
                        run.command_template.contains(artifact_path),
                        "command template for {} must write listed artifact path",
                        run.family
                    );
                    assert_proof_run_artifact_doc_truth(run, artifact_path, &manifest);
                }
                if let Some(selector) = &run.test_selector {
                    selector_count += 1;
                    assert!(
                        run.command_template.contains(selector),
                        "command template should contain selector {selector}"
                    );
                    let async_fn = format!("async fn {selector}(");
                    assert!(
                        COMMANDS_PIPELINE_RS.contains(&async_fn),
                        "proof-run selector {selector} must exist in crates/commands/tests/pipeline.rs"
                    );
                }
            }
        }

        assert!(
            selector_count >= 1,
            "manifest should validate at least one cargo test selector"
        );
    }

    fn assert_proof_run_artifact_doc_truth(
        run: &ProofRunSpec,
        artifact_path: &str,
        manifest: &ProofRunManifest,
    ) {
        let rendered_command = render_proof_run_command(
            &run.command_template,
            Uuid::from_u128(0),
            &manifest.database_url_example,
        );
        for (doc_name, doc) in [
            ("docs/arch/09-engine-and-packs.md", ENGINE_AND_PACKS_MD),
            (
                "docs/arch/11-engine-port-checklist.md",
                ENGINE_PORT_CHECKLIST_MD,
            ),
        ] {
            assert!(
                doc.contains(&run.id),
                "{doc_name} should mention proof-run id {}",
                run.id
            );
            assert!(
                doc.contains(artifact_path),
                "{doc_name} should mention artifact path {artifact_path}"
            );
            assert!(
                normalized_contains(doc, &rendered_command),
                "{doc_name} should mention rendered command {rendered_command}"
            );
            assert!(
                normalized_contains(doc, &run.proof_boundary),
                "{doc_name} should mention proof boundary for {}",
                run.id
            );
            assert!(
                doc.contains("artifact state `trusted`"),
                "{doc_name} should record current trusted artifact state"
            );
            assert!(
                doc.contains("production.trusted = 13")
                    && doc.contains("production.non_trusted = 0"),
                "{doc_name} should record production artifact go/no-go counts"
            );
        }
    }

    fn normalized_contains(haystack: &str, needle: &str) -> bool {
        let normalize = |text: &str| text.split_whitespace().collect::<Vec<_>>().join(" ");
        normalize(haystack).contains(&normalize(needle))
    }

    #[derive(Default)]
    struct ContractArtifactCounts {
        total_artifact_rows: u64,
        trusted: u64,
        stale: u64,
        missing: u64,
        malformed: u64,
        path_mismatch: u64,
        version_mismatch: u64,
    }

    impl ContractArtifactCounts {
        fn record(&mut self, state: &str) {
            self.total_artifact_rows += 1;
            match state {
                "trusted" => self.trusted += 1,
                "stale" => self.stale += 1,
                "missing" => self.missing += 1,
                "malformed" => self.malformed += 1,
                "path_mismatch" => self.path_mismatch += 1,
                "version_mismatch" => self.version_mismatch += 1,
                other => panic!("unknown artifact state {other}"),
            }
        }

        fn non_trusted(&self) -> u64 {
            self.total_artifact_rows.saturating_sub(self.trusted)
        }
    }

    fn assert_operator_proof_run_status_contract(status: &serde_json::Value) {
        assert_eq!(
            status["contract_version"].as_u64(),
            Some(PROOF_RUN_STATUS_CONTRACT_VERSION as u64),
            "status contract version should be explicit"
        );
        assert!(status["game"].as_str().is_some(), "game should be string");
        assert!(
            status["manifest_version"].as_u64().is_some(),
            "manifest_version should be numeric"
        );
        assert_eq!(status["execution"], "local-only command copy");

        let families = status["families"].as_array().expect("families array");
        let mut production = ContractArtifactCounts::default();
        let mut fixtures = ContractArtifactCounts::default();
        for family in families {
            assert!(
                family["heading"].as_str().is_some(),
                "family heading should be string"
            );
            let family_fixture = family["fixture"].as_bool().expect("family fixture bool");
            let runs = family["runs"].as_array().expect("family runs array");
            for row in runs {
                for field in [
                    "id",
                    "row_id",
                    "family",
                    "scope",
                    "command",
                    "proof_boundary",
                ] {
                    assert!(
                        row[field].as_str().is_some(),
                        "row {field} should be string"
                    );
                }
                assert_eq!(
                    row["fixture"].as_bool(),
                    Some(family_fixture),
                    "row fixture flag should match family"
                );
                let artifact = &row["artifact"];
                if artifact.is_null() {
                    continue;
                }
                assert!(
                    artifact["path"].as_str().is_some(),
                    "artifact path should be string"
                );
                let state = artifact["state"]
                    .as_str()
                    .expect("artifact state should be string");
                if family_fixture {
                    fixtures.record(state);
                } else {
                    production.record(state);
                }
                match state {
                    "trusted" => {
                        assert_artifact_u64(artifact, "modified_at_unix_seconds");
                        assert_artifact_u64(artifact, "age_seconds");
                        assert_artifact_u64(artifact, "freshness_max_age_seconds");
                        if let Some(metadata) = artifact.get("trusted_metadata") {
                            let metadata = metadata.as_object().expect("trusted metadata object");
                            assert!(!metadata.is_empty(), "trusted metadata should not be empty");
                            assert_optional_metadata_string(metadata, "game_id");
                            for field in [
                                "manifest_version",
                                "resolve_elapsed_ms",
                                "threshold_ms",
                                "trace_row_count",
                                "projection_table_count",
                                "resolution_phase_count",
                                "family_count",
                                "seed_count",
                                "expected_family_count",
                                "expected_seed_count",
                                "case_count",
                                "expected_case_count",
                                "manifest_family_count",
                                "manifest_case_count",
                                "missing_family_count",
                                "unexpected_family_count",
                                "count_mismatch_count",
                                "evidence_failure_count",
                            ] {
                                assert_optional_metadata_u64(metadata, field);
                            }
                            for field in [
                                "retention_comparison_normalized_match",
                                "phase_trace_anchored",
                                "decision_trace_anchored",
                                "family_manifest_matched",
                                "gap_audit_ok",
                            ] {
                                assert_optional_metadata_bool(metadata, field);
                            }
                        }
                        assert!(artifact.get("reported_path").is_none());
                    }
                    "stale" => {
                        assert_artifact_u64(artifact, "modified_at_unix_seconds");
                        assert_artifact_u64(artifact, "age_seconds");
                        assert_artifact_u64(artifact, "freshness_max_age_seconds");
                        assert!(artifact.get("trusted_metadata").is_none());
                    }
                    "path_mismatch" => {
                        assert!(
                            artifact["reported_path"].as_str().is_some(),
                            "path mismatch should expose reported_path"
                        );
                        assert!(artifact.get("trusted_metadata").is_none());
                    }
                    "version_mismatch" => {
                        assert_artifact_u64(artifact, "artifact_version");
                        assert_artifact_u64(artifact, "expected_version");
                        assert!(artifact.get("trusted_metadata").is_none());
                    }
                    "missing" | "malformed" => {
                        assert!(artifact.get("trusted_metadata").is_none());
                    }
                    other => panic!("unknown artifact state {other}"),
                }
            }
        }
        assert_status_summary_counts(status, "production", &production);
        assert_status_summary_counts(status, "fixtures", &fixtures);
    }

    fn assert_artifact_u64(artifact: &serde_json::Value, field: &str) {
        assert!(
            artifact[field].as_u64().is_some(),
            "artifact {field} should be numeric"
        );
    }

    fn assert_optional_metadata_string(
        metadata: &serde_json::Map<String, serde_json::Value>,
        field: &str,
    ) {
        if let Some(value) = metadata.get(field) {
            assert!(
                value.as_str().is_some(),
                "trusted metadata {field} should be string"
            );
        }
    }

    fn assert_optional_metadata_u64(
        metadata: &serde_json::Map<String, serde_json::Value>,
        field: &str,
    ) {
        if let Some(value) = metadata.get(field) {
            assert!(
                value.as_u64().is_some(),
                "trusted metadata {field} should be numeric"
            );
        }
    }

    fn assert_optional_metadata_bool(
        metadata: &serde_json::Map<String, serde_json::Value>,
        field: &str,
    ) {
        if let Some(value) = metadata.get(field) {
            assert!(
                value.as_bool().is_some(),
                "trusted metadata {field} should be bool"
            );
        }
    }

    fn assert_status_summary_counts(
        status: &serde_json::Value,
        scope: &str,
        expected: &ContractArtifactCounts,
    ) {
        let summary = &status["summary"][scope];
        let fields = [
            ("total_artifact_rows", expected.total_artifact_rows),
            ("trusted", expected.trusted),
            ("stale", expected.stale),
            ("missing", expected.missing),
            ("malformed", expected.malformed),
            ("path_mismatch", expected.path_mismatch),
            ("version_mismatch", expected.version_mismatch),
            ("non_trusted", expected.non_trusted()),
        ];
        for (field, value) in fields {
            assert_eq!(
                summary[field].as_u64(),
                Some(value),
                "{scope}.{field} should match row-derived counts"
            );
        }
    }

    fn contract_status_row(
        id: &str,
        fixture: bool,
        artifact: OperatorProofRunArtifactStatus,
    ) -> OperatorProofRunStatusRow {
        OperatorProofRunStatusRow {
            id: id.to_string(),
            row_id: proof_run_row_id(id),
            family: if fixture { "Fixture" } else { "Production" }.to_string(),
            scope: "Local-only".to_string(),
            fixture,
            command: format!("run {id}"),
            artifact: Some(artifact),
            proof_boundary: format!("proof boundary for {id}"),
        }
    }

    #[test]
    fn proof_run_status_contract_covers_version_summary_rows_and_artifact_states() {
        let trusted_game = Uuid::from_u128(88);
        let production_rows = vec![
            contract_status_row(
                "trusted-artifact",
                false,
                proof_run_artifact_status(
                    "target/trusted.json",
                    ProofRunArtifactState::Present {
                        game_id: trusted_game,
                        manifest_version: 1,
                        normalized_match: Some(true),
                        freshness: ProofRunArtifactFreshness {
                            modified_at_unix_seconds: 20,
                            age_seconds: 3,
                            max_age_seconds: 86_400,
                        },
                    },
                ),
            ),
            contract_status_row(
                "missing-artifact",
                false,
                proof_run_artifact_status("target/missing.json", ProofRunArtifactState::Missing),
            ),
        ];
        let fixture_rows = vec![
            contract_status_row(
                "malformed-artifact",
                true,
                proof_run_artifact_status(
                    "target/malformed.json",
                    ProofRunArtifactState::Malformed,
                ),
            ),
            contract_status_row(
                "stale-artifact",
                true,
                proof_run_artifact_status(
                    "target/stale.json",
                    ProofRunArtifactState::Stale {
                        freshness: ProofRunArtifactFreshness {
                            modified_at_unix_seconds: 1,
                            age_seconds: 86_401,
                            max_age_seconds: 86_400,
                        },
                    },
                ),
            ),
            contract_status_row(
                "path-mismatch-artifact",
                true,
                proof_run_artifact_status(
                    "target/path-mismatch.json",
                    ProofRunArtifactState::PathMismatch {
                        reported_path: "target/other.json".to_string(),
                    },
                ),
            ),
            contract_status_row(
                "version-mismatch-artifact",
                true,
                proof_run_artifact_status(
                    "target/version-mismatch.json",
                    ProofRunArtifactState::VersionMismatch {
                        artifact_manifest_version: 2,
                        expected_manifest_version: 1,
                    },
                ),
            ),
        ];
        let families = vec![
            OperatorProofRunStatusFamily {
                heading: "Production".to_string(),
                fixture: false,
                runs: production_rows,
            },
            OperatorProofRunStatusFamily {
                heading: "Fixture".to_string(),
                fixture: true,
                runs: fixture_rows,
            },
        ];
        let summary = proof_run_summary(&families);
        let status = serde_json::to_value(OperatorProofRunStatus {
            contract_version: PROOF_RUN_STATUS_CONTRACT_VERSION,
            game: Uuid::from_u128(99),
            manifest_version: 1,
            execution: "local-only command copy",
            summary,
            families,
        })
        .unwrap();

        assert_operator_proof_run_status_contract(&status);
    }

    #[test]
    fn proof_run_artifact_metadata_renders_only_for_valid_json() {
        let dir = env::temp_dir().join(format!("fmarch-proof-page-{}", Uuid::new_v4()));
        let artifact = dir.join("report.json");
        let malformed = dir.join("malformed.json");
        let artifact_text = artifact.to_string_lossy().to_string();
        let malformed_text = malformed.to_string_lossy().to_string();
        let row_for = |artifact_path: String| OperatorProofRunStatusRow {
            id: "artifact-row".to_string(),
            row_id: "proof-run-artifact-row".to_string(),
            family: "Artifact Row".to_string(),
            scope: "Local-only".to_string(),
            fixture: false,
            command: format!("run --output {artifact_path}"),
            artifact: Some(proof_run_artifact_status(
                &artifact_path,
                proof_run_artifact_state_at(&artifact_path, 1, 86_400, SystemTime::now()),
            )),
            proof_boundary: "writes a report".to_string(),
        };

        let mut missing_html = String::new();
        render_proof_run_table(
            &mut missing_html,
            "Artifacts",
            &[row_for(artifact_text.clone())],
        );
        assert!(missing_html.contains(&format!("<code>{artifact_text}</code>")));
        assert!(missing_html.contains("artifact not present locally"));
        assert!(!missing_html.contains("game_id:"));

        fs::create_dir_all(&dir).expect("artifact dir");
        fs::write(&malformed, "{").expect("malformed artifact file");
        let mut malformed_html = String::new();
        render_proof_run_table(
            &mut malformed_html,
            "Artifacts",
            &[row_for(malformed_text.clone())],
        );
        assert!(malformed_html.contains(&format!("<code>{malformed_text}</code>")));
        assert!(malformed_html.contains("artifact metadata unreadable"));
        assert!(!malformed_html.contains("game_id:"));

        let artifact_game = Uuid::from_u128(77);
        fs::write(
            &artifact,
            serde_json::json!({
                "game_id": artifact_game,
                "manifest_version": 1,
                "artifact_path": "wrong-path.json"
            })
            .to_string(),
        )
        .expect("path-mismatch artifact file");
        let mut path_mismatch_html = String::new();
        render_proof_run_table(
            &mut path_mismatch_html,
            "Artifacts",
            &[row_for(artifact_text.clone())],
        );
        assert!(path_mismatch_html.contains(&format!("<code>{artifact_text}</code>")));
        assert!(path_mismatch_html.contains("artifact path mismatch"));
        assert!(path_mismatch_html.contains("reported_path: wrong-path.json"));
        assert!(!path_mismatch_html.contains("game_id:"));

        fs::write(
            &artifact,
            serde_json::json!({
                "game_id": artifact_game,
                "manifest_version": 2,
                "artifact_path": artifact_text,
            })
            .to_string(),
        )
        .expect("version-mismatch artifact file");
        let mut version_mismatch_html = String::new();
        render_proof_run_table(
            &mut version_mismatch_html,
            "Artifacts",
            &[row_for(artifact_text.clone())],
        );
        assert!(version_mismatch_html.contains(&format!("<code>{artifact_text}</code>")));
        assert!(version_mismatch_html.contains("artifact manifest version incompatible"));
        assert!(version_mismatch_html.contains("artifact_version: 2"));
        assert!(version_mismatch_html.contains("expected_version: 1"));
        assert!(!version_mismatch_html.contains("game_id:"));

        fs::write(
            &artifact,
            serde_json::json!({
                "game_id": artifact_game,
                "manifest_version": 1,
                "artifact_path": artifact_text,
                "retention_comparison": {"normalized_match": true}
            })
            .to_string(),
        )
        .expect("artifact file");
        let mut present_html = String::new();
        render_proof_run_table(
            &mut present_html,
            "Artifacts",
            &[row_for(artifact_text.clone())],
        );
        assert!(present_html.contains(&format!("<code>{artifact_text}</code>")));
        assert!(present_html.contains(&format!("game_id: {artifact_game}")));
        assert!(present_html.contains("manifest_version: 1"));
        assert!(present_html.contains("retention_comparison.normalized_match: true"));
        assert!(present_html.contains("modified_at_unix_seconds:"));
        assert!(present_html.contains("age_seconds:"));
        assert!(present_html.contains("freshness_max_age_seconds: 86400"));

        let stale_state = ProofRunArtifactState::Stale {
            freshness: ProofRunArtifactFreshness {
                modified_at_unix_seconds: 1,
                age_seconds: 86_401,
                max_age_seconds: 86_400,
            },
        };
        let mut stale_html = String::new();
        let stale_status = proof_run_artifact_status(&artifact_text, stale_state);
        render_artifact_cell(&mut stale_html, &stale_status);
        assert!(stale_html.contains("artifact stale"));
        assert!(stale_html.contains("modified_at_unix_seconds: 1"));
        assert!(stale_html.contains("age_seconds: 86401"));
        assert!(!stale_html.contains("game_id:"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn proof_run_artifact_status_exposes_metadata_only_when_trusted() {
        let path_mismatch = serde_json::to_value(proof_run_artifact_status(
            "target/report.json",
            ProofRunArtifactState::PathMismatch {
                reported_path: "target/other.json".to_string(),
            },
        ))
        .unwrap();
        assert_eq!(path_mismatch["state"], "path_mismatch");
        assert_eq!(path_mismatch["reported_path"], "target/other.json");
        assert!(path_mismatch.get("trusted_metadata").is_none());

        let version_mismatch = serde_json::to_value(proof_run_artifact_status(
            "target/report.json",
            ProofRunArtifactState::VersionMismatch {
                artifact_manifest_version: 2,
                expected_manifest_version: 1,
            },
        ))
        .unwrap();
        assert_eq!(version_mismatch["state"], "version_mismatch");
        assert_eq!(version_mismatch["artifact_version"], 2);
        assert_eq!(version_mismatch["expected_version"], 1);
        assert!(version_mismatch.get("trusted_metadata").is_none());

        let stale = serde_json::to_value(proof_run_artifact_status(
            "target/report.json",
            ProofRunArtifactState::Stale {
                freshness: ProofRunArtifactFreshness {
                    modified_at_unix_seconds: 10,
                    age_seconds: 86_401,
                    max_age_seconds: 86_400,
                },
            },
        ))
        .unwrap();
        assert_eq!(stale["state"], "stale");
        assert_eq!(stale["modified_at_unix_seconds"], 10);
        assert_eq!(stale["age_seconds"], 86401);
        assert_eq!(stale["freshness_max_age_seconds"], 86400);
        assert!(stale.get("trusted_metadata").is_none());

        let trusted_game = Uuid::from_u128(88);
        let trusted = serde_json::to_value(proof_run_artifact_status(
            "target/report.json",
            ProofRunArtifactState::Present {
                game_id: trusted_game,
                manifest_version: 1,
                normalized_match: Some(true),
                freshness: ProofRunArtifactFreshness {
                    modified_at_unix_seconds: 20,
                    age_seconds: 3,
                    max_age_seconds: 86_400,
                },
            },
        ))
        .unwrap();
        assert_eq!(trusted["state"], "trusted");
        assert_eq!(
            trusted["trusted_metadata"]["game_id"],
            trusted_game.to_string()
        );
        assert_eq!(trusted["trusted_metadata"]["manifest_version"], 1);
        assert_eq!(
            trusted["trusted_metadata"]["retention_comparison_normalized_match"],
            true
        );
        assert_eq!(trusted["modified_at_unix_seconds"], 20);
        assert_eq!(trusted["age_seconds"], 3);
        assert_eq!(trusted["freshness_max_age_seconds"], 86400);
        assert!(trusted.get("reported_path").is_none());
        assert!(trusted.get("artifact_version").is_none());
    }

    #[test]
    fn proof_run_summary_counts_production_and_fixture_artifacts_separately() {
        let production_row = OperatorProofRunStatusRow {
            id: "prod".to_string(),
            row_id: "proof-run-prod".to_string(),
            family: "Production".to_string(),
            scope: "Local-only".to_string(),
            fixture: false,
            command: "prod".to_string(),
            artifact: Some(proof_run_artifact_status(
                "target/prod.json",
                ProofRunArtifactState::Present {
                    game_id: Uuid::from_u128(1),
                    manifest_version: 1,
                    normalized_match: None,
                    freshness: ProofRunArtifactFreshness {
                        modified_at_unix_seconds: 20,
                        age_seconds: 3,
                        max_age_seconds: 86_400,
                    },
                },
            )),
            proof_boundary: "prod".to_string(),
        };
        let fixture_row = OperatorProofRunStatusRow {
            id: "fixture".to_string(),
            row_id: "proof-run-fixture".to_string(),
            family: "Fixture".to_string(),
            scope: "Local-only".to_string(),
            fixture: true,
            command: "fixture".to_string(),
            artifact: Some(proof_run_artifact_status(
                "target/fixture.json",
                ProofRunArtifactState::Stale {
                    freshness: ProofRunArtifactFreshness {
                        modified_at_unix_seconds: 1,
                        age_seconds: 86_401,
                        max_age_seconds: 86_400,
                    },
                },
            )),
            proof_boundary: "fixture".to_string(),
        };
        let summary = proof_run_summary(&[
            OperatorProofRunStatusFamily {
                heading: "Production".to_string(),
                fixture: false,
                runs: vec![production_row],
            },
            OperatorProofRunStatusFamily {
                heading: "Fixture".to_string(),
                fixture: true,
                runs: vec![fixture_row],
            },
        ]);

        assert_eq!(summary.production.total_artifact_rows, 1);
        assert_eq!(summary.production.trusted, 1);
        assert_eq!(summary.production.non_trusted, 0);
        assert_eq!(summary.fixtures.total_artifact_rows, 1);
        assert_eq!(summary.fixtures.stale, 1);
        assert_eq!(summary.fixtures.non_trusted, 1);
    }
}
