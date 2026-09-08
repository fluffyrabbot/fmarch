use super::{unix_now_seconds, WorkerBudget};
use api::identity_delivery::{
    IdentityDeliveryAdmission, IdentityDeliveryGateway, IdentityDeliveryWorkerConfig,
    IdentityDeliveryWorkerObservation, IdentityDeliveryWorkerObservationKind,
};
use api::{ApiState, RuntimeWorkerHealth};
use sqlx::PgPool;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

const SUBJECT_ERASURE_WORKER: &str = "subject-erasure";
const DAY_EVENT_WORKER: &str = "day-event-scheduler";
const IDENTITY_DELIVERY_WORKER: &str = "identity-delivery";
const LIVE_EVENT_LISTENER: &str = "live-event-listener";
const MEDIA_RECONCILIATION_WORKER: &str = "media-reconciliation";

type WorkerFuture = Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'static>>;
type WorkerFactory =
    Arc<dyn Fn(watch::Receiver<bool>, RuntimeWorkerHealth) -> WorkerFuture + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WorkerPolicy {
    RequiredFatal,
    RequiredRestart { backoff: Duration, limit: u32 },
    DegradedRestart { backoff: Duration },
}

impl WorkerPolicy {
    fn required(self) -> bool {
        matches!(self, Self::RequiredFatal | Self::RequiredRestart { .. })
    }
}

#[derive(Clone)]
struct WorkerSpec {
    name: &'static str,
    policy: WorkerPolicy,
    factory: WorkerFactory,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SupervisorFailure {
    pub(super) worker: &'static str,
    pub(super) reason: String,
}

pub(super) struct IdentityDeliveryWorkerBinding {
    gateway: Arc<dyn IdentityDeliveryGateway>,
    config: IdentityDeliveryWorkerConfig,
    admission: IdentityDeliveryAdmission,
}

impl IdentityDeliveryWorkerBinding {
    pub(super) fn new(
        gateway: Arc<dyn IdentityDeliveryGateway>,
        config: IdentityDeliveryWorkerConfig,
        admission: IdentityDeliveryAdmission,
    ) -> Self {
        Self {
            gateway,
            config,
            admission,
        }
    }
}

pub(super) struct RuntimeSupervisor {
    shutdown: watch::Sender<bool>,
    fatal: mpsc::UnboundedReceiver<SupervisorFailure>,
    startup_fatal_sender: Option<mpsc::UnboundedSender<SupervisorFailure>>,
    tasks: Vec<JoinHandle<()>>,
    health: RuntimeWorkerHealth,
    readiness_grace: Duration,
    drain_timeout: Duration,
}

impl RuntimeSupervisor {
    /// Start only the workers whose readiness gates process activation.
    ///
    /// Identity delivery is added after these workers report ready and the
    /// composition root has committed the durable provider-generation bind.
    pub(super) fn start_required(
        pool: PgPool,
        api_state: ApiState,
        scheduler: commands::day_scheduler::DayEventSchedulerConfig,
        budget: WorkerBudget,
        health: RuntimeWorkerHealth,
    ) -> Self {
        let (shutdown, _) = watch::channel(false);
        let (fatal_sender, fatal) = mpsc::unbounded_channel();
        let specs = vec![
            subject_erasure_spec(pool.clone(), &budget),
            day_event_spec(pool.clone(), scheduler),
            media_reconciliation_spec(pool.clone(), api_state.clone(), &budget),
            live_listener_spec(api_state, &budget),
        ];
        let mut tasks = Vec::with_capacity(specs.len());
        for spec in specs {
            health.register(spec.name, spec.policy.required());
            tasks.push(tokio::spawn(supervise_worker(
                spec,
                shutdown.subscribe(),
                health.clone(),
                fatal_sender.clone(),
            )));
        }
        Self {
            shutdown,
            fatal,
            startup_fatal_sender: Some(fatal_sender),
            tasks,
            health,
            readiness_grace: budget.readiness_grace,
            drain_timeout: budget.shutdown_drain_timeout,
        }
    }

