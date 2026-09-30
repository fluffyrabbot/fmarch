use super::*;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, thiserror::Error)]
#[error("injected adapter failure")]
struct AdapterFailure;

#[derive(Clone)]
struct Stored {
    records: Vec<ForumEventRecord>,
    author: Option<Uuid>,
    moderator: bool,
    budget: u32,
    fail_charge: bool,
    fail_append: bool,
    rollbacks: u32,
}

#[derive(Clone)]
struct Store(Arc<Mutex<Stored>>);
struct Transaction {
    store: Store,
    staged: Stored,
    locked: bool,
}

impl ForumStore for Store {
    type Error = AdapterFailure;
    type Transaction = Transaction;
    async fn begin(&self) -> Result<Transaction, AdapterFailure> {
        Ok(Transaction {
            store: self.clone(),
            staged: self.0.lock().unwrap().clone(),
            locked: false,
        })
    }
}

impl ForumTransaction for Transaction {
    type Error = AdapterFailure;
    async fn load_forum_stream(
        &mut self,
        _: Uuid,
    ) -> Result<Vec<ForumEventRecord>, AdapterFailure> {
        self.locked = true;
        Ok(self.staged.records.clone())
    }
    async fn author_profile(&mut self, _: PrincipalId) -> Result<Option<Uuid>, AdapterFailure> {
        assert!(
            self.locked,
            "identity authority is acquired after the source lock"
        );
        Ok(self.staged.author)
    }
    async fn is_global_moderator(&mut self, _: PrincipalId) -> Result<bool, AdapterFailure> {
        Ok(self.staged.moderator)
    }
    async fn area_by_slug(&mut self, _: &str) -> Result<Option<Uuid>, AdapterFailure> {
        Ok(Some(Uuid::from_u128(1)))
    }
    async fn reserve_area_slug(&mut self, _: Uuid, _: &str) -> Result<bool, AdapterFailure> {
        Ok(true)
    }
    async fn public_mention_profile(
        &mut self,
        _: &str,
    ) -> Result<Option<MentionProfile>, AdapterFailure> {
        Ok(None)
    }
    async fn quotation_thread(
        &mut self,
        topic: Uuid,
        _: PrincipalId,
    ) -> Result<QuotationThreadState, AdapterFailure> {
        let mut thread = forum::TopicAggregate::replay(topic, &self.staged.records)
            .unwrap()
            .quotation_thread()
            .unwrap();
        // A replaceable query body cannot grant an invented quotation excerpt.
        for post in &mut thread.posts {
            post.body = "fabricated projection body".into();
        }
        Ok(thread)
    }
    async fn charge_posting(
        &mut self,
        _: PrincipalId,
        _: PostingAction,
        _: u32,
        _: i64,
    ) -> Result<(), AdapterFailure> {
        self.staged.budget += 1;
        if self.staged.fail_charge {
            Err(AdapterFailure)
        } else {
            Ok(())
        }
    }
    async fn append_and_project(
        &mut self,
        stream: Uuid,
        expected: i64,
        events: &[DecodedForumEvent],
        _: PrincipalId,
        now: i64,
    ) -> Result<ForumCommit, AdapterFailure> {
        assert_eq!(expected as usize, self.staged.records.len());
        for event in events {
            let version = self.staged.records.len() as i64 + 1;
            self.staged.records.push(ForumEventRecord {
                source_seq: version * 10,
                stream_seq: version,
                occurred_at: now,
                event: event.clone(),
            });
        }
        if self.staged.fail_append {
            return Err(AdapterFailure);
        }
        Ok(ForumCommit {
            stream_id: stream,
            stream_version: self.staged.records.len() as i64,
            last_source_seq: self.staged.records.last().unwrap().source_seq,
        })
    }
    async fn commit(self) -> Result<(), AdapterFailure> {
        *self.store.0.lock().unwrap() = self.staged;
        Ok(())
    }
    async fn rollback(self) -> Result<(), AdapterFailure> {
        self.store.0.lock().unwrap().rollbacks += 1;
        Ok(())
    }
}

fn fixture() -> (Store, Uuid, PrincipalId) {
    let topic = Uuid::from_u128(2);
    let author = Uuid::from_u128(3);
    let records = vec![
        ForumEventRecord {
            source_seq: 10,
            stream_seq: 1,
            occurred_at: 100,
            event: DecodedForumEvent::TopicCreated {
                area_id: Uuid::from_u128(1),
                title: "Canonical".into(),
                author_profile_id: Some(author),
            },
        },
        ForumEventRecord {
            source_seq: 20,
            stream_seq: 2,
            occurred_at: 101,
            event: DecodedForumEvent::PostSubmitted {
                body: "Canonical original body".into(),
                author_profile_id: Some(author),
                quotations: vec![],
                mentions: vec![],
            },
        },
    ];
    (
        Store(Arc::new(Mutex::new(Stored {
            records,
            author: Some(author),
            moderator: false,
            budget: 0,
            fail_charge: false,
            fail_append: false,
            rollbacks: 0,
        }))),
        topic,
        PrincipalId::from_uuid(Uuid::from_u128(4)),
    )
}

fn submit(topic_id: Uuid) -> ForumCommand {
    ForumCommand::SubmitPost {
        topic_id,
        body: "Reply".into(),
        quotations: vec![],
        mentions: vec![],
    }
}

