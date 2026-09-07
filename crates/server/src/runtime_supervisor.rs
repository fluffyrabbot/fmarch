use super::{unix_now_seconds, WorkerBudget};
use api::identity_delivery::IdentityDeliveryGateway;
use api::{ApiState, RuntimeWorkerHealth};
use sqlx::PgPool;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

pub const SUBJECT_ERASURE_WORKER: &str = "subject-erasure";
pub const DAY_EVENT_WORKER: &str = "day-event-scheduler";
pub const IDENTITY_DELIVERY_WORKER: &str = "identity-delivery";
pub const LIVE_EVENT_LISTENER: &str = "live-event-listener";

type WorkerFuture = Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'static>>;
type WorkerFactory =
    Arc<dyn Fn(watch::Receiver<bool>, RuntimeWorkerHealth) -> WorkerFuture + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WorkerPolicy {
    Fatal,
    Restart { backoff: Duration, limit: u32 },
}

#[derive(Clone)]
struct WorkerSpec {
    name: &'static str,
    required: bool,
    policy: WorkerPolicy,
    factory: WorkerFactory,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupervisorFailure {
    pub worker: &'static str,
    pub reason: String,
}

pub struct RuntimeSupervisor {
    shutdown: watch::Sender<bool>,
    fatal: mpsc::UnboundedReceiver<SupervisorFailure>,
    tasks: Vec<JoinHandle<()>>,
    health: RuntimeWorkerHealth,
    readiness_grace: Duration,
    drain_timeout: Duration,
}

impl RuntimeSupervisor {
    pub fn start(
        pool: PgPool,
        api_state: ApiState,
        identity_gateway: Arc<dyn IdentityDeliveryGateway>,
        classic_enabled: bool,
        scheduler: commands::day_scheduler::DayEventSchedulerConfig,
        budget: WorkerBudget,
        health: RuntimeWorkerHealth,
    ) -> Self {
        let (shutdown, _) = watch::channel(false);
        let (fatal_sender, fatal) = mpsc::unbounded_channel();
        let mut specs = vec![
            subject_erasure_spec(pool.clone(), &budget),
            day_event_spec(pool.clone(), scheduler, &budget),
            live_listener_spec(api_state, &budget),
        ];
        if classic_enabled {
            specs.push(identity_delivery_spec(pool, identity_gateway, &budget));
        }
        let mut tasks = Vec::with_capacity(specs.len());
        for spec in specs {
            health.register(spec.name, spec.required);
            tasks.push(tokio::spawn(supervise_worker(
                spec,
                shutdown.subscribe(),
                health.clone(),
                fatal_sender.clone(),
            )));
        }
        drop(fatal_sender);
        Self {
            shutdown,
            fatal,
            tasks,
            health,
            readiness_grace: budget.readiness_grace,
            drain_timeout: budget.shutdown_drain_timeout,
        }
    }

    pub fn shutdown_receiver(&self) -> watch::Receiver<bool> {
        self.shutdown.subscribe()
    }

    pub fn request_shutdown(&self) {
        let _ = self.shutdown.send(true);
    }

    pub async fn wait_for_fatal(&mut self) -> Option<SupervisorFailure> {
        self.fatal.recv().await
    }

    pub async fn wait_until_ready(&mut self) -> Result<(), String> {
        let deadline = Instant::now() + self.readiness_grace;
        loop {
            if self.health.required_workers_ready() {
                return Ok(());
            }
            if Instant::now() >= deadline {
                let unready = self
                    .health
                    .snapshot()
                    .into_iter()
                    .filter(|worker| worker.required && !worker.healthy)
                    .map(|worker| worker.name)
                    .collect::<Vec<_>>()
                    .join(", ");
                return Err(format!(
                    "required workers did not become ready within {:?}: {unready}",
                    self.readiness_grace
                ));
            }
            tokio::select! {
                failure = self.fatal.recv() => {
                    return Err(match failure {
                        Some(failure) => format!(
                            "required worker {} failed during startup: {}",
                            failure.worker, failure.reason
                        ),
                        None => "runtime supervisor stopped during startup".to_string(),
                    });
                }
                _ = tokio::time::sleep(Duration::from_millis(25)) => {}
            }
        }
    }