    /// Add the degradable delivery worker after provider authority is bound.
    ///
    /// Taking the startup sender makes this a single-use phase transition and
    /// restores channel-closure detection once every supervisor task exits.
    pub(super) fn start_identity_delivery(
        &mut self,
        pool: PgPool,
        identity_delivery: IdentityDeliveryWorkerBinding,
        budget: &WorkerBudget,
    ) {
        let spec = identity_delivery_spec(
            pool,
            identity_delivery.gateway,
            identity_delivery.config,
            identity_delivery.admission,
            budget,
        );
        self.health.register(spec.name, spec.policy.required());
        let fatal_sender = self
            .startup_fatal_sender
            .take()
            .expect("identity delivery startup phase may be completed only once");
        self.tasks.push(tokio::spawn(supervise_worker(
            spec,
            self.shutdown.subscribe(),
            self.health.clone(),
            fatal_sender,
        )));
    }

    pub(super) fn shutdown_receiver(&self) -> watch::Receiver<bool> {
        self.shutdown.subscribe()
    }

    pub(super) fn request_shutdown(&self) {
        let _ = self.shutdown.send(true);
    }

    pub(super) async fn wait_for_fatal(&mut self) -> Option<SupervisorFailure> {
        self.fatal.recv().await
    }

    pub(super) async fn wait_until_ready(&mut self) -> Result<(), String> {
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

    pub(super) async fn shutdown(mut self) -> Result<(), String> {
        self.request_shutdown();
        let deadline = tokio::time::Instant::now() + self.drain_timeout;
        let mut failures = Vec::new();
        for mut task in self.tasks.drain(..) {
            match tokio::time::timeout_at(deadline, &mut task).await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => failures.push(format!("supervisor task join failed: {error}")),
                Err(_) => {
                    task.abort();
                    match task.await {
                        Ok(()) => {}
                        Err(error) if error.is_cancelled() => {}
                        Err(error) => failures.push(format!(
                            "aborted supervisor task failed while joining: {error}"
                        )),
                    }
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

impl Drop for RuntimeSupervisor {
    fn drop(&mut self) {
        let _ = self.shutdown.send(true);
        for task in &self.tasks {
            task.abort();
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
        // JoinSet aborts its children on drop, so aborting a timed-out
        // supervisor cannot detach the worker attempt it currently owns.
        let mut attempt_set = tokio::task::JoinSet::new();
        attempt_set.spawn((spec.factory)(shutdown.clone(), health.clone()));
        let attempt = attempt_set
            .join_next()
            .await
            .expect("supervisor attempt set must contain one worker");
        if *shutdown.borrow() {
            health.mark_stopped(spec.name, false);
            return;
        }
        let reason = match attempt {
            Ok(Ok(())) => "worker exited before shutdown".to_string(),
            Ok(Err(_)) => "worker reported a bounded failure".to_string(),
            Err(error) if error.is_panic() => "worker panicked".to_string(),
            Err(_) => "worker join failed".to_string(),
        };
        match spec.policy {
            WorkerPolicy::RequiredFatal => {
                health.mark_stopped(spec.name, false);
                let _ = fatal.send(SupervisorFailure {
                    worker: spec.name,
                    reason,
                });
                return;
            }
            WorkerPolicy::RequiredRestart { backoff, limit } if restarts < limit => {
                restarts = restarts.saturating_add(1);
                health.mark_stopped(spec.name, true);
                tracing::warn!(
                    event = "runtime_worker_restarting",
                    worker = spec.name,
                    restart = restarts,
                    failure = reason.as_str(),
                    "runtime worker exited unexpectedly; restarting"
                );
                if wait_or_shutdown(backoff, shutdown.clone()).await {
                    return;
                }
            }
            WorkerPolicy::RequiredRestart { .. } => {
                health.mark_stopped(spec.name, false);
                let _ = fatal.send(SupervisorFailure {
                    worker: spec.name,
                    reason: format!("restart budget exhausted after {restarts} restarts: {reason}"),
                });
                return;
            }
            WorkerPolicy::DegradedRestart { backoff } => {
                restarts = restarts.saturating_add(1);
                health.mark_stopped(spec.name, true);
                tracing::warn!(
                    event = "runtime_worker_degraded_restarting",
                    worker = spec.name,
                    restart = restarts,
                    failure = reason.as_str(),
                    "degraded runtime worker exited unexpectedly; site remains available while recovery continues"
                );
                if wait_or_shutdown(backoff, shutdown.clone()).await {
                    return;
                }
            }
        }
    }
}

fn subject_erasure_spec(pool: PgPool, budget: &WorkerBudget) -> WorkerSpec {
    let idle = budget.subject_erasure_idle_interval;
    let error_backoff = budget.subject_erasure_error_backoff;
    WorkerSpec {
        name: SUBJECT_ERASURE_WORKER,
        policy: WorkerPolicy::RequiredFatal,
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
) -> WorkerSpec {
    WorkerSpec {
        name: DAY_EVENT_WORKER,
        // The worker contains database iteration failures and keeps polling.
        // Reaching the supervisor means invalid startup configuration or an
        // unexpected exit, which is a process-fatal condition rather than a
        // restart-budget concern.
        policy: WorkerPolicy::RequiredFatal,
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
    config: IdentityDeliveryWorkerConfig,
    admission: IdentityDeliveryAdmission,
    budget: &WorkerBudget,
) -> WorkerSpec {
    WorkerSpec {
        name: IDENTITY_DELIVERY_WORKER,
        // A durable provider suspension blocks new credential issuance and is
        // visible in worker/admin diagnostics, but it must not boot-loop or
        // withdraw the rest of the site. The HTTP and administrative recovery
        // surfaces must remain available while delivery is degraded.
        policy: WorkerPolicy::DegradedRestart {
            backoff: budget.worker_restart_backoff,
        },
        factory: Arc::new(move |shutdown, health| {
            let pool = pool.clone();
            let gateway = gateway.clone();
            let admission = admission.clone();
            Box::pin(async move {
                let heartbeat_health = health.clone();
                let mut failure_latched = false;
                api::identity_delivery::run_identity_delivery_worker_observed(
                    pool,
                    gateway,
                    config,
                    admission,
                    shutdown,
                    move |observation| {
                        record_identity_delivery_health(
                            &heartbeat_health,
                            &mut failure_latched,
                            observation,
                        );
                    },
                )
                .await
                .map_err(|error| format!("identity delivery worker failed: {error}"))
            })
        }),
    }
}

fn record_identity_delivery_health(
    health: &RuntimeWorkerHealth,
    failure_latched: &mut bool,
    observation: IdentityDeliveryWorkerObservation,
) {
    if observation.attempt_errors > 0 {
        *failure_latched = true;
        health.iteration_failed(IDENTITY_DELIVERY_WORKER);
        return;
    }
    if matches!(
        observation.kind,
        IdentityDeliveryWorkerObservationKind::EmptyClaim
            | IdentityDeliveryWorkerObservationKind::AttemptFinished
    ) {
        *failure_latched = false;
    }
    if !*failure_latched {
        health.heartbeat_with_load(
            IDENTITY_DELIVERY_WORKER,
            observation.completed,
            None,
            Some(observation.in_flight as u64),
        );
    }
}

fn live_listener_spec(api_state: ApiState, budget: &WorkerBudget) -> WorkerSpec {
    WorkerSpec {
        name: LIVE_EVENT_LISTENER,
        policy: WorkerPolicy::RequiredRestart {
            backoff: budget.worker_restart_backoff,
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

fn media_reconciliation_spec(
    pool: PgPool,
    api_state: ApiState,
    budget: &WorkerBudget,
) -> WorkerSpec {
    let interval = budget.media_reconciliation_interval;
    let probe_timeout = budget.media_reconciliation_timeout;
    let batch_size = budget.media_reconciliation_batch_size;
    WorkerSpec {
        name: MEDIA_RECONCILIATION_WORKER,
        policy: WorkerPolicy::RequiredFatal,
        factory: Arc::new(move |shutdown, health| {
            let pool = pool.clone();
            let state = api_state.clone();
            Box::pin(run_media_reconciliation_worker(
                pool,
                state,
                interval,
                probe_timeout,
                batch_size,
                shutdown,
                health,
            ))
        }),
    }
}

async fn run_media_reconciliation_worker(
    pool: PgPool,
    state: ApiState,
    interval: Duration,
    probe_timeout: Duration,
    batch_size: i64,
    shutdown: watch::Receiver<bool>,
    health: RuntimeWorkerHealth,
) -> Result<(), String> {
    loop {
        if *shutdown.borrow() {
            return Ok(());
        }
        match api::reconcile_media_uploads_once(&state, batch_size, probe_timeout).await {
            Ok(report) => {
                let backlog = media_reconciliation_backlog(&pool).await.ok();
                health.heartbeat_with_load(
                    MEDIA_RECONCILIATION_WORKER,
                    report.completed(),
                    backlog,
                    Some(0),
                );
                if report.failures > 0 {
                    health.iteration_failed(MEDIA_RECONCILIATION_WORKER);
                }
            }
            Err(_) => {
                tracing::error!(
                    event = "media_reconciliation_worker_failed",
                    "media reconciliation worker iteration failed"
                );
                health.iteration_failed(MEDIA_RECONCILIATION_WORKER);
            }
        }
        if wait_or_shutdown(interval, shutdown.clone()).await {
            return Ok(());
        }
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
            Err(_) => {
                tracing::error!(
                    event = "subject_erasure_worker_failed",
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
            Err(_) => {
                tracing::error!(
                    event = "day_event_worker_failed",
                    worker_id = %worker_id,
                    "DayEvent scheduler iteration failed"
                );
                health.iteration_failed(DAY_EVENT_WORKER);
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

async fn media_reconciliation_backlog(pool: &PgPool) -> Result<u64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM media_upload_ledger WHERE state IN ('installing', 'reclaiming')",
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
        record_identity_delivery_health, supervise_worker, RuntimeWorkerHealth, SupervisorFailure,
        WorkerPolicy, WorkerSpec, IDENTITY_DELIVERY_WORKER,
    };
    use api::identity_delivery::{
        IdentityDeliveryWorkerObservation, IdentityDeliveryWorkerObservationKind,
    };
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::{mpsc, watch};

    #[test]
    fn identity_delivery_failure_ignores_timer_ticks_but_clears_after_an_empty_claim() {
        let health = RuntimeWorkerHealth::default();
        health.register(IDENTITY_DELIVERY_WORKER, false);
        let mut failure_latched = false;
        record_identity_delivery_health(
            &health,
            &mut failure_latched,
            IdentityDeliveryWorkerObservation {
                completed: 0,
                attempt_errors: 0,
                in_flight: 1,
                kind: IdentityDeliveryWorkerObservationKind::AttemptStarted,
            },
        );
        assert!(health.required_workers_ready());

        record_identity_delivery_health(
            &health,
            &mut failure_latched,
            IdentityDeliveryWorkerObservation {
                completed: 0,
                attempt_errors: 1,
                in_flight: 0,
                kind: IdentityDeliveryWorkerObservationKind::AttemptFinished,
            },
        );
        assert!(health.required_workers_ready());
        assert!(!health.snapshot()[0].healthy);

        record_identity_delivery_health(
            &health,
            &mut failure_latched,
            IdentityDeliveryWorkerObservation {
                completed: 0,
                attempt_errors: 0,
                in_flight: 1,
                kind: IdentityDeliveryWorkerObservationKind::AttemptStarted,
            },
        );
        assert!(health.required_workers_ready());
        assert!(!health.snapshot()[0].healthy);

        record_identity_delivery_health(
            &health,
            &mut failure_latched,
            IdentityDeliveryWorkerObservation {
                completed: 0,
                attempt_errors: 0,
                in_flight: 0,
                kind: IdentityDeliveryWorkerObservationKind::TimerTick,
            },
        );
        assert!(health.required_workers_ready());
        assert!(!health.snapshot()[0].healthy);

        record_identity_delivery_health(
            &health,
            &mut failure_latched,
            IdentityDeliveryWorkerObservation {
                completed: 0,
                attempt_errors: 0,
                in_flight: 0,
                kind: IdentityDeliveryWorkerObservationKind::EmptyClaim,
            },
        );
        assert!(health.required_workers_ready());
        assert!(health.snapshot()[0].healthy);
    }

    #[tokio::test]
    async fn fatal_policy_surfaces_early_exit() {
        let health = RuntimeWorkerHealth::default();
        health.register("test-fatal", true);
        let (shutdown, receiver) = watch::channel(false);
        let (fatal_sender, mut fatal) = mpsc::unbounded_channel();
        let spec = WorkerSpec {
            name: "test-fatal",
            policy: WorkerPolicy::RequiredFatal,
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
            policy: WorkerPolicy::RequiredRestart {
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

    #[tokio::test]
    async fn required_restart_exhaustion_is_process_fatal() {
        let health = RuntimeWorkerHealth::default();
        health.register("test-required-restart", true);
        let attempts = Arc::new(std::sync::atomic::AtomicU32::new(0));
        let (_shutdown, receiver) = watch::channel(false);
        let (fatal_sender, mut fatal) = mpsc::unbounded_channel();
        let factory_attempts = attempts.clone();
        let spec = WorkerSpec {
            name: "test-required-restart",
            policy: WorkerPolicy::RequiredRestart {
                backoff: Duration::from_millis(1),
                limit: 1,
            },
            factory: Arc::new(move |_, _| {
                factory_attempts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Box::pin(async { Err("synthetic required-worker failure".to_string()) })
            }),
        };

        supervise_worker(spec, receiver, health.clone(), fatal_sender).await;

        assert_eq!(attempts.load(std::sync::atomic::Ordering::SeqCst), 2);
        assert_eq!(
            fatal.recv().await,
            Some(SupervisorFailure {
                worker: "test-required-restart",
                reason:
                    "restart budget exhausted after 1 restarts: worker reported a bounded failure"
                        .to_string(),
            })
        );
        let worker = &health.snapshot()[0];
        assert!(worker.required);
        assert!(!worker.running);
        assert!(!worker.healthy);
        assert_eq!(worker.restart_count, 1);
    }

    #[tokio::test]
    async fn degraded_restart_keeps_recovering_without_a_finite_budget() {
        let health = RuntimeWorkerHealth::default();
        health.register("test-degraded-restart", false);
        let attempts = Arc::new(std::sync::atomic::AtomicU32::new(0));
        let (shutdown, receiver) = watch::channel(false);
        let (fatal_sender, mut fatal) = mpsc::unbounded_channel();
        let factory_attempts = attempts.clone();
        let spec = WorkerSpec {
            name: "test-degraded-restart",
            policy: WorkerPolicy::DegradedRestart {
                backoff: Duration::from_millis(1),
            },
            factory: Arc::new(move |mut stop, health| {
                let attempt = factory_attempts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Box::pin(async move {
                    if attempt < 2 {
                        return Err("synthetic degraded-worker failure".to_string());
                    }
                    health.heartbeat("test-degraded-restart", 0, Some(0));
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
            while attempts.load(std::sync::atomic::Ordering::SeqCst) < 3 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        assert!(fatal.try_recv().is_err());
        let worker = &health.snapshot()[0];
        assert!(!worker.required);
        assert!(worker.running);
        assert!(worker.healthy);
        assert_eq!(worker.restart_count, 2);
        assert!(health.required_workers_ready());
        shutdown.send(true).unwrap();
        task.await.unwrap();
    }
}
