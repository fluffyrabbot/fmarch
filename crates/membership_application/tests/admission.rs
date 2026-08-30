use membership_application::{
    admit_classic, community_stewardship_snapshot, ensure_founder_membership, issue_invitation,
    lineage_for_principal, revoke_invitation, steward_membership, InvitationTargetIndex,
    MembershipApplicationError, MAX_OPEN_INVITATIONS_PER_SPONSOR,
};
use principal::PrincipalId;
use std::time::Duration;

async fn founder(pool: &sqlx::PgPool, now: i64) -> PrincipalId {
    let principal = PrincipalId::random();
    let mut tx = pool.begin().await.unwrap();
    identity::methods::ensure_principal(&mut tx, &principal, &[], now)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    ensure_founder_membership(pool, principal, now)
        .await
        .unwrap();
    principal
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn invitation_quota_is_serialized_by_the_sponsor_lock(pool: sqlx::PgPool) {
    let now = 1_700_000_000;
    let sponsor = founder(&pool, now).await;
    let target_index = InvitationTargetIndex::from_env_or_local().unwrap();
    for index in 0..MAX_OPEN_INVITATIONS_PER_SPONSOR {
        issue_invitation(
            &pool,
            &target_index,
            sponsor,
            format!("quota-{index}@example.test").as_str(),
            now + 3_600,
            now,
        )
        .await
        .unwrap();
    }
    let rejected = issue_invitation(
        &pool,
        &target_index,
        sponsor,
        "quota-blocked@example.test",
        now + 3_600,
        now,
    )
    .await;
    assert!(matches!(
        rejected,
        Err(MembershipApplicationError::QuotaExceeded { .. })
    ));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn stewardship_preserves_lineage_and_suspension_revokes_pending_invites(pool: sqlx::PgPool) {
    let now = 1_700_000_000;
    let admin = founder(&pool, now).await;
    let target_index = InvitationTargetIndex::from_env_or_local().unwrap();
    let admission = issue_invitation(
        &pool,
        &target_index,
        admin,
        "member@example.test",
        now + 3_600,
        now,
    )
    .await
    .unwrap();
    let member = admit_classic(
        &pool,
        &target_index,
        &admission.credential,
        "member@example.test",
        "$argon2id$fixture",
        &identity::SessionPolicy::from_env(),
        now + 1,
    )
    .await
    .unwrap();
    let pending = issue_invitation(
        &pool,
        &target_index,
        member.principal_id,
        "pending@example.test",
        now + 3_600,
        now + 2,
    )
    .await
    .unwrap();

    steward_membership(
        &pool,
        admin,
        member.membership_id,
        community_membership::MembershipCommand::Suspend {
            reason: "credible abuse signal".to_string(),
        },
        now + 3,
    )
    .await
    .unwrap();
    let snapshot = community_stewardship_snapshot(&pool, None, now + 3)
        .await
        .unwrap();
    let suspended = snapshot
        .memberships
        .iter()
        .find(|entry| entry.membership_id == member.membership_id)
        .unwrap();
    assert_eq!(suspended.status, "suspended");
    assert_eq!(suspended.depth, 1);
    assert!(snapshot
        .pending_invitations
        .iter()
        .all(|entry| entry.invitation_id != pending.invitation_id));
    let status: String =
        sqlx::query_scalar("SELECT status FROM community_invitation WHERE invitation_id = $1")
            .bind(pending.invitation_id.as_uuid())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status, "revoked");

    steward_membership(
        &pool,
        admin,
        member.membership_id,
        community_membership::MembershipCommand::Restore,
        now + 4,
    )
    .await
    .unwrap();
    issue_invitation(
        &pool,
        &target_index,
        member.principal_id,
        "after-restore@example.test",
        now + 3_600,
        now + 5,
    )
    .await
    .unwrap();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn admission_is_target_bound_single_use_atomic_and_preserves_lineage(pool: sqlx::PgPool) {
    let now = 1_700_000_000;
    let sponsor = founder(&pool, now).await;
    let target_index = InvitationTargetIndex::from_env_or_local().unwrap();
    let invitation = issue_invitation(
        &pool,
        &target_index,
        sponsor,
        "Invited@Example.test",
        now + 3_600,
        now,
    )
    .await
    .unwrap();
    let policy = identity::SessionPolicy::from_env();

    let mismatch = admit_classic(
        &pool,
        &target_index,
        &invitation.credential,
        "somebody-else@example.test",
        "$argon2id$fixture",
        &policy,
        now + 1,
    )
    .await;
    assert!(matches!(
        mismatch,
        Err(MembershipApplicationError::Invitation(_))
    ));
    let accounts_after_mismatch: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM auth_account")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(accounts_after_mismatch, 0);

    let admitted = admit_classic(
        &pool,
        &target_index,
        &invitation.credential,
        "invited@example.test",
        "$argon2id$fixture",
        &policy,
        now + 2,
    )
    .await
    .unwrap();
    let lineage = lineage_for_principal(&pool, admitted.principal_id)
        .await
        .unwrap();
    assert_eq!(lineage.len(), 2);
    assert_eq!(lineage[0].depth, 1);
    assert_eq!(lineage[1].depth, 0);
    assert_eq!(lineage[1].membership_id, admitted.membership_id);

    let replay = admit_classic(
        &pool,
        &target_index,
        &invitation.credential,
        "invited@example.test",
        "$argon2id$fixture",
        &policy,
        now + 3,
    )
    .await;
    assert!(matches!(
        replay,
        Err(MembershipApplicationError::Unavailable)
    ));
    let accounts_after_replay: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM auth_account")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(accounts_after_replay, 1);

    let revoked = issue_invitation(
        &pool,
        &target_index,
        sponsor,
        "revoked@example.test",
        now + 3_600,
        now + 4,
    )
    .await
    .unwrap();
    revoke_invitation(&pool, sponsor, revoked.invitation_id, now + 5)
        .await
        .unwrap();
    let rejected = admit_classic(
        &pool,
        &target_index,
        &revoked.credential,
        "revoked@example.test",
        "$argon2id$fixture",
        &policy,
        now + 6,
    )
    .await;
    assert!(matches!(
        rejected,
        Err(MembershipApplicationError::Unavailable)
    ));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn concurrent_acceptance_and_revocation_serialize_without_deadlock(pool: sqlx::PgPool) {
    let now = 1_700_000_000;
    let sponsor = founder(&pool, now).await;
    let target_index = InvitationTargetIndex::from_env_or_local().unwrap();
    let invitation = issue_invitation(
        &pool,
        &target_index,
        sponsor,
        "race@example.test",
        now + 3_600,
        now,
    )
    .await
    .unwrap();
    let policy = identity::SessionPolicy::from_env();
    let acceptance_pool = pool.clone();
    let revocation_pool = pool.clone();
    let credential = invitation.credential.clone();
    let invitation_id = invitation.invitation_id;

    let (acceptance, revocation) = tokio::time::timeout(Duration::from_secs(5), async move {
        tokio::join!(
            admit_classic(
                &acceptance_pool,
                &target_index,
                &credential,
                "race@example.test",
                "$argon2id$fixture",
                &policy,
                now + 1,
            ),
            revoke_invitation(&revocation_pool, sponsor, invitation_id, now + 1,)
        )
    })
    .await
    .expect("acceptance and revocation must not deadlock");

    assert_ne!(acceptance.is_ok(), revocation.is_ok());
    let status = sqlx::query_scalar::<_, String>(
        "SELECT status FROM community_invitation WHERE invitation_id = $1",
    )
    .bind(invitation_id.as_uuid())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        status,
        if acceptance.is_ok() {
            "accepted"
        } else {
            "revoked"
        }
    );
}
