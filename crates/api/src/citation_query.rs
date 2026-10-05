//! Shared bounded citation target selection.

use super::ApiError;
use axum::http::StatusCode;
use serde::Deserialize;
use std::collections::BTreeSet;
use wire::RejectCode;

#[derive(Debug, Clone, Deserialize)]
pub(super) struct CitationBatchQuery {
    source_seqs: String,
    pub(super) limit: Option<i64>,
}

impl CitationBatchQuery {
    pub(super) fn source_seqs(&self) -> Result<Vec<i64>, ApiError> {
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

#[cfg(test)]
mod tests {
    use super::CitationBatchQuery;

    #[test]
    fn citation_queries_require_a_bounded_distinct_positive_set() {
        let parse = |source_seqs: &str| {
            CitationBatchQuery {
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
