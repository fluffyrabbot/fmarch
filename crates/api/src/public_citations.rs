//! Shared bounded public citation request and flat response boundary.

use super::{citation_query::CitationBatchQuery, ApiError};
use content_reference::DEFAULT_POST_CITATION_LIMIT;
use principal::PrincipalId;
use sqlx::PgPool;
use uuid::Uuid;
use wire::{PublicPostCitationBatch, PublicPostCitationPage};

pub(super) async fn read(
    pool: &PgPool,
    surface_id: Uuid,
    query: CitationBatchQuery,
    viewer_principal_id: Option<PrincipalId>,
) -> Result<PublicPostCitationBatch, ApiError> {
    let source_seqs = query.source_seqs()?;
    let pages = projections::visible_public_incoming_citation_pages(
        pool,
        surface_id,
        &source_seqs,
        viewer_principal_id,
        query.limit.unwrap_or(DEFAULT_POST_CITATION_LIMIT),
    )
    .await?;
    Ok(PublicPostCitationBatch {
        pages: pages
            .into_iter()
            .map(PublicPostCitationPage::from)
            .collect(),
    })
}