#[tokio::test]
async fn canonical_locked_policy_rejects_without_charging_or_appending() {
    let (store, topic, principal) = fixture();
    store.0.lock().unwrap().records.push(ForumEventRecord {
        source_seq: 30,
        stream_seq: 3,
        occurred_at: 102,
        event: DecodedForumEvent::PostingStateChanged {
            posting_state: PostingState::Locked,
        },
    });
    assert!(matches!(
        execute(&store, submit(topic), principal, 110).await,
        Err(ForumApplicationError::Decision(
            forum::ForumReject::TopicLocked
        ))
    ));
    let saved = store.0.lock().unwrap();
    assert_eq!(
        (saved.records.len(), saved.budget, saved.rollbacks),
        (3, 0, 1)
    );
}

#[tokio::test]
async fn canonical_post_author_and_revision_control_edits() {
    let (store, topic, principal) = fixture();
    store.0.lock().unwrap().author = Some(Uuid::from_u128(999));
    let edit = ForumCommand::EditPost {
        topic_id: topic,
        source_seq: 20,
        body: "Changed".into(),
        mentions: vec![],
        expected_revision: 0,
    };
    assert!(matches!(
        execute(&store, edit.clone(), principal, 110).await,
        Err(ForumApplicationError::Decision(
            forum::ForumReject::NotAuthor
        ))
    ));
    store.0.lock().unwrap().author = Some(Uuid::from_u128(3));
    execute(&store, edit.clone(), principal, 110).await.unwrap();
    assert!(matches!(
        execute(&store, edit, principal, 111).await,
        Err(ForumApplicationError::Decision(
            forum::ForumReject::StaleRevision
        ))
    ));
    let saved = store.0.lock().unwrap();
    assert_eq!((saved.records.len(), saved.budget), (3, 1));
}

#[tokio::test]
async fn curation_requires_the_authority_port_and_uses_replayed_current_state() {
    let (store, topic, principal) = fixture();
    let rename = ForumCommand::RenameTopic {
        topic_id: topic,
        title: "Renamed".into(),
    };
    assert!(matches!(
        execute(&store, rename.clone(), principal, 110).await,
        Err(ForumApplicationError::ModeratorRequired)
    ));
    store.0.lock().unwrap().moderator = true;
    execute(&store, rename.clone(), principal, 111)
        .await
        .unwrap();
    assert!(matches!(
        execute(&store, rename, principal, 112).await,
        Err(ForumApplicationError::Decision(
            forum::ForumReject::NoStateChange
        ))
    ));
}

#[tokio::test]
async fn budget_and_partial_append_failures_roll_back_before_returning() {
    for charge_failure in [false, true] {
        let (store, topic, principal) = fixture();
        {
            let mut saved = store.0.lock().unwrap();
            saved.fail_charge = charge_failure;
            saved.fail_append = !charge_failure;
        }
        assert!(matches!(
            execute(&store, submit(topic), principal, 110).await,
            Err(ForumApplicationError::Port(_))
        ));
        let saved = store.0.lock().unwrap();
        assert_eq!(
            (saved.records.len(), saved.budget, saved.rollbacks),
            (2, 0, 1)
        );
    }
}

#[tokio::test]
async fn corrupt_projection_body_cannot_authorize_a_quotation() {
    let (store, topic, principal) = fixture();
    let command = ForumCommand::SubmitPost {
        topic_id: topic,
        body: "Reply".into(),
        quotations: vec![Quotation {
            target: content_reference::PostRef {
                kind: content_reference::PostKind::DiscussionPost,
                scope_id: topic,
                source_seq: 20,
            },
            excerpt: "fabricated projection body".into(),
        }],
        mentions: vec![],
    };
    assert!(matches!(
        execute(&store, command, principal, 110).await,
        Err(ForumApplicationError::Decision(
            forum::ForumReject::ContentReference(
                content_reference::ContentReferenceReject::InvalidQuotationExcerpt
            )
        ))
    ));
    assert_eq!(store.0.lock().unwrap().budget, 0);
}

#[tokio::test]
async fn malformed_history_cannot_reach_admission_or_append() {
    let (store, topic, principal) = fixture();
    store.0.lock().unwrap().records[1].stream_seq = 9;
    assert!(matches!(
        execute(&store, submit(topic), principal, 110).await,
        Err(ForumApplicationError::Replay(_))
    ));
    let saved = store.0.lock().unwrap();
    assert_eq!(
        (saved.records.len(), saved.budget, saved.rollbacks),
        (2, 0, 1)
    );
}

#[tokio::test]
async fn topic_creation_commits_genesis_opening_post_and_budget_together() {
    let (store, topic, principal) = fixture();
    store.0.lock().unwrap().records.clear();
    let receipt = execute(
        &store,
        ForumCommand::CreateTopic {
            topic_id: topic,
            area_slug: "general".into(),
            title: "New topic".into(),
            body: "Opening".into(),
        },
        principal,
        110,
    )
    .await
    .unwrap();
    assert_eq!(receipt.stream_version, 2);
    let saved = store.0.lock().unwrap();
    assert_eq!(
        (saved.records.len(), saved.budget, saved.rollbacks),
        (2, 1, 0)
    );
}
