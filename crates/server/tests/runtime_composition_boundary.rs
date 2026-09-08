use std::path::PathBuf;

#[test]
fn process_root_owns_runtime_budgets_and_worker_lifecycle() {
    let server_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let workspace_crates = server_root.parent().unwrap().parent().unwrap();
    let main = std::fs::read_to_string(server_root.join("main.rs")).unwrap();
    let supervisor = std::fs::read_to_string(server_root.join("runtime_supervisor.rs")).unwrap();
    let api = std::fs::read_to_string(workspace_crates.join("api/src/lib.rs")).unwrap();
    let auth_http = std::fs::read_to_string(workspace_crates.join("api/src/auth_http.rs")).unwrap();
    let authentication =
        std::fs::read_to_string(workspace_crates.join("api/src/authentication.rs")).unwrap();
    let identity_delivery =
        std::fs::read_to_string(workspace_crates.join("api/src/identity_delivery.rs")).unwrap();

    for key in [
        "FMARCH_DB_MAX_CONNECTIONS",
        "FMARCH_HTTP_MAX_IN_FLIGHT",
        "FMARCH_WS_MAX_CONNECTIONS",
        "FMARCH_COMMAND_MAX_IN_FLIGHT",
        "FMARCH_AUTHORITY_TRANSACTION_MAX_IN_FLIGHT",
        "FMARCH_MEDIA_MAX_IN_FLIGHT",
        "FMARCH_MEDIA_RECONCILIATION_TIMEOUT_MS",
        "FMARCH_IDENTITY_DELIVERY_PROVIDER_CLOCK_SKEW_MARGIN_MS",
        "FMARCH_WORKER_HEARTBEAT_STALE_MS",
        "FMARCH_SHUTDOWN_DRAIN_TIMEOUT_MS",
    ] {
        assert!(main.contains(key), "composition root does not own {key}");
    }
    for library_source in [&api, &auth_http, &authentication, &identity_delivery] {
        assert!(
            !library_source.contains("std::env"),
            "API runtime libraries must not inspect ambient process configuration"
        );
        assert!(
            !library_source.contains("env_i64("),
            "API runtime libraries must consume typed budget values"
        );
    }
    assert!(!api.contains("spawn_listener("));
    assert!(main.contains("with_graceful_shutdown"));
    assert!(main.contains("pool.close().await"));
    assert!(main.contains("identity_delivery_gateway_from_env"));
    assert!(main.contains("dyn api::identity_delivery::IdentityDeliveryGateway"));
    assert!(!main.contains("HttpJsonIdentityDeliveryGateway::from_env"));
    assert!(supervisor.contains("pub(super) fn start_required("));
    assert!(supervisor.contains("startup_fatal_sender: Option<"));
    assert!(supervisor.contains("pub(super) fn start_identity_delivery("));
    assert!(supervisor.contains(".startup_fatal_sender\n            .take()"));
    for worker in [
        "subject_erasure_spec",
        "day_event_spec",
        "identity_delivery_spec",
        "live_listener_spec",
        "media_reconciliation_spec",
    ] {
        assert!(
            supervisor.contains(worker),
            "supervisor does not own {worker}"
        );
    }
    assert!(supervisor.contains("worker panicked"));
    assert!(supervisor.contains("restart budget exhausted"));
    assert!(supervisor.contains("WorkerPolicy::RequiredRestart"));
    assert!(supervisor.contains("WorkerPolicy::DegradedRestart"));
    assert!(supervisor.contains("run_identity_delivery_worker_observed"));
    assert!(supervisor
        .contains("name: IDENTITY_DELIVERY_WORKER,\n        // A durable provider suspension"));
    assert!(supervisor.contains("policy: WorkerPolicy::DegradedRestart"));
    assert!(supervisor.contains("event = \"runtime_worker_degraded_restarting\""));
    assert!(supervisor.contains("site remains available while recovery continues"));
    assert!(supervisor.contains("task.abort()"));
    assert!(supervisor.contains("task.await"));
    assert!(!identity_delivery.contains("spawn_identity_delivery_worker"));

    let listener_position = main.find("TcpListener::bind(config.bind)").unwrap();
    let required_start_position = main.find("RuntimeSupervisor::start_required(").unwrap();
    let readiness_position = main.find("supervisor.wait_until_ready()").unwrap();
    let provider_bind_position = main
        .find("bind_identity_delivery_provider_authority(")
        .unwrap();
    let delivery_start_position = main.find("supervisor.start_identity_delivery(").unwrap();
    let serve_position = main.find("axum::serve(listener, app)").unwrap();
    assert!(
        listener_position < required_start_position
            && required_start_position < readiness_position
            && readiness_position < provider_bind_position
            && provider_bind_position < delivery_start_position
            && delivery_start_position < serve_position,
        "irreversible provider activation must follow listener ownership and required-worker readiness, then start delivery before serving"
    );
}

