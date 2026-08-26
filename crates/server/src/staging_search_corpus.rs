//! Lifecycle owner for the deterministic public-search staging corpus.
//!
//! The corpus is installed through the production command pipeline. SQL in
//! this module is read-only and exists only to select an active global admin,
//! inspect reconciliation state, and verify the projected public surface.

use caps::{Principal, PrincipalId};
use commands::Command;
use domain::phase::PhaseId;
use serde::Serialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

pub const CORPUS_VERSION: u32 = 1;
pub const CORPUS_PACK: &str = "mafiascum";
pub const CORPUS_SEARCH_QUERY: &str = "game";
pub const CORPUS_GAME_ID: Uuid = Uuid::from_u128(0x7f46d8a2_9f5d_4d3b_8b9e_7c40a74c1001);
const CREATE_COMMAND_ID: Uuid = Uuid::from_u128(0x7f46d8a2_9f5d_4d3b_8b9e_7c40a74c1101);
const START_COMMAND_ID: Uuid = Uuid::from_u128(0x7f46d8a2_9f5d_4d3b_8b9e_7c40a74c1102);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StagingSearchCorpusReceipt {
    pub version: u32,
    pub proof: &'static str,
    pub status: &'static str,
    pub game_id: Uuid,
    pub pack: &'static str,
    pub lifecycle: &'static str,
    pub created: bool,
    pub started: bool,
    pub projected_public_game: bool,
    pub projected_search_match: bool,
}

#[derive(Debug, Clone)]
struct CorpusState {
    pack: String,
    status: String,
    host: PrincipalId,
    host_is_active_global_admin: bool,
}

/// Reconcile the one source-of-truth staging corpus aggregate.
///
/// A missing corpus is created and started through durable, idempotent domain
/// commands. An existing aggregate must still have the exact declared pack,
/// active lifecycle, and active global-admin host; drift fails closed rather
/// than creating a second fixture or mutating projections directly.
pub async fn reconcile(pool: &PgPool) -> Result<StagingSearchCorpusReceipt, String> {
    let mut created = false;
    let mut started = false;
    let mut state = load_state(pool).await?;

    if state.is_none() {
        let host = canonical_active_global_admin(pool).await?;
        commands::handle_idempotent(
            pool,
            &Principal::authenticated(host),
            CREATE_COMMAND_ID,
            Command::CreateGame {
                game: CORPUS_GAME_ID,
                pack: CORPUS_PACK.to_string(),
                cohost_denied: Vec::new(),
            },
        )
        .await
        .map_err(|error| format!("create staging search corpus: {error}"))?;
        created = true;
        state = load_state(pool).await?;
    }

    let state = state.ok_or_else(|| {
        "staging search corpus command committed without a readable game projection".to_string()
    })?;
    validate_state(&state)?;

    if state.status == "setup" {
        let phase = PhaseId::parse("D01")
            .map_err(|error| format!("static staging search phase is invalid: {error}"))?;
        commands::handle_idempotent(
            pool,
            &Principal::authenticated(state.host),
            START_COMMAND_ID,
            Command::StartGame {
                game: CORPUS_GAME_ID,
                phase,
            },
        )
        .await
        .map_err(|error| format!("start staging search corpus: {error}"))?;
        started = true;
    }

    let final_state = load_state(pool)
        .await?
        .ok_or_else(|| "staging search corpus disappeared during reconciliation".to_string())?;
    validate_state(&final_state)?;
    if final_state.status != "active" {
        return Err(format!(
            "staging search corpus lifecycle drifted: expected active, found {}",
            final_state.status
        ));
    }

    let public_game = projections::public_game_by_id(pool, CORPUS_GAME_ID)
        .await
        .map_err(|error| format!("read staging corpus public game: {error}"))?
        .is_some();
    let search = projections::public_search(
        pool,
        CORPUS_SEARCH_QUERY,
        projections::PublicSearchFilter::Group(projections::PublicSearchGroup::Games),
        None,
        20,
        None,
    )
    .await
    .map_err(|error| format!("search staging corpus projection: {error}"))?;
    let expected_href = format!("/games/{CORPUS_GAME_ID}");
    let projected_search_match = search
        .results
        .iter()
        .any(|result| result.href == expected_href);
    if !public_game || !projected_search_match {
        return Err(
            "staging search corpus command state did not project into public discovery and search"
                .to_string(),
        );
    }

    Ok(StagingSearchCorpusReceipt {
        version: CORPUS_VERSION,
        proof: "fmarch-staging-search-corpus",
        status: "ready",
        game_id: CORPUS_GAME_ID,
        pack: CORPUS_PACK,
        lifecycle: "active",
        created,
        started,
        projected_public_game: public_game,
        projected_search_match,
    })
}

async fn canonical_active_global_admin(pool: &PgPool) -> Result<PrincipalId, String> {
    let principal_id: Option<Uuid> = sqlx::query_scalar(
        r#"
        SELECT principal_id
        FROM platform_principal
        WHERE status = 'active' AND 'GlobalAdmin' = ANY(global_capabilities)
        ORDER BY created_at, principal_id
        LIMIT 1
        "#,
    )
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("select staging corpus owner: {error}"))?;
    principal_id
        .map(PrincipalId::from_uuid)
        .ok_or_else(|| "staging search corpus requires one active global admin".to_string())
}

async fn load_state(pool: &PgPool) -> Result<Option<CorpusState>, String> {
    let rows = sqlx::query(
        r#"
        SELECT game.pack_key, game.status, authority.principal_id,
               principal.status = 'active'
                 AND 'GlobalAdmin' = ANY(principal.global_capabilities)
                 AS host_is_active_global_admin
        FROM game_index AS game
        JOIN game_authority AS authority
          ON authority.game_id = game.game_id AND authority.role = 'host'
        LEFT JOIN platform_principal AS principal
          ON principal.principal_id = authority.principal_id
        WHERE game.game_id = $1
        ORDER BY authority.principal_id
        "#,
    )
    .bind(CORPUS_GAME_ID)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("inspect staging search corpus: {error}"))?;
    match rows.as_slice() {
        [] => Ok(None),
        [row] => Ok(Some(CorpusState {
            pack: row.get("pack_key"),
            status: row.get("status"),
            host: PrincipalId::from_uuid(row.get("principal_id")),
            host_is_active_global_admin: row.get("host_is_active_global_admin"),
        })),
        _ => Err("staging search corpus must have exactly one host".to_string()),
    }
}

fn validate_state(state: &CorpusState) -> Result<(), String> {
    if state.pack != CORPUS_PACK {
        return Err(format!(
            "staging search corpus pack drifted: expected {CORPUS_PACK}, found {}",
            state.pack
        ));
    }
    if !state.host_is_active_global_admin {
        return Err("staging search corpus host must remain an active global admin".to_string());
    }
    if !matches!(state.status.as_str(), "setup" | "active") {
        return Err(format!(
            "staging search corpus lifecycle is not reconcilable: {}",
            state.status
        ));
    }
    Ok(())
}
