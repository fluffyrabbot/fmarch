use std::env;

use commands::inspect_resolution_traces;
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let game_id = args
        .next()
        .ok_or("usage: inspect_trace <game_uuid> [run_id]")?
        .parse::<Uuid>()?;
    let run_id = args.next();
    if args.next().is_some() {
        return Err("usage: inspect_trace <game_uuid> [run_id]".into());
    }

    let database_url = env::var("DATABASE_URL")?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await?;
    sqlx::migrate!("../projections/migrations")
        .run(&pool)
        .await?;

    let report = inspect_resolution_traces(&pool, game_id, run_id.as_deref()).await?;
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}
