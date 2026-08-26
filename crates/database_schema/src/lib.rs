//! Sole owner of fmarch's physical PostgreSQL contract.
//!
//! Domain persistence crates own queries and behavior. This crate alone owns
//! schema creation, exact schema readiness, database principals, and grants.

mod authority;
mod schema;

pub use authority::{
    reconcile_database_authority, verify_database_principal, verify_migration_authority,
    DatabaseAuthorityError, DatabasePrincipal, APPLICATION_DATABASE_ROLE, KEY_ADMIN_DATABASE_ROLE,
};
pub use schema::{ensure_schema_ready, inspect_schema_readiness, SchemaReadiness, MIGRATOR};
