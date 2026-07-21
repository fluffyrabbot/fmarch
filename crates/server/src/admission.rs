use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::Response;
use tokio::sync::Semaphore;

#[derive(Clone)]
pub struct HttpAdmission {
    slots: Arc<Semaphore>,
    queue_timeout: Duration,
    request_timeout: Duration,
    retry_after_seconds: i64,
}

impl HttpAdmission {
    pub fn new(
        max_in_flight: usize,
        queue_timeout: Duration,
        request_timeout: Duration,
        retry_after_seconds: i64,
    ) -> Self {
        Self {
            slots: Arc::new(Semaphore::new(max_in_flight.max(1))),
            queue_timeout,
            request_timeout,
            retry_after_seconds: retry_after_seconds.max(1),
        }
    }
}

pub async fn enforce_http_admission(
    State(admission): State<HttpAdmission>,
    request: Request,
    next: Next,
) -> Response {
    if request.uri().path() == "/healthz" {
        return next.run(request).await;
    }

    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let permit = match tokio::time::timeout(
        admission.queue_timeout,
        admission.slots.clone().acquire_owned(),
    )
    .await
    {
        Ok(Ok(permit)) => permit,
        Ok(Err(_)) | Err(_) => {
            tracing::warn!(
                event = "http_admission_rejected",
                reason = "in_flight_capacity_exhausted",
                %method,
                %path,
                queue_timeout_ms = admission.queue_timeout.as_millis(),
                "HTTP admission rejected"
            );
            return api::capacity_unavailable_response(
                "server request capacity is exhausted; retry shortly",
                admission.retry_after_seconds,
            );
        }
    };

    let started = Instant::now();
    let response = match tokio::time::timeout(admission.request_timeout, next.run(request)).await {
        Ok(response) => response,
        Err(_) => {
            tracing::warn!(
                event = "http_request_deadline_exceeded",
                %method,
                %path,
                request_timeout_ms = admission.request_timeout.as_millis(),
                "HTTP request exceeded its deadline"
            );
            api::capacity_unavailable_response(
                "server request deadline was exceeded; retry shortly",
                admission.retry_after_seconds,
            )
        }
    };
    let status = response.status().as_u16();
    tracing::info!(
        event = "http_request_completed",
        %method,
        %path,
        status,
        elapsed_ms = started.elapsed().as_millis(),
        "HTTP request completed"
    );
    drop(permit);
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use axum::middleware;
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    fn controlled_router(admission: HttpAdmission) -> Router {
        Router::new()
            .route(
                "/slow",
                get(|| async {
                    tokio::time::sleep(Duration::from_millis(150)).await;
                    StatusCode::OK
                }),
            )
            .route("/healthz", get(|| async { StatusCode::OK }))
            .layer(middleware::from_fn_with_state(
                admission,
                enforce_http_admission,
            ))
    }

    #[tokio::test]
    async fn exhausted_request_capacity_returns_retryable_503() {
        let app = controlled_router(HttpAdmission::new(
            1,
            Duration::from_millis(10),
            Duration::from_secs(1),
            2,
        ));
        let first = tokio::spawn({
            let app = app.clone();
            async move {
                app.oneshot(Request::get("/slow").body(Body::empty()).unwrap())
                    .await
                    .unwrap()
            }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;

        let rejected = app
            .oneshot(Request::get("/slow").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(rejected.headers()["retry-after"], "2");
        assert_eq!(first.await.unwrap().status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn request_deadline_returns_retryable_503() {
        let response = controlled_router(HttpAdmission::new(
            1,
            Duration::from_millis(10),
            Duration::from_millis(20),
            1,
        ))
        .oneshot(Request::get("/slow").body(Body::empty()).unwrap())
        .await
        .unwrap();

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.headers()["retry-after"], "1");
    }

    #[tokio::test]
    async fn health_check_bypasses_exhausted_capacity() {
        let app = controlled_router(HttpAdmission::new(
            1,
            Duration::from_millis(10),
            Duration::from_secs(1),
            1,
        ));
        let first = tokio::spawn({
            let app = app.clone();
            async move {
                app.oneshot(Request::get("/slow").body(Body::empty()).unwrap())
                    .await
                    .unwrap()
            }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;

        let health = app
            .oneshot(Request::get("/healthz").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(health.status(), StatusCode::OK);
        assert_eq!(first.await.unwrap().status(), StatusCode::OK);
    }
}
