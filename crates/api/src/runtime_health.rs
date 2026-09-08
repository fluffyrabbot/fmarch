use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkerHealthView {
    pub name: String,
    pub required: bool,
    pub running: bool,
    pub healthy: bool,
    pub restart_count: u32,
    pub last_heartbeat_at: Option<i64>,
    pub progress: u64,
    pub backlog: Option<u64>,
    pub in_flight: Option<u64>,
}

#[derive(Debug, Clone)]
struct WorkerHealthState {
    required: bool,
    running: bool,
    restart_count: u32,
    last_heartbeat_at: Option<i64>,
    progress: u64,
    backlog: Option<u64>,
    in_flight: Option<u64>,
    last_iteration_succeeded: bool,
}

#[derive(Debug, Clone)]
pub struct RuntimeWorkerHealth {
    inner: Arc<RwLock<BTreeMap<String, WorkerHealthState>>>,
    stale_after: Duration,
}

impl RuntimeWorkerHealth {
    pub fn new(stale_after: Duration) -> Result<Self, &'static str> {
        if stale_after.is_zero() {
            return Err("worker heartbeat staleness must be positive");
        }
        Ok(Self {
            inner: Arc::new(RwLock::new(BTreeMap::new())),
            stale_after,
        })
    }

    pub fn register(&self, name: impl Into<String>, required: bool) {
        let previous = self
            .inner
            .write()
            .expect("worker health lock poisoned")
            .insert(
                name.into(),
                WorkerHealthState {
                    required,
                    running: false,
                    restart_count: 0,
                    last_heartbeat_at: None,
                    progress: 0,
                    backlog: None,
                    in_flight: None,
                    last_iteration_succeeded: false,
                },
            );
        assert!(previous.is_none(), "runtime worker registered twice");
    }

    pub fn mark_starting(&self, name: &str) {
        if let Some(worker) = self
            .inner
            .write()
            .expect("worker health lock poisoned")
            .get_mut(name)
        {
            worker.running = true;
            worker.last_heartbeat_at = None;
            worker.in_flight = None;
            worker.last_iteration_succeeded = false;
        }
    }

    pub fn heartbeat(&self, name: &str, progress_delta: u64, backlog: Option<u64>) {
        self.heartbeat_with_load(name, progress_delta, backlog, None);
    }

    pub fn heartbeat_with_load(
        &self,
        name: &str,
        progress_delta: u64,
        backlog: Option<u64>,
        in_flight: Option<u64>,
    ) {
        self.record_heartbeat(name, progress_delta, backlog, in_flight, true);
    }

    /// Publish progress and outcome atomically, retaining backlog on failure.
    /// A failed iteration must never briefly become ready between two writes.
    pub fn record_iteration(
        &self,
        name: &str,
        progress_delta: u64,
        backlog: Option<u64>,
        succeeded: bool,
    ) {
        self.record_heartbeat(name, progress_delta, backlog, None, succeeded);
    }

    fn record_heartbeat(
        &self,
        name: &str,
        progress_delta: u64,
        backlog: Option<u64>,
        in_flight: Option<u64>,
        succeeded: bool,
    ) {
        if let Some(worker) = self
            .inner
            .write()
            .expect("worker health lock poisoned")
            .get_mut(name)
        {
            worker.running = true;
            worker.last_heartbeat_at = Some(unix_now_seconds());
            worker.progress = worker.progress.saturating_add(progress_delta);
            worker.backlog = backlog;
            worker.in_flight = in_flight;
            worker.last_iteration_succeeded = succeeded;
        }
    }

    pub fn iteration_failed(&self, name: &str) {
        if let Some(worker) = self
            .inner
            .write()
            .expect("worker health lock poisoned")
            .get_mut(name)
        {
            worker.running = true;
            worker.last_heartbeat_at = Some(unix_now_seconds());
            worker.last_iteration_succeeded = false;
            worker.backlog = None;
            worker.in_flight = None;
        }
    }

    pub fn mark_stopped(&self, name: &str, restarting: bool) {
        if let Some(worker) = self
            .inner
            .write()
            .expect("worker health lock poisoned")
            .get_mut(name)
        {
            worker.running = false;
            worker.last_heartbeat_at = None;
            worker.in_flight = None;
            worker.last_iteration_succeeded = false;
            if restarting {
                worker.restart_count = worker.restart_count.saturating_add(1);
            }
        }
    }

    pub fn snapshot(&self) -> Vec<WorkerHealthView> {
        let now = unix_now_seconds();
        let stale_after = self.stale_after.as_secs().max(1) as i64;
        self.inner
            .read()
            .expect("worker health lock poisoned")
            .iter()
            .map(|(name, worker)| {
                let healthy = worker.running
                    && worker.last_iteration_succeeded
                    && worker
                        .last_heartbeat_at
                        .is_some_and(|heartbeat| now.saturating_sub(heartbeat) <= stale_after);
                WorkerHealthView {
                    name: name.clone(),
                    required: worker.required,
                    running: worker.running,
                    healthy,
                    restart_count: worker.restart_count,
                    last_heartbeat_at: worker.last_heartbeat_at,
                    progress: worker.progress,
                    backlog: worker.backlog,
                    in_flight: worker.in_flight,
                }
            })
            .collect()
    }

    pub fn required_workers_ready(&self) -> bool {
        self.snapshot()
            .iter()
            .all(|worker| !worker.required || worker.healthy)
    }
}

