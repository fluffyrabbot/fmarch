//! Hosted object-storage conformance (Hetzner/Kamal RFC, slice S2).
//!
//! The application relies on two provider behaviours that S3-compatible
//! services do not all share: a create-only put (`If-None-Match: *`) must
//! refuse an existing object, and a delete must make the object invisible.
//! The subject journal additionally depends on its credential being unable
//! to delete. `fmarch-storage-conformance` runs these probes against the
//! real buckets of an environment and fails closed on any deviation.
//!
//! Probes write small objects under [`PROBE_PREFIX`]. In the journal bucket
//! they are retained by design (Object Lock); they sit outside every prefix
//! the application lists.

use std::future::Future;
use std::sync::Arc;

use bytes::Bytes;
use object_store::path::Path as ObjectPath;
use object_store::{ObjectStore, ObjectStoreExt, PutMode};
use serde::Serialize;

pub const PROBE_PREFIX: &str = "fmarch-storage-conformance";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreateOutcome {
    Created,
    AlreadyExists,
}

/// The three operations the probes need. Implemented for real object stores
/// and for test doubles that model non-conforming providers.
pub trait ProbeStore: Sync {
    fn create(
        &self,
        path: &str,
        body: Bytes,
    ) -> impl Future<Output = Result<CreateOutcome, String>> + Send;
    fn delete(&self, path: &str) -> impl Future<Output = Result<(), String>> + Send;
    fn exists(&self, path: &str) -> impl Future<Output = Result<bool, String>> + Send;
}

impl ProbeStore for Arc<dyn ObjectStore> {
    async fn create(&self, path: &str, body: Bytes) -> Result<CreateOutcome, String> {
        match self
            .put_opts(&ObjectPath::from(path), body.into(), PutMode::Create.into())
            .await
        {
            Ok(_) => Ok(CreateOutcome::Created),
            Err(object_store::Error::AlreadyExists { .. }) => Ok(CreateOutcome::AlreadyExists),
            Err(error) => Err(error.to_string()),
        }
    }

    async fn delete(&self, path: &str) -> Result<(), String> {
        self.as_ref()
            .delete(&ObjectPath::from(path))
            .await
            .map_err(|error| error.to_string())
    }

