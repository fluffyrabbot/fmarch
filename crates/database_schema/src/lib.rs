//! Sole owner of fmarch's physical PostgreSQL contract.
//!
//! Domain persistence crates own queries and behavior. This crate alone owns
//! schema creation, exact schema readiness, database principals, and grants.

mod authority;
mod schema;

pub use authority::{
    bind_database_environment_identity, reconcile_database_authority,
    verify_database_environment_identity, verify_database_principal, verify_migration_authority,
    verify_schema_epoch_reset_completion_authority, DatabaseAuthorityError, DatabasePrincipal,
    APPLICATION_DATABASE_ROLE, DATABASE_ENVIRONMENT_IDENTITY_TABLE,
    DATABASE_IDENTITY_ADVISORY_LOCK, KEY_ADMIN_DATABASE_ROLE, RELEASE_AUTHORITY_SCHEMA,
    SCHEMA_EPOCH_RESET_COMPLETION_TABLE,
};
pub use schema::{ensure_schema_ready, inspect_schema_readiness, SchemaReadiness, MIGRATOR};
