//! Report evidence is one immutable admitted revision, independent of later edits.
use content_reference::PublicContentRef;
use eventstore::{ActorId, EventInput};
use projections::{
    append_discussion_and_project, append_discussion_and_project_in_tx, moderation_case_by_id,
    rebuild_discussion_stream, rebuild_moderation_stream, submit_moderation_report,
};
use social::{
    PrincipalId, ProfileBio, ProfileDisplayName, ProfileHandle, ProfilePresentation,
    ProfileVisibility,
};
use sqlx::PgPool;
use std::time::Duration;
use trust_safety::{
    ModerationContentSnapshot, ModerationEvidence, ModerationTarget, ReportReasonFamily,
};
use uuid::Uuid;

struct Fixture {
    topic: Uuid,
    source_seq: i64,
    opening_seq: i64,
    author: PrincipalId,
    reporter: PrincipalId,
    other_reporter: PrincipalId,
    mentioned_profile: Uuid,
}

async fn fixture(pool: &PgPool) -> Fixture {
    let author = PrincipalId::from_uuid(Uuid::new_v4());
    let reporter = PrincipalId::from_uuid(Uuid::new_v4());
    let other_reporter = PrincipalId::from_uuid(Uuid::new_v4());
    for principal in [author, reporter, other_reporter] {
        let mut connection = pool.acquire().await.unwrap();
        identity::methods::ensure_principal(&mut connection, &principal, &[], 1)
            .await
            .unwrap();
    }
    let presentation = ProfilePresentation::new(
        ProfileHandle::new("reported_member").unwrap(),
        ProfileDisplayName::new("Reported member").unwrap(),
        ProfileBio::new("Moderation evidence proof").unwrap(),
        ProfileVisibility::Public,
    );
    let profile = profile_application::create_profile(pool, author, presentation, 1)
        .await
        .unwrap()
        .as_uuid();
    let area = Uuid::new_v4();
    let topic = Uuid::new_v4();
    append_discussion_and_project(
        pool,
        area,
        &[input(
            "DiscussionAreaCreated",
            serde_json::json!({
                "slug": "evidence", "title": "Evidence", "description": "Report evidence"
            }),
            author,
            2,
        )],
    )
    .await
    .unwrap();
    let opening = append_discussion_and_project(pool, topic, &[
        input("DiscussionTopicCreated", serde_json::json!({"area_id": area, "title": "Evidence", "author_profile_id": profile}), author, 3),
        input("DiscussionPostSubmitted", serde_json::json!({"body": "Quoted context", "author_profile_id": profile}), author, 4),
    ]).await.unwrap()[1].seq;
    let source_seq = append_discussion_and_project(pool, topic, &[input("DiscussionPostSubmitted", serde_json::json!({
        "body": "@reported_member abusive original", "author_profile_id": profile,
        "mentions": [{"profile_id": profile, "span": {"offset": 0, "len": 16}}],
        "quotations": [{"target": {"kind": "discussion_post", "scope_id": topic, "source_seq": opening}, "excerpt": "Quoted context"}]
    }), author, 5)]).await.unwrap()[0].seq;
    Fixture {
        topic,
        source_seq,
        opening_seq: opening,
        author,
        reporter,
        other_reporter,
        mentioned_profile: profile,
    }
}

fn input(kind: &str, payload: serde_json::Value, actor: PrincipalId, at: i64) -> EventInput {
    EventInput::new(kind, 1, payload, ActorId::Principal(actor), at)
}

fn edit(f: &Fixture, revision: i64, body: &str) -> EventInput {
    input(
        "DiscussionPostEdited",
        serde_json::json!({"source_seq": f.source_seq, "revision": revision, "body": body}),
        f.author,
        5 + revision,
    )
}