    async fn exists(&self, path: &str) -> Result<bool, String> {
        match self.head(&ObjectPath::from(path)).await {
            Ok(_) => Ok(true),
            Err(object_store::Error::NotFound { .. }) => Ok(false),
            Err(error) => Err(error.to_string()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConformanceCheck {
    pub store: String,
    pub check: &'static str,
    pub passed: bool,
    pub detail: String,
}

fn check(
    store: &str,
    name: &'static str,
    passed: bool,
    detail: impl Into<String>,
) -> ConformanceCheck {
    ConformanceCheck {
        store: store.to_string(),
        check: name,
        passed,
        detail: detail.into(),
    }
}

fn probe_path(probe_id: &str) -> String {
    format!("{PROBE_PREFIX}/{probe_id}.probe")
}

/// Shared first half: a fresh create succeeds and a second create of the
/// same path is refused. Returns `None` when the store cannot even write.
async fn conditional_create<S: ProbeStore>(
    store: &S,
    name: &str,
    path: &str,
    checks: &mut Vec<ConformanceCheck>,
) -> Option<()> {
    let body = Bytes::from(format!("{{\"probe\":\"{path}\"}}"));
    match store.create(path, body.clone()).await {
        Ok(CreateOutcome::Created) => {}
        Ok(CreateOutcome::AlreadyExists) => {
            checks.push(check(
                name,
                "create",
                false,
                "a fresh probe path already existed",
            ));
            return None;
        }
        Err(error) => {
            checks.push(check(name, "create", false, error));
            return None;
        }
    }
    checks.push(check(name, "create", true, "probe written"));
    match store.create(path, body).await {
        Ok(CreateOutcome::AlreadyExists) => {
            checks.push(check(
                name,
                "conditional-create",
                true,
                "second create refused",
            ));
        }
        Ok(CreateOutcome::Created) => checks.push(check(
            name,
            "conditional-create",
            false,
            "provider overwrote an existing object on a create-only put",
        )),
        Err(error) => checks.push(check(name, "conditional-create", false, error)),
    }
    Some(())
}

/// For stores the application deletes from (media, subject keys): create-only
/// puts are honoured and a delete makes the object invisible.
pub async fn deletable_store<S: ProbeStore>(
    store: &S,
    name: &str,
    probe_id: &str,
) -> Vec<ConformanceCheck> {
    let path = probe_path(probe_id);
    let mut checks = Vec::new();
    if conditional_create(store, name, &path, &mut checks)
        .await
        .is_none()
    {
        return checks;
    }
    if let Err(error) = store.delete(&path).await {
        checks.push(check(name, "delete", false, error));
        return checks;
    }
    checks.push(match store.exists(&path).await {
        Ok(false) => check(name, "delete-hides", true, "deleted probe is invisible"),
        Ok(true) => check(
            name,
            "delete-hides",
            false,
            "deleted probe is still visible",
        ),
        Err(error) => check(name, "delete-hides", false, error),
    });
    checks
}

/// For the create-only subject journal: create-only puts are honoured and
/// its credential cannot delete, so the probe survives a delete attempt.
pub async fn create_only_store<S: ProbeStore>(
    store: &S,
    name: &str,
    probe_id: &str,
) -> Vec<ConformanceCheck> {
    let path = probe_path(probe_id);
    let mut checks = Vec::new();
    if conditional_create(store, name, &path, &mut checks)
        .await
        .is_none()
    {
        return checks;
    }
    checks.push(match store.delete(&path).await {
        Err(error) => check(
            name,
            "delete-refused",
            true,
            format!("delete refused: {error}"),
        ),
        Ok(()) => check(
            name,
            "delete-refused",
            false,
            "journal credential was allowed to delete",
        ),
    });
    checks.push(match store.exists(&path).await {
        Ok(true) => check(name, "probe-retained", true, "probe still visible"),
        Ok(false) => check(name, "probe-retained", false, "journal probe disappeared"),
        Err(error) => check(name, "probe-retained", false, error),
    });
    checks
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeStore {
        objects: Mutex<HashSet<String>>,
        ignores_conditions: bool,
        delete_denied: bool,
        delete_is_silent: bool,
    }

    impl ProbeStore for FakeStore {
        async fn create(&self, path: &str, _body: Bytes) -> Result<CreateOutcome, String> {
            let inserted = self.objects.lock().unwrap().insert(path.to_string());
            Ok(if inserted || self.ignores_conditions {
                CreateOutcome::Created
            } else {
                CreateOutcome::AlreadyExists
            })
        }

        async fn delete(&self, path: &str) -> Result<(), String> {
            if self.delete_denied {
                return Err("access denied".to_string());
            }
            if !self.delete_is_silent {
                self.objects.lock().unwrap().remove(path);
            }
            Ok(())
        }

        async fn exists(&self, path: &str) -> Result<bool, String> {
            Ok(self.objects.lock().unwrap().contains(path))
        }
    }

    fn failed(checks: &[ConformanceCheck]) -> Vec<&'static str> {
        checks
            .iter()
            .filter(|check| !check.passed)
            .map(|check| check.check)
            .collect()
    }

    #[tokio::test]
    async fn conforming_stores_pass_every_probe() {
        let media = deletable_store(&FakeStore::default(), "media", "p1").await;
        assert_eq!(media.len(), 3);
        assert!(failed(&media).is_empty(), "{media:?}");
        let journal = FakeStore {
            delete_denied: true,
            ..FakeStore::default()
        };
        let journal = create_only_store(&journal, "subject-journal", "p2").await;
        assert_eq!(journal.len(), 4);
        assert!(failed(&journal).is_empty(), "{journal:?}");
    }

    #[tokio::test]
    async fn each_provider_deviation_is_reported() {
        let overwrite = FakeStore {
            ignores_conditions: true,
            ..FakeStore::default()
        };
        assert_eq!(
            failed(&deletable_store(&overwrite, "media", "p").await),
            ["conditional-create"]
        );

        let silent = FakeStore {
            delete_is_silent: true,
            ..FakeStore::default()
        };
        assert_eq!(
            failed(&deletable_store(&silent, "subject-keys", "p").await),
            ["delete-hides"]
        );

        let deletable_journal = FakeStore::default();
        assert_eq!(
            failed(&create_only_store(&deletable_journal, "subject-journal", "p").await),
            ["delete-refused", "probe-retained"]
        );
    }
}