    pub async fn shutdown(mut self) -> Result<(), String> {
        self.request_shutdown();
        let deadline = tokio::time::Instant::now() + self.drain_timeout;
        let mut failures = Vec::new();
        for mut task in self.tasks.drain(..) {
            match tokio::time::timeout_at(deadline, &mut task).await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => failures.push(format!("supervisor task join failed: {error}")),
                Err(_) => {
                    task.abort();
                    failures.push("supervisor drain deadline elapsed".to_string());
                }
            }
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(failures.join("; "))
        }
    }
}

async fn supervise_worker(
    spec: WorkerSpec,
    shutdown: watch::Receiver<bool>,
    health: RuntimeWorkerHealth,
    fatal: mpsc::UnboundedSender<SupervisorFailure>,
) {
    let mut restarts = 0_u32;
    loop {
        if *shutdown.borrow() {
            health.mark_stopped(spec.name, false);
            return;
        }
        health.mark_starting(spec.name);
        let attempt = tokio::spawn((spec.factory)(shutdown.clone(), health.clone())).await;
        if *shutdown.borrow() {
            health.mark_stopped(spec.name, false);
            return;
        }
        let reason = match attempt {
            Ok(Ok(())) => "worker exited before shutdown".to_string(),
            Ok(Err(error)) => error,
            Err(error) if error.is_panic() => format!("worker panicked: {error}"),
            Err(error) => format!("worker join failed: {error}"),
        };
        match spec.policy {
            WorkerPolicy::Fatal => {
                health.mark_stopped(spec.name, false);
                let _ = fatal.send(SupervisorFailure {
                    worker: spec.name,
                    reason,
                });
                return;
            }
            WorkerPolicy::Restart { backoff, limit } if restarts < limit => {
                restarts = restarts.saturating_add(1);
                health.mark_stopped(spec.name, true);
                tracing::warn!(
                    event = "runtime_worker_restarting",
                    worker = spec.name,
                    restart = restarts,
                    error = %reason,
                    "runtime worker exited unexpectedly; restarting"
                );
                if wait_or_shutdown(backoff, shutdown.clone()).await {
                    return;
                }
            }
            WorkerPolicy::Restart { .. } => {
                health.mark_stopped(spec.name, false);
                let _ = fatal.send(SupervisorFailure {
                    worker: spec.name,
                    reason: format!("restart budget exhausted after {restarts} restarts: {reason}"),
                });
                return;
            }
        }
    }
}

fn subject_erasure_spec(pool: PgPool, budget: &WorkerBudget) -> WorkerSpec {
    let idle = budget.subject_erasure_idle_interval;
    let error_backoff = budget.subject_erasure_error_backoff;
    WorkerSpec {
        name: SUBJECT_ERASURE_WORKER,
        required: true,
        policy: WorkerPolicy::Fatal,
        factory: Arc::new(move |shutdown, health| {
            let pool = pool.clone();
            Box::pin(run_subject_erasure_worker(
                pool,
                idle,
                error_backoff,
                shutdown,
                health,
            ))
        }),
    }
}

fn day_event_spec(
    pool: PgPool,
    config: commands::day_scheduler::DayEventSchedulerConfig,
    budget: &WorkerBudget,
) -> WorkerSpec {
    WorkerSpec {
        name: DAY_EVENT_WORKER,
        required: true,
        policy: WorkerPolicy::Fatal,
        factory: Arc::new(move |shutdown, health| {
            let pool = pool.clone();
            let config = config.clone();
            Box::pin(run_day_event_worker(pool, config, shutdown, health))
        }),
    }
}

fn identity_delivery_spec(
    pool: PgPool,
    gateway: Arc<dyn IdentityDeliveryGateway>,
    budget: &WorkerBudget,
) -> WorkerSpec {
    let idle = budget.identity_delivery_idle_interval;
    let error_backoff = budget.identity_delivery_error_backoff;
    WorkerSpec {
        name: IDENTITY_DELIVERY_WORKER,
        required: true,
        policy: WorkerPolicy::Fatal,
        factory: Arc::new(move |shutdown, health| {
            let pool = pool.clone();
            let gateway = gateway.clone();
            Box::pin(run_identity_delivery_worker(
                pool,
                gateway,
                idle,
                error_backoff,
                shutdown,
                health,
            ))
        }),
    }
}

