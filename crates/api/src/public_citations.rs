//! Shared bounded public citation request and flat response boundary.

use super::ApiError;
use axum::http::StatusCode;
use content_reference::DEFAULT_POST_CITATION_LIMIT;
use principal::PrincipalId;
use serde::Deserialize;
use sqlx::PgPool;
use std::collections::BTreeSet;
use uuid::Uuid;
use wire::{PublicPostCitationBatch, PublicPostCitationPage, RejectCode};

#[derive(Debug, Clone, Deserialize)]
pub(super) struct PublicCitationQuery {
    source_seqs: String,
    limit: Option<i64>,
}

impl PublicCitationQuery {
    fn source_seqs(&self) -> Result<Vec<i64>, ApiError> {
        let invalid = || ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::InvalidArgument,
            message: "source_seqs must contain 1 to 50 distinct positive event sequences".into(),
        };
        let mut source_seqs = BTreeSet::new();
        for value in self.source_seqs.split(',') {
            if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err(invalid());
            }
            let source_seq = value.parse::<i64>().map_err(|_| invalid())?;
            if source_seq <= 0 || !source_seqs.insert(source_seq) || source_seqs.len() > 50 {
                return Err(invalid());
            }
        }
        Ok(source_seqs.into_iter().collect())
    }
}

pub(super) async fn read(
    pool: &PgPool,
    surface_id: Uuid,
    query: PublicCitationQuery,
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

#[cfg(test)]
mod tests {
    use super::PublicCitationQuery;

    #[test]
    fn public_citation_queries_require_a_bounded_distinct_positive_set() {
        let parse = |source_seqs: &str| {
            PublicCitationQuery {
                source_seqs: source_seqs.into(),
                limit: None,
            }
            .source_seqs()
        };
        assert_eq!(parse("80,40").unwrap(), vec![40, 80]);
        assert_eq!(parse("9223372036854775807").unwrap(), vec![i64::MAX]);
        for invalid in [
            "",
            "0",
            "-1",
            "+1",
            "1,1",
            "01,1",
            ",1",
            "1,",
            "1,,2",
            "1, 2",
            " 1",
            "1.0",
            "1e2",
            "9223372036854775808",
            "one",
            "１",
        ] {
            assert!(parse(invalid).is_err(), "accepted {invalid:?}");
        }
        let batch = |count| {
            (1..=count)
                .map(|seq| seq.to_string())
                .collect::<Vec<_>>()
                .join(",")
        };
        assert_eq!(parse(&batch(50)).unwrap().len(), 50);
        assert!(parse(&batch(51)).is_err());
    }
}
