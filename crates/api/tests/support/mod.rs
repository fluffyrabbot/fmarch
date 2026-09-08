use api::ApiState;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{watch, Notify};
use tokio::task::JoinHandle;

/// Owns the same durable live-event listener that the server composition root
/// supervises in production. Integration tests must await readiness before
/// asserting cross-instance delivery; polling is only a missed-NOTIFY fallback.
pub struct LiveEventListenerHarness {
    shutdown: watch::Sender<bool>,
    task: Option<JoinHandle<Result<(), sqlx::Error>>>,
}

impl LiveEventListenerHarness {
    pub async fn start(state: ApiState) -> Self {
        let (shutdown, receiver) = watch::channel(false);
        let ready = Arc::new(Notify::new());
        let listener_ready = ready.clone();
        let mut task = tokio::spawn(async move {
            state
                .run_live_event_listener(receiver, move |_| listener_ready.notify_one())
                .await
        });

        tokio::select! {
            _ = ready.notified() => {}
            result = &mut task => match result {
                Ok(Ok(())) => panic!("durable live-event listener exited before readiness"),
                Ok(Err(error)) => panic!("durable live-event listener failed before readiness: {error}"),
                Err(error) => panic!("durable live-event listener task failed before readiness: {error}"),
            },
            _ = tokio::time::sleep(Duration::from_secs(2)) => {
                task.abort();
                let _ = task.await;
                panic!("durable live-event listener did not become ready within its test budget");
            }
        }

        Self {
            shutdown,
            task: Some(task),
        }
    }

    pub async fn shutdown(self) {
        self.shutdown_with_budget(Duration::from_secs(2)).await;
    }

    async fn shutdown_with_budget(mut self, budget: Duration) {
        let _ = self.shutdown.send(true);
        let mut task = self.task.take().expect("live-event listener task exists");
        match tokio::time::timeout(budget, &mut task).await {
            Ok(result) => result
                .expect("durable live-event listener task joined")
                .expect("durable live-event listener exited cleanly"),
            Err(_) => {
                task.abort();
                let _ = task.await;
                panic!("durable live-event listener did not stop within its test budget");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    struct DropProbe(Arc<AtomicBool>);

    impl Drop for DropProbe {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn timed_out_shutdown_aborts_and_joins_the_listener() {
        let dropped = Arc::new(AtomicBool::new(false));
        let probe = DropProbe(dropped.clone());
        let task = tokio::spawn(async move {
            let _probe = probe;
            std::future::pending::<Result<(), sqlx::Error>>().await
        });
        let (shutdown, _receiver) = watch::channel(false);
        let harness = LiveEventListenerHarness {
            shutdown,
            task: Some(task),
        };

        let shutdown = tokio::spawn(harness.shutdown_with_budget(Duration::from_millis(10)));
        let error = shutdown
            .await
            .expect_err("stuck listener shutdown must fail after aborting its task");
        assert!(error.is_panic());
        assert!(
            dropped.load(Ordering::SeqCst),
            "listener future remained detached after the shutdown timeout"
        );
    }
}

impl Drop for LiveEventListenerHarness {
    fn drop(&mut self) {
        let _ = self.shutdown.send(true);
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}
