use std::env;

use commands::audit_resolution_envelopes;
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let game_id = args
        .next()
        .ok_or("usage: audit_resolution <game_uuid>")?
        .parse::<Uuid>()?;
    if args.next().is_some() {
        return Err("usage: audit_resolution <game_uuid>".into());
    }

    let database_url = env::var("DATABASE_URL")?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await?;
    database_schema::ensure_schema_ready(&pool).await?;
    database_schema::verify_database_principal(
        &pool,
        database_schema::DatabasePrincipal::Application,
    )
    .await?;

    let report = audit_resolution_envelopes(&pool, game_id).await?;
    println!("{}", serde_json::to_string_pretty(&report)?);

    if report.ok {
        Ok(())
    } else {
        Err("resolution envelope audit found drift".into())
    }
}