impl Default for RuntimeWorkerHealth {
    fn default() -> Self {
        Self::new(Duration::from_secs(30)).expect("default worker health policy is valid")
    }
}

fn unix_now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::RuntimeWorkerHealth;
    use std::time::Duration;

    #[test]
    fn required_worker_is_unready_until_first_heartbeat() {
        let health = RuntimeWorkerHealth::new(Duration::from_secs(30)).unwrap();
        health.register("required", true);
        health.mark_starting("required");
        assert!(!health.required_workers_ready());
        health.heartbeat("required", 2, Some(3));
        assert!(health.required_workers_ready());
        let snapshot = health.snapshot();
        assert_eq!(snapshot[0].progress, 2);
        assert_eq!(snapshot[0].backlog, Some(3));
        assert_eq!(snapshot[0].in_flight, None);
        health.iteration_failed("required");
        assert!(!health.required_workers_ready());
        assert_eq!(health.snapshot()[0].in_flight, None);
    }

    #[test]
    fn optional_worker_does_not_gate_readiness() {
        let health = RuntimeWorkerHealth::default();
        health.register("optional", false);
        assert!(health.required_workers_ready());
    }

    #[test]
    fn operational_load_is_recorded_atomically_and_reset_by_lifecycle_changes() {
        let health = RuntimeWorkerHealth::default();
        health.register("identity_delivery", true);
        health.mark_starting("identity_delivery");
        assert_eq!(health.snapshot()[0].in_flight, None);

        health.heartbeat_with_load("identity_delivery", 2, Some(7), Some(3));
        let snapshot = health.snapshot();
        assert_eq!(snapshot[0].progress, 2);
        assert_eq!(snapshot[0].backlog, Some(7));
        assert_eq!(snapshot[0].in_flight, Some(3));

        health.iteration_failed("identity_delivery");
        assert_eq!(health.snapshot()[0].in_flight, None);

        health.heartbeat_with_load("identity_delivery", 1, Some(4), Some(2));
        health.mark_stopped("identity_delivery", true);
        let snapshot = health.snapshot();
        assert_eq!(snapshot[0].progress, 3);
        assert_eq!(snapshot[0].in_flight, None);
        assert_eq!(snapshot[0].restart_count, 1);

        health.mark_starting("identity_delivery");
        assert_eq!(health.snapshot()[0].in_flight, None);
    }

    #[test]
    fn ordinary_heartbeat_clears_unreported_operational_load() {
        let health = RuntimeWorkerHealth::default();
        health.register("worker", false);
        health.heartbeat_with_load("worker", 1, Some(2), Some(1));
        health.heartbeat("worker", 1, Some(1));
        assert_eq!(health.snapshot()[0].in_flight, None);
    }
}
