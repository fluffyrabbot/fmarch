/// Domain errors for identity flows. The API crate maps these onto its wire
/// rejection shapes in one place; nothing here depends on HTTP types.
#[derive(Debug, thiserror::Error)]
pub enum IdentityFlowError {
    #[error("credentials or session are not valid")]
    Unauthorized,
    #[error("recent authentication is required")]
    RecentAuthRequired,
    #[error("{0} already exists")]
    AlreadyExists(&'static str),
    #[error("an active principal must retain at least one active authentication method")]
    LastActiveMethod,
    #[error("{0}")]
    Invalid(String),
    #[error("identity internals failed: {0}")]
    Internal(String),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}