#[test]
fn http_budget_outlives_the_complete_synchronous_delivery_lifecycle() {
    let server_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let main = std::fs::read_to_string(server_root.join("main.rs")).unwrap();

    for contract in [
        "const IDENTITY_DELIVERY_HTTP_COMPLETION_MARGIN: Duration = Duration::from_secs(1)",
        "bounded_env(\"FMARCH_HTTP_REQUEST_TIMEOUT_MS\", 40_000, 10, 300_000)",
        "validate_identity_delivery_http_budget(",
        "authentication_database_budget,",
        ".saturating_add(self.database.statement_timeout_ms.saturating_mul(2))",
        "authentication_budget\n        .saturating_add(identity_delivery.lease_coverage_timeout())",
        ".lease_coverage_timeout()",
        ".saturating_add(IDENTITY_DELIVERY_HTTP_COMPLETION_MARGIN)",
        "if request_timeout <= required_timeout",
        "must exceed one database acquisition, both request-authentication statements, the complete identity delivery claim, preparation, provider, and finalization budget, and a one-second response margin",
        "bounded_env(\n                \"FMARCH_SHUTDOWN_DRAIN_TIMEOUT_MS\",\n                45_000",
        "validate_http_shutdown_budget(",
        "request_timeout.saturating_add(HTTP_SHUTDOWN_DRAIN_MARGIN)",
        "FMARCH_SHUTDOWN_DRAIN_TIMEOUT_MS must exceed FMARCH_HTTP_REQUEST_TIMEOUT_MS plus a one-second process-drain margin",
    ] {
        assert!(
            main.contains(contract),
            "synchronous identity-delivery HTTP budget drifted at {contract}"
        );
    }
}

#[test]
fn identity_delivery_admission_is_shared_by_http_retries_and_the_supervised_worker() {
    let server_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let workspace_crates = server_root.parent().unwrap().parent().unwrap();
    let main = std::fs::read_to_string(server_root.join("main.rs")).unwrap();
    let supervisor = std::fs::read_to_string(server_root.join("runtime_supervisor.rs")).unwrap();
    let api = std::fs::read_to_string(workspace_crates.join("api/src/lib.rs")).unwrap();
    let auth_http = std::fs::read_to_string(workspace_crates.join("api/src/auth_http.rs")).unwrap();
    let identity_delivery =
        std::fs::read_to_string(workspace_crates.join("api/src/identity_delivery.rs")).unwrap();

    assert!(auth_http.contains("#[derive(Clone)]\npub(super) struct AuthHttpState"));
    assert!(auth_http.contains("pub(super) identity_delivery_admission: IdentityDeliveryAdmission"));
    assert!(auth_http.contains(
        "identity_delivery_admission: IdentityDeliveryAdmission::new(\n                budget.identity_delivery_worker_config,\n            )"
    ));
    assert!(api.contains(
        "self.auth.identity_delivery_admission = IdentityDeliveryAdmission::new(config)"
    ));
    assert!(api.contains(
        "pub fn identity_delivery_admission(&self) -> IdentityDeliveryAdmission {\n        self.auth.identity_delivery_admission.clone()"
    ));

    assert!(main.contains(
        "config.api.auth.identity_delivery_worker_config,\n        api_state.identity_delivery_admission(),"
    ));
    assert!(!main.contains("IdentityDeliveryAdmission::new"));
    assert!(main.contains(
        "identity_delivery_gateway: std::sync::Arc<dyn api::identity_delivery::IdentityDeliveryGateway>"
    ));
    assert!(main.contains(".with_identity_delivery_gateway(identity_delivery_gateway.clone())"));
    assert!(main.contains(
        "let identity_delivery_worker = runtime_supervisor::IdentityDeliveryWorkerBinding::new("
    ));
    assert!(main.contains("supervisor.start_identity_delivery("));
    assert!(
        !main.contains("let identity_delivery_worker = if classic_enabled"),
        "provider-neutral delivery worker activation must not depend on classic authentication"
    );
    assert!(
        !main.contains(
            "identity delivery settings must be absent when classic authentication is disabled"
        ),
        "WorkOS-only deployments must be allowed to configure invitation delivery"
    );
    assert!(main.contains(
        "identity delivery requires FMARCH_IDENTITY_DELIVERY_ENDPOINT; the local deterministic delivery gateway is available only with FMARCH_DEV_AUTH=1 in a debug build"
    ));

    for binding_contract in [
        "admission: IdentityDeliveryAdmission",
        "identity_delivery.admission",
        "let admission = admission.clone()",
        "run_identity_delivery_worker_observed(\n                    pool,\n                    gateway,\n                    config,\n                    admission,",
    ] {
        assert!(
            supervisor.contains(binding_contract),
            "supervisor lost shared identity-delivery admission contract: {binding_contract}"
        );
    }
    assert!(!supervisor.contains("IdentityDeliveryAdmission::new"));

    assert!(identity_delivery.contains(
        "#[derive(Clone)]\npub struct IdentityDeliveryAdmission {\n    attempt_slots: Arc<Semaphore>,\n    database_slots: Arc<Semaphore>,"
    ));
    assert!(identity_delivery.contains(
        "Process-wide admission shared by the supervised worker and synchronous\n/// operator retries"
    ));
    assert!(identity_delivery.contains("permit = admission.acquire_attempt()"));
    assert!(identity_delivery.contains("let _database_permit = admission.acquire_database().await"));
    assert!(auth_http.contains(".identity_delivery_admission\n        .try_acquire_attempt()"));
    assert!(auth_http.contains("&state.identity_delivery_admission"));
}