fn live_listener_spec(api_state: ApiState, budget: &WorkerBudget) -> WorkerSpec {
    WorkerSpec {
        name: LIVE_EVENT_LISTENER,
        required: true,
        policy: WorkerPolicy::Restart {
            backoff: budget.live_listener_restart_backoff,
            limit: budget.restart_limit,
        },
        factory: Arc::new(move |shutdown, health| {
            let state = api_state.clone();
            Box::pin(async move {
                let heartbeat_health = health.clone();
                state
                    .run_live_event_listener(shutdown, move |progress| {
                        heartbeat_health.heartbeat(LIVE_EVENT_LISTENER, progress, None);
                    })
                    .await
                    .map_err(|error| format!("live-event listener failed: {error}"))
            })
        }),
    }
}

async fn run_subject_erasure_worker(
    pool: PgPool,
    idle_interval: Duration,
    error_backoff: Duration,
    shutdown: watch::Receiver<bool>,
    health: RuntimeWorkerHealth,
) -> Result<(), String> {
    let worker_id = format!("subject-erasure-{}", uuid::Uuid::new_v4().simple());
    loop {
        if *shutdown.borrow() {
            return Ok(());
        }
        match identity::process_pending_subject_erasures(&pool, &worker_id, unix_now_seconds())
            .await
        {
            Ok(processed) => {
                let backlog = subject_erasure_backlog(&pool).await.ok();
                health.heartbeat(SUBJECT_ERASURE_WORKER, processed as u64, backlog);
                if processed == 0 && wait_or_shutdown(idle_interval, shutdown.clone()).await {
                    return Ok(());
                }
            }
            Err(error) => {
                tracing::error!(
                    event = "subject_erasure_worker_failed",
                    error = %error,
                    "subject erasure worker iteration failed"
                );
                health.iteration_failed(SUBJECT_ERASURE_WORKER);
                if wait_or_shutdown(error_backoff, shutdown.clone()).await {
                    return Ok(());
                }
            }
        }
    }
}

async fn run_day_event_worker(
    pool: PgPool,
    config: commands::day_scheduler::DayEventSchedulerConfig,
    shutdown: watch::Receiver<bool>,
    health: RuntimeWorkerHealth,
) -> Result<(), String> {
    config.validate().map_err(|error| error.to_string())?;
    let worker_id = uuid::Uuid::new_v4();
    let mut interval = tokio::time::interval(config.poll_interval);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        if *shutdown.borrow() {
            return Ok(());
        }
        tokio::select! {
            _ = interval.tick() => {}
            _ = wait_for_shutdown(shutdown.clone()) => return Ok(()),
        }
        let observed_at = unix_now_seconds();
        match commands::day_scheduler::run_day_event_scheduler_once(
            &pool,
            &config,
            worker_id,
            observed_at,
        )
        .await
        {
            Ok(report) => {
                let progress = report.succeeded_games as u64;
                let backlog = day_event_backlog(&pool).await.ok();
                health.heartbeat(DAY_EVENT_WORKER, progress, backlog);
            }
            Err(error) => {
                tracing::error!(
                    event = "day_event_worker_failed",
                    worker_id = %worker_id,
                    error = %error,
                    "DayEvent scheduler iteration failed"
                );
                health.iteration_failed(DAY_EVENT_WORKER);
            }
        }
    }
}

async fn run_identity_delivery_worker(
    pool: PgPool,
    gateway: Arc<dyn IdentityDeliveryGateway>,
    idle_interval: Duration,
    error_backoff: Duration,
    shutdown: watch::Receiver<bool>,
    health: RuntimeWorkerHealth,
) -> Result<(), String> {
    let mut backlog = None;
    let mut next_backlog_sample = Instant::now();
    loop {
        if *shutdown.borrow() {
            return Ok(());
        }
        match api::identity_delivery::process_next_identity_delivery(
            &pool,
            gateway.as_ref(),
            unix_now_seconds(),
        )
        .await
        {
            Ok(receipt) => {
                let progress = if receipt.is_some() { 1 } else { 0 };
                if Instant::now() >= next_backlog_sample {
                    backlog = identity_delivery_backlog(&pool).await.ok();
                    next_backlog_sample = Instant::now() + Duration::from_secs(1);
                }
                health.heartbeat(IDENTITY_DELIVERY_WORKER, progress, backlog);
                if receipt.is_none() && wait_or_shutdown(idle_interval, shutdown.clone()).await {
                    return Ok(());
                }
            }
            Err(error) => {
                tracing::error!(
                    event = "identity_delivery_worker_failed",
                    error = %error,
                    "identity delivery worker iteration failed"
                );
                health.iteration_failed(IDENTITY_DELIVERY_WORKER);
                if wait_or_shutdown(error_backoff, shutdown.clone()).await {
                    return Ok(());
                }
            }
        }
    }
}

