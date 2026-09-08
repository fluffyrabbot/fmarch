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
    assert!(supervisor.contains("Option<IdentityDeliveryWorkerBinding>"));
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
    assert!(supervisor.contains("run_identity_delivery_worker_observed"));
    assert!(supervisor.contains("task.abort()"));
    assert!(supervisor.contains("task.await"));
    assert!(!identity_delivery.contains("spawn_identity_delivery_worker"));
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
        "config.api.auth.identity_delivery_worker_config,\n            api_state.identity_delivery_admission(),"
    ));
    assert!(!main.contains("IdentityDeliveryAdmission::new"));

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
