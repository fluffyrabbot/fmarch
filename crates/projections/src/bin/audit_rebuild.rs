use std::env;

use projections::audit_rebuild;
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let game_id = args
        .next()
        .ok_or("usage: audit_rebuild <game_uuid>")?
        .parse::<Uuid>()?;
    if args.next().is_some() {
        return Err("usage: audit_rebuild <game_uuid>".into());
    }

    let database_url = env::var("DATABASE_URL")?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;

    let report = audit_rebuild(&pool, game_id).await?;
    println!("{}", serde_json::to_string_pretty(&report)?);

    if report.ok {
        Ok(())
    } else {
        Err("projection rebuild audit found drift".into())
    }
}