async fn subject_erasure_backlog(pool: &PgPool) -> Result<u64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM subject_erasure WHERE state = 'pending'")
        .fetch_one(pool)
        .await
        .map(|count| count.max(0) as u64)
}

async fn day_event_backlog(pool: &PgPool) -> Result<u64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM day_event_schedule_work WHERE auto_resolve_pending OR narrative_pending",
    )
    .fetch_one(pool)
    .await
    .map(|count| count.max(0) as u64)
}

async fn identity_delivery_backlog(pool: &PgPool) -> Result<u64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM auth_delivery_intent WHERE status IN ('pending', 'retryable_failed')",
    )
    .fetch_one(pool)
    .await
    .map(|count| count.max(0) as u64)
}

async fn wait_or_shutdown(duration: Duration, shutdown: watch::Receiver<bool>) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(duration) => false,
        _ = wait_for_shutdown(shutdown) => true,
    }
}

async fn wait_for_shutdown(mut shutdown: watch::Receiver<bool>) {
    if *shutdown.borrow() {
        return;
    }
    while shutdown.changed().await.is_ok() {
        if *shutdown.borrow() {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        supervise_worker, RuntimeWorkerHealth, SupervisorFailure, WorkerPolicy, WorkerSpec,
    };
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::{mpsc, watch};

    #[tokio::test]
    async fn fatal_policy_surfaces_early_exit() {
        let health = RuntimeWorkerHealth::default();
        health.register("test-fatal", true);
        let (shutdown, receiver) = watch::channel(false);
        let (fatal_sender, mut fatal) = mpsc::unbounded_channel();
        let spec = WorkerSpec {
            name: "test-fatal",
            required: true,
            policy: WorkerPolicy::Fatal,
            factory: Arc::new(|_, _| Box::pin(async { Ok(()) })),
        };
        supervise_worker(spec, receiver, health, fatal_sender).await;
        assert_eq!(
            fatal.recv().await,
            Some(SupervisorFailure {
                worker: "test-fatal",
                reason: "worker exited before shutdown".to_string(),
            })
        );
        drop(shutdown);
    }

    #[tokio::test]
    async fn restart_policy_contains_panic_then_recovers_until_shutdown() {
        let health = RuntimeWorkerHealth::default();
        health.register("test-restart", true);
        let attempts = Arc::new(std::sync::atomic::AtomicU32::new(0));
        let (shutdown, receiver) = watch::channel(false);
        let (fatal_sender, mut fatal) = mpsc::unbounded_channel();
        let factory_attempts = attempts.clone();
        let spec = WorkerSpec {
            name: "test-restart",
            required: true,
            policy: WorkerPolicy::Restart {
                backoff: Duration::from_millis(1),
                limit: 2,
            },
            factory: Arc::new(move |mut stop, health| {
                let attempt = factory_attempts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Box::pin(async move {
                    if attempt == 0 {
                        panic!("synthetic worker panic");
                    }
                    health.heartbeat("test-restart", 0, Some(0));
                    let _ = stop.changed().await;
                    Ok(())
                })
            }),
        };
        let task = tokio::spawn(supervise_worker(
            spec,
            receiver,
            health.clone(),
            fatal_sender,
        ));
        tokio::time::timeout(Duration::from_secs(1), async {
            while attempts.load(std::sync::atomic::Ordering::SeqCst) < 2 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(health.required_workers_ready());
        shutdown.send(true).unwrap();
        task.await.unwrap();
        assert!(fatal.try_recv().is_err());
    }
}
