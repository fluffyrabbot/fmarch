use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;

use sqlx::postgres::PgPoolOptions;

#[derive(Debug, Clone)]
struct Config {
    database_url: String,
    bind: SocketAddr,
    media_root: PathBuf,
}

impl Config {
    fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        let database_url = env::var("DATABASE_URL")?;
        let bind = bind_from_values(
            env::var("FMARCH_BIND").ok().as_deref(),
            env::var("PORT").ok().as_deref(),
        )?;
        let media_root = env::var("FMARCH_MEDIA_ROOT")?;
        if media_root.trim().is_empty() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "FMARCH_MEDIA_ROOT must not be empty",
            )
            .into());
        }
        Ok(Config {
            database_url,
            bind,
            media_root: PathBuf::from(media_root),
        })
    }
}

fn bind_from_values(
    configured_bind: Option<&str>,
    platform_port: Option<&str>,
) -> Result<SocketAddr, std::net::AddrParseError> {
    let bind = configured_bind
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .or_else(|| {
            platform_port
                .filter(|value| !value.trim().is_empty())
                .map(|port| format!("0.0.0.0:{port}"))
        })
        .unwrap_or_else(|| "127.0.0.1:4000".to_string());
    bind.parse()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = Config::from_env()?;
    let media_store = media::MediaStore::open(&config.media_root, media::MediaLimits::default())?;
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await?;

    sqlx::migrate!("../projections/migrations")
        .run(&pool)
        .await?;

    api::identity_delivery::spawn_identity_delivery_worker(
        pool.clone(),
        std::sync::Arc::new(
            api::identity_delivery::LocalDeterministicIdentityDeliveryGateway::from_env(),
        ),
    );
    let app = api::router(pool.clone(), media_store).merge(operator_api::router(pool));
    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    tracing::info!(addr = %config.bind, "fmarch server listening");
    axum::serve(listener, app).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::bind_from_values;

    #[test]
    fn configured_bind_overrides_platform_port() {
        assert_eq!(
            bind_from_values(Some("127.0.0.1:4512"), Some("8080"))
                .unwrap()
                .to_string(),
            "127.0.0.1:4512"
        );
    }

    #[test]
    fn platform_port_binds_publicly_when_no_explicit_bind_exists() {
        assert_eq!(
            bind_from_values(None, Some("8080")).unwrap().to_string(),
            "0.0.0.0:8080"
        );
    }

    #[test]
    fn local_default_remains_loopback_port_4000() {
        assert_eq!(
            bind_from_values(None, None).unwrap().to_string(),
            "127.0.0.1:4000"
        );
    }
}
