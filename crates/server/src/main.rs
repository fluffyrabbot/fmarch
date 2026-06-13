use std::env;
use std::net::SocketAddr;

use sqlx::postgres::PgPoolOptions;

#[derive(Debug, Clone)]
struct Config {
    database_url: String,
    bind: SocketAddr,
}

impl Config {
    fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        let database_url = env::var("DATABASE_URL")?;
        let bind = env::var("FMARCH_BIND")
            .unwrap_or_else(|_| "127.0.0.1:4000".to_string())
            .parse()?;
        Ok(Config { database_url, bind })
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = Config::from_env()?;
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await?;

    sqlx::migrate!("../projections/migrations")
        .run(&pool)
        .await?;

    let app = api::router(pool);
    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    tracing::info!(addr = %config.bind, "fmarch server listening");
    axum::serve(listener, app).await?;

    Ok(())
}