async fn report(pool: &PgPool, topic: Uuid, source_seq: i64, reporter: PrincipalId) -> Uuid {
    let report_id = Uuid::new_v4();
    submit_moderation_report(
        pool,
        ModerationTarget {
            public: PublicContentRef::new(topic, source_seq),
        },
        report_id,
        reporter,
        ReportReasonFamily::Harassment,
        "Please review the captured content".to_string(),
        10,
    )
    .await
    .unwrap();
    sqlx::query_scalar("SELECT case_id FROM moderation_report WHERE report_id = $1")
        .bind(report_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

fn captured(evidence: &ModerationEvidence) -> &ModerationContentSnapshot {
    match evidence {
        ModerationEvidence::Captured { content } => content,
        ModerationEvidence::NotCaptured => panic!("new reports must capture evidence"),
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn report_edit_retract_and_rebuild_preserve_each_reported_revision(pool: PgPool) {
    let f = fixture(&pool).await;
    let case = report(&pool, f.topic, f.source_seq, f.reporter).await;
    append_discussion_and_project(&pool, f.topic, &[edit(&f, 1, "Innocuous replacement")])
        .await
        .unwrap();
    assert_eq!(
        report(&pool, f.topic, f.source_seq, f.other_reporter).await,
        case
    );
    append_discussion_and_project(
        &pool,
        f.topic,
        &[
            edit(&f, 2, "Second replacement"),
            input(
                "DiscussionPostRetracted",
                serde_json::json!({"source_seq": f.source_seq}),
                f.author,
                12,
            ),
        ],
    )
    .await
    .unwrap();
    let detail = moderation_case_by_id(&pool, case).await.unwrap().unwrap();
    assert_eq!(detail.case.target_body, "Second replacement");
    assert_eq!(detail.case.target_revision, 2);
    assert!(detail.case.target_retracted);
    let first = captured(&detail.reports[0].evidence);
    assert_eq!(first.revision, 0);
    assert_eq!(first.body, "@reported_member abusive original");
    assert_eq!(first.profile_mentions[0].profile_id, f.mentioned_profile);
    assert_eq!(first.quotations[0].target.source_seq, f.opening_seq);
    assert_eq!(first.quotations[0].excerpt, "Quoted context");
    assert!(!first.retracted);
    let second = captured(&detail.reports[1].evidence);
    assert_eq!(second.revision, 1);
    assert_eq!(second.body, "Innocuous replacement");
    assert!(second.profile_mentions.is_empty());
    assert_eq!(detail.content_history.len(), 3);
    assert_eq!(detail.content_history[0].content, *first);
    assert_eq!(detail.content_history[1].content, *second);
    assert!(detail.content_history[2].content.retracted);
    let events = eventstore::load_stream(&pool, case).await.unwrap();
    assert!(events
        .iter()
        .filter(|event| event.kind == trust_safety::MODERATION_REPORT_SUBMITTED)
        .all(|event| event.version == 2));
    rebuild_discussion_stream(&pool, f.topic).await.unwrap();
    rebuild_moderation_stream(&pool, case).await.unwrap();
    assert_eq!(
        moderation_case_by_id(&pool, case).await.unwrap().unwrap(),
        detail
    );
    // Replay order cannot invent evidence by consulting the current publication.
    rebuild_moderation_stream(&pool, case).await.unwrap();
    rebuild_discussion_stream(&pool, f.topic).await.unwrap();
    assert_eq!(
        moderation_case_by_id(&pool, case).await.unwrap().unwrap(),
        detail
    );
}

/// Wait for an actual advisory-lock waiter behind this fixture's blocker.
/// This observes database coordination, not a timing-based assumption.
async fn wait_for_blocked_writer(pool: &PgPool, blocker_pid: i32) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let waiting: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)))",
            ).bind(blocker_pid).fetch_one(pool).await.unwrap();
            if waiting { break; }
            tokio::task::yield_now().await;
        }
    }).await.expect("writer must block on the ordered source/target lock");
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn report_waits_for_edit_commit_and_captures_one_complete_revision(pool: PgPool) {
    let f = fixture(&pool).await;
    let mut edit_tx = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *edit_tx)
        .await
        .unwrap();
    append_discussion_and_project_in_tx(
        &mut edit_tx,
        f.topic,
        &[edit(&f, 1, "Committed edited content")],
    )
    .await
    .unwrap();
    let report_pool = pool.clone();
    let (topic, source, reporter) = (f.topic, f.source_seq, f.reporter);
    let pending = tokio::spawn(async move { report(&report_pool, topic, source, reporter).await });
    wait_for_blocked_writer(&pool, pid).await;
    edit_tx.commit().await.unwrap();
    let case = tokio::time::timeout(Duration::from_secs(5), pending)
        .await
        .unwrap()
        .unwrap();
    let detail = moderation_case_by_id(&pool, case).await.unwrap().unwrap();
    let evidence = captured(&detail.reports[0].evidence);
    assert_eq!(
        (evidence.revision, evidence.body.as_str()),
        (1, "Committed edited content")
    );
    assert!(evidence.profile_mentions.is_empty());
    assert_eq!(evidence.quotations.len(), 1);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn edit_waits_for_report_admission_and_cannot_replace_its_evidence(pool: PgPool) {
    let f = fixture(&pool).await;
    let mut target_tx = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *target_tx)
        .await
        .unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("{}:{}", f.topic, f.source_seq))
        .execute(&mut *target_tx)
        .await
        .unwrap();
    let report_pool = pool.clone();
    let (topic, source, reporter) = (f.topic, f.source_seq, f.reporter);
    let pending_report =
        tokio::spawn(async move { report(&report_pool, topic, source, reporter).await });
    wait_for_blocked_writer(&pool, pid).await;
    // The report now owns the source stream lock and waits only on our target lock.
    let mut probe = pool.begin().await.unwrap();
    assert!(!eventstore::try_lock_stream_in_tx(&mut probe, f.topic)
        .await
        .unwrap());
    probe.rollback().await.unwrap();
    let edit_pool = pool.clone();
    let edit_event = edit(&f, 1, "Late replacement");
    let pending_edit = tokio::spawn(async move {
        append_discussion_and_project(&edit_pool, topic, &[edit_event])
            .await
            .unwrap();
    });
    target_tx.commit().await.unwrap();
    let case = tokio::time::timeout(Duration::from_secs(5), pending_report)
        .await
        .unwrap()
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), pending_edit)
        .await
        .unwrap()
        .unwrap();
    let detail = moderation_case_by_id(&pool, case).await.unwrap().unwrap();
    assert_eq!(captured(&detail.reports[0].evidence).revision, 0);
    assert_eq!(
        captured(&detail.reports[0].evidence).body,
        "@reported_member abusive original"
    );
    assert_eq!(detail.case.target_revision, 1);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn legacy_reports_record_absence_and_v2_missing_evidence_fails_closed(pool: PgPool) {
    let f = fixture(&pool).await;
    for (version, evidence, accepted) in [
        (1, None, true),
        (2, None, false),
        (
            2,
            Some(serde_json::json!({"status": "not_captured"})),
            false,
        ),
        (3, None, false),
    ] {
        let case = Uuid::new_v4();
        let mut payload = serde_json::json!({"report_id": Uuid::new_v4(), "reason": "harassment", "details": "historical report"});
        if let Some(evidence) = evidence {
            payload["evidence"] = evidence;
        }
        eventstore::append(&pool, case, &[
            input("ModerationCaseOpened", serde_json::json!({"target": {"public": {"surface_id": f.topic, "source_seq": f.source_seq}}}), f.reporter, 10),
            EventInput::new("ModerationReportSubmitted", version, payload, ActorId::Principal(f.reporter), 10),
        ]).await.unwrap();
        let result = rebuild_moderation_stream(&pool, case).await;
        assert_eq!(result.is_ok(), accepted);
        if accepted {
            let detail = moderation_case_by_id(&pool, case).await.unwrap().unwrap();
            assert_eq!(detail.reports[0].evidence, ModerationEvidence::NotCaptured);
            // Clear the rebuilt projection, retaining the legacy event history,
            // so each unsupported encoding independently reaches its decoder.
            sqlx::query("DELETE FROM moderation_case WHERE case_id = $1")
                .bind(case)
                .execute(&pool)
                .await
                .unwrap();
        } else {
            assert!(moderation_case_by_id(&pool, case).await.unwrap().is_none());
        }
    }
}
