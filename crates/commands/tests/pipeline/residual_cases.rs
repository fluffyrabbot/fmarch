// Ordinary Postgres command scenarios. Heavy semantic audits live in tests/semantic_audit/.

#[sqlx::test(migrations = "../projections/migrations")]
async fn host_phase_movement_respects_pack_cadence(pool: PgPool) {
    let game = Uuid::new_v4();
    let host = user("host_h");
    handle(
        &pool,
        &host,
        Command::CreateGame {
            game,
            pack: "default_open".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();

    let err = handle(
        &pool,
        &host,
        Command::StartGame {
            game,
            phase: "T01".into(),
        },
    )
    .await
    .expect_err("default_open has no Twilight cadence");
    assert_eq!(err, Reject::InvalidTarget);
    assert!(
        phase_state(&pool, game).await.unwrap().is_none(),
        "rejected start must not create phase_state"
    );

    handle(
        &pool,
        &host,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .expect("declared Day cadence is legal");
    assert_eq!(
        phase_state(&pool, game).await.unwrap().unwrap().phase_id,
        "D01"
    );

    let err = handle(
        &pool,
        &host,
        Command::OpenDayPhase {
            game,
            phase: "T01".into(),
        },
    )
    .await
    .expect_err("host advancement cannot use absent Twilight cadence");
    assert_eq!(err, Reject::InvalidTarget);
    assert_eq!(
        phase_state(&pool, game).await.unwrap().unwrap().phase_id,
        "D01",
        "rejected phase advance must not mutate phase_state"
    );

    let invalid_phase_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 AND payload->>'phase_id' = 'T01'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        invalid_phase_events, 0,
        "rejected phase movement must not append invalid phase events"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn start_game_declares_mason_neighbor_private_channels(pool: PgPool) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, role) in [
        ("slot_1", "mason"),
        ("slot_2", "mason"),
        ("slot_3", "neighbor"),
        ("slot_4", "neighbor"),
        ("slot_5", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .expect("start declares setup private channels");

    let declarations = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'PrivateChannelDeclared' \
         ORDER BY payload->>'channel_id'",
    )
    .bind(game)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(declarations.len(), 2);
    assert_eq!(declarations[0]["channel_id"], "private:mason");
    assert_eq!(declarations[0]["kind"], "Mason");
    assert_eq!(declarations[0]["reveals_alignment"], "Town");
    assert_eq!(declarations[0]["members"][0]["slot_id"], "slot_1");
    assert_eq!(declarations[0]["members"][1]["slot_id"], "slot_2");
    assert_eq!(declarations[1]["channel_id"], "private:neighbor");
    assert_eq!(declarations[1]["kind"], "Neighbor");
    assert_eq!(declarations[1]["reveals_alignment"], "None");
    assert_eq!(declarations[1]["members"][0]["slot_id"], "slot_3");
    assert_eq!(declarations[1]["members"][1]["slot_id"], "slot_4");

    let members = projections::private_channel_members(&pool, game)
        .await
        .expect("private channel projection");
    let summary = members
        .iter()
        .map(|member| {
            (
                member.channel_id.as_str(),
                member.kind.as_str(),
                member.slot_id.as_str(),
                member.role_key.as_str(),
                member.reveals_alignment.as_str(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        summary,
        vec![
            ("private:mason", "Mason", "slot_1", "mason", "Town"),
            ("private:mason", "Mason", "slot_2", "mason", "Town"),
            ("private:neighbor", "Neighbor", "slot_3", "neighbor", "None"),
            ("private:neighbor", "Neighbor", "slot_4", "neighbor", "None"),
        ]
    );
    assert!(
        projections::thread_view(&pool, game, None, 50)
            .await
            .unwrap()
            .posts
            .is_empty(),
        "private channel metadata must not leak into public thread_view"
    );

    let members_before = serde_json::to_string(&members).unwrap();
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        members_before,
        serde_json::to_string(
            &projections::private_channel_members(&pool, game)
                .await
                .unwrap()
        )
        .unwrap(),
        "private channel membership rebuild must be deterministic"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn encryptor_declares_and_revokes_mafia_day_chat(pool: PgPool) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "encryptor_user_1", "encryptor"),
        ("slot_2", "encryptor_user_2", "mafia_goon"),
        ("slot_3", "encryptor_user_3", "vanilla_townie"),
        ("slot_4", "encryptor_user_4", "vanilla_townie"),
        ("slot_5", "encryptor_user_5", "vanilla_townie"),
        ("slot_6", "encryptor_user_6", "traitor"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .expect("start declares Encryptor-gated mafia day chat");

    let declaration = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'PrivateChannelDeclared' \
         AND payload->>'channel_id' = 'private:mafia_day_chat'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(declaration["kind"], "FactionDayChat");
    assert_eq!(
        declaration["member_alignments"],
        serde_json::json!(["mafia"])
    );
    assert_eq!(
        declaration["enabled_by_roles"],
        serde_json::json!(["encryptor"])
    );
    assert_eq!(
        declaration["excluded_roles"],
        serde_json::json!(["traitor"])
    );
    assert_eq!(declaration["active_while_source_alive"], true);
    assert_eq!(declaration["source_slots"], serde_json::json!(["slot_1"]));
    assert_eq!(declaration["members"].as_array().unwrap().len(), 2);
    assert_eq!(declaration["members"][0]["slot_id"], "slot_1");
    assert_eq!(declaration["members"][0]["role_key"], "encryptor");
    assert_eq!(declaration["members"][1]["slot_id"], "slot_2");
    assert_eq!(declaration["members"][1]["role_key"], "mafia_goon");

    let members = projections::private_channel_members(&pool, game)
        .await
        .expect("private channel projection");
    let faction_members = members
        .iter()
        .filter(|member| member.channel_id == "private:mafia_day_chat")
        .map(|member| {
            (
                member.kind.as_str(),
                member.slot_id.as_str(),
                member.role_key.as_str(),
                member.reveals_alignment.as_str(),
                member.source.as_str(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        faction_members,
        vec![
            (
                "FactionDayChat",
                "slot_1",
                "encryptor",
                "None",
                "pack.private_channels.mafia_day_chat"
            ),
            (
                "FactionDayChat",
                "slot_2",
                "mafia_goon",
                "None",
                "pack.private_channels.mafia_day_chat"
            ),
        ]
    );

    for (voter_user, voter_slot) in [
        ("encryptor_user_3", "slot_3"),
        ("encryptor_user_4", "slot_4"),
        ("encryptor_user_5", "slot_5"),
        ("encryptor_user_6", "slot_6"),
    ] {
        handle(
            &pool,
            &user(voter_user),
            Command::SubmitVote {
                game,
                actor_slot: voter_slot.into(),
                target: VoteTarget::Slot("slot_1".into()),
            },
        )
        .await
        .unwrap_or_else(|err| panic!("{voter_slot} vote against Encryptor failed: {err:?}"));
    }

    let ack = handle(&pool, &h, Command::ResolvePhase { game, seed: 771101 })
        .await
        .expect("host resolves Encryptor lynch and revokes day chat");
    assert_eq!(
        ack.stream_seqs.len(),
        4,
        "Encryptor lynch appends ResolutionApplied, ResolutionTrace, PrivateChannelRevoked, and ThreadLocked atomically"
    );
    let applied_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied' \
         AND payload->>'phase_id' = 'D01'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let applied = domain::validate_resolution_json(&applied_payload, domain::RESULT_VERSION)
        .expect("valid Encryptor lynch result");
    assert!(
        applied.events.iter().any(|indexed| matches!(
            &indexed.event,
            domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
                if slot_id == "slot_1" && cause == "day_vote"
        )),
        "expected Encryptor day-vote death, got {:#?}",
        applied.events
    );

    let revocation = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'PrivateChannelRevoked' \
         AND payload->>'channel_id' = 'private:mafia_day_chat'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(revocation["kind"], "FactionDayChat");
    assert_eq!(revocation["reason"], "source_role_not_alive");
    assert_eq!(revocation["source"], "pack.private_channels.mafia_day_chat");

    let members_after = projections::private_channel_members(&pool, game)
        .await
        .expect("private channel projection after revocation");
    assert!(
        members_after
            .iter()
            .all(|member| member.channel_id != "private:mafia_day_chat"),
        "Encryptor day chat should be revoked after the last Encryptor dies"
    );

    let members_after_json = serde_json::to_string(&members_after).unwrap();
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        members_after_json,
        serde_json::to_string(
            &projections::private_channel_members(&pool, game)
                .await
                .unwrap()
        )
        .unwrap(),
        "Encryptor private-channel revocation rebuild must be deterministic"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn start_game_declares_mafia_universe_mason_neighbor_private_channels(pool: PgPool) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafia_universe".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, role) in [
        ("slot_1", "mason"),
        ("slot_2", "mason"),
        ("slot_3", "neighbor"),
        ("slot_4", "neighbor"),
        ("slot_5", "town_vanilla"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .expect("start declares Mafia Universe setup private channels");

    let declarations = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'PrivateChannelDeclared' \
         ORDER BY payload->>'channel_id'",
    )
    .bind(game)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(declarations.len(), 2);
    assert_eq!(declarations[0]["channel_id"], "private:mason");
    assert_eq!(declarations[0]["kind"], "Mason");
    assert_eq!(declarations[0]["roles"], serde_json::json!(["mason"]));
    assert_eq!(declarations[0]["reveals_alignment"], "Town");
    assert_eq!(declarations[0]["source"], "pack.private_channels.mason");
    assert_eq!(declarations[0]["members"][0]["slot_id"], "slot_1");
    assert_eq!(declarations[0]["members"][0]["role_key"], "mason");
    assert_eq!(declarations[0]["members"][1]["slot_id"], "slot_2");
    assert_eq!(declarations[1]["channel_id"], "private:neighbor");
    assert_eq!(declarations[1]["kind"], "Neighbor");
    assert_eq!(declarations[1]["roles"], serde_json::json!(["neighbor"]));
    assert_eq!(declarations[1]["reveals_alignment"], "None");
    assert_eq!(declarations[1]["source"], "pack.private_channels.neighbor");
    assert_eq!(declarations[1]["members"][0]["slot_id"], "slot_3");
    assert_eq!(declarations[1]["members"][0]["role_key"], "neighbor");
    assert_eq!(declarations[1]["members"][1]["slot_id"], "slot_4");

    let members = projections::private_channel_members(&pool, game)
        .await
        .expect("Mafia Universe private channel projection");
    let summary = members
        .iter()
        .map(|member| {
            (
                member.channel_id.as_str(),
                member.kind.as_str(),
                member.slot_id.as_str(),
                member.role_key.as_str(),
                member.reveals_alignment.as_str(),
                member.source.as_str(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        summary,
        vec![
            (
                "private:mason",
                "Mason",
                "slot_1",
                "mason",
                "Town",
                "pack.private_channels.mason"
            ),
            (
                "private:mason",
                "Mason",
                "slot_2",
                "mason",
                "Town",
                "pack.private_channels.mason"
            ),
            (
                "private:neighbor",
                "Neighbor",
                "slot_3",
                "neighbor",
                "None",
                "pack.private_channels.neighbor"
            ),
            (
                "private:neighbor",
                "Neighbor",
                "slot_4",
                "neighbor",
                "None",
                "pack.private_channels.neighbor"
            ),
        ]
    );
    assert!(
        projections::thread_view(&pool, game, None, 50)
            .await
            .unwrap()
            .posts
            .is_empty(),
        "Mafia Universe private channel metadata must not leak into public thread_view"
    );

    let members_before = serde_json::to_string(&members).unwrap();
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        members_before,
        serde_json::to_string(
            &projections::private_channel_members(&pool, game)
                .await
                .unwrap()
        )
        .unwrap(),
        "Mafia Universe private channel membership rebuild must be deterministic"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn resolve_phase_rejects_invalid_pack_precedence_before_append(pool: PgPool) {
    let host_id = "host_h";
    let game = Uuid::new_v4();
    seed_open_night_game_with_pack(
        &pool,
        game,
        host_id,
        "test_invalid_precedence",
        ("roleblocker", "town"),
        ("mafia_goon", "mafia"),
    )
    .await
    .expect("seed invalid-pack open night stream");

    let before_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    let err = handle(
        &pool,
        &user(host_id),
        Command::ResolvePhase { game, seed: 9901 },
    )
    .await
    .expect_err("invalid pack precedence must reject before resolving");
    assert!(
        matches!(
            err,
            Reject::Internal(ref message)
                if message.contains("load pack test_invalid_precedence")
                    && message.contains("night_resolution.precedence")
                    && message.contains(
                        "requires Block precedence before suppressed ability `Protect`"
                    )
                    && message.contains("requires Block precedence before suppressed ability `Kill`")
                    && message.contains("night_resolution.strongman_bypasses_protect")
                    && message.contains("requires strongman_bypasses_protect true")
                    && message.contains("night_resolution.suppression_policy.roleblocker_block.scope")
                    && message
                        .contains("night_resolution suppression policy must declare scope")
        ),
        "unexpected invalid-pack rejection: {err:?}"
    );
    let after_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        before_count, after_count,
        "invalid pack resolve must not append any events"
    );
    let resolution_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 \
         AND kind IN ('ResolutionApplied', 'ResolutionTrace', 'ThreadLocked')",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        resolution_events, 0,
        "invalid pack resolve must not append resolution envelopes or lock the phase"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn resolve_phase_rejects_unsupported_pack_versions_before_append(pool: PgPool) {
    let host_id = "host_h";
    let game = Uuid::new_v4();
    seed_open_night_game_with_pack(
        &pool,
        game,
        host_id,
        "test_unsupported_ir_version",
        ("vanilla_townie", "town"),
        ("mafia_goon", "mafia"),
    )
    .await
    .expect("seed unsupported-version open night stream");

    let before_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    let err = handle(
        &pool,
        &user(host_id),
        Command::ResolvePhase { game, seed: 9902 },
    )
    .await
    .expect_err("unsupported pack versions must reject before resolving");
    assert!(
        matches!(
            err,
            Reject::Internal(ref message)
                if message.contains("load pack test_unsupported_ir_version")
                    && message.contains("unsupported pack version 2")
                    && message.contains("supported version is 1")
        ),
        "unexpected unsupported-version rejection: {err:?}"
    );
    let after_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        before_count, after_count,
        "unsupported pack resolve must not append any events"
    );
    let resolution_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 \
         AND kind IN ('ResolutionApplied', 'ResolutionTrace', 'ThreadLocked')",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        resolution_events, 0,
        "unsupported pack resolve must not append resolution envelopes or lock the phase"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn resolve_phase_rejects_invalid_action_contract_before_append(pool: PgPool) {
    let host_id = "host_h";
    let game = Uuid::new_v4();
    seed_open_night_game_with_pack(
        &pool,
        game,
        host_id,
        "test_invalid_action_contract",
        ("malformed_investigator", "town"),
        ("mafia_goon", "mafia"),
    )
    .await
    .expect("seed invalid-action-contract open night stream");

    let before_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    let err = handle(
        &pool,
        &user(host_id),
        Command::ResolvePhase { game, seed: 9903 },
    )
    .await
    .expect_err("invalid action mode contracts must reject before resolving");
    assert!(
        matches!(
            err,
            Reject::Internal(ref message)
                if message.contains("load pack test_invalid_action_contract")
                    && message.contains("roles.malformed_investigator.actions[0].mode")
                    && message.contains("Investigate actions must declare mode")
                    && message.contains("roles.malformed_investigator.actions[1].mode")
                    && message.contains("mode is only legal on Investigate actions")
        ),
        "unexpected invalid-action-contract rejection: {err:?}"
    );
    let after_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        before_count, after_count,
        "invalid action contract resolve must not append any events"
    );
    let resolution_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 \
         AND kind IN ('ResolutionApplied', 'ResolutionTrace', 'ThreadLocked')",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        resolution_events, 0,
        "invalid action contract resolve must not append resolution envelopes or lock the phase"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn resolve_phase_rejects_invalid_effect_contract_before_append(pool: PgPool) {
    let host_id = "host_h";
    let game = Uuid::new_v4();
    seed_open_night_game_with_pack(
        &pool,
        game,
        host_id,
        "test_invalid_effect_contract",
        ("malformed_effect_user", "town"),
        ("mafia_goon", "mafia"),
    )
    .await
    .expect("seed invalid-effect-contract open night stream");

    let before_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    let err = handle(
        &pool,
        &user(host_id),
        Command::ResolvePhase { game, seed: 9904 },
    )
    .await
    .expect_err("invalid effect/read-effect action contracts must reject before resolving");
    assert!(
        matches!(
            err,
            Reject::Internal(ref message)
                if message.contains("load pack test_invalid_effect_contract")
                    && message.contains("roles.malformed_effect_user.actions[0].effect")
                    && message.contains("Mark/Clear actions must declare effect")
                    && message.contains("roles.malformed_effect_user.actions[1].effect")
                    && message.contains("effect is only legal on Mark, Clear, Convert, and Link actions")
                    && message.contains("roles.malformed_effect_user.actions[2].reads_effect")
                    && message.contains("reads_effect is only legal on Kill actions")
        ),
        "unexpected invalid-effect-contract rejection: {err:?}"
    );
    let after_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        before_count, after_count,
        "invalid effect contract resolve must not append any events"
    );
    let resolution_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 \
         AND kind IN ('ResolutionApplied', 'ResolutionTrace', 'ThreadLocked')",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        resolution_events, 0,
        "invalid effect contract resolve must not append resolution envelopes or lock the phase"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn resolve_phase_rejects_invalid_target_window_contract_before_append(pool: PgPool) {
    let host_id = "host_h";
    let game = Uuid::new_v4();
    seed_open_night_game_with_pack(
        &pool,
        game,
        host_id,
        "test_invalid_target_window_contract",
        ("malformed_target_window_user", "town"),
        ("mafia_goon", "mafia"),
    )
    .await
    .expect("seed invalid-target-window-contract open night stream");

    let before_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    let err = handle(
        &pool,
        &user(host_id),
        Command::ResolvePhase { game, seed: 9905 },
    )
    .await
    .expect_err("invalid target/window action contracts must reject before resolving");
    assert!(
        matches!(
            err,
            Reject::Internal(ref message)
                if message.contains("load pack test_invalid_target_window_contract")
                    && message.contains("roles.malformed_target_window_user.actions[0].window")
                    && message.contains("action window Night is absent from phases.cadence")
                    && message.contains("roles.malformed_target_window_user.actions[1].constraints.max_targets")
                    && message.contains("TargetSpec::None requires max_targets = 0")
                    && message.contains("roles.malformed_target_window_user.actions[1].constraints.target_state")
                    && message.contains("TargetSpec::None requires target_state = Any")
        ),
        "unexpected invalid-target-window-contract rejection: {err:?}"
    );
    let after_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        before_count, after_count,
        "invalid target/window contract resolve must not append any events"
    );
    let resolution_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 \
         AND kind IN ('ResolutionApplied', 'ResolutionTrace', 'ThreadLocked')",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        resolution_events, 0,
        "invalid target/window contract resolve must not append resolution envelopes or lock the phase"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn resolve_phase_rejects_invalid_target_state_policy_before_append(pool: PgPool) {
    let host_id = "host_h";
    let game = Uuid::new_v4();
    seed_open_night_game_with_pack(
        &pool,
        game,
        host_id,
        "test_invalid_target_state_policy",
        ("roleblocker", "town"),
        ("mafia_goon", "mafia"),
    )
    .await
    .expect("seed invalid-target-state-policy open night stream");

    let before_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    let err = handle(
        &pool,
        &user(host_id),
        Command::ResolvePhase { game, seed: 9906 },
    )
    .await
    .expect_err("invalid target-state night_resolution policy must reject before resolving");
    assert!(
        matches!(
            err,
            Reject::Internal(ref message)
                if message.contains("load pack test_invalid_target_state_policy")
                    && message.contains("night_resolution.target_state_save_policy")
                    && message.contains(
                        "explicit night_resolution policy must classify target-state saves"
                    )
                    && message.contains(
                        "night_resolution target-state save `bulletproof` must classify every kill cause"
                    )
                    && message.contains("night_resolution.target_state_gate_policy")
                    && message.contains(
                        "explicit night_resolution policy must classify target-state gates"
                    )
                    && message.contains(
                        "night_resolution target-state gate `commuted` must classify blocked abilities"
                    )
        ),
        "unexpected invalid-target-state-policy rejection: {err:?}"
    );
    let after_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        before_count, after_count,
        "invalid target-state policy resolve must not append any events"
    );
    let resolution_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 \
         AND kind IN ('ResolutionApplied', 'ResolutionTrace', 'ThreadLocked')",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        resolution_events, 0,
        "invalid target-state policy resolve must not append resolution envelopes or lock the phase"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn resolve_phase_rejects_invalid_generated_kill_ownership_before_append(pool: PgPool) {
    let host_id = "host_h";
    let game = Uuid::new_v4();
    seed_open_night_game_with_pack(
        &pool,
        game,
        host_id,
        "test_invalid_generated_kill_ownership",
        ("roleblocker", "town"),
        ("mafia_goon", "mafia"),
    )
    .await
    .expect("seed invalid-generated-kill-ownership open night stream");

    let before_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    let err = handle(
        &pool,
        &user(host_id),
        Command::ResolvePhase { game, seed: 9914 },
    )
    .await
    .expect_err("invalid generated-kill ownership must reject before resolving");
    assert!(
        matches!(
            err,
            Reject::Internal(ref message)
                if message.contains("load pack test_invalid_generated_kill_ownership")
                    && message.contains(
                        "night_resolution.generated_kill_ownership.pgo_shoots_visitor"
                    )
                    && message.contains(
                        "generated kill trigger `pgo_shoots_visitor` is not owned by protection source `doctor_protect`"
                    )
                    && message.contains(
                        "generated kill trigger `pgo_shoots_visitor` is not owned by target-state save `bulletproof`"
                    )
                    && message.contains(
                        "generated kill trigger `pgo_shoots_visitor` feeder action `visit` is not owned by block source `roleblocker_block`"
                    )
        ),
        "unexpected invalid-generated-kill-ownership rejection: {err:?}"
    );
    let after_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        before_count, after_count,
        "invalid generated-kill ownership resolve must not append any events"
    );
    let resolution_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 \
         AND kind IN ('ResolutionApplied', 'ResolutionTrace', 'ThreadLocked')",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        resolution_events, 0,
        "invalid generated-kill ownership resolve must not append resolution envelopes or lock the phase"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn resolve_phase_rejects_invalid_reference_contract_before_append(pool: PgPool) {
    let host_id = "host_h";
    let game = Uuid::new_v4();
    seed_open_night_game_with_pack(
        &pool,
        game,
        host_id,
        "test_invalid_reference_contract",
        ("malformed_reference_user", "town"),
        ("mafia_goon", "mafia"),
    )
    .await
    .expect("seed invalid-reference-contract open night stream");

    let before_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    let err = handle(
        &pool,
        &user(host_id),
        Command::ResolvePhase { game, seed: 9906 },
    )
    .await
    .expect_err("invalid reference contracts must reject before resolving");
    assert!(
        matches!(
            err,
            Reject::Internal(ref message)
                if message.contains("load pack test_invalid_reference_contract")
                    && message.contains("roles.malformed_reference_user.actions[0].reads_effect")
                    && message.contains("unknown effect tag `missing_effect`")
                    && message.contains("investigation_results.parity.alignment_results.missing_alignment")
                    && message.contains("unknown alignment `missing_alignment`")
                    && message.contains("guard_policy.guard_action_ids")
                    && message.contains("unknown guard action `missing_guard`")
                    && message.contains("vote.weights")
                    && message.contains("unknown role `ghost_role`")
        ),
        "unexpected invalid-reference-contract rejection: {err:?}"
    );
    let after_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        before_count, after_count,
        "invalid reference contract resolve must not append any events"
    );
    let resolution_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 \
         AND kind IN ('ResolutionApplied', 'ResolutionTrace', 'ThreadLocked')",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        resolution_events, 0,
        "invalid reference contract resolve must not append resolution envelopes or lock the phase"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn resolve_phase_rejects_invalid_trigger_reference_contract_before_append(pool: PgPool) {
    let host_id = "host_h";
    let game = Uuid::new_v4();
    seed_open_night_game_with_pack(
        &pool,
        game,
        host_id,
        "test_invalid_trigger_reference_contract",
        ("malformed_trigger_user", "town"),
        ("mafia_goon", "mafia"),
    )
    .await
    .expect("seed invalid-trigger-reference-contract open night stream");

    let before_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    let err = handle(
        &pool,
        &user(host_id),
        Command::ResolvePhase { game, seed: 9907 },
    )
    .await
    .expect_err("invalid trigger reference contracts must reject before resolving");
    assert!(
        matches!(
            err,
            Reject::Internal(ref message)
                if message.contains("load pack test_invalid_trigger_reference_contract")
                    && message.contains("triggers[0].if_target_has")
                    && message.contains("trigger filter tags must not be empty")
                    && message.contains("unknown effect tag `missing_tag`")
                    && message.contains("triggers[0].if_actor_has")
                    && message.contains("unknown effect tag `missing_actor_tag`")
                    && message.contains("duplicate value `known_trigger_target`")
                    && message.contains("duplicate value `known_trigger_actor`")
                    && message.contains("duplicate trigger id `missing_effect_trigger`")
                    && message.contains("triggers[1].produces.actor")
                    && message.contains("trigger productions only support Actor or Target actor refs")
                    && message.contains("triggers[1].produces.target")
                    && message.contains("trigger productions only support Actor, Target, or Killer target refs")
                    && message.contains("triggers[1].produces.ability")
                    && message.contains("trigger productions currently support generated Kill or self-targeted Visit")
                    && message.contains("triggers[2].produces.modifiers")
                    && message.contains("generated Kill triggers only support Strongman modifier, got `Ninja`")
                    && message.contains("duplicate generated Kill modifier `Strongman`")
        ),
        "unexpected invalid-trigger-reference-contract rejection: {err:?}"
    );
    let after_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        before_count, after_count,
        "invalid trigger reference contract resolve must not append any events"
    );
    let resolution_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 \
         AND kind IN ('ResolutionApplied', 'ResolutionTrace', 'ThreadLocked')",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        resolution_events, 0,
        "invalid trigger reference contract resolve must not append resolution envelopes or lock the phase"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn resolve_phase_rejects_invalid_win_policy_contract_before_append(pool: PgPool) {
    let host_id = "host_h";
    let game = Uuid::new_v4();
    seed_open_night_game_with_pack(
        &pool,
        game,
        host_id,
        "test_invalid_win_policy_contract",
        ("malformed_win_townie", "town"),
        ("mafia_goon", "mafia"),
    )
    .await
    .expect("seed invalid-win-policy-contract open night stream");

    let before_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    let err = handle(
        &pool,
        &user(host_id),
        Command::ResolvePhase { game, seed: 9910 },
    )
    .await
    .expect_err("invalid win policy contracts must reject before resolving");
    assert!(
        matches!(
            err,
            Reject::Internal(ref message)
                if message.contains("load pack test_invalid_win_policy_contract")
                    && message.contains("win.rules[0].winner")
                    && message.contains(
                        "FactionEliminated rules must not award the eliminated faction"
                    )
                    && message.contains("win.rules[1].winner")
                    && message.contains(
                        "FactionReachesParity rules must award the parity faction"
                    )
                    && message.contains("win.rules[2].winner")
                    && message.contains(
                        "AllOtherFactionsEliminated rules must award the surviving faction"
                    )
                    && message.contains("win.rules[3].when")
                    && message.contains("duplicate win condition `FactionEliminated(mafia)`")
                    && message.contains("target_lynch_win_policies[1].eligible_roles")
                    && message.contains(
                        "duplicate target lynch win source `execution_target` for eligible role `executioner`"
                    )
                    && message.contains("self_lynch_win_policies[1].eligible_roles")
                    && message.contains(
                        "duplicate self lynch win source `win.jester` for eligible role `jester`"
                    )
        ),
        "unexpected invalid-win-policy-contract rejection: {err:?}"
    );
    let after_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        before_count, after_count,
        "invalid win policy contract resolve must not append any events"
    );
    let resolution_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 \
         AND kind IN ('ResolutionApplied', 'ResolutionTrace', 'ThreadLocked')",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        resolution_events, 0,
        "invalid win policy contract resolve must not append resolution envelopes or lock the phase"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn resolve_phase_uses_pack_derived_custom_precedence_order(pool: PgPool) {
    let host_id = "host_h";
    let game = Uuid::new_v4();
    seed_open_night_game_with_pack(
        &pool,
        game,
        host_id,
        "test_precedence_order_contract",
        ("fast_killer", "mafia"),
        ("late_doctor", "town"),
    )
    .await
    .expect("seed precedence-order open night stream");

    handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "kill_late_doctor_n01".into(),
            actor_slot: "slot_1".into(),
            template_id: "factional_kill".into(),
            targets: vec!["slot_2".into()],
            grant_id: None,
        },
    )
    .await
    .expect("killer submits through command validation");
    handle(
        &pool,
        &user("user_2"),
        Command::SubmitAction {
            game,
            action_id: "late_doctor_self_protect_n01".into(),
            actor_slot: "slot_2".into(),
            template_id: "self_protect".into(),
            targets: vec!["slot_2".into()],
            grant_id: None,
        },
    )
    .await
    .expect("doctor self-protect submits through command validation");

    handle(
        &pool,
        &user(host_id),
        Command::ResolvePhase { game, seed: 9908 },
    )
    .await
    .expect("host resolves precedence-order scenario");

    let applied_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let applied =
        domain::validate_resolution_json(&applied_payload, domain::RESULT_VERSION).unwrap();
    assert!(
        applied.events.iter().any(|indexed| {
            matches!(
                &indexed.event,
                domain::InnerEvent::PlayerKilled {
                    slot_id,
                    cause,
                    attackers,
                    unstoppable,
                    ..
                } if slot_id == "slot_2"
                    && cause == "factional_kill"
                    && attackers == &vec!["slot_1".to_string()]
                    && !unstoppable
            )
        }),
        "Kill-before-Protect pack order should kill the self-protected target"
    );
    assert!(
        !applied.events.iter().any(|indexed| {
            matches!(
                &indexed.event,
                domain::InnerEvent::PlayerSaved { slot_id, .. } if slot_id == "slot_2"
            )
        }),
        "self-protect must not save when pack precedence orders Kill before Protect"
    );

    let trace_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionTrace'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let trace = domain::validate_trace_json(&trace_payload, domain::TRACE_VERSION).unwrap();
    assert_decision_trace(
        &trace,
        DecisionTraceExpectation {
            stage: "night:stage_order",
            source: "pack.precedence",
            outcome: "pack_derived_stage_order",
            detail: vec![("order", serde_json::json!(["Kill", "Protect"]))],
        },
    );

    let slots = slot_state(&pool, game).await.unwrap();
    let killed = slots.iter().find(|slot| slot.slot_id == "slot_2").unwrap();
    assert!(
        !killed.alive,
        "ResolutionApplied should fold the pack-ordered kill into projections"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn resolve_phase_folds_night_kill_into_faction_win_and_rebuild(pool: PgPool) {
    let host_id = "host_h";
    let game = Uuid::new_v4();
    seed_open_night_game_with_pack(
        &pool,
        game,
        host_id,
        "default_open",
        ("citizen", "town"),
        ("agent", "mafia"),
    )
    .await
    .expect("seed default_open night win stream");

    handle(
        &pool,
        &user("user_2"),
        Command::SubmitAction {
            game,
            action_id: "agent_kills_last_town_n01".into(),
            actor_slot: "slot_2".into(),
            template_id: "agent_kill".into(),
            targets: vec!["slot_1".into()],
            grant_id: None,
        },
    )
    .await
    .expect("agent submits the faction kill through command validation");

    let ack = handle(
        &pool,
        &user(host_id),
        Command::ResolvePhase { game, seed: 9911 },
    )
    .await
    .expect("host resolves default_open night faction win");
    assert_eq!(
        ack.stream_seqs.len(),
        3,
        "night win resolve appends ResolutionApplied, ResolutionTrace, and ThreadLocked atomically"
    );

    let applied_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let applied = domain::validate_resolution_json(&applied_payload, domain::RESULT_VERSION)
        .expect("default_open night win ResolutionApplied validates");
    assert_eq!(applied.phase_id, "N01");
    assert_eq!(applied.phase_kind, domain::pack::PhaseKind::Night);
    assert_eq!(applied.seed, 9911);
    let killed_index = applied
        .events
        .iter()
        .find_map(|indexed| match &indexed.event {
            domain::InnerEvent::PlayerKilled {
                slot_id,
                cause,
                attackers,
                unstoppable,
                ..
            } if slot_id == "slot_1"
                && cause == "agent_kill"
                && attackers == &vec!["slot_2".to_string()]
                && !unstoppable =>
            {
                Some(indexed.index)
            }
            _ => None,
        })
        .expect("night kill should remove the last town slot");
    let win_index = applied
        .events
        .iter()
        .find_map(|indexed| match &indexed.event {
            domain::InnerEvent::WinReached { winner, reason, .. }
                if winner == "mafia" && reason.contains("reaches parity") =>
            {
                Some(indexed.index)
            }
            _ => None,
        })
        .expect("night kill should trigger mafia parity win");
    assert!(
        killed_index < win_index,
        "death should be folded into state before the faction win check"
    );

    let trace_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionTrace'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let trace = domain::validate_trace_json(&trace_payload, domain::TRACE_VERSION)
        .expect("default_open night win ResolutionTrace validates");
    assert_eq!(trace.run_id, applied.run_id);
    let kill_source = format!("event_index:{killed_index}");
    assert_decision_trace(
        &trace,
        DecisionTraceExpectation {
            stage: "inner_event",
            source: &kill_source,
            outcome: "player_killed",
            detail: vec![],
        },
    );
    let win_source = format!("event_index:{win_index}");
    assert_decision_trace(
        &trace,
        DecisionTraceExpectation {
            stage: "inner_event",
            source: &win_source,
            outcome: "win_reached",
            detail: vec![],
        },
    );

    let slots = slot_state(&pool, game).await.unwrap();
    let town = slots
        .iter()
        .find(|slot| slot.slot_id == "slot_1")
        .expect("town slot projection");
    assert!(!town.alive, "night kill folds into slot_state");
    assert_win_revealed_all_slots(&slots, "default_open night parity win");
    let result = game_result(&pool, game)
        .await
        .expect("default_open night win game_result read")
        .expect("terminal WinReached should fold a game_result row");
    assert_eq!(
        result.winner, "mafia",
        "game_result winner folds from the terminal WinReached"
    );
    assert!(
        result.reason.contains("reaches parity"),
        "game_result reason carries the engine's win reason: {}",
        result.reason
    );
    assert_eq!(
        result.phase_id, "N01",
        "game_result pins the phase the win landed in"
    );
    let slots_before = serde_json::to_string(&slots).unwrap();
    let projection_audit = audit_rebuild(&pool, game)
        .await
        .expect("default_open night win audit_rebuild");
    assert!(
        projection_audit.ok,
        "default_open night win projection rebuild audit drifted: {projection_audit:?}"
    );
    assert_eq!(
        slots_before,
        serde_json::to_string(&slot_state(&pool, game).await.unwrap()).unwrap(),
        "slot_state rebuild must preserve night kill plus faction win"
    );
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        result,
        game_result(&pool, game)
            .await
            .expect("post-rebuild game_result read")
            .expect("rebuild must refold the game_result row"),
        "game_result rebuild must converge on the same trailing WinReached"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn resolve_phase_folds_three_faction_elimination_win_and_rebuild(pool: PgPool) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "epicmafia".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "villager"),
        ("slot_2", "user_2", "villager"),
        ("slot_3", "user_3", "mafia_goon"),
        ("slot_4", "user_4", "cult_leader"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();

    for (user_id, actor_slot, target) in [
        ("user_1", "slot_1", "slot_4"),
        ("user_2", "slot_2", "slot_4"),
        ("user_3", "slot_3", "slot_4"),
        ("user_4", "slot_4", "slot_1"),
    ] {
        handle(
            &pool,
            &user(user_id),
            Command::SubmitVote {
                game,
                actor_slot: actor_slot.into(),
                target: VoteTarget::Slot(target.into()),
            },
        )
        .await
        .unwrap();
    }

    handle(&pool, &h, Command::ResolvePhase { game, seed: 9912 })
        .await
        .expect("host resolves epicmafia D01 cult lynch");
    let d01_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied' \
         AND payload->>'phase_id' = 'D01'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let d01 = domain::validate_resolution_json(&d01_payload, domain::RESULT_VERSION)
        .expect("epicmafia D01 ResolutionApplied validates");
    assert!(d01.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
            if slot_id == "slot_4" && cause == "day_vote"
    )));
    assert!(
        !d01.events
            .iter()
            .any(|indexed| matches!(indexed.event, domain::InnerEvent::WinReached { .. })),
        "eliminating cult first must not end a two-town-one-mafia game"
    );

    handle(&pool, &h, Command::AdvancePhase { game })
        .await
        .expect("host advances D01 to N01");
    handle(&pool, &h, Command::ResolvePhase { game, seed: 9913 })
        .await
        .expect("host resolves no-op epicmafia N01");
    handle(&pool, &h, Command::AdvancePhase { game })
        .await
        .expect("host advances N01 to D02");

    for (user_id, actor_slot, target) in [
        ("user_1", "slot_1", "slot_3"),
        ("user_2", "slot_2", "slot_3"),
        ("user_3", "slot_3", "slot_1"),
    ] {
        handle(
            &pool,
            &user(user_id),
            Command::SubmitVote {
                game,
                actor_slot: actor_slot.into(),
                target: VoteTarget::Slot(target.into()),
            },
        )
        .await
        .unwrap();
    }

    let ack = handle(&pool, &h, Command::ResolvePhase { game, seed: 9914 })
        .await
        .expect("host resolves epicmafia D02 mafia lynch");
    assert_eq!(
        ack.stream_seqs.len(),
        3,
        "D02 town win resolve appends ResolutionApplied, ResolutionTrace, and ThreadLocked atomically"
    );

    let d02_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied' \
         AND payload->>'phase_id' = 'D02'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let d02 = domain::validate_resolution_json(&d02_payload, domain::RESULT_VERSION)
        .expect("epicmafia D02 ResolutionApplied validates");
    let lynch_index = d02
        .events
        .iter()
        .find_map(|indexed| match &indexed.event {
            domain::InnerEvent::PlayerKilled {
                slot_id,
                cause,
                attackers,
                unstoppable,
                ..
            } if slot_id == "slot_3"
                && cause == "day_vote"
                && attackers.is_empty()
                && *unstoppable =>
            {
                Some(indexed.index)
            }
            _ => None,
        })
        .expect("D02 should lynch the last mafia slot");
    let win_index = d02
        .events
        .iter()
        .find_map(|indexed| match &indexed.event {
            domain::InnerEvent::WinReached { winner, reason, .. }
                if winner == "town"
                    && reason.contains("all factions other than town eliminated") =>
            {
                Some(indexed.index)
            }
            _ => None,
        })
        .expect("D02 should emit town AllOtherFactionsEliminated win");
    assert!(
        lynch_index < win_index,
        "mafia elimination must fold into state before the three-faction town win"
    );

    let trace_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionTrace' \
         AND payload->>'phase_id' = 'D02'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let trace = domain::validate_trace_json(&trace_payload, domain::TRACE_VERSION)
        .expect("epicmafia D02 ResolutionTrace validates");
    assert_eq!(trace.run_id, d02.run_id);
    let win_source = format!("event_index:{win_index}");
    assert_decision_trace(
        &trace,
        DecisionTraceExpectation {
            stage: "inner_event",
            source: &win_source,
            outcome: "win_reached",
            detail: vec![],
        },
    );

    let slots = slot_state(&pool, game).await.unwrap();
    let mafia = slots
        .iter()
        .find(|slot| slot.slot_id == "slot_3")
        .expect("mafia slot projection");
    let cult = slots
        .iter()
        .find(|slot| slot.slot_id == "slot_4")
        .expect("cult slot projection");
    assert!(!mafia.alive, "D02 lynch folds mafia dead");
    assert!(!cult.alive, "D01 lynch keeps cult dead through D02");
    assert_win_revealed_all_slots(&slots, "epicmafia all-other-factions town win");
    let slots_before = serde_json::to_string(&slots).unwrap();
    let projection_audit = audit_rebuild(&pool, game)
        .await
        .expect("epicmafia all-other-factions audit_rebuild");
    assert!(
        projection_audit.ok,
        "epicmafia all-other-factions projection rebuild audit drifted: {projection_audit:?}"
    );
    assert_eq!(
        slots_before,
        serde_json::to_string(&slot_state(&pool, game).await.unwrap()).unwrap(),
        "slot_state rebuild must preserve three-faction town win"
    );
}

/// REPLACEMENT PROOF (the DOD): slot S occupied by A; A votes (as S) for T and
/// posts as S; then ProcessReplacement(S, A→B). Assert:
///   (a) S's vote STILL tallies for T,
///   (b) S's post is STILL attributed to slot S (in the event log),
///   (c) B now resolves SlotOccupant(S) and can vote as S,
///   (d) A can no longer act as S → NotYourSlot.
/// The slot's history is preserved because it attaches to S, not to the user.
#[sqlx::test(migrations = "../projections/migrations")]
async fn replacement_preserves_slot_history_and_transfers_authority(pool: PgPool) {
    let host = "host_h";
    let slot = "slot_7";
    let a = "user_a";
    let b = "user_b";
    let target = "slot_target";

    let game = setup_game(&pool, host, slot, a).await;
    // A second slot to serve as the vote target.
    add_vanilla_slot(&pool, game, host, target).await;

    // A acts as S: votes T and posts.
    handle(
        &pool,
        &user(a),
        Command::SubmitVote {
            game,
            actor_slot: slot.into(),
            target: VoteTarget::Slot(target.into()),
        },
    )
    .await
    .expect("A votes as S");
    let post_ack = handle(
        &pool,
        &user(a),
        Command::SubmitPost {
            game,
            channel_id: "main".into(),
            actor_slot: slot.into(),
            body: "I am slot 7".into(),
            media: Vec::new(),
        },
    )
    .await
    .expect("A posts as S");
    assert!(!post_ack.stream_seqs.is_empty());

    // Pre-replacement: S's ballot tallies for T.
    assert_eq!(tally_for(&pool, game, "D01", target).await, 1, "S voted T");

    // ── THE REPLACEMENT: A → B on the SAME slot id S ──
    handle(
        &pool,
        &user(host),
        Command::ProcessReplacement {
            game,
            slot: slot.into(),
            outgoing_user: a.into(),
            incoming_user: b.into(),
        },
    )
    .await
    .expect("host processes replacement");

    // (a) S's vote STILL tallies for T — the ballot is keyed by slot, not user.
    assert_eq!(
        tally_for(&pool, game, "D01", target).await,
        1,
        "(a) S's vote survives replacement (attached to the slot)"
    );

    // (b) S's post is STILL attributed to slot S in the event log.
    let posts = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted'",
    )
    .bind(game)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(posts.len(), 1, "one post");
    assert_eq!(
        posts[0]["slot_or_user"]["slot"], slot,
        "(b) post authorship is the SLOT id, untouched by replacement"
    );

    // (c) B now resolves SlotOccupant(S) and can vote as S.
    let b_caps = caps::resolve(&pool, &user(b), game).await.unwrap();
    assert!(
        b_caps.grants(&caps::Capability::SlotOccupant(slot.to_string())),
        "(c) incoming user B holds SlotOccupant(S)"
    );
    handle(
        &pool,
        &user(b),
        Command::SubmitVote {
            game,
            actor_slot: slot.into(),
            target: VoteTarget::NoLynch,
        },
    )
    .await
    .expect("(c) B can act as S");
    // B's new ballot OVERWRITES S's prior ballot → T drops to 0, no_lynch is 1.
    assert_eq!(tally_for(&pool, game, "D01", target).await, 0);
    assert_eq!(tally_for(&pool, game, "D01", "no_lynch").await, 1);

    // (d) A can no longer act as S → NotYourSlot.
    let a_err = handle(
        &pool,
        &user(a),
        Command::SubmitVote {
            game,
            actor_slot: slot.into(),
            target: VoteTarget::NoLynch,
        },
    )
    .await
    .expect_err("(d) A is no longer the occupant");
    assert_eq!(a_err, Reject::NotYourSlot, "(d) A → NotYourSlot");

    // And A no longer resolves the capability at all.
    let a_caps = caps::resolve(&pool, &user(a), game).await.unwrap();
    assert!(
        !a_caps.grants(&caps::Capability::SlotOccupant(slot.to_string())),
        "(d) outgoing user A lost SlotOccupant(S)"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn dead_chat_authority_tracks_dead_slot_restore_and_replacement(pool: PgPool) {
    let game = Uuid::new_v4();
    let host = "dead_chat_host";
    let outgoing = "dead_chat_outgoing";
    let incoming = "dead_chat_incoming";
    let living = "dead_chat_living";
    let dead_slot = "dead_slot";
    let living_slot = "living_slot";

    handle(
        &pool,
        &user(host),
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant) in [(dead_slot, outgoing), (living_slot, living)] {
        handle(
            &pool,
            &user(host),
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &user(host),
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &user(host),
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: "vanilla_townie".into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &user(host),
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();

    let pre_death = caps::resolve(&pool, &user(outgoing), game).await.unwrap();
    assert!(!pre_death.grants(&caps::Capability::DeadViewer(game)));
    assert_eq!(
        handle(
            &pool,
            &user(outgoing),
            Command::SubmitPost {
                game,
                channel_id: "dead".into(),
                actor_slot: dead_slot.into(),
                body: "alive principals cannot enter dead chat".into(),
                media: Vec::new(),
            },
        )
        .await
        .unwrap_err(),
        Reject::NotAuthorized,
    );

    handle(
        &pool,
        &user(host),
        Command::SetSlotStatus {
            game,
            slot: dead_slot.into(),
            status: domain::SlotLifecycle::Dead,
        },
    )
    .await
    .unwrap();

    let dead_caps = caps::resolve(&pool, &user(outgoing), game).await.unwrap();
    assert!(dead_caps.grants(&caps::Capability::DeadViewer(game)));
    handle(
        &pool,
        &user(outgoing),
        Command::SubmitPost {
            game,
            channel_id: "dead".into(),
            actor_slot: dead_slot.into(),
            body: "dead history before replacement".into(),
            media: Vec::new(),
        },
    )
    .await
    .expect("dead occupant posts in dead chat");
    assert_eq!(
        handle(
            &pool,
            &user(outgoing),
            Command::SubmitPost {
                game,
                channel_id: "main".into(),
                actor_slot: dead_slot.into(),
                body: "dead main post".into(),
                media: Vec::new(),
            },
        )
        .await
        .unwrap_err(),
        Reject::SlotNotAlive,
        "ordinary main-thread lifecycle rules remain unchanged",
    );
    assert_eq!(
        handle(
            &pool,
            &user(living),
            Command::SubmitPost {
                game,
                channel_id: "dead".into(),
                actor_slot: living_slot.into(),
                body: "living outsider".into(),
                media: Vec::new(),
            },
        )
        .await
        .unwrap_err(),
        Reject::NotAuthorized,
    );

    let encrypted: serde_json::Value = sqlx::query_scalar(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted' \
         AND payload->>'channel_id' = 'dead' ORDER BY stream_seq DESC LIMIT 1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(encrypted.get("body").is_none());
    assert!(encrypted["body_private"]["ciphertext"].is_string());

    handle(
        &pool,
        &user(host),
        Command::ProcessReplacement {
            game,
            slot: dead_slot.into(),
            outgoing_user: outgoing.into(),
            incoming_user: incoming.into(),
        },
    )
    .await
    .unwrap();
    let stale_caps = caps::resolve(&pool, &user(outgoing), game).await.unwrap();
    assert!(!stale_caps.grants(&caps::Capability::DeadViewer(game)));
    let incoming_caps = caps::resolve(&pool, &user(incoming), game).await.unwrap();
    assert!(incoming_caps.grants(&caps::Capability::DeadViewer(game)));
    assert_eq!(
        handle(
            &pool,
            &user(outgoing),
            Command::SubmitPost {
                game,
                channel_id: "dead".into(),
                actor_slot: dead_slot.into(),
                body: "stale outgoing post".into(),
                media: Vec::new(),
            },
        )
        .await
        .unwrap_err(),
        Reject::NotYourSlot,
    );
    handle(
        &pool,
        &user(incoming),
        Command::SubmitPost {
            game,
            channel_id: "dead".into(),
            actor_slot: dead_slot.into(),
            body: "incoming continues dead history".into(),
            media: Vec::new(),
        },
    )
    .await
    .unwrap();

    let before_rebuild = projections::thread_view_for_channel(&pool, game, "dead", None, 10)
        .await
        .unwrap();
    assert_eq!(
        before_rebuild
            .posts
            .iter()
            .map(|post| post.body.as_str())
            .collect::<Vec<_>>(),
        vec![
            "dead history before replacement",
            "incoming continues dead history"
        ],
    );
    rebuild(&pool, game).await.unwrap();
    assert_eq!(
        projections::thread_view_for_channel(&pool, game, "dead", None, 10)
            .await
            .unwrap(),
        before_rebuild,
        "dead-chat history survives projection rebuild",
    );

    handle(
        &pool,
        &user(host),
        Command::SetSlotStatus {
            game,
            slot: dead_slot.into(),
            status: domain::SlotLifecycle::Alive,
        },
    )
    .await
    .unwrap();
    let restored_caps = caps::resolve(&pool, &user(incoming), game).await.unwrap();
    assert!(!restored_caps.grants(&caps::Capability::DeadViewer(game)));
    assert_eq!(
        handle(
            &pool,
            &user(incoming),
            Command::SubmitPost {
                game,
                channel_id: "dead".into(),
                actor_slot: dead_slot.into(),
                body: "restored-alive dead post".into(),
                media: Vec::new(),
            },
        )
        .await
        .unwrap_err(),
        Reject::NotAuthorized,
    );
    handle(
        &pool,
        &user(incoming),
        Command::SubmitPost {
            game,
            channel_id: "main".into(),
            actor_slot: dead_slot.into(),
            body: "restored-alive main post".into(),
            media: Vec::new(),
        },
    )
    .await
    .expect("restoring alive restores ordinary main-thread posting");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn spectator_grant_is_explicit_read_only_and_slot_disjoint(pool: PgPool) {
    let game = Uuid::new_v4();
    let host = "spectator_host";
    let spectator = "spectator_user";
    let player = "spectator_fixture_player";
    let slot = "spectator_fixture_slot";

    handle(
        &pool,
        &user(host),
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    assert_eq!(
        handle(
            &pool,
            &user("not_host"),
            Command::GrantSpectator {
                game,
                user: spectator.into(),
            },
        )
        .await
        .unwrap_err(),
        Reject::NotHost,
    );
    assert_eq!(
        handle(
            &pool,
            &user(host),
            Command::GrantSpectator {
                game,
                user: " ".into(),
            },
        )
        .await
        .unwrap_err(),
        Reject::InvalidTarget,
    );
    handle(
        &pool,
        &user(host),
        Command::GrantSpectator {
            game,
            user: spectator.into(),
        },
    )
    .await
    .unwrap();

    let spectator_caps = caps::resolve(&pool, &user(spectator), game).await.unwrap();
    assert!(spectator_caps.grants(&caps::Capability::SpectatorOf(game)));
    assert!(!spectator_caps
        .iter()
        .any(|cap| matches!(cap, caps::Capability::SlotOccupant(_))));
    assert_eq!(
        handle(
            &pool,
            &user(spectator),
            Command::SubmitPost {
                game,
                channel_id: "spectator".into(),
                actor_slot: "invented-slot".into(),
                body: "spectator append".into(),
                media: Vec::new(),
            },
        )
        .await
        .unwrap_err(),
        Reject::NotAuthorized,
    );
    assert_eq!(
        handle(
            &pool,
            &user(spectator),
            Command::PublishSpectatorPost {
                game,
                body: "spectator cannot publish".into(),
                media: Vec::new(),
            },
        )
        .await
        .unwrap_err(),
        Reject::NotHost,
    );

    handle(
        &pool,
        &user(host),
        Command::AddSlot {
            game,
            slot: slot.into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        handle(
            &pool,
            &user(host),
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: spectator.into(),
            },
        )
        .await
        .unwrap_err(),
        Reject::InvalidTarget,
        "a current spectator cannot acquire a player slot",
    );
    handle(
        &pool,
        &user(host),
        Command::AssignSlot {
            game,
            slot: slot.into(),
            user: player.into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        handle(
            &pool,
            &user(host),
            Command::GrantSpectator {
                game,
                user: player.into(),
            },
        )
        .await
        .unwrap_err(),
        Reject::InvalidTarget,
        "a current player cannot also acquire spectator authority",
    );
    handle(
        &pool,
        &user(host),
        Command::AssignRole {
            game,
            slot: slot.into(),
            role_key: "vanilla_townie".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user(host),
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        handle(
            &pool,
            &user(host),
            Command::ProcessReplacement {
                game,
                slot: slot.into(),
                outgoing_user: player.into(),
                incoming_user: spectator.into(),
            },
        )
        .await
        .unwrap_err(),
        Reject::InvalidTarget,
        "replacement cannot convert a spectator into a slot occupant",
    );

    handle(
        &pool,
        &user(host),
        Command::PublishSpectatorPost {
            game,
            body: "host-authored spectator notice".into(),
            media: Vec::new(),
        },
    )
    .await
    .unwrap();
    let stored: serde_json::Value = sqlx::query_scalar(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted' \
         AND payload->>'channel_id' = 'spectator' ORDER BY stream_seq DESC LIMIT 1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(stored.get("body").is_none());
    assert!(stored["body_private"]["ciphertext"].is_string());

    rebuild(&pool, game).await.unwrap();
    assert_eq!(
        projections::spectator_memberships(&pool, game)
            .await
            .unwrap(),
        vec![projections::SpectatorMembershipRow {
            game_id: game,
            user_id: spectator.into(),
        }],
    );
    assert_eq!(
        projections::thread_view_for_channel(&pool, game, "spectator", None, 10)
            .await
            .unwrap()
            .posts[0]
            .body,
        "host-authored spectator notice",
    );

    handle(
        &pool,
        &user(host),
        Command::RevokeSpectator {
            game,
            user: spectator.into(),
        },
    )
    .await
    .unwrap();
    assert!(!caps::resolve(&pool, &user(spectator), game)
        .await
        .unwrap()
        .grants(&caps::Capability::SpectatorOf(game)));
    assert_eq!(
        handle(
            &pool,
            &user(host),
            Command::RevokeSpectator {
                game,
                user: spectator.into(),
            },
        )
        .await
        .unwrap_err(),
        Reject::InvalidTarget,
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn role_pm_is_engine_declared_slot_stable_and_replacement_safe(pool: PgPool) {
    let host = "host_h";
    let slot = "slot_7";
    let outgoing = "user_a";
    let incoming = "user_b";
    let game = setup_game(&pool, host, slot, outgoing).await;
    let channel_id = domain::role_pm_channel_id(slot);

    let declaration: serde_json::Value = sqlx::query_scalar(
        "SELECT payload FROM events WHERE stream_id = $1 \
         AND kind = 'PrivateChannelDeclared' AND payload->>'channel_id' = $2",
    )
    .bind(game)
    .bind(&channel_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(declaration["kind"], "RolePm");
    assert_eq!(declaration["source"], "engine.role_pm");
    assert_eq!(declaration["members"][0]["slot_id"], slot);
    assert_eq!(declaration["members"][0]["role_key"], "vanilla_townie");

    let members = projections::private_channel_members(&pool, game)
        .await
        .unwrap();
    assert!(members.iter().any(|member| {
        member.channel_id == channel_id
            && member.kind == "RolePm"
            && member.slot_id == slot
            && member.source == "engine.role_pm"
    }));

    let outgoing_caps = caps::resolve(&pool, &user(outgoing), game).await.unwrap();
    assert!(outgoing_caps.grants(&caps::Capability::ChannelMember(channel_id.clone())));
    handle(
        &pool,
        &user(outgoing),
        Command::SubmitPost {
            game,
            channel_id: channel_id.clone(),
            actor_slot: slot.into(),
            body: "Role PM history before replacement".into(),
            media: Vec::new(),
        },
    )
    .await
    .expect("outgoing occupant posts in its engine-declared Role PM");

    handle(
        &pool,
        &user(host),
        Command::ProcessReplacement {
            game,
            slot: slot.into(),
            outgoing_user: outgoing.into(),
            incoming_user: incoming.into(),
        },
    )
    .await
    .expect("host replaces the Role PM member behind the stable slot");

    let stale_caps = caps::resolve(&pool, &user(outgoing), game).await.unwrap();
    assert!(!stale_caps.grants(&caps::Capability::SlotOccupant(slot.into())));
    assert!(!stale_caps.grants(&caps::Capability::ChannelMember(channel_id.clone())));
    let incoming_caps = caps::resolve(&pool, &user(incoming), game).await.unwrap();
    assert!(incoming_caps.grants(&caps::Capability::SlotOccupant(slot.into())));
    assert!(incoming_caps.grants(&caps::Capability::ChannelMember(channel_id.clone())));

    let stale_post = handle(
        &pool,
        &user(outgoing),
        Command::SubmitPost {
            game,
            channel_id: channel_id.clone(),
            actor_slot: slot.into(),
            body: "stale outgoing Role PM post".into(),
            media: Vec::new(),
        },
    )
    .await
    .expect_err("outgoing principal loses slot and Role PM authority immediately");
    assert_eq!(stale_post, Reject::NotYourSlot);

    handle(
        &pool,
        &user(incoming),
        Command::SubmitPost {
            game,
            channel_id: channel_id.clone(),
            actor_slot: slot.into(),
            body: "Incoming occupant continues the same Role PM".into(),
            media: Vec::new(),
        },
    )
    .await
    .expect("incoming occupant posts through the transferred Role PM capability");

    let thread = projections::thread_view_for_channel(&pool, game, &channel_id, None, 10)
        .await
        .unwrap();
    assert_eq!(
        thread
            .posts
            .iter()
            .map(|post| (post.author_slot.as_deref(), post.body.as_str()))
            .collect::<Vec<_>>(),
        vec![
            (Some(slot), "Role PM history before replacement"),
            (Some(slot), "Incoming occupant continues the same Role PM"),
        ],
    );

    let before_rebuild = serde_json::to_string(&members).unwrap();
    rebuild(&pool, game).await.unwrap();
    assert_eq!(
        serde_json::to_string(
            &projections::private_channel_members(&pool, game)
                .await
                .unwrap()
        )
        .unwrap(),
        before_rebuild,
        "Role PM membership remains event-rebuildable across replacement",
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn submit_post_uses_stream_logical_time_and_preserves_empty_text_media_pagination(
    pool: PgPool,
) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    handle(
        &pool,
        &user("host_h"),
        Command::SetPostPolicy {
            game,
            channel_id: "main".into(),
            allow_media_only: true,
        },
    )
    .await
    .expect("host enables media-only posts");
    let first_media = vec![thread_media(
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "tablet canvas drawing",
    )];

    let first_ack = handle(
        &pool,
        &user("user_a"),
        Command::SubmitPost {
            game,
            channel_id: "main".into(),
            actor_slot: "slot_1".into(),
            body: "".into(),
            media: first_media.clone(),
        },
    )
    .await
    .expect("first post");
    let second_ack = handle(
        &pool,
        &user("user_a"),
        Command::SubmitPost {
            game,
            channel_id: "main".into(),
            actor_slot: "slot_1".into(),
            body: "second post".into(),
            media: Vec::new(),
        },
    )
    .await
    .expect("second post");
    assert_eq!(first_ack.stream_seqs.len(), 1);
    assert_eq!(second_ack.stream_seqs.len(), 1);

    let event_rows = sqlx::query(
        "SELECT stream_seq, occurred_at, payload FROM events \
         WHERE stream_id = $1 AND kind = 'PostSubmitted' ORDER BY stream_seq",
    )
    .bind(game)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(event_rows.len(), 2);
    let first_stream_seq: i64 = event_rows[0].get("stream_seq");
    let first_occurred_at: i64 = event_rows[0].get("occurred_at");
    let first_payload: serde_json::Value = event_rows[0].get("payload");
    let second_stream_seq: i64 = event_rows[1].get("stream_seq");
    let second_occurred_at: i64 = event_rows[1].get("occurred_at");
    assert_eq!(
        first_occurred_at, first_stream_seq,
        "PostSubmitted occurred_at should be the deterministic stream logical time"
    );
    assert_eq!(
        second_occurred_at, second_stream_seq,
        "subsequent posts should carry their own stream logical time"
    );
    assert!(
        first_occurred_at < second_occurred_at,
        "post logical time should increase with game-local append order"
    );
    assert_eq!(first_payload["body"], "");
    assert_eq!(first_payload["media"].as_array().unwrap().len(), 1);
    assert_eq!(
        first_payload["media"][0]["content_id"],
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    assert!(first_payload["media"][0].get("url").is_none());

    let latest = projections::thread_view(&pool, game, None, 1)
        .await
        .expect("latest thread page");
    assert_eq!(latest.posts.len(), 1);
    assert_eq!(latest.posts[0].body, "second post");
    let older = projections::thread_view(&pool, game, latest.next_before_seq, 1)
        .await
        .expect("older thread page");
    assert_eq!(older.posts.len(), 1);
    assert_eq!(older.posts[0].body, "");
    assert_eq!(older.posts[0].stream_seq, first_stream_seq);
    assert_eq!(older.posts[0].occurred_at, first_occurred_at);
    assert_eq!(
        older.posts[0].media[0]["content_id"],
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    assert_eq!(older.posts[0].media[0]["variants"]["tablet"]["width"], 1024);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn submit_post_media_only_requires_enabled_post_policy(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let canvas_media = vec![thread_media(
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "tablet canvas drawing",
    )];

    let default_policy = projections::post_policy(&pool, game, "main")
        .await
        .expect("default post policy");
    assert!(!default_policy.allow_media_only);

    let disabled_err = handle(
        &pool,
        &user("user_a"),
        Command::SubmitPost {
            game,
            channel_id: "main".into(),
            actor_slot: "slot_1".into(),
            body: "".into(),
            media: canvas_media.clone(),
        },
    )
    .await
    .expect_err("media-only post needs explicit policy");
    assert_eq!(disabled_err, Reject::InvalidTarget);

    let no_media_err = handle(
        &pool,
        &user("user_a"),
        Command::SubmitPost {
            game,
            channel_id: "main".into(),
            actor_slot: "slot_1".into(),
            body: "".into(),
            media: Vec::new(),
        },
    )
    .await
    .expect_err("empty post without media is still invalid");
    assert_eq!(no_media_err, Reject::InvalidTarget);

    handle(
        &pool,
        &user("host_h"),
        Command::SetPostPolicy {
            game,
            channel_id: "main".into(),
            allow_media_only: true,
        },
    )
    .await
    .expect("host enables media-only posts");
    assert!(
        projections::post_policy(&pool, game, "main")
            .await
            .unwrap()
            .allow_media_only
    );

    handle(
        &pool,
        &user("user_a"),
        Command::SubmitPost {
            game,
            channel_id: "main".into(),
            actor_slot: "slot_1".into(),
            body: "".into(),
            media: canvas_media.clone(),
        },
    )
    .await
    .expect("media-only post after policy enable");
    let thread = projections::thread_view(&pool, game, None, 10)
        .await
        .expect("thread view");
    assert_eq!(thread.posts.len(), 1);
    assert_eq!(thread.posts[0].body, "");
    assert_eq!(
        thread.posts[0].media[0]["content_id"],
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    );

    handle(
        &pool,
        &user("host_h"),
        Command::SetPostPolicy {
            game,
            channel_id: "main".into(),
            allow_media_only: false,
        },
    )
    .await
    .expect("host disables media-only posts");
    let disabled_again = handle(
        &pool,
        &user("user_a"),
        Command::SubmitPost {
            game,
            channel_id: "main".into(),
            actor_slot: "slot_1".into(),
            body: "".into(),
            media: canvas_media,
        },
    )
    .await
    .expect_err("media-only post rejected after policy disable");
    assert_eq!(disabled_again, Reject::InvalidTarget);

    let policy_before =
        serde_json::to_string(&projections::post_policy(&pool, game, "main").await.unwrap())
            .unwrap();
    let thread_before = serde_json::to_string(&thread).unwrap();
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        policy_before,
        serde_json::to_string(&projections::post_policy(&pool, game, "main").await.unwrap())
            .unwrap(),
        "post policy rebuild must preserve the final host toggle"
    );
    assert_eq!(
        thread_before,
        serde_json::to_string(
            &projections::thread_view(&pool, game, None, 10)
                .await
                .unwrap()
        )
        .unwrap(),
        "thread_view rebuild must preserve media-only post"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn private_submit_post_encrypts_body_but_preserves_logical_time_and_media(pool: PgPool) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);
    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "encryptor_user", "encryptor"),
        ("slot_2", "goon_user", "mafia_goon"),
        ("slot_3", "traitor_user", "traitor"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .expect("start declares encryptor private channel");

    let media = vec![thread_media(
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "private tablet canvas drawing",
    )];
    let ack = handle(
        &pool,
        &user("encryptor_user"),
        Command::SubmitPost {
            game,
            channel_id: "private:mafia_day_chat".into(),
            actor_slot: "slot_1".into(),
            body: "private media body".into(),
            media,
        },
    )
    .await
    .expect("private post");
    assert_eq!(ack.stream_seqs.len(), 1);

    let raw = sqlx::query(
        "SELECT stream_seq, occurred_at, payload FROM events \
         WHERE stream_id = $1 AND kind = 'PostSubmitted' ORDER BY stream_seq DESC LIMIT 1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let stream_seq: i64 = raw.get("stream_seq");
    let occurred_at: i64 = raw.get("occurred_at");
    let payload: serde_json::Value = raw.get("payload");
    assert_eq!(occurred_at, stream_seq);
    assert_eq!(payload["channel_id"], "private:mafia_day_chat");
    assert!(
        payload.get("body").is_none(),
        "private PostSubmitted body must not be stored in plaintext"
    );
    assert!(payload["body_private"]["ciphertext"].is_string());
    assert_eq!(
        payload["media"][0]["content_id"],
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    );

    let thread =
        projections::thread_view_for_channel(&pool, game, "private:mafia_day_chat", None, 10)
            .await
            .expect("private thread projection");
    assert_eq!(thread.posts.len(), 1);
    assert_eq!(thread.posts[0].body, "private media body");
    assert_eq!(thread.posts[0].occurred_at, occurred_at);
    assert_eq!(
        thread.posts[0].media[0]["content_id"],
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    );

    rebuild(&pool, game).await.expect("projection rebuild");
    let rebuilt =
        projections::thread_view_for_channel(&pool, game, "private:mafia_day_chat", None, 10)
            .await
            .expect("rebuilt private thread projection");
    assert_eq!(rebuilt.posts, thread.posts);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn concurrent_replacement_waits_for_in_flight_outgoing_post(pool: PgPool) {
    let host_id = "host_h";
    let slot = "slot_7";
    let outgoing = "user_a";
    let incoming = "user_b";
    let game = setup_game(&pool, host_id, slot, outgoing).await;
    let post_body = "outgoing post that started before replacement";

    let lock_key = 41_006_i64;
    install_post_insert_blocker(&pool, game, lock_key).await;
    let mut blocker = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(lock_key)
        .execute(&mut *blocker)
        .await
        .unwrap();

    let post_pool = pool.clone();
    let post_task = tokio::spawn(async move {
        handle(
            &post_pool,
            &user(outgoing),
            Command::SubmitPost {
                game,
                channel_id: "main".into(),
                actor_slot: slot.into(),
                body: post_body.into(),
                media: Vec::new(),
            },
        )
        .await
    });
    wait_for_advisory_wait_count(&pool, 1).await;

    let replacement_pool = pool.clone();
    let replacement_task = tokio::spawn(async move {
        handle(
            &replacement_pool,
            &user(host_id),
            Command::ProcessReplacement {
                game,
                slot: slot.into(),
                outgoing_user: outgoing.into(),
                incoming_user: incoming.into(),
            },
        )
        .await
    });
    let early_replacement = tokio::time::timeout(std::time::Duration::from_millis(250), async {
        loop {
            if replacement_task.is_finished() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await;
    assert!(
        early_replacement.is_err(),
        "replacement must wait while the outgoing post is in flight"
    );

    sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(lock_key)
        .execute(&mut *blocker)
        .await
        .unwrap();

    let post_ack = post_task
        .await
        .unwrap()
        .expect("post that already passed outgoing authority check wins first");
    let replacement_ack = replacement_task
        .await
        .unwrap()
        .expect("replacement proceeds after the in-flight post commits");
    assert_eq!(post_ack.stream_seqs.len(), 1);
    assert_eq!(replacement_ack.stream_seqs.len(), 1);
    assert!(
        post_ack.stream_seqs[0] < replacement_ack.stream_seqs[0],
        "replacement must not commit between outgoing authority check and post append"
    );

    let post_after_replacement = handle(
        &pool,
        &user(outgoing),
        Command::SubmitPost {
            game,
            channel_id: "main".into(),
            actor_slot: slot.into(),
            body: "stale post after replacement".into(),
            media: Vec::new(),
        },
    )
    .await
    .expect_err("outgoing user loses slot authority after replacement");
    assert_eq!(post_after_replacement, Reject::NotYourSlot);

    let events = eventstore::load_stream(&pool, game).await.unwrap();
    let post_event = events
        .iter()
        .find(|event| {
            event.kind == "PostSubmitted" && event.payload["body"].as_str() == Some(post_body)
        })
        .expect("winning post event exists");
    let replacement_event = events
        .iter()
        .find(|event| event.kind == "ReplacementCompleted")
        .expect("replacement event exists");
    assert_eq!(post_event.payload["slot_or_user"]["slot"], slot);
    assert!(
        post_event.stream_seq < replacement_event.stream_seq,
        "post remains a legitimate Slot 7 write before replacement"
    );
    drop_post_insert_blocker(&pool).await;
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn concurrent_replacement_waits_for_in_flight_outgoing_vote(pool: PgPool) {
    let host_id = "host_h";
    let slot = "slot_7";
    let outgoing = "user_a";
    let incoming = "user_b";
    let target = "slot_target";
    let game = setup_game(&pool, host_id, slot, outgoing).await;
    add_vanilla_slot(&pool, game, host_id, target).await;

    let lock_key = 41_007_i64;
    install_vote_insert_blocker(&pool, game, lock_key).await;
    let mut blocker = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(lock_key)
        .execute(&mut *blocker)
        .await
        .unwrap();

    let vote_pool = pool.clone();
    let vote_task = tokio::spawn(async move {
        handle(
            &vote_pool,
            &user(outgoing),
            Command::SubmitVote {
                game,
                actor_slot: slot.into(),
                target: VoteTarget::Slot(target.into()),
            },
        )
        .await
    });
    wait_for_advisory_wait_count(&pool, 1).await;

    let replacement_pool = pool.clone();
    let replacement_task = tokio::spawn(async move {
        handle(
            &replacement_pool,
            &user(host_id),
            Command::ProcessReplacement {
                game,
                slot: slot.into(),
                outgoing_user: outgoing.into(),
                incoming_user: incoming.into(),
            },
        )
        .await
    });
    let early_replacement = tokio::time::timeout(std::time::Duration::from_millis(250), async {
        loop {
            if replacement_task.is_finished() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await;
    assert!(
        early_replacement.is_err(),
        "replacement must wait while the outgoing vote is in flight"
    );

    sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(lock_key)
        .execute(&mut *blocker)
        .await
        .unwrap();

    let vote_ack = vote_task
        .await
        .unwrap()
        .expect("vote that already passed outgoing authority check wins first");
    let replacement_ack = replacement_task
        .await
        .unwrap()
        .expect("replacement proceeds after the in-flight vote commits");
    assert_eq!(vote_ack.stream_seqs.len(), 1);
    assert_eq!(replacement_ack.stream_seqs.len(), 1);
    assert!(
        vote_ack.stream_seqs[0] < replacement_ack.stream_seqs[0],
        "replacement must not commit between outgoing authority check and vote append"
    );
    assert_eq!(
        tally_for(&pool, game, "D01", target).await,
        1,
        "the winning vote remains attached to the stable slot"
    );

    let vote_after_replacement = handle(
        &pool,
        &user(outgoing),
        Command::SubmitVote {
            game,
            actor_slot: slot.into(),
            target: VoteTarget::NoLynch,
        },
    )
    .await
    .expect_err("outgoing user loses slot authority after replacement");
    assert_eq!(vote_after_replacement, Reject::NotYourSlot);

    let events = eventstore::load_stream(&pool, game).await.unwrap();
    let vote_event = events
        .iter()
        .find(|event| event.kind == "VoteSubmitted")
        .expect("winning vote event exists");
    let replacement_event = events
        .iter()
        .find(|event| event.kind == "ReplacementCompleted")
        .expect("replacement event exists");
    assert_eq!(vote_event.payload["actor"], slot);
    assert_eq!(vote_event.payload["target"], target);
    assert!(
        vote_event.stream_seq < replacement_event.stream_seq,
        "vote remains a legitimate Slot 7 write before replacement"
    );
    drop_vote_insert_blocker(&pool).await;
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn concurrent_replacement_and_outgoing_action_converges(pool: PgPool) {
    let host_id = "host_h";
    let slot = "slot_4";
    let outgoing = "action-goon";
    let incoming = "replacement-goon";
    let target = "slot-2";
    let host = user(host_id);
    let game = Uuid::new_v4();
    handle(
        &pool,
        &host,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot_id, occupant, role) in [
        (slot, outgoing, "mafia_goon"),
        (target, "town-target", "vanilla_townie"),
        ("slot-3", "town-backup", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &host,
            Command::AddSlot {
                game,
                slot: slot_id.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignSlot {
                game,
                slot: slot_id.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignRole {
                game,
                slot: slot_id.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &host,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();

    let action_pool = pool.clone();
    let action_task = tokio::spawn(async move {
        handle(
            &action_pool,
            &user(outgoing),
            Command::SubmitAction {
                game,
                action_id: "replacement_race_action".into(),
                actor_slot: slot.into(),
                template_id: "factional_kill".into(),
                targets: vec![target.into()],
                grant_id: None,
            },
        )
        .await
    });

    let replacement_pool = pool.clone();
    let replacement_task = tokio::spawn(async move {
        handle(
            &replacement_pool,
            &user(host_id),
            Command::ProcessReplacement {
                game,
                slot: slot.into(),
                outgoing_user: outgoing.into(),
                incoming_user: incoming.into(),
            },
        )
        .await
    });

    let replacement_ack = replacement_task
        .await
        .unwrap()
        .expect("replacement should converge successfully");
    let action_result = action_task.await.unwrap();
    assert_eq!(replacement_ack.stream_seqs.len(), 1);
    match &action_result {
        Ok(action_ack) => {
            assert_eq!(action_ack.stream_seqs.len(), 1);
            assert!(
                action_ack.stream_seqs[0] < replacement_ack.stream_seqs[0],
                "accepted outgoing action must serialize before replacement"
            );
        }
        Err(err) => assert_eq!(
            *err,
            Reject::NotYourSlot,
            "late outgoing action should revalidate against replacement"
        ),
    }

    let action_after_replacement = handle(
        &pool,
        &user(outgoing),
        Command::SubmitAction {
            game,
            action_id: "stale_action_after_replacement".into(),
            actor_slot: slot.into(),
            template_id: "factional_kill".into(),
            targets: vec![target.into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("outgoing user loses slot authority after replacement");
    assert_eq!(action_after_replacement, Reject::NotYourSlot);

    let incoming_caps = caps::resolve(&pool, &user(incoming), game).await.unwrap();
    assert!(
        incoming_caps.grants(&caps::Capability::SlotOccupant(slot.to_string())),
        "incoming user gains SlotOccupant authority for the action slot"
    );

    let events = eventstore::load_stream(&pool, game).await.unwrap();
    let replacement_event = events
        .iter()
        .find(|event| event.kind == "ReplacementCompleted")
        .expect("replacement event exists");
    let action_events: Vec<_> = events
        .iter()
        .filter(|event| event.kind == "ActionSubmitted")
        .collect();
    match action_result {
        Ok(_) => {
            assert_eq!(action_events.len(), 1);
            assert_eq!(action_events[0].payload["actor"], slot);
            assert_eq!(action_events[0].payload["template_id"], "factional_kill");
            assert_eq!(
                action_events[0].payload["targets"],
                serde_json::json!([target])
            );
            assert!(
                action_events[0].stream_seq < replacement_event.stream_seq,
                "action remains a legitimate Slot 4 write before replacement"
            );
        }
        Err(_) => assert!(
            action_events.is_empty(),
            "rejected stale action must not append"
        ),
    }
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn incoming_replacement_can_submit_and_resolve_action(pool: PgPool) {
    let host_id = "host_h";
    let slot = "slot_4";
    let outgoing = "action-goon";
    let incoming = "replacement-goon";
    let target = "slot-2";
    let host = user(host_id);
    let game = Uuid::new_v4();
    handle(
        &pool,
        &host,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot_id, occupant, role) in [
        (slot, outgoing, "mafia_goon"),
        (target, "town-target", "vanilla_townie"),
        ("slot-3", "town-backup", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &host,
            Command::AddSlot {
                game,
                slot: slot_id.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignSlot {
                game,
                slot: slot_id.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignRole {
                game,
                slot: slot_id.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &host,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();

    handle(
        &pool,
        &host,
        Command::ProcessReplacement {
            game,
            slot: slot.into(),
            outgoing_user: outgoing.into(),
            incoming_user: incoming.into(),
        },
    )
    .await
    .expect("host replaces the action-capable slot");

    let outgoing_err = handle(
        &pool,
        &user(outgoing),
        Command::SubmitAction {
            game,
            action_id: "outgoing_after_replacement".into(),
            actor_slot: slot.into(),
            template_id: "factional_kill".into(),
            targets: vec![target.into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("outgoing user cannot keep action authority after replacement");
    assert_eq!(outgoing_err, Reject::NotYourSlot);

    let action_ack = handle(
        &pool,
        &user(incoming),
        Command::SubmitAction {
            game,
            action_id: "incoming_replacement_kill".into(),
            actor_slot: slot.into(),
            template_id: "factional_kill".into(),
            targets: vec![target.into()],
            grant_id: None,
        },
    )
    .await
    .expect("incoming replacement can submit the slot action");
    assert_eq!(action_ack.stream_seqs.len(), 1);

    handle(&pool, &host, Command::ResolvePhase { game, seed: 72_502 })
        .await
        .expect("host resolves incoming replacement action");

    let action_event = eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .find(|event| {
            event.kind == "ActionSubmitted"
                && event.payload["action_id"] == "incoming_replacement_kill"
        })
        .expect("incoming replacement action event exists");
    assert_eq!(action_event.payload["actor"], slot);
    assert_eq!(action_event.payload["template_id"], "factional_kill");
    assert_eq!(action_event.payload["targets"], serde_json::json!([target]));

    let target_state = slot_state(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .find(|row| row.slot_id == target)
        .expect("resolved target slot");
    assert!(
        !target_state.alive && target_state.status == "dead",
        "incoming replacement action should kill the selected target"
    );

    let notices = player_notifications(&pool, game).await.unwrap();
    assert!(
        notices.iter().any(|notice| {
            notice.audience_slot == target
                && notice.effect == "player_killed"
                && notice.status == "factional_kill"
        }),
        "target receives the private kill receipt from the replacement action"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn non_host_extend_deadline_is_rejected_host_acks(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;

    // A non-host (the slot occupant) tries to extend the deadline.
    let err = handle(
        &pool,
        &user("user_a"),
        Command::ExtendDeadline {
            game,
            phase: "D01".into(),
            at: 999,
        },
    )
    .await
    .expect_err("non-host cannot extend deadline");
    assert_eq!(err, Reject::NotHost);

    // The host can.
    let ack = handle(
        &pool,
        &user("host_h"),
        Command::ExtendDeadline {
            game,
            phase: "D01".into(),
            at: 999,
        },
    )
    .await
    .expect("host extends deadline");
    assert!(!ack.stream_seqs.is_empty());

    // A cohost (delegated authority) can too.
    handle(
        &pool,
        &user("host_h"),
        Command::AddCohost {
            game,
            user: "user_c".into(),
        },
    )
    .await
    .unwrap();
    let cohost_command_id = Uuid::new_v4();
    handle_idempotent(
        &pool,
        &user("user_c"),
        cohost_command_id,
        Command::ExtendDeadline {
            game,
            phase: "D01".into(),
            at: 1000,
        },
    )
    .await
    .expect("cohost extends deadline");

    let event = eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .find(|event| event.kind == "DeadlineExtended" && event.payload["at"] == 1000)
        .expect("cohost deadline event");
    assert_eq!(event.causation_id, Some(cohost_command_id));
    assert_eq!(event.meta["command_id"], cohost_command_id.to_string());
    assert_eq!(event.meta["principal_user_id"], "user_c");
    assert_eq!(event.meta["command_kind"], "ExtendDeadline");
    assert_eq!(event.meta["authority_used"], format!("CohostOf({game})"));
    assert_eq!(event.meta["source"], "host_command");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn cohost_default_full_game_run_and_structural_stays_host_only(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    handle(
        &pool,
        &user("host_h"),
        Command::AddCohost {
            game,
            user: "user_c".into(),
        },
    )
    .await
    .expect("delegate cohost");

    // Default denylist is empty: cohost may resolve phase (game-run).
    handle(
        &pool,
        &user("user_c"),
        Command::ResolvePhase { game, seed: 7 },
    )
    .await
    .expect("cohost resolves phase under default co-GM parity");

    let resolved = eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .find(|event| event.kind == "ResolutionApplied")
        .expect("cohost resolution event");
    assert_eq!(resolved.meta["principal_user_id"], "user_c");
    assert_eq!(resolved.meta["command_kind"], "ResolvePhase");
    assert_eq!(resolved.meta["authority_used"], format!("CohostOf({game})"));
    assert_eq!(resolved.meta["source"], "host_command");
    let causation_id = resolved
        .causation_id
        .expect("accepted command events carry causation id")
        .to_string();
    assert_eq!(resolved.meta["command_id"], causation_id);

    // Structural: cohost cannot grant another cohost.
    let err = handle(
        &pool,
        &user("user_c"),
        Command::AddCohost {
            game,
            user: "user_d".into(),
        },
    )
    .await
    .expect_err("cohost cannot add cohost");
    assert_eq!(err, Reject::NotHost);

    handle(
        &pool,
        &user("host_h"),
        Command::AddCohost {
            game,
            user: "user_d".into(),
        },
    )
    .await
    .expect("primary host still adds cohost");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn apply_effect_plan_is_atomic_audited_and_visible_to_the_engine(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    add_vanilla_slot(&pool, game, "host_h", "slot_2").await;
    handle(
        &pool,
        &user("host_h"),
        Command::AddCohost {
            game,
            user: "user_c".into(),
        },
    )
    .await
    .expect("delegate cohost");

    let mark = game_platform::ConcreteEffect::Mark {
        target: game_platform::SlotId::new("slot_1").unwrap(),
        effect: game_platform::Tag::new("bomb").unwrap(),
    };
    let kill = game_platform::ConcreteEffect::SetSlotLifecycle {
        target: game_platform::SlotId::new("slot_2").unwrap(),
        status: game_platform::SlotLifecycleEffect::Dead,
    };
    let ack = handle_idempotent(
        &pool,
        &user("user_c"),
        Uuid::new_v4(),
        Command::ApplyEffectPlan {
            game,
            effects: vec![mark.clone(), kill],
            reason: "host-team adjudicated raffle consequence".into(),
        },
    )
    .await
    .expect("cohost applies a persistent effect plan");
    assert_eq!(ack.stream_seqs.len(), 2);

    let stream = eventstore::load_stream(&pool, game).await.unwrap();
    let planned = stream
        .iter()
        .filter(|event| ack.stream_seqs.contains(&event.stream_seq))
        .collect::<Vec<_>>();
    assert_eq!(planned.len(), 2);
    for (index, event) in planned.iter().enumerate() {
        assert_eq!(event.actor, ActorId::Host);
        assert_eq!(event.meta["source"], "host_fiat");
        assert_eq!(event.meta["principal_user_id"], "user_c");
        assert_eq!(event.meta["authority_used"], format!("CohostOf({game})"));
        assert_eq!(
            event.meta["effect_plan_reason"],
            "host-team adjudicated raffle consequence"
        );
        assert_eq!(event.meta["effect_plan_index"], index);
    }
    assert_eq!(planned[0].kind, "EffectsMarked");
    assert_eq!(planned[0].payload["actor"], "external");
    assert_eq!(planned[0].payload["source_action"], "host_fiat:mark");
    assert_eq!(planned[0].payload["phase_id"], "D01");
    assert_eq!(planned[0].payload["phase_kind"], "Day");
    assert_eq!(planned[0].payload["phase_number"], 1);
    assert_eq!(planned[0].payload["duration"], "Persistent");
    assert_eq!(planned[1].kind, "SlotStatusChanged");
    assert_eq!(
        planned[1].payload["source_action"],
        "host_fiat:set_slot_lifecycle"
    );
    assert_eq!(planned[1].payload["phase_id"], "D01");

    let projected_effects = slot_effects(&pool, game).await.unwrap();
    let bomb = projected_effects
        .iter()
        .find(|effect| effect.slot_id == "slot_1" && effect.effect == "bomb")
        .expect("persistent mark projected");
    assert_eq!(bomb.source_slot, "external");
    assert_eq!(bomb.source_action.as_deref(), Some("host_fiat:mark"));
    assert_eq!(bomb.phase_id.as_deref(), Some("D01"));
    assert_eq!(bomb.duration, "Persistent");
    let projected_slots = slot_state(&pool, game).await.unwrap();
    assert_eq!(
        projected_slots
            .iter()
            .find(|slot| slot.slot_id == "slot_2")
            .unwrap()
            .status,
        "dead"
    );

    let phase_input = load_engine_phase_input(&pool, game, "D01")
        .await
        .expect("build the exact subsequent ResolvePhase input");
    let marked_slot = phase_input
        .state
        .slots
        .iter()
        .find(|slot| slot.slot_id == "slot_1")
        .unwrap();
    assert!(marked_slot.effects.iter().any(|effect| effect == "bomb"));
    assert_eq!(
        phase_input
            .state
            .slots
            .iter()
            .find(|slot| slot.slot_id == "slot_2")
            .unwrap()
            .status,
        domain::SlotLifecycle::Dead
    );
    let projection_audit = audit_rebuild(&pool, game).await.unwrap();
    assert!(
        projection_audit.ok,
        "effect-plan projections must rebuild from the same stream facts: {:?}",
        projection_audit
            .tables
            .iter()
            .filter(|table| !table.matches)
            .collect::<Vec<_>>()
    );

    let correction_ack = handle(
        &pool,
        &user("host_h"),
        Command::ApplyEffectPlan {
            game,
            effects: vec![
                game_platform::ConcreteEffect::Clear {
                    target: game_platform::SlotId::new("slot_1").unwrap(),
                    effect: game_platform::Tag::new("bomb").unwrap(),
                },
                game_platform::ConcreteEffect::SetSlotLifecycle {
                    target: game_platform::SlotId::new("slot_2").unwrap(),
                    status: game_platform::SlotLifecycleEffect::Alive,
                },
            ],
            reason: "host corrected the adjudication".into(),
        },
    )
    .await
    .expect("clear and lifecycle restore share the same planner");
    let corrected_stream = eventstore::load_stream(&pool, game).await.unwrap();
    let clear = corrected_stream
        .iter()
        .find(|event| {
            correction_ack.stream_seqs.contains(&event.stream_seq) && event.kind == "EffectsCleared"
        })
        .expect("clear event from the correction plan");
    assert_eq!(clear.payload["actor"], "external");
    assert_eq!(clear.payload["source_action"], "host_fiat:clear");
    assert_eq!(clear.payload["phase_id"], "D01");
    assert_eq!(clear.payload["phase_kind"], "Day");
    assert_eq!(clear.payload["phase_number"], 1);
    assert!(slot_effects(&pool, game)
        .await
        .unwrap()
        .iter()
        .all(|effect| effect.effect != "bomb"));
    assert_eq!(
        slot_state(&pool, game)
            .await
            .unwrap()
            .iter()
            .find(|slot| slot.slot_id == "slot_2")
            .unwrap()
            .status,
        "alive"
    );

    let event_count_before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
            .bind(game)
            .fetch_one(&pool)
            .await
            .unwrap();
    let incompatible = handle(
        &pool,
        &user("host_h"),
        Command::ApplyEffectPlan {
            game,
            effects: vec![
                mark,
                game_platform::ConcreteEffect::Grant {
                    target: game_platform::SlotId::new("slot_1").unwrap(),
                    grant: game_platform::GrantSpec {
                        grant_id: game_platform::Tag::new("double_vote").unwrap(),
                        kind: game_platform::GrantKind::VoteWeight,
                        uses: 1,
                        vote_weight: Some(2.0),
                        visibility: game_platform::EffectVisibility::Target,
                    },
                },
            ],
            reason: "this batch must roll back before append".into(),
        },
    )
    .await
    .expect_err("pack-incompatible VoteWeight grant rejects before append");
    assert!(matches!(
        incompatible,
        Reject::EffectSpecValidation(message)
            if message.contains("is not declared by pack `mafiascum` dynamic vote policy")
    ));
    let event_count_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
            .bind(game)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        event_count_after, event_count_before,
        "preflight failure must append none of the earlier valid effects"
    );
    assert!(slot_effects(&pool, game)
        .await
        .unwrap()
        .iter()
        .all(|effect| effect.effect != "bomb"));
    let final_projection_audit = audit_rebuild(&pool, game).await.unwrap();
    assert!(
        final_projection_audit.ok,
        "clear/lifecycle correction must remain rebuild-equivalent: {:?}",
        final_projection_audit
            .tables
            .iter()
            .filter(|table| !table.matches)
            .collect::<Vec<_>>()
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn apply_effect_plan_grants_extra_action_and_item_inventory(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let command_id = Uuid::new_v4();
    let ack = handle_idempotent(
        &pool,
        &user("host_h"),
        command_id,
        Command::ApplyEffectPlan {
            game,
            effects: vec![
                game_platform::ConcreteEffect::Grant {
                    target: game_platform::SlotId::new("slot_1").unwrap(),
                    grant: game_platform::GrantSpec {
                        grant_id: game_platform::Tag::new("extra_action").unwrap(),
                        kind: game_platform::GrantKind::ExtraAction,
                        uses: 2,
                        vote_weight: None,
                        visibility: game_platform::EffectVisibility::Target,
                    },
                },
                game_platform::ConcreteEffect::Grant {
                    target: game_platform::SlotId::new("slot_1").unwrap(),
                    grant: game_platform::GrantSpec {
                        grant_id: game_platform::Tag::new("single_use_item").unwrap(),
                        kind: game_platform::GrantKind::Item,
                        uses: 1,
                        vote_weight: None,
                        visibility: game_platform::EffectVisibility::Target,
                    },
                },
            ],
            reason: "host awarded two mechanical prizes".into(),
        },
    )
    .await
    .expect("host fiat grants use the durable inventory model");
    assert_eq!(
        ack.stream_seqs.len(),
        4,
        "each visible grant appends one grant fact and one notification fact"
    );

    let planned = eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .filter(|event| ack.stream_seqs.contains(&event.stream_seq))
        .collect::<Vec<_>>();
    assert_eq!(
        planned
            .iter()
            .map(|event| event.kind.as_str())
            .collect::<Vec<_>>(),
        vec![
            "ActionGranted",
            "EffectNotification",
            "ActionGranted",
            "EffectNotification",
        ]
    );
    for (effect_index, event_pair) in planned.chunks_exact(2).enumerate() {
        let grant = &event_pair[0];
        assert_eq!(grant.actor, ActorId::Host);
        assert_eq!(grant.payload["actor"], "external");
        assert_eq!(grant.payload["target"], "slot_1");
        assert_eq!(grant.payload["phase_id"], "D01");
        assert_eq!(grant.payload["phase_kind"], "Day");
        assert_eq!(grant.payload["phase_number"], 1);
        let source_action = grant.payload["source_action"].as_str().unwrap();
        assert!(source_action.starts_with("host_fiat:grant:"));
        assert!(source_action.ends_with(&format!(":{effect_index}")));
        assert!(
            !source_action.contains("host_h"),
            "durable mechanical identity must not expose the account principal"
        );
        assert_eq!(grant.meta["effect_plan_index"], effect_index);
        let notification = &event_pair[1];
        assert_eq!(notification.payload["effect"], "grant");
        assert_eq!(notification.payload["status"], grant.payload["grant_id"]);
        assert_eq!(
            notification.payload["audience"],
            serde_json::json!(["slot_1"])
        );
        assert_eq!(notification.payload["phase_id"], "D01");
        assert_eq!(notification.meta["effect_plan_index"], effect_index);
    }

    let grants = action_grants(&pool, game).await.unwrap();
    assert_eq!(grants.len(), 2);
    assert_eq!(grants[0].grant_id, "extra_action");
    assert_eq!(grants[0].kind, "ExtraAction");
    assert_eq!(grants[0].source_slot, "external");
    assert_eq!(grants[0].uses, 2);
    assert_eq!(grants[1].grant_id, "single_use_item");
    assert_eq!(grants[1].kind, "Item");
    assert_eq!(grants[1].source_slot, "external");
    assert_eq!(grants[1].uses, 1);

    let snapshot = load_engine_snapshot(&pool, game, "D01")
        .await
        .expect("top-level grants fold into the exact engine snapshot");
    assert_eq!(snapshot.action_grants.len(), 2);
    assert!(snapshot.action_grants.iter().any(|grant| {
        grant.grant_id == "extra_action"
            && grant.kind == domain::GrantKind::ExtraAction
            && grant.actor == "external"
            && grant.target == "slot_1"
            && grant.uses == 2
    }));
    assert!(snapshot.action_grants.iter().any(|grant| {
        grant.grant_id == "single_use_item"
            && grant.kind == domain::GrantKind::Item
            && grant.actor == "external"
            && grant.target == "slot_1"
            && grant.uses == 1
    }));

    let notices = player_notifications(&pool, game).await.unwrap();
    assert_eq!(notices.len(), 2);
    assert!(notices.iter().all(|notice| {
        notice.audience_slot == "slot_1" && notice.effect == "grant" && notice.phase_id == "D01"
    }));
    let projection_audit = audit_rebuild(&pool, game).await.unwrap();
    assert!(
        projection_audit.ok,
        "top-level grant inventory and notifications must rebuild exactly: {:?}",
        projection_audit
            .tables
            .iter()
            .filter(|table| !table.matches)
            .collect::<Vec<_>>()
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn host_fiat_vote_weight_grant_hammers_from_folded_snapshot(pool: PgPool) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);
    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "test_dynamic_vote_hammer".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "vanilla_townie"),
        ("slot_2", "user_2", "mafia_goon"),
        ("slot_3", "user_3", "vote_granter"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();

    let command_id = Uuid::new_v4();
    let grant_ack = handle_idempotent(
        &pool,
        &h,
        command_id,
        Command::ApplyEffectPlan {
            game,
            effects: vec![game_platform::ConcreteEffect::Grant {
                target: game_platform::SlotId::new("slot_1").unwrap(),
                grant: game_platform::GrantSpec {
                    grant_id: game_platform::Tag::new("vote_power_boost").unwrap(),
                    kind: game_platform::GrantKind::VoteWeight,
                    uses: 1,
                    vote_weight: Some(2.0),
                    visibility: game_platform::EffectVisibility::Target,
                },
            }],
            reason: "host awarded a double-vote prize".into(),
        },
    )
    .await
    .expect("pack-declared VoteWeight grant is accepted");
    assert_eq!(grant_ack.stream_seqs.len(), 2);
    let grant_event = eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .find(|event| {
            grant_ack.stream_seqs.contains(&event.stream_seq) && event.kind == "ActionGranted"
        })
        .expect("host-fiat ActionGranted stream fact");
    assert_eq!(grant_event.payload["kind"], "VoteWeight");
    assert_eq!(grant_event.payload["vote_weight"], 2.0);
    let grant_source_action = grant_event.payload["source_action"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(grant_source_action.starts_with("host_fiat:grant:"));
    assert!(grant_source_action.ends_with(":0"));
    assert!(!grant_source_action.contains("host_h"));

    let n01_snapshot = load_engine_snapshot(&pool, game, "N01")
        .await
        .expect("host-fiat VoteWeight grant folds before any resolution");
    assert!(n01_snapshot.action_grants.iter().any(|grant| {
        grant.target == "slot_1"
            && grant.grant_id == "vote_power_boost"
            && grant.kind == domain::GrantKind::VoteWeight
            && grant.actor == "external"
            && grant.source_action == grant_source_action
            && grant.uses == 1
            && grant.vote_weight == Some(2.0)
    }));

    handle(&pool, &h, Command::ResolvePhase { game, seed: 9_101 })
        .await
        .expect("night resolution preserves the pre-existing host-fiat grant");
    handle(
        &pool,
        &h,
        Command::SetSlotStatus {
            game,
            slot: "slot_3".into(),
            status: domain::SlotLifecycle::Dead,
        },
    )
    .await
    .expect("remove the third slot from the day majority denominator");
    handle(&pool, &h, Command::AdvancePhase { game })
        .await
        .expect("advance to the vote-weighted day");

    let d02_snapshot = load_engine_snapshot(&pool, game, "D02")
        .await
        .expect("host-fiat grant survives the phase boundary");
    assert!(d02_snapshot.action_grants.iter().any(|grant| {
        grant.target == "slot_1"
            && grant.grant_id == "vote_power_boost"
            && grant.kind == domain::GrantKind::VoteWeight
            && grant.vote_weight == Some(2.0)
    }));

    let hammer_ack = handle(
        &pool,
        &user("user_1"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .expect("one host-granted 2.0-weight ballot reaches majority");
    assert_eq!(hammer_ack.stream_seqs.len(), 2);
    assert!(phase_state(&pool, game).await.unwrap().unwrap().locked);
    let lock_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ThreadLocked' \
         ORDER BY stream_seq DESC LIMIT 1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(lock_payload["reason"], "hammer");
    assert_eq!(lock_payload["actor"], "slot_1");
    assert_eq!(lock_payload["target"], "slot_2");

    let grants_before = serde_json::to_string(&action_grants(&pool, game).await.unwrap()).unwrap();
    let phase_before = serde_json::to_string(&phase_state(&pool, game).await.unwrap()).unwrap();
    let projection_audit = audit_rebuild(&pool, game).await.unwrap();
    assert!(
        projection_audit.ok,
        "host-fiat VoteWeight grant must remain rebuild-equivalent: {:?}",
        projection_audit
            .tables
            .iter()
            .filter(|table| !table.matches)
            .collect::<Vec<_>>()
    );
    assert_eq!(
        grants_before,
        serde_json::to_string(&action_grants(&pool, game).await.unwrap()).unwrap()
    );
    assert_eq!(
        phase_before,
        serde_json::to_string(&phase_state(&pool, game).await.unwrap()).unwrap()
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn cohost_denied_lifecycle_and_effect_spec_while_deadline_still_allowed(pool: PgPool) {
    let game = Uuid::new_v4();
    handle(
        &pool,
        &user("host_h"),
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![
                CohostPermissionClass::Lifecycle,
                CohostPermissionClass::EffectSpec,
            ],
        },
    )
    .await
    .expect("create with lifecycle denied");
    for (slot, occupant) in [("slot_1", "user_a"), ("slot_2", "user_b")] {
        handle(
            &pool,
            &user("host_h"),
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &user("host_h"),
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &user("host_h"),
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: "vanilla_townie".into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &user("host_h"),
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("host_h"),
        Command::OpenDayPhase {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("host_h"),
        Command::AddCohost {
            game,
            user: "user_c".into(),
        },
    )
    .await
    .unwrap();

    handle(
        &pool,
        &user("user_c"),
        Command::ExtendDeadline {
            game,
            phase: "D01".into(),
            at: 4242,
        },
    )
    .await
    .expect("deadline class still allowed");

    let denied = handle(
        &pool,
        &user("user_c"),
        Command::SetSlotStatus {
            game,
            slot: "slot_2".into(),
            status: domain::SlotLifecycle::Dead,
        },
    )
    .await
    .expect_err("lifecycle class denied for cohost");
    assert_eq!(denied, Reject::CohostPermissionDenied("lifecycle".into()));

    let denied = handle(
        &pool,
        &user("user_c"),
        Command::ApplyEffectPlan {
            game,
            effects: vec![game_platform::ConcreteEffect::Mark {
                target: game_platform::SlotId::new("slot_1").unwrap(),
                effect: game_platform::Tag::new("bomb").unwrap(),
            }],
            reason: "cohost policy must reject before append".into(),
        },
    )
    .await
    .expect_err("effect-spec class denied for cohost");
    assert_eq!(denied, Reject::CohostPermissionDenied("effect_spec".into()));

    // Primary host ignores denylist.
    handle(
        &pool,
        &user("host_h"),
        Command::SetSlotStatus {
            game,
            slot: "slot_2".into(),
            status: domain::SlotLifecycle::Dead,
        },
    )
    .await
    .expect("host can still set lifecycle when cohost is denied");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn stale_phase_extend_deadline_rejects_without_mutating_current_phase(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    handle(
        &pool,
        &user("host_h"),
        Command::AddCohost {
            game,
            user: "user_c".into(),
        },
    )
    .await
    .expect("delegate cohost");

    let wrong_phase_err = handle(
        &pool,
        &user("user_c"),
        Command::ExtendDeadline {
            game,
            phase: "N01".into(),
            at: 111,
        },
    )
    .await
    .expect_err("cohost cannot extend a non-current phase");
    assert_eq!(wrong_phase_err, Reject::PhaseLocked);
    let d01_before_deadline = phase_state(&pool, game).await.unwrap().unwrap();
    assert_eq!(d01_before_deadline.phase_id, "D01");
    assert_eq!(d01_before_deadline.deadline, None);

    handle(
        &pool,
        &user("user_c"),
        Command::ExtendDeadline {
            game,
            phase: "D01".into(),
            at: 222,
        },
    )
    .await
    .expect("cohost extends the current open phase");
    assert_eq!(
        phase_state(&pool, game).await.unwrap().unwrap().deadline,
        Some(222),
    );

    handle(
        &pool,
        &user("host_h"),
        Command::ResolvePhase { game, seed: 4815 },
    )
    .await
    .expect("host resolves D01");
    let locked_phase_err = handle(
        &pool,
        &user("user_c"),
        Command::ExtendDeadline {
            game,
            phase: "D01".into(),
            at: 333,
        },
    )
    .await
    .expect_err("cohost cannot extend a locked phase");
    assert_eq!(locked_phase_err, Reject::PhaseLocked);
    assert_eq!(
        phase_state(&pool, game).await.unwrap().unwrap().deadline,
        Some(222),
    );

    handle(&pool, &user("host_h"), Command::AdvancePhase { game })
        .await
        .expect("host advances to night");
    let n01 = phase_state(&pool, game).await.unwrap().unwrap();
    assert_eq!(n01.phase_id, "N01");
    assert_eq!(n01.deadline, None);

    let stale_phase_err = handle(
        &pool,
        &user("user_c"),
        Command::ExtendDeadline {
            game,
            phase: "D01".into(),
            at: 444,
        },
    )
    .await
    .expect_err("cohost cannot extend a stale phase");
    assert_eq!(stale_phase_err, Reject::PhaseLocked);
    let after_stale_reject = phase_state(&pool, game).await.unwrap().unwrap();
    assert_eq!(after_stale_reject.phase_id, "N01");
    assert_eq!(after_stale_reject.deadline, None);

    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "DeadlineExtended",
            1,
            serde_json::json!({ "phase_id": "D01", "at": 555 }),
            ActorId::Host,
            0,
        )],
    )
    .await
    .expect("bypass stale deadline event appends");
    let after_bypass_event = phase_state(&pool, game).await.unwrap().unwrap();
    assert_eq!(after_bypass_event.phase_id, "N01");
    assert_eq!(
        after_bypass_event.deadline, None,
        "projection must not let stale deadline events mutate the current phase",
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn stored_game_stream_loads_deterministic_slot_only_engine_snapshot(pool: PgPool) {
    let game = Uuid::new_v4();
    let host = user("host_h");

    handle(
        &pool,
        &host,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();

    for (slot, occupant, role) in [
        ("slot_c", "user_c", "mafia_goon"),
        ("slot_a", "user_a", "bulletproof"),
        ("slot_b", "user_b", "doctor"),
    ] {
        handle(
            &pool,
            &host,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &host,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_a"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_a".into(),
            target: VoteTarget::Slot("slot_c".into()),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &host,
        Command::ProcessReplacement {
            game,
            slot: "slot_a".into(),
            outgoing_user: "user_a".into(),
            incoming_user: "user_z".into(),
        },
    )
    .await
    .unwrap();

    let first = load_engine_snapshot(&pool, game, "D01")
        .await
        .expect("first engine snapshot load");
    let second = load_engine_snapshot(&pool, game, "D01")
        .await
        .expect("second engine snapshot load");
    let first_json = serde_json::to_value(&first).expect("snapshot serializes");
    let second_json = serde_json::to_value(&second).expect("snapshot serializes");

    assert_eq!(
        first_json, second_json,
        "loading the same stored stream twice should produce identical engine snapshots"
    );
    assert_eq!(first.phase_id, "D01");
    assert_eq!(first.phase_kind, domain::pack::PhaseKind::Day);
    assert_eq!(first.phase_number, 1);
    assert_eq!(
        first
            .slots
            .iter()
            .map(|slot| slot.slot_id.as_str())
            .collect::<Vec<_>>(),
        vec!["slot_a", "slot_b", "slot_c"],
        "snapshot slots are deterministic and keyed by SlotId"
    );
    let bulletproof = first
        .slots
        .iter()
        .find(|slot| slot.slot_id == "slot_a")
        .expect("slot_a in snapshot");
    assert_eq!(bulletproof.role_key, "bulletproof");
    assert_eq!(bulletproof.alignment.as_deref(), Some("town"));
    assert!(bulletproof
        .effects
        .iter()
        .any(|effect| effect == "bulletproof"));

    let serialized = serde_json::to_string(&first_json).expect("snapshot json string");
    assert!(
        !serialized.contains("user_"),
        "engine snapshot must not leak UserId/occupant identity: {serialized}"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn engine_snapshot_identity_audit_keeps_users_out_of_state_snapshot(pool: PgPool) {
    let game = Uuid::new_v4();
    let host = user("user_host_alpha");

    handle(
        &pool,
        &host,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &host,
        Command::AddCohost {
            game,
            user: "user_cohost_beta".into(),
        },
    )
    .await
    .unwrap();

    for (slot, occupant, role) in [
        ("slot_red", "user_player_red", "vanilla_townie"),
        ("slot_blue", "user_player_blue", "mafia_goon"),
    ] {
        handle(
            &pool,
            &host,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &host,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &host,
        Command::ProcessReplacement {
            game,
            slot: "slot_red".into(),
            outgoing_user: "user_player_red".into(),
            incoming_user: "user_replacement_green".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_replacement_green"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_red".into(),
            target: VoteTarget::Slot("slot_blue".into()),
        },
    )
    .await
    .unwrap();

    let audit = audit_engine_snapshot_identity_boundary(&pool, game, "D01")
        .await
        .expect("identity boundary audit");

    assert_eq!(audit.phase_id, "D01");
    assert_eq!(audit.snapshot_slot_ids, vec!["slot_blue", "slot_red"]);
    for expected_user in [
        "user_host_alpha",
        "user_cohost_beta",
        "user_player_red",
        "user_player_blue",
        "user_replacement_green",
    ] {
        assert!(
            audit
                .stream_user_ids
                .iter()
                .any(|user| user == expected_user),
            "audit should discover {expected_user} in stream identities: {audit:?}"
        );
    }
    assert!(
        audit.leaked_user_ids.is_empty(),
        "engine snapshot leaked platform users into resolver input: {audit:?}"
    );
    assert!(
        audit.slot_only,
        "engine snapshot should preserve slot ids while excluding user identities: {audit:?}"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn stored_game_stream_loads_phase_metadata_deadline_and_pack_policy(pool: PgPool) {
    let game = Uuid::new_v4();
    let host = user("host_phase_policy");

    handle(
        &pool,
        &host,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();

    for (slot, occupant, role) in [
        ("slot_1", "user_1", "vanilla_townie"),
        ("slot_2", "user_2", "mafia_goon"),
    ] {
        handle(
            &pool,
            &host,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &host,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &host,
        Command::ExtendDeadline {
            game,
            phase: "D01".into(),
            at: 1_799_999_999,
        },
    )
    .await
    .unwrap();

    let snapshot = load_engine_snapshot(&pool, game, "D01")
        .await
        .expect("load engine snapshot with phase metadata");

    assert_eq!(snapshot.phase_id, "D01");
    assert_eq!(snapshot.phase_kind, domain::pack::PhaseKind::Day);
    assert_eq!(snapshot.phase_number, 1);
    assert_eq!(snapshot.phase_deadline, Some(1_799_999_999));
    assert_eq!(
        snapshot.phase_policy.cadence,
        vec![domain::pack::PhaseKind::Day, domain::pack::PhaseKind::Night],
        "snapshot must carry the declared pack cadence"
    );
    assert_eq!(
        snapshot
            .phase_policy
            .subsegments
            .get(&domain::pack::PhaseKind::Day)
            .cloned()
            .unwrap_or_default(),
        vec!["sod", "main", "eod"],
        "snapshot must carry pack day subsegments"
    );
    assert!(
        !snapshot.phase_policy.twilight,
        "mafiascum pack disables twilight in its phase policy"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn stored_game_stream_loads_slot_lifecycle_and_pack_visible_status_tags(pool: PgPool) {
    let game = Uuid::new_v4();
    let host = user("host_slot_status");

    handle(
        &pool,
        &host,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();

    for (slot, occupant, role) in [
        ("slot_1", "user_1", "vanilla_townie"),
        ("slot_2", "user_2", "vanilla_townie"),
        ("slot_3", "user_3", "mafia_goon"),
        ("slot_4", "user_4", "voteless"),
    ] {
        handle(
            &pool,
            &host,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &host,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();
    for (user_id, actor_slot) in [("user_2", "slot_2"), ("user_3", "slot_3")] {
        handle(
            &pool,
            &user(user_id),
            Command::SubmitVote {
                game,
                actor_slot: actor_slot.into(),
                target: VoteTarget::Slot("slot_1".into()),
            },
        )
        .await
        .unwrap();
    }
    handle(&pool, &host, Command::ResolvePhase { game, seed: 17 })
        .await
        .expect("host resolves lynch");
    handle(
        &pool,
        &host,
        Command::SetSlotStatus {
            game,
            slot: "slot_2".into(),
            status: domain::SlotLifecycle::Modkilled,
        },
    )
    .await
    .expect("host modkills slot");
    handle(
        &pool,
        &host,
        Command::AddSlotStatusTag {
            game,
            slot: "slot_4".into(),
            tag: "treestump".into(),
        },
    )
    .await
    .expect("host tags slot");

    let snapshot = load_engine_snapshot(&pool, game, "D01")
        .await
        .expect("load engine snapshot with slot status");
    let slot_1 = snapshot
        .slots
        .iter()
        .find(|slot| slot.slot_id == "slot_1")
        .expect("slot_1 in snapshot");
    let slot_2 = snapshot
        .slots
        .iter()
        .find(|slot| slot.slot_id == "slot_2")
        .expect("slot_2 in snapshot");
    let slot_4 = snapshot
        .slots
        .iter()
        .find(|slot| slot.slot_id == "slot_4")
        .expect("slot_4 in snapshot");

    assert_eq!(slot_1.status, domain::SlotLifecycle::Dead);
    assert_eq!(slot_2.status, domain::SlotLifecycle::Modkilled);
    assert!(
        slot_4.status_tags.iter().any(|tag| tag == "treestump"),
        "explicit host status tag should enter snapshot: {slot_4:?}"
    );
    assert!(
        slot_4
            .status_tags
            .iter()
            .any(|tag| tag == "limited_vote:voteless"),
        "pack vote policy should expose voteless as a limited-vote status tag: {slot_4:?}"
    );

    let projected = slot_state(&pool, game).await.unwrap();
    let projected_slot_2 = projected
        .iter()
        .find(|slot| slot.slot_id == "slot_2")
        .expect("slot_2 projection");
    let projected_slot_4 = projected
        .iter()
        .find(|slot| slot.slot_id == "slot_4")
        .expect("slot_4 projection");
    assert_eq!(projected_slot_2.status, "modkilled");
    assert!(!projected_slot_2.alive);
    assert_eq!(projected_slot_4.status_tags, vec!["treestump"]);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn resolve_phase_tags_treestump_and_preserves_dead_vote_action_bar(pool: PgPool) {
    let game = Uuid::new_v4();
    let host = user("host_treestump");

    handle(
        &pool,
        &host,
        Command::CreateGame {
            game,
            pack: "mafia_universe".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();

    for (slot, occupant, role) in [
        ("slot_1", "user_treestump", "town_treestump"),
        ("slot_2", "user_town_2", "town_vanilla"),
        ("slot_3", "user_town_3", "town_vanilla"),
        ("slot_4", "user_town_4", "town_vanilla"),
        ("slot_5", "user_mafia_5", "mafia_goon"),
        ("slot_6", "user_mafia_6", "mafia_goon"),
    ] {
        handle(
            &pool,
            &host,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &host,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();

    for (user_id, actor_slot, seq_target) in [
        ("user_town_2", "slot_2", "slot_1"),
        ("user_town_3", "slot_3", "slot_1"),
        ("user_town_4", "slot_4", "slot_1"),
        ("user_mafia_5", "slot_5", "slot_1"),
    ] {
        handle(
            &pool,
            &user(user_id),
            Command::SubmitVote {
                game,
                actor_slot: actor_slot.into(),
                target: VoteTarget::Slot(seq_target.into()),
            },
        )
        .await
        .unwrap();
    }

    handle(&pool, &host, Command::ResolvePhase { game, seed: 930001 })
        .await
        .expect("host resolves treestump lynch");

    let payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let applied = domain::validate_resolution_json(&payload, domain::RESULT_VERSION).unwrap();
    let tag_index = applied
        .events
        .iter()
        .find_map(|indexed| match &indexed.event {
            domain::InnerEvent::SlotStatusTagged {
                slot_id,
                tag,
                source,
            } if slot_id == "slot_1" && tag == "treestump" && source == "day_vote" => {
                Some(indexed.index)
            }
            _ => None,
        })
        .expect("treestump death emits durable status tag");
    let phase_announcement_index = applied
        .events
        .iter()
        .find_map(|indexed| {
            matches!(indexed.event, domain::InnerEvent::PhaseAnnouncement(_))
                .then_some(indexed.index)
        })
        .expect("phase announcement stored");
    assert!(
        tag_index < phase_announcement_index,
        "treestump tag must be inside the resolution before the final phase announcement"
    );

    let slots = slot_state(&pool, game).await.unwrap();
    let treestump = slots
        .iter()
        .find(|slot| slot.slot_id == "slot_1")
        .expect("treestump slot projected");
    assert!(!treestump.alive, "treestump is dead for game mechanics");
    assert_eq!(treestump.status, "dead");
    assert_eq!(treestump.status_tags, vec!["treestump"]);

    let slots_before = serde_json::to_string(&slots).unwrap();
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        slots_before,
        serde_json::to_string(&slot_state(&pool, game).await.unwrap()).unwrap(),
        "slot_state rebuild must preserve treestump death status and tag"
    );

    handle(&pool, &host, Command::UnlockThread { game })
        .await
        .expect("host reopens thread after resolution");
    handle(
        &pool,
        &user("user_treestump"),
        Command::SubmitPost {
            game,
            channel_id: "main".into(),
            actor_slot: "slot_1".into(),
            body: "still here, no vote".into(),
            media: Vec::new(),
        },
    )
    .await
    .expect("dead treestump may post after unlock");

    let vote_err = handle(
        &pool,
        &user("user_treestump"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .expect_err("dead treestump cannot vote");
    assert_eq!(vote_err, Reject::SlotNotAlive);

    let action_err = handle(
        &pool,
        &user("user_treestump"),
        Command::SubmitAction {
            game,
            action_id: "dead_treestump_action".into(),
            actor_slot: "slot_1".into(),
            template_id: "ita_shot".into(),
            targets: vec!["slot_6".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("dead treestump cannot act");
    assert_eq!(action_err, Reject::SlotNotAlive);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn stored_game_stream_loads_role_alignment_reveal_state_and_role_effects(pool: PgPool) {
    let game = Uuid::new_v4();
    let host = user("host_role_reveal");

    handle(
        &pool,
        &host,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();

    for (slot, occupant, role) in [
        ("slot_1", "user_1", "godfather"),
        ("slot_2", "user_2", "cop"),
    ] {
        handle(
            &pool,
            &host,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &host,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();

    let raw_role_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'RoleAssigned' \
         AND payload->>'slot_id' = 'slot_1'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(raw_role_payload["slot_id"], "slot_1");
    assert!(raw_role_payload.get("role_key").is_none());
    assert!(raw_role_payload.get("alignment").is_none());
    assert!(raw_role_payload.get("role_effects").is_none());
    assert!(raw_role_payload["private"]["ciphertext"].is_string());

    let snapshot = load_engine_snapshot(&pool, game, "D01")
        .await
        .expect("load engine snapshot with private role facts");
    let godfather = snapshot
        .slots
        .iter()
        .find(|slot| slot.slot_id == "slot_1")
        .expect("godfather slot");
    assert_eq!(godfather.role_key, "godfather");
    assert_eq!(godfather.alignment.as_deref(), Some("mafia"));
    assert_eq!(godfather.role_reveal, domain::RevealState::Private);
    assert_eq!(godfather.alignment_reveal, domain::RevealState::Private);
    assert!(
        godfather.effects.iter().any(|effect| effect == "godfather"),
        "role-level godfather effect should be resolver-visible: {godfather:?}"
    );

    let projected_before = slot_state(&pool, game).await.unwrap();
    let projected_godfather = projected_before
        .iter()
        .find(|slot| slot.slot_id == "slot_1")
        .expect("projected godfather slot");
    assert_eq!(projected_godfather.role_key.as_deref(), Some("godfather"));
    assert_eq!(projected_godfather.alignment.as_deref(), Some("mafia"));
    assert!(
        !projected_godfather.role_revealed,
        "role facts may exist in the read model but remain private until reveal"
    );
    assert!(
        !projected_godfather.alignment_revealed,
        "alignment facts may exist in the read model but remain private until reveal"
    );
    let effects_before = slot_effects(&pool, game).await.unwrap();
    assert!(
        effects_before
            .iter()
            .any(|effect| effect.slot_id == "slot_1" && effect.effect == "godfather"),
        "role-level effects should be projected as rebuildable slot effects"
    );

    handle(&pool, &host, Command::CompleteGame { game })
        .await
        .expect("host completes game");

    let completed_snapshot = load_engine_snapshot(&pool, game, "D01")
        .await
        .expect("load completed engine snapshot");
    let completed_godfather = completed_snapshot
        .slots
        .iter()
        .find(|slot| slot.slot_id == "slot_1")
        .expect("completed godfather slot");
    assert_eq!(completed_godfather.role_reveal, domain::RevealState::Public);
    assert_eq!(
        completed_godfather.alignment_reveal,
        domain::RevealState::Public
    );
    assert_eq!(completed_godfather.role_key, "godfather");
    assert_eq!(completed_godfather.alignment.as_deref(), Some("mafia"));

    let duplicate_complete_err = handle(&pool, &host, Command::CompleteGame { game })
        .await
        .expect_err("completed game must reject stale duplicate completion");
    assert_eq!(duplicate_complete_err, Reject::GameAlreadyCompleted);
    let completed_event_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 AND kind = 'GameCompleted'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        completed_event_count, 1,
        "duplicate CompleteGame must not append another GameCompleted event"
    );
    for (label, principal, command) in [
        ("host lock", host.clone(), Command::LockThread { game }),
        (
            "player vote",
            user("user_1"),
            Command::SubmitVote {
                game,
                actor_slot: "slot_1".into(),
                target: VoteTarget::Slot("slot_2".into()),
            },
        ),
        (
            "player post",
            user("user_1"),
            Command::SubmitPost {
                game,
                channel_id: "main".into(),
                actor_slot: "slot_1".into(),
                body: "post-completion stale post".into(),
                media: Vec::new(),
            },
        ),
    ] {
        let err = match handle(&pool, &principal, command).await {
            Ok(ack) => panic!("{label} must reject after completion, got {ack:?}"),
            Err(err) => err,
        };
        assert_eq!(err, Reject::GameAlreadyCompleted, "{label}");
    }

    let projected_after = slot_state(&pool, game).await.unwrap();
    assert!(
        projected_after.iter().all(|slot| slot.role_revealed),
        "GameCompleted should reveal every projected slot role"
    );
    assert!(
        projected_after.iter().all(|slot| slot.alignment_revealed),
        "GameCompleted should reveal every projected slot alignment"
    );
    let projected_after_json = serde_json::to_string(&projected_after).unwrap();
    let effects_after_json =
        serde_json::to_string(&slot_effects(&pool, game).await.unwrap()).unwrap();
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        projected_after_json,
        serde_json::to_string(&slot_state(&pool, game).await.unwrap()).unwrap(),
        "slot_state rebuild must preserve role/alignment/reveal facts"
    );
    assert_eq!(
        effects_after_json,
        serde_json::to_string(&slot_effects(&pool, game).await.unwrap()).unwrap(),
        "slot_effect rebuild must preserve role-level effects"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn concurrent_complete_game_serializes_to_one_ack(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let host = user("host_h");

    let (first, second) = tokio::join!(
        handle(&pool, &host, Command::CompleteGame { game }),
        handle(&pool, &host, Command::CompleteGame { game }),
    );

    let results = [first, second];
    let ack_count = results.iter().filter(|result| result.is_ok()).count();
    let already_completed_count = results
        .iter()
        .filter(|result| matches!(result, Err(Reject::GameAlreadyCompleted)))
        .count();
    assert_eq!(ack_count, 1, "exactly one CompleteGame command should ACK");
    assert_eq!(
        already_completed_count, 1,
        "losing CompleteGame command should revalidate after the winner completes the game"
    );

    let completed_event_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 AND kind = 'GameCompleted'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        completed_event_count, 1,
        "concurrent CompleteGame commands must append one GameCompleted event"
    );

    let projected_after = slot_state(&pool, game).await.unwrap();
    assert!(
        projected_after
            .iter()
            .all(|slot| slot.role_revealed && slot.alignment_revealed),
        "winning CompleteGame command should reveal every projected slot"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn concurrent_player_post_and_complete_game_serialize_terminal_boundary(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let host = user("host_h");
    let player = user("user_a");

    let (complete, post) = tokio::join!(
        handle(&pool, &host, Command::CompleteGame { game }),
        handle(
            &pool,
            &player,
            Command::SubmitPost {
                game,
                channel_id: "main".into(),
                actor_slot: "slot_1".into(),
                body: "racing post against completion".into(),
                media: Vec::new(),
            },
        ),
    );

    let complete = complete.expect("CompleteGame should ACK the first completion");
    assert_eq!(
        complete.stream_seqs.len(),
        1,
        "completion appends exactly GameCompleted"
    );
    let complete_seq = complete.stream_seqs[0];

    match post {
        Ok(post_ack) => {
            assert_eq!(post_ack.stream_seqs.len(), 1);
            assert!(
                post_ack.stream_seqs[0] < complete_seq,
                "if the racing post ACKs, it must serialize before GameCompleted"
            );
        }
        Err(Reject::GameAlreadyCompleted) => {}
        Err(err) => panic!("racing post should only reject as completed, got {err:?}"),
    }

    let events = eventstore::load_stream(&pool, game)
        .await
        .expect("load event stream");
    let completed_seq = events
        .iter()
        .find(|event| event.kind == "GameCompleted")
        .expect("completion event")
        .stream_seq;
    assert_eq!(completed_seq, complete_seq);
    let post_after_completion = events
        .iter()
        .any(|event| event.kind == "PostSubmitted" && event.stream_seq > completed_seq);
    assert!(
        !post_after_completion,
        "no player post may append after GameCompleted"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn submit_action_resolves_instant_self_destruct_atomically(pool: PgPool) {
    let host = user("host_instant_self_destruct");
    let game = Uuid::new_v4();

    handle(
        &pool,
        &host,
        Command::CreateGame {
            game,
            pack: "test_instant_window".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "instant_user_1", "instant_self_destructor"),
        ("slot_2", "instant_user_2", "vanilla_townie"),
        ("slot_3", "instant_user_3", "vanilla_townie"),
        ("slot_4", "instant_user_4", "mafia_goon"),
        ("slot_5", "instant_user_5", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &host,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &host,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();

    let ack = handle(
        &pool,
        &user("instant_user_1"),
        Command::SubmitAction {
            game,
            action_id: "instant_self_001".into(),
            actor_slot: "slot_1".into(),
            template_id: "instant_self_destruct".into(),
            targets: vec!["slot_2".into()],
            grant_id: None,
        },
    )
    .await
    .expect("Instant self-destruct action resolves during SubmitAction");
    assert_eq!(
        ack.stream_seqs.len(),
        3,
        "instant SubmitAction appends ActionSubmitted, ResolutionApplied, and ResolutionTrace"
    );
    assert!(
        !phase_state(&pool, game).await.unwrap().unwrap().locked,
        "instant action resolution must not lock the phase"
    );

    let submitted_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ActionSubmitted' \
         AND payload->>'action_id' = 'instant_self_001'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        submitted_payload["instant_resolved"],
        serde_json::json!(true)
    );

    let applied_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied' \
         AND payload->>'run_id' LIKE 'instant:%'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let applied =
        domain::validate_resolution_json(&applied_payload, domain::RESULT_VERSION).unwrap();
    assert!(
        applied
            .events
            .iter()
            .all(|indexed| !matches!(indexed.event, domain::InnerEvent::DayVoteOutcome(_))),
        "Instant resolution must not emit a day vote outcome"
    );
    assert!(applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::WolfSelfDestructed {
            wolf_id,
            target_id,
            cause,
            source_action,
            ..
        } if wolf_id == "slot_1"
            && target_id == "slot_2"
            && cause == "instant_self_destruct"
            && source_action == "instant_self_001"
    )));

    let slots = slot_state(&pool, game).await.unwrap();
    for slot_id in ["slot_1", "slot_2"] {
        assert!(
            !slots
                .iter()
                .find(|slot| slot.slot_id == slot_id)
                .unwrap()
                .alive,
            "{slot_id} should be dead immediately after instant SubmitAction"
        );
    }

    let withdraw_err = handle(
        &pool,
        &user("instant_user_1"),
        Command::WithdrawAction {
            game,
            action_id: "instant_self_001".into(),
            actor_slot: "slot_1".into(),
        },
    )
    .await
    .expect_err("resolved instant actions are not active withdrawable submissions");
    assert_eq!(withdraw_err, Reject::SlotNotAlive);

    handle(
        &pool,
        &host,
        Command::ResolvePhase {
            game,
            seed: 930_603,
        },
    )
    .await
    .expect("ordinary D01 ResolvePhase skips already-resolved instant submission");

    let applied_payloads = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied' \
         ORDER BY stream_seq",
    )
    .bind(game)
    .fetch_all(&pool)
    .await
    .unwrap();
    let instant_kill_events = applied_payloads
        .iter()
        .map(|payload| domain::validate_resolution_json(payload, domain::RESULT_VERSION).unwrap())
        .flat_map(|applied| applied.events.into_iter())
        .filter(|indexed| {
            matches!(
                &indexed.event,
                domain::InnerEvent::PlayerKilled { cause, .. } if cause == "instant_self_destruct"
            )
        })
        .count();
    assert_eq!(
        instant_kill_events, 2,
        "ordinary ResolvePhase must not replay the instant submission"
    );

    let thread = projections::thread_view(&pool, game, None, 50)
        .await
        .expect("thread view includes instant announcement");
    assert!(
        thread.posts.iter().any(|post| {
            post.phase_id == "D01"
                && post.author_user.as_deref() == Some("system")
                && post.body.contains(
                    "Phase D01 announcement: slot_2 (instant_self_destruct), slot_1 (instant_self_destruct).",
                )
        }),
        "thread projection should publish instant target death plus self-sacrifice"
    );

    let audit = audit_resolution_envelopes(&pool, game)
        .await
        .expect("instant self-destruct resolution audit");
    assert!(audit.ok, "instant self-destruct audit drifted: {audit:?}");
    assert_eq!(
        audit.skipped, 1,
        "instant envelope is command-time, not phase-replayable"
    );
    assert_eq!(
        audit.audited, 1,
        "ordinary ResolvePhase envelope remains replay-audited"
    );

    let slots_before = serde_json::to_string(&slot_state(&pool, game).await.unwrap()).unwrap();
    let thread_before = serde_json::to_string(&thread).unwrap();
    rebuild(&pool, game)
        .await
        .expect("instant self-destruct projection rebuild");
    assert_eq!(
        slots_before,
        serde_json::to_string(&slot_state(&pool, game).await.unwrap()).unwrap(),
        "slot_state rebuild must preserve instant self-destruct deaths"
    );
    assert_eq!(
        thread_before,
        serde_json::to_string(
            &projections::thread_view(&pool, game, None, 50)
                .await
                .unwrap()
        )
        .unwrap(),
        "thread_view rebuild must preserve instant self-destruct announcement"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn host_resolve_phase_reveals_killed_slot_without_endgame(pool: PgPool) {
    let host = user("host_death_reveal");
    let game = Uuid::new_v4();

    handle(
        &pool,
        &host,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "mafia_goon"),
        ("slot_2", "user_2", "vanilla_townie"),
        ("slot_3", "user_3", "vanilla_townie"),
        ("slot_4", "user_4", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &host,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &host,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "mafia_kill_n01".into(),
            actor_slot: "slot_1".into(),
            template_id: "factional_kill".into(),
            targets: vec!["slot_2".into()],
            grant_id: None,
        },
    )
    .await
    .expect("mafia submits factional kill");

    handle(&pool, &host, Command::ResolvePhase { game, seed: 7306 })
        .await
        .expect("host resolves death-reveal scenario");
    let applied_payload = resolution_payload(&pool, game, "N01", 7306).await;
    let applied = domain::validate_resolution_json(&applied_payload, domain::RESULT_VERSION)
        .expect("death-reveal ResolutionApplied validates");
    assert!(
        applied.events.iter().any(|indexed| matches!(
            &indexed.event,
            domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
                if slot_id == "slot_2" && cause == "factional_kill"
        )),
        "resolution should kill slot_2"
    );
    assert!(
        !applied
            .events
            .iter()
            .any(|indexed| matches!(&indexed.event, domain::InnerEvent::WinReached { .. })),
        "scenario should stay mid-game so only the death flip reveals"
    );

    let snapshot = load_engine_snapshot(&pool, game, "N01")
        .await
        .expect("load post-death snapshot");
    let killed = snapshot
        .slots
        .iter()
        .find(|slot| slot.slot_id == "slot_2")
        .expect("killed slot");
    assert_eq!(killed.status, domain::SlotLifecycle::Dead);
    assert_eq!(killed.role_reveal, domain::RevealState::Public);
    assert_eq!(killed.alignment_reveal, domain::RevealState::Public);
    let living = snapshot
        .slots
        .iter()
        .find(|slot| slot.slot_id == "slot_3")
        .expect("living slot");
    assert_eq!(living.role_reveal, domain::RevealState::Private);
    assert_eq!(living.alignment_reveal, domain::RevealState::Private);

    let projected = slot_state(&pool, game).await.unwrap();
    let killed_projection = projected
        .iter()
        .find(|slot| slot.slot_id == "slot_2")
        .expect("killed slot projection");
    assert!(!killed_projection.alive);
    assert!(killed_projection.role_revealed);
    assert!(killed_projection.alignment_revealed);
    let living_projection = projected
        .iter()
        .find(|slot| slot.slot_id == "slot_3")
        .expect("living slot projection");
    assert!(living_projection.alive);
    assert!(
        !living_projection.role_revealed,
        "living slots should stay private until endgame reveal"
    );
    assert!(
        !living_projection.alignment_revealed,
        "living alignments should stay private until endgame reveal"
    );

    let audit = audit_resolution_envelopes(&pool, game)
        .await
        .expect("death-reveal resolution audit");
    assert!(audit.ok, "death-reveal audit drifted: {audit:?}");
    assert_eq!(audit.audited, 1);
    assert_eq!(audit.skipped, 0);

    let projected_before = serde_json::to_string(&projected).unwrap();
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        projected_before,
        serde_json::to_string(&slot_state(&pool, game).await.unwrap()).unwrap(),
        "slot_state rebuild must preserve ordinary death reveal"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn host_resolve_phase_loads_votes_applies_resolution_and_projects(pool: PgPool) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "vanilla_townie"),
        ("slot_2", "user_2", "vanilla_townie"),
        ("slot_3", "user_3", "mafia_goon"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();
    let premature_advance_err = handle(&pool, &h, Command::AdvancePhase { game })
        .await
        .expect_err("host cannot advance an unresolved open phase");
    assert_eq!(premature_advance_err, Reject::InvalidTarget);

    handle(
        &pool,
        &user("user_1"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_3".into()),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_2"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_2".into(),
            target: VoteTarget::Slot("slot_3".into()),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_2"),
        Command::WithdrawVote {
            game,
            actor_slot: "slot_2".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_2"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_2".into(),
            target: VoteTarget::Slot("slot_3".into()),
        },
    )
    .await
    .unwrap();

    let err = handle(
        &pool,
        &user("user_1"),
        Command::ResolvePhase { game, seed: 777 },
    )
    .await
    .expect_err("only host can resolve");
    assert_eq!(err, Reject::NotHost);

    let ack = handle(&pool, &h, Command::ResolvePhase { game, seed: 777 })
        .await
        .expect("host resolves current phase");
    assert_eq!(
        ack.stream_seqs.len(),
        3,
        "resolve appends ResolutionApplied, ResolutionTrace, and ThreadLocked atomically"
    );

    let payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let applied = domain::validate_resolution_json(&payload, domain::RESULT_VERSION).unwrap();
    assert_eq!(applied.phase_id, "D01");
    assert_eq!(applied.phase_kind, domain::pack::PhaseKind::Day);
    assert_eq!(applied.seed, 777);
    assert_eq!(applied.counts.kills, 1);
    let day_vote_index = applied
        .events
        .iter()
        .find_map(|indexed| match &indexed.event {
            domain::InnerEvent::DayVoteOutcome(outcome)
                if outcome.winner.as_deref() == Some("slot_3") =>
            {
                Some(indexed.index)
            }
            _ => None,
        })
        .expect("resolver used the submitted day votes");
    let lynch_death_index = applied
        .events
        .iter()
        .find_map(|indexed| match &indexed.event {
            domain::InnerEvent::PlayerKilled {
                slot_id,
                cause,
                attackers,
                unstoppable,
                ..
            } if slot_id == "slot_3"
                && cause == "day_vote"
                && attackers.is_empty()
                && *unstoppable =>
            {
                Some(indexed.index)
            }
            _ => None,
        })
        .expect("day-vote resolution emits structural lynch death");
    let town_win_index = applied
        .events
        .iter()
        .find_map(|indexed| match &indexed.event {
            domain::InnerEvent::WinReached { winner, .. } if winner == "town" => {
                Some(indexed.index)
            }
            _ => None,
        })
        .expect("lynching the only mafia reaches town win");
    let announcement_indexes: Vec<usize> = applied
        .events
        .iter()
        .filter_map(|indexed| {
            matches!(&indexed.event, domain::InnerEvent::PhaseAnnouncement(_))
                .then_some(indexed.index)
        })
        .collect();
    let expected_announcement_index = if matches!(
        applied.events.last().map(|indexed| &indexed.event),
        Some(domain::InnerEvent::WinReached { .. })
    ) {
        applied.events.len() - 2
    } else {
        applied.events.len() - 1
    };
    assert_eq!(
        announcement_indexes,
        vec![expected_announcement_index],
        "prompt-free resolution stores exactly one trailing PhaseAnnouncement before optional WinReached"
    );
    let announcement = applied
        .events
        .get(expected_announcement_index)
        .and_then(|indexed| match &indexed.event {
            domain::InnerEvent::PhaseAnnouncement(announcement) => Some(announcement),
            _ => None,
        })
        .expect("trailer event is PhaseAnnouncement");
    assert_eq!(announcement.phase_id, "D01");
    assert!(
        announcement
            .deaths
            .iter()
            .any(|death| death.slot_id == "slot_3" && death.cause == "lynch"),
        "PhaseAnnouncement carries the public lynch death"
    );

    let slots = slot_state(&pool, game).await.unwrap();
    let killed = slots.iter().find(|s| s.slot_id == "slot_3").unwrap();
    assert!(
        !killed.alive,
        "ResolutionApplied was folded through append_and_project"
    );

    let trace_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionTrace'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let trace = domain::validate_trace_json(&trace_payload, domain::TRACE_VERSION).unwrap();
    assert_eq!(trace.run_id, applied.run_id);
    assert_eq!(trace.phase_id, "D01");
    let assert_stored_trace_decision =
        |stage: &str, source: &str, outcome: &str, detail: serde_json::Value| {
            let decision = trace
                .decisions
                .iter()
                .find(|decision| {
                    decision.stage == stage
                        && decision.source == source
                        && decision.outcome == outcome
                })
                .unwrap_or_else(|| {
                    panic!("stored trace missing decision {outcome} from {source} at {stage}")
                });
            assert_eq!(decision.detail, detail, "stored trace decision {outcome}");
        };
    let result_contract_source =
        format!("domain::resolve/result_version:{}", applied.result_version);
    let result_contract_outcome = format!("{} inner events validated", applied.counts.events);
    assert_stored_trace_decision(
        "result_contract",
        &result_contract_source,
        &result_contract_outcome,
        serde_json::json!({
            "kills": applied.counts.kills,
            "saves": applied.counts.saves,
        }),
    );
    let day_vote_source = format!("event_index:{day_vote_index}");
    assert_stored_trace_decision(
        "inner_event",
        &day_vote_source,
        "day_vote_outcome",
        serde_json::Value::Null,
    );
    let lynch_death_source = format!("event_index:{lynch_death_index}");
    assert_stored_trace_decision(
        "inner_event",
        &lynch_death_source,
        "player_killed",
        serde_json::Value::Null,
    );
    let phase_announcement_source = format!("event_index:{expected_announcement_index}");
    assert_stored_trace_decision(
        "inner_event",
        &phase_announcement_source,
        "phase_announcement",
        serde_json::Value::Null,
    );
    let town_win_source = format!("event_index:{town_win_index}");
    assert_stored_trace_decision(
        "inner_event",
        &town_win_source,
        "win_reached",
        serde_json::Value::Null,
    );
    assert_eq!(
        trace
            .decisions
            .iter()
            .filter(|decision| decision.stage == "inner_event")
            .count(),
        applied.events.len(),
        "stored trace records every ResolutionApplied inner event"
    );

    let phase_after_resolution = phase_state(&pool, game).await.unwrap().unwrap();
    assert_eq!(phase_after_resolution.phase_id, "D01");
    assert!(
        phase_after_resolution.locked,
        "prompt-free ResolvePhase closes the resolved phase"
    );

    let lock_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ThreadLocked' \
         ORDER BY stream_seq DESC LIMIT 1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(lock_payload["phase_id"], "D01");
    assert_eq!(lock_payload["reason"], "phase_resolved");
    assert_eq!(lock_payload["source"], "resolve_phase");

    let event_count_before_non_host_advance: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
            .bind(game)
            .fetch_one(&pool)
            .await
            .unwrap();
    let phase_before_non_host_advance =
        serde_json::to_string(&phase_state(&pool, game).await.unwrap()).unwrap();
    let non_host_advance_err = handle(&pool, &user("user_1"), Command::AdvancePhase { game })
        .await
        .expect_err("non-host cannot advance the resolved phase");
    assert_eq!(non_host_advance_err, Reject::NotHost);
    let event_count_after_non_host_advance: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
            .bind(game)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        event_count_before_non_host_advance, event_count_after_non_host_advance,
        "platform capability rejection must append no phase-control events"
    );
    assert_eq!(
        phase_before_non_host_advance,
        serde_json::to_string(&phase_state(&pool, game).await.unwrap()).unwrap(),
        "platform capability rejection must not mutate phase_state"
    );

    let late_vote_err = handle(
        &pool,
        &user("user_1"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .expect_err("resolved prompt-free phase rejects late votes");
    assert_eq!(late_vote_err, Reject::PhaseLocked);

    let late_action_err = handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "late_d01_action".into(),
            actor_slot: "slot_1".into(),
            template_id: "not_reached".into(),
            targets: vec![],
            grant_id: None,
        },
    )
    .await
    .expect_err("resolved prompt-free phase rejects late actions");
    assert_eq!(late_action_err, Reject::PhaseLocked);

    let audit = audit_resolution_envelopes(&pool, game)
        .await
        .expect("resolution envelope audit");
    assert!(audit.ok, "resolution audit should match stored envelopes");
    assert_eq!(audit.audited, 1);
    assert_eq!(audit.skipped, 0);
    assert_eq!(audit.summary.matched, 1);
    assert_eq!(audit.summary.drifted, 0);
    assert_eq!(audit.summary.skipped, 0);
    assert!(audit.summary.first_drift_paths.is_empty());
    assert_eq!(audit.phases.len(), 1);
    assert_eq!(audit.phases[0].phase_id, "D01");
    assert_eq!(audit.phases[0].run_id, applied.run_id);
    assert_eq!(
        audit.phases[0].status,
        ResolutionEnvelopeAuditStatus::Matched
    );
    assert!(audit.phases[0].applied_matches);
    assert!(audit.phases[0].trace_matches);
    assert!(audit.phases[0].diffs.is_empty());

    let filtered_trace_report = inspect_resolution_traces(&pool, game, Some(&applied.run_id))
        .await
        .expect("filtered resolution trace inspection");
    assert_eq!(
        filtered_trace_report.traces.len(),
        1,
        "run-id filtered trace inspection should return only the resolved phase"
    );
    assert_eq!(filtered_trace_report.traces[0].run_id, applied.run_id);
    assert_eq!(filtered_trace_report.traces[0].phase_id, "D01");
    assert_eq!(
        filtered_trace_report.traces[0].applied_stream_seq,
        Some(audit.phases[0].applied_stream_seq),
        "trace inspection anchors trace rows to their ResolutionApplied event"
    );
    assert_eq!(
        filtered_trace_report.traces[0].trace_stream_seq,
        audit.phases[0]
            .trace_stream_seq
            .expect("matched audit has trace stream seq")
    );
    assert_anchored_inspection_decision(
        &filtered_trace_report,
        InspectionDecisionExpectation {
            phase_id: "D01",
            stage: "result_contract",
            source: &result_contract_source,
            outcome: &result_contract_outcome,
            detail: serde_json::json!({
                "kills": applied.counts.kills,
                "saves": applied.counts.saves,
            }),
        },
        "prompt-free resolution trace inspection",
    );
    assert_anchored_inspection_decision(
        &filtered_trace_report,
        InspectionDecisionExpectation {
            phase_id: "D01",
            stage: "inner_event",
            source: &day_vote_source,
            outcome: "day_vote_outcome",
            detail: serde_json::Value::Null,
        },
        "prompt-free resolution trace inspection",
    );

    let audit_before_rebuild = serde_json::to_string(&audit).unwrap();
    let trace_inspection_before_rebuild = serde_json::to_string(&filtered_trace_report).unwrap();
    let slots_before = serde_json::to_string(&slot_state(&pool, game).await.unwrap()).unwrap();
    let votes_before = serde_json::to_string(&votecount(&pool, game).await.unwrap()).unwrap();
    let phase_before = serde_json::to_string(&phase_state(&pool, game).await.unwrap()).unwrap();
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        slots_before,
        serde_json::to_string(&slot_state(&pool, game).await.unwrap()).unwrap(),
        "slot_state rebuild must match incremental resolve projection"
    );
    assert_eq!(
        votes_before,
        serde_json::to_string(&votecount(&pool, game).await.unwrap()).unwrap(),
        "votecount rebuild must match incremental resolve projection"
    );
    assert_eq!(
        phase_before,
        serde_json::to_string(&phase_state(&pool, game).await.unwrap()).unwrap(),
        "phase_state rebuild must preserve the prompt-free resolved phase lock"
    );
    assert_eq!(
        audit_before_rebuild,
        serde_json::to_string(&audit_resolution_envelopes(&pool, game).await.unwrap()).unwrap(),
        "resolution replay audit must remain stable after projection rebuild"
    );
    assert_eq!(
        trace_inspection_before_rebuild,
        serde_json::to_string(
            &inspect_resolution_traces(&pool, game, Some(&applied.run_id))
                .await
                .unwrap()
        )
        .unwrap(),
        "run-id filtered trace inspection must remain stable after projection rebuild"
    );

    handle(&pool, &h, Command::AdvancePhase { game })
        .await
        .expect("host advances to the next declared cadence phase");
    let phase_after_advance = phase_state(&pool, game).await.unwrap().unwrap();
    assert_eq!(phase_after_advance.phase_id, "N01");
    assert!(
        !phase_after_advance.locked,
        "host-controlled cadence advance reopens the next declared phase"
    );

    let advance_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'PhaseAdvanced' \
         ORDER BY stream_seq DESC LIMIT 1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(advance_payload["phase_id"], "N01");
    assert_eq!(advance_payload["source_phase_id"], "D01");
    assert_eq!(advance_payload["reason"], "resolved_phase");

    let night_vote_err = handle(
        &pool,
        &user("user_1"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .expect_err("next declared Night window is not votable");
    assert_eq!(night_vote_err, Reject::PhaseLocked);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn host_advance_phase_wraps_night_to_next_day_from_pack_cadence(pool: PgPool) {
    let game = Uuid::new_v4();
    let h = user("host_h");

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "vanilla_townie"),
        ("slot_2", "user_2", "vanilla_townie"),
        ("slot_3", "user_3", "mafia_goon"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();

    let ack = handle(&pool, &h, Command::ResolvePhase { game, seed: 7781 })
        .await
        .expect("host resolves prompt-free night");
    assert_eq!(
        ack.stream_seqs.len(),
        3,
        "night resolve appends envelopes plus phase lock"
    );
    assert!(
        phase_state(&pool, game).await.unwrap().unwrap().locked,
        "resolved night is locked before host cadence advance"
    );

    handle(&pool, &h, Command::AdvancePhase { game })
        .await
        .expect("host advances from resolved night to next day");
    let phase_after_advance = phase_state(&pool, game).await.unwrap().unwrap();
    assert_eq!(phase_after_advance.phase_id, "D02");
    assert!(
        !phase_after_advance.locked,
        "wrapped cadence advance opens the next numbered day"
    );
    handle(
        &pool,
        &user("user_1"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .expect("derived D02 day window accepts ballots");

    let phase_before = serde_json::to_string(&phase_state(&pool, game).await.unwrap()).unwrap();
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        phase_before,
        serde_json::to_string(&phase_state(&pool, game).await.unwrap()).unwrap(),
        "phase_state rebuild must preserve cadence-derived D02 advance"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn deadline_elapsed_evidence_is_inert_until_deadline_advance_command(pool: PgPool) {
    let game = Uuid::new_v4();
    let h = user("host_h");

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "vanilla_townie"),
        ("slot_2", "user_2", "vanilla_townie"),
        ("slot_3", "user_3", "mafia_goon"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &h,
        Command::ExtendDeadline {
            game,
            phase: "D01".into(),
            at: 100,
        },
    )
    .await
    .expect("host sets phase deadline");

    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "PhaseDeadlineElapsed",
            1,
            serde_json::json!({
                "phase_id": "D01",
                "deadline_at": 100,
                "observed_at": 101,
                "source": "scheduler",
            }),
            ActorId::System,
            101,
        )],
    )
    .await
    .expect("standalone timer evidence appends");
    let phase_after_evidence = phase_state(&pool, game).await.unwrap().unwrap();
    assert_eq!(phase_after_evidence.phase_id, "D01");
    assert!(!phase_after_evidence.locked);
    assert_eq!(
        phase_after_evidence.deadline,
        Some(100),
        "timer evidence alone must not move or clear phase_state"
    );
    let phase_after_evidence_json = serde_json::to_string(&phase_after_evidence).unwrap();
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        phase_after_evidence_json,
        serde_json::to_string(&phase_state(&pool, game).await.unwrap().unwrap()).unwrap(),
        "projection rebuild must preserve inert timer evidence semantics"
    );

    let unresolved_err = handle(
        &pool,
        &h,
        Command::AdvancePhaseByDeadline {
            game,
            phase: "D01".into(),
            observed_at: 101,
        },
    )
    .await
    .expect_err("deadline command cannot advance unresolved open phases");
    assert_eq!(unresolved_err, Reject::InvalidTarget);

    handle(&pool, &h, Command::ResolvePhase { game, seed: 9901 })
        .await
        .expect("host resolves current phase");
    let locked = phase_state(&pool, game).await.unwrap().unwrap();
    assert_eq!(locked.phase_id, "D01");
    assert!(locked.locked);
    assert_eq!(locked.deadline, Some(100));

    let early_err = handle(
        &pool,
        &h,
        Command::AdvancePhaseByDeadline {
            game,
            phase: "D01".into(),
            observed_at: 99,
        },
    )
    .await
    .expect_err("deadline command rejects observations before stored deadline");
    assert_eq!(early_err, Reject::InvalidTarget);

    let wrong_phase_err = handle(
        &pool,
        &h,
        Command::AdvancePhaseByDeadline {
            game,
            phase: "N01".into(),
            observed_at: 101,
        },
    )
    .await
    .expect_err("deadline command rejects stale or wrong phase ids");
    assert_eq!(wrong_phase_err, Reject::InvalidTarget);

    let deadline_control_events_before_non_host: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 \
         AND kind IN ('PhaseDeadlineElapsed', 'PhaseAdvanced')",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let non_host_deadline_err = handle(
        &pool,
        &user("user_1"),
        Command::AdvancePhaseByDeadline {
            game,
            phase: "D01".into(),
            observed_at: 101,
        },
    )
    .await
    .expect_err("non-host cannot advance by deadline evidence");
    assert_eq!(non_host_deadline_err, Reject::NotHost);
    let deadline_control_events_after_non_host: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 \
         AND kind IN ('PhaseDeadlineElapsed', 'PhaseAdvanced')",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        deadline_control_events_before_non_host, deadline_control_events_after_non_host,
        "non-host deadline rejection must append no deadline evidence or phase advance"
    );

    let ack = handle(
        &pool,
        &h,
        Command::AdvancePhaseByDeadline {
            game,
            phase: "D01".into(),
            observed_at: 101,
        },
    )
    .await
    .expect("deadline command advances through pack cadence");
    assert_eq!(
        ack.stream_seqs.len(),
        2,
        "deadline advance appends evidence plus PhaseAdvanced atomically"
    );

    let phase_after_deadline_advance = phase_state(&pool, game).await.unwrap().unwrap();
    assert_eq!(phase_after_deadline_advance.phase_id, "N01");
    assert!(!phase_after_deadline_advance.locked);
    assert_eq!(
        phase_after_deadline_advance.deadline, None,
        "PhaseAdvanced is the only event in the command that moves the cursor"
    );

    let rows = sqlx::query_as::<_, (String, serde_json::Value, serde_json::Value)>(
        "SELECT kind, payload, actor FROM events WHERE stream_id = $1 \
         ORDER BY stream_seq DESC LIMIT 2",
    )
    .bind(game)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[1].0, "PhaseDeadlineElapsed");
    assert_eq!(rows[1].1["phase_id"], "D01");
    assert_eq!(rows[1].1["deadline_at"], 100);
    assert_eq!(rows[1].1["observed_at"], 101);
    assert_eq!(rows[1].1["source"], "scheduler");
    assert_eq!(rows[1].2["type"], "System");
    assert_eq!(rows[0].0, "PhaseAdvanced");
    assert_eq!(rows[0].1["phase_id"], "N01");
    assert_eq!(rows[0].1["source_phase_id"], "D01");
    assert_eq!(rows[0].1["reason"], "deadline_elapsed");
    assert_eq!(rows[0].1["source_event_kind"], "PhaseDeadlineElapsed");
    assert_eq!(rows[0].1["source_deadline_at"], 100);
    assert_eq!(rows[0].2["type"], "System");

    let phase_before_rebuild =
        serde_json::to_string(&phase_state(&pool, game).await.unwrap().unwrap()).unwrap();
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        phase_before_rebuild,
        serde_json::to_string(&phase_state(&pool, game).await.unwrap().unwrap()).unwrap(),
        "phase_state rebuild must preserve deadline-derived cadence advance"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn engine_phase_input_preserves_submit_withdraw_history_and_current_day_ballots(
    pool: PgPool,
) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "mafia_goon"),
        ("slot_2", "user_2", "vanilla_townie"),
        ("slot_3", "user_3", "vanilla_townie"),
        ("slot_4", "user_4", "vanilla_townie"),
        ("slot_5", "user_5", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();

    handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "night_kill_withdrawn".into(),
            actor_slot: "slot_1".into(),
            template_id: "factional_kill".into(),
            targets: vec!["slot_4".into()],
            grant_id: None,
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_1"),
        Command::WithdrawAction {
            game,
            action_id: "night_kill_withdrawn".into(),
            actor_slot: "slot_1".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "night_kill_live".into(),
            actor_slot: "slot_1".into(),
            template_id: "factional_kill".into(),
            targets: vec!["slot_3".into()],
            grant_id: None,
        },
    )
    .await
    .unwrap();

    let night_input = load_engine_phase_input(&pool, game, "N01")
        .await
        .expect("load N01 resolver input");
    assert_eq!(night_input.phase_id, "N01");
    assert_eq!(night_input.phase_kind, domain::pack::PhaseKind::Night);
    assert_eq!(night_input.phase_number, 1);
    assert_eq!(night_input.pack_name, "mafiascum");
    assert_eq!(night_input.state.phase_id, "N01");
    assert_eq!(night_input.state.phase_kind, domain::pack::PhaseKind::Night);
    assert_eq!(night_input.state.phase_number, 1);
    let mafia_actor = night_input
        .state
        .slots
        .iter()
        .find(|slot| slot.slot_id == "slot_1")
        .expect("slot_1 reaches resolver state");
    assert_eq!(mafia_actor.role_key, "mafia_goon");
    assert_eq!(mafia_actor.alignment.as_deref(), Some("mafia"));
    let night_submissions: Vec<_> = night_input
        .submissions
        .iter()
        .map(|sub| {
            (
                sub.action_id.as_str(),
                sub.actor.as_str(),
                sub.template_id.as_str(),
                sub.targets.as_slice(),
                sub.withdrawn,
            )
        })
        .collect();
    assert_eq!(
        night_submissions,
        vec![
            (
                "night_kill_withdrawn",
                "slot_1",
                "factional_kill",
                &["slot_4".to_string()][..],
                true
            ),
            (
                "night_kill_live",
                "slot_1",
                "factional_kill",
                &["slot_3".to_string()][..],
                false
            )
        ],
        "engine input keeps withdrawn action history while marking only the live action active"
    );

    handle(
        &pool,
        &h,
        Command::OpenDayPhase {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();
    for (actor, target) in [
        ("slot_1", "slot_5"),
        ("slot_2", "slot_4"),
        ("slot_2", "slot_5"),
        ("slot_3", "slot_5"),
        ("slot_4", "slot_5"),
    ] {
        handle(
            &pool,
            &user(&format!("user_{}", actor.trim_start_matches("slot_"))),
            Command::SubmitVote {
                game,
                actor_slot: actor.into(),
                target: VoteTarget::Slot(target.into()),
            },
        )
        .await
        .unwrap_or_else(|err| panic!("{actor} vote for {target} rejected: {err}"));
    }
    handle(
        &pool,
        &user("user_4"),
        Command::WithdrawVote {
            game,
            actor_slot: "slot_4".into(),
        },
    )
    .await
    .unwrap();

    let audit_kinds: Vec<_> = eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .filter(|event| {
            matches!(
                event.kind.as_str(),
                "ActionSubmitted" | "ActionWithdrawn" | "VoteSubmitted" | "VoteWithdrawn"
            )
        })
        .map(|event| event.kind)
        .collect();
    assert_eq!(
        audit_kinds,
        vec![
            "ActionSubmitted",
            "ActionWithdrawn",
            "ActionSubmitted",
            "VoteSubmitted",
            "VoteSubmitted",
            "VoteSubmitted",
            "VoteSubmitted",
            "VoteSubmitted",
            "VoteWithdrawn",
        ],
        "event stream remains the audit history even when projections expose current state"
    );

    let day_input = load_engine_phase_input(&pool, game, "D01")
        .await
        .expect("load D01 resolver input");
    let day_submissions: Vec<_> = day_input
        .submissions
        .iter()
        .map(|sub| {
            (
                sub.actor.as_str(),
                sub.targets.first().map(String::as_str),
                sub.withdrawn,
            )
        })
        .collect();
    assert_eq!(
        day_submissions,
        vec![
            ("slot_1", Some("slot_5"), false),
            ("slot_2", Some("slot_4"), false),
            ("slot_2", Some("slot_5"), false),
            ("slot_3", Some("slot_5"), false),
            ("slot_4", Some("slot_5"), false),
            ("slot_4", None, true),
        ],
        "day input preserves ordered submit/overwrite/withdraw history for domain last-write-wins"
    );

    let current_votes = votecount(&pool, game).await.unwrap();
    assert_eq!(
        current_votes
            .iter()
            .find(|row| row.phase_id == "D01" && row.candidate_slot == "slot_5")
            .map(|row| row.count),
        Some(3),
        "projection current ballots keep the latest non-withdrawn slot_1/2/3 votes"
    );
    assert!(
        !current_votes
            .iter()
            .any(|row| row.phase_id == "D01" && row.candidate_slot == "slot_4"),
        "slot_2's overwritten decoy vote is absent from the current ballot projection"
    );
    let votes_before = serde_json::to_string(&current_votes).unwrap();
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        votes_before,
        serde_json::to_string(&votecount(&pool, game).await.unwrap()).unwrap(),
        "votecount rebuild must preserve last-write-wins current ballots"
    );

    sqlx::query(
        "INSERT INTO vote_ballot (game_id, phase_id, actor_slot, target) \
         VALUES ($1, 'D01', 'stale_projection_actor', 'slot_4')",
    )
    .bind(game)
    .execute(&pool)
    .await
    .expect("inject stale projection-only ballot");
    let stale_votes = votecount(&pool, game).await.unwrap();
    assert_eq!(
        stale_votes
            .iter()
            .find(|row| row.phase_id == "D01" && row.candidate_slot == "slot_4")
            .map(|row| row.count),
        Some(1),
        "test setup proves the running votecount projection can be stale without a log event"
    );

    handle(&pool, &h, Command::ResolvePhase { game, seed: 9876 })
        .await
        .expect("host resolves D01");
    let payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied' \
         AND payload->>'phase_id' = 'D01'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let applied = domain::validate_resolution_json(&payload, domain::RESULT_VERSION)
        .expect("day vote withdraw ResolutionApplied validates");
    let recorded_votes: Vec<_> = applied
        .events
        .iter()
        .filter_map(|event| match &event.event {
            domain::InnerEvent::DayVoteRecorded {
                actor,
                target,
                withdrawn,
                sequence,
            } => Some((actor.as_str(), target.as_deref(), *withdrawn, *sequence)),
            _ => None,
        })
        .collect();
    assert_eq!(
        recorded_votes,
        vec![
            ("slot_1", Some("slot_5"), false, 1),
            ("slot_2", Some("slot_4"), false, 2),
            ("slot_2", Some("slot_5"), false, 3),
            ("slot_3", Some("slot_5"), false, 4),
            ("slot_4", Some("slot_5"), false, 5),
            ("slot_4", None, true, 6),
        ],
        "ResolutionApplied must preserve ordered day-vote submit/overwrite/withdraw history"
    );
    let outcome = applied
        .events
        .iter()
        .find_map(|event| match &event.event {
            domain::InnerEvent::DayVoteOutcome(outcome) => Some(outcome),
            _ => None,
        })
        .expect("day vote outcome");
    assert_eq!(outcome.winner.as_deref(), Some("slot_5"));
    assert_eq!(
        outcome.votes.get("slot_1").map(String::as_str),
        Some("slot_5")
    );
    assert_eq!(
        outcome.votes.get("slot_2").map(String::as_str),
        Some("slot_5")
    );
    assert_eq!(
        outcome.votes.get("slot_3").map(String::as_str),
        Some("slot_5")
    );
    assert!(
        !outcome.votes.contains_key("slot_4"),
        "withdrawn/stale slot_4 ballots are absent from the official day outcome"
    );
    assert!(
        !outcome.votes.contains_key("stale_projection_actor"),
        "projection-only actors must not enter the official DayVoteOutcome"
    );
    let official_rows = day_vote_outcomes(&pool, game)
        .await
        .expect("official day vote outcome projection");
    assert_eq!(official_rows.len(), 1);
    assert_eq!(official_rows[0].phase_id, "D01");
    assert_eq!(official_rows[0].status, "Lynch");
    assert_eq!(official_rows[0].winner_slot.as_deref(), Some("slot_5"));
    assert_eq!(
        official_rows[0].votes["slot_2"], "slot_5",
        "host console official row uses engine last-write-wins vote, not the running projection"
    );
    assert!(
        official_rows[0].votes.get("slot_4").is_none(),
        "host console official row omits withdrawn ballots"
    );
    assert!(
        official_rows[0]
            .votes
            .get("stale_projection_actor")
            .is_none(),
        "host console official row is folded from ResolutionApplied, not the running projection"
    );
    let trace_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionTrace' \
         AND payload->>'phase_id' = 'D01'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    domain::validate_trace_json(&trace_payload, domain::TRACE_VERSION)
        .expect("day vote withdraw ResolutionTrace validates");
    assert!(
        !trace_payload.to_string().contains("slot_4"),
        "withdrawn slot_4 ballot must not appear in persisted day-resolution trace"
    );

    assert_eq!(
        votecount(&pool, game)
            .await
            .unwrap()
            .iter()
            .find(|row| row.phase_id == "D01" && row.candidate_slot == "slot_4")
            .map(|row| row.count),
        Some(1),
        "the stale projection row remains projection-local and is not the official outcome source"
    );
    rebuild(&pool, game)
        .await
        .expect("projection rebuild after D01");
    // The D01 lynch of slot_5 clears every ballot targeting the dead slot (dead
    // players cannot be voted for), so the log-derived votecount boundary for
    // D01 is empty. The only row still present live was the raw stale ballot
    // injected above, which has no backing event — rebuild folds solely from the
    // log, so it must discard that projection-only row and reproduce an empty
    // votecount.
    assert!(
        votecount(&pool, game).await.unwrap().is_empty(),
        "votecount rebuild must discard projection-only stale ballots and restore the (empty) log-derived boundary after the D01 lynch"
    );
    assert_eq!(
        serde_json::to_string(&official_rows).unwrap(),
        serde_json::to_string(&day_vote_outcomes(&pool, game).await.unwrap()).unwrap(),
        "official day vote outcome rebuild must preserve the canonical engine result"
    );
    let applied_after_rebuild = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied' \
         AND payload->>'phase_id' = 'D01'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let trace_after_rebuild = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionTrace' \
         AND payload->>'phase_id' = 'D01'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        payload, applied_after_rebuild,
        "projection rebuild must not rewrite persisted day-vote withdraw ResolutionApplied envelope"
    );
    assert_eq!(
        trace_payload, trace_after_rebuild,
        "projection rebuild must not rewrite persisted day-vote withdraw ResolutionTrace envelope"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn action_submission_rejects_invalid_target_shape_state_and_window(pool: PgPool) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "mafia_goon"),
        ("slot_2", "user_2", "bus_driver"),
        ("slot_3", "user_3", "commuter"),
        ("slot_4", "user_4", "cop"),
        ("slot_5", "user_5", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &h,
        Command::SetSlotStatus {
            game,
            slot: "slot_5".into(),
            status: domain::SlotLifecycle::Dead,
        },
    )
    .await
    .expect("host marks slot_5 dead for target-state validation");

    for (action_id, targets, why) in [
        (
            "kill_no_target",
            Vec::<String>::new(),
            "one-target actions reject zero targets",
        ),
        (
            "kill_too_many_targets",
            vec!["slot_2".into(), "slot_4".into()],
            "one-target actions reject multiple targets",
        ),
        (
            "kill_self",
            vec!["slot_1".into()],
            "self_allowed=false rejects actor self-targeting",
        ),
        (
            "kill_unknown",
            vec!["slot_99".into()],
            "unknown target slots reject before append",
        ),
        (
            "kill_dead",
            vec!["slot_5".into()],
            "default target_state=Alive rejects dead targets",
        ),
    ] {
        let err = handle(
            &pool,
            &user("user_1"),
            Command::SubmitAction {
                game,
                action_id: action_id.into(),
                actor_slot: "slot_1".into(),
                template_id: "factional_kill".into(),
                targets,
                grant_id: None,
            },
        )
        .await
        .expect_err(why);
        assert_eq!(err, Reject::InvalidTarget, "{why}");
    }

    for (action_id, targets, why) in [
        (
            "bus_duplicate_targets",
            vec!["slot_1".into(), "slot_1".into()],
            "unique_targets=true rejects duplicate targets",
        ),
        (
            "bus_too_many_targets",
            vec!["slot_1".into(), "slot_3".into(), "slot_4".into()],
            "max_targets rejects overwide target lists",
        ),
    ] {
        let err = handle(
            &pool,
            &user("user_2"),
            Command::SubmitAction {
                game,
                action_id: action_id.into(),
                actor_slot: "slot_2".into(),
                template_id: "bus_driver_swap".into(),
                targets,
                grant_id: None,
            },
        )
        .await
        .expect_err(why);
        assert_eq!(err, Reject::InvalidTarget, "{why}");
    }

    let err = handle(
        &pool,
        &user("user_3"),
        Command::SubmitAction {
            game,
            action_id: "commute_other_rejected".into(),
            actor_slot: "slot_3".into(),
            template_id: "commute".into(),
            targets: vec!["slot_4".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("personal-only commuter rejects non-self target before append");
    assert_eq!(err, Reject::InvalidTarget);

    handle(
        &pool,
        &user("user_3"),
        Command::SubmitAction {
            game,
            action_id: "commute_self_ok".into(),
            actor_slot: "slot_3".into(),
            template_id: "commute".into(),
            targets: vec!["slot_3".into()],
            grant_id: None,
        },
    )
    .await
    .expect("self_allowed=true permits commuter self-targeting");

    handle(
        &pool,
        &h,
        Command::OpenDayPhase {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();
    let err = handle(
        &pool,
        &user("user_4"),
        Command::SubmitAction {
            game,
            action_id: "cop_wrong_window".into(),
            actor_slot: "slot_4".into(),
            template_id: "cop_investigate".into(),
            targets: vec!["slot_1".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("night-only action rejects day submission");
    assert_eq!(err, Reject::PhaseLocked);

    let submitted: Vec<_> = eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .filter(|event| event.kind == "ActionSubmitted")
        .map(|event| event.payload["action_id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        submitted,
        vec!["commute_self_ok".to_string()],
        "target-shape/state/window rejects must not append ActionSubmitted"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn action_submission_rejects_day_specific_action_in_night_window(pool: PgPool) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "chinese_structured".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "white_wolf_king"),
        ("slot_2", "user_2", "villager"),
        ("slot_3", "user_3", "villager"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();

    let err = handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "day_self_destruct_wrong_window".into(),
            actor_slot: "slot_1".into(),
            template_id: "day_self_destruct".into(),
            targets: vec!["slot_2".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("day-only self destruct rejects night submission");
    assert_eq!(err, Reject::PhaseLocked);

    let submitted: Vec<_> = eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .filter(|event| event.kind == "ActionSubmitted")
        .map(|event| event.payload["action_id"].as_str().unwrap().to_string())
        .collect();
    assert!(
        submitted.is_empty(),
        "wrong-window day action must not append ActionSubmitted"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn audit_resolution_reports_structural_drift_path_expected_and_actual(pool: PgPool) {
    let game = setup_resolved_audit_drift_game(&pool, "applied_drift", 778).await;
    let (winner_event_index, expected_winner) =
        perturb_stored_resolution_winner(&pool, game, "slot_2").await;
    let winner_path = format!("$.events[{winner_event_index}].payload.winner");

    let audit = audit_resolution_envelopes(&pool, game)
        .await
        .expect("drift audit report");
    assert!(!audit.ok, "perturbed resolution must drift");
    assert_eq!(audit.audited, 1);
    assert_eq!(audit.skipped, 0);
    assert_eq!(audit.summary.matched, 0);
    assert_eq!(audit.summary.drifted, 1);
    assert_eq!(audit.summary.skipped, 0);
    assert_eq!(audit.phases.len(), 1);
    let phase = &audit.phases[0];
    assert_eq!(phase.phase_id, "D01");
    assert_eq!(phase.status, ResolutionEnvelopeAuditStatus::Drifted);
    assert!(!phase.applied_matches);
    assert!(phase.trace_matches);
    let diff = phase
        .diffs
        .iter()
        .find(|diff| {
            diff.envelope == ResolutionEnvelopeAuditEnvelope::Applied && diff.path == winner_path
        })
        .unwrap_or_else(|| panic!("winner drift diff missing: {phase:#?}"));
    assert_eq!(diff.expected, serde_json::json!(expected_winner));
    assert_eq!(diff.actual, serde_json::json!("slot_2"));
    assert_eq!(audit.summary.first_drift_paths.len(), 1);
    assert_eq!(audit.summary.first_drift_paths[0].phase_id, "D01");
    assert_eq!(
        audit.summary.first_drift_paths[0].envelope,
        ResolutionEnvelopeAuditEnvelope::Applied
    );
    assert_eq!(audit.summary.first_drift_paths[0].path, winner_path);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn audit_resolution_reports_trace_drift_path_expected_and_actual(pool: PgPool) {
    let game = setup_resolved_audit_drift_game(&pool, "trace_drift", 779).await;
    let expected_outcome = stored_first_trace_decision_outcome(&pool, game).await;

    let mut tx = pool.begin().await.unwrap();
    sqlx::query("ALTER TABLE events DISABLE TRIGGER events_no_update")
        .execute(&mut *tx)
        .await
        .expect("temporarily disable append-only guard for synthetic trace drift");
    let update = sqlx::query(
        "UPDATE events \
         SET payload = jsonb_set(payload, '{decisions,0,outcome}', '\"tampered_trace\"'::jsonb, false) \
         WHERE stream_id = $1 AND kind = 'ResolutionTrace'",
    )
    .bind(game)
    .execute(&mut *tx)
    .await
    .expect("perturb stored ResolutionTrace outcome");
    assert_eq!(update.rows_affected(), 1, "one trace envelope perturbed");
    sqlx::query("ALTER TABLE events ENABLE TRIGGER events_no_update")
        .execute(&mut *tx)
        .await
        .expect("restore append-only guard after synthetic trace drift");
    tx.commit().await.expect("commit trace drift perturbation");

    let audit = audit_resolution_envelopes(&pool, game)
        .await
        .expect("trace drift audit report");
    assert!(!audit.ok, "perturbed trace must drift");
    assert_eq!(audit.audited, 1);
    assert_eq!(audit.skipped, 0);
    assert_eq!(audit.summary.matched, 0);
    assert_eq!(audit.summary.drifted, 1);
    assert_eq!(audit.summary.skipped, 0);
    assert_eq!(audit.phases.len(), 1);
    let phase = &audit.phases[0];
    assert_eq!(phase.phase_id, "D01");
    assert_eq!(phase.status, ResolutionEnvelopeAuditStatus::Drifted);
    assert!(phase.applied_matches);
    assert!(!phase.trace_matches);
    let diff = phase
        .diffs
        .iter()
        .find(|diff| {
            diff.envelope == ResolutionEnvelopeAuditEnvelope::Trace
                && diff.path == "$.decisions[0].outcome"
        })
        .unwrap_or_else(|| panic!("trace drift diff missing: {phase:#?}"));
    assert_eq!(diff.expected, serde_json::json!(expected_outcome));
    assert_eq!(diff.actual, serde_json::json!("tampered_trace"));
    assert_eq!(audit.summary.first_drift_paths.len(), 1);
    assert_eq!(
        audit.summary.first_drift_paths[0].envelope,
        ResolutionEnvelopeAuditEnvelope::Trace
    );
    assert_eq!(
        audit.summary.first_drift_paths[0].path,
        "$.decisions[0].outcome"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn audit_resolution_reports_missing_trace_root_diff(pool: PgPool) {
    let game = setup_resolved_audit_drift_game(&pool, "missing_trace", 780).await;

    let mut tx = pool.begin().await.unwrap();
    sqlx::query("ALTER TABLE events DISABLE TRIGGER events_no_update")
        .execute(&mut *tx)
        .await
        .expect("temporarily disable append-only guard for synthetic missing trace");
    let deleted =
        sqlx::query("DELETE FROM events WHERE stream_id = $1 AND kind = 'ResolutionTrace'")
            .bind(game)
            .execute(&mut *tx)
            .await
            .expect("delete stored ResolutionTrace");
    assert_eq!(deleted.rows_affected(), 1, "one trace envelope deleted");
    sqlx::query("ALTER TABLE events ENABLE TRIGGER events_no_update")
        .execute(&mut *tx)
        .await
        .expect("restore append-only guard after synthetic missing trace");
    tx.commit()
        .await
        .expect("commit missing trace perturbation");

    let audit = audit_resolution_envelopes(&pool, game)
        .await
        .expect("missing trace audit report");
    assert!(!audit.ok, "missing trace must drift");
    assert_eq!(audit.audited, 1);
    assert_eq!(audit.skipped, 0);
    assert_eq!(audit.summary.matched, 0);
    assert_eq!(audit.summary.drifted, 1);
    assert_eq!(audit.summary.skipped, 0);
    assert_eq!(audit.phases.len(), 1);
    let phase = &audit.phases[0];
    assert_eq!(phase.phase_id, "D01");
    assert_eq!(phase.status, ResolutionEnvelopeAuditStatus::Drifted);
    assert!(phase.applied_matches);
    assert!(!phase.trace_matches);
    assert_eq!(
        phase.reason.as_deref(),
        Some("matching ResolutionTrace envelope is missing")
    );
    let diff = phase
        .diffs
        .iter()
        .find(|diff| diff.envelope == ResolutionEnvelopeAuditEnvelope::Trace && diff.path == "$")
        .unwrap_or_else(|| panic!("missing trace root diff missing: {phase:#?}"));
    assert_eq!(diff.expected["phase_id"], "D01");
    assert_eq!(diff.actual, serde_json::json!({ "__audit_missing": true }));
    assert_eq!(audit.summary.first_drift_paths.len(), 1);
    assert_eq!(
        audit.summary.first_drift_paths[0].envelope,
        ResolutionEnvelopeAuditEnvelope::Trace
    );
    assert_eq!(audit.summary.first_drift_paths[0].path, "$");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn audit_resolution_in_process_reports_success_for_matched_game(pool: PgPool) {
    let game = setup_resolved_audit_drift_game(&pool, "cli_matched", 781).await;
    let output = run_audit_resolution_in_process(&pool, game).await;

    assert!(
        output.status.success(),
        "matched audit should exit zero\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.stderr.is_empty(),
        "matched audit should not write stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("matched CLI stdout is JSON");
    assert_eq!(report["game_id"], game.to_string());
    assert_eq!(report["ok"], true);
    assert_eq!(report["audited"], 1);
    assert_eq!(report["skipped"], 0);
    assert_eq!(report["summary"]["matched"], 1);
    assert_eq!(report["summary"]["drifted"], 0);
    assert_eq!(report["summary"]["skipped"], 0);
    assert!(report["summary"]["first_drift_paths"]
        .as_array()
        .expect("matched summary drift paths")
        .is_empty());
    assert_eq!(report["phases"][0]["status"], "matched");
    assert!(report["phases"][0].get("diffs").is_none());
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn audit_resolution_in_process_reports_diffs_for_drift(pool: PgPool) {
    let game = setup_resolved_audit_drift_game(&pool, "cli_drift", 782).await;
    let (winner_event_index, expected_winner) =
        perturb_stored_resolution_winner(&pool, game, "slot_2").await;
    let winner_path = format!("$.events[{winner_event_index}].payload.winner");

    let output = run_audit_resolution_in_process(&pool, game).await;
    assert!(
        !output.status.success(),
        "drift audit should exit non-zero\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("resolution envelope audit found drift"),
        "drift CLI stderr should name drift\nstderr:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("drift CLI stdout is JSON");
    assert_eq!(report["game_id"], game.to_string());
    assert_eq!(report["ok"], false);
    assert_eq!(report["audited"], 1);
    assert_eq!(report["skipped"], 0);
    assert_eq!(report["summary"]["matched"], 0);
    assert_eq!(report["summary"]["drifted"], 1);
    assert_eq!(report["summary"]["skipped"], 0);
    assert_eq!(
        report["summary"]["first_drift_paths"][0]["envelope"],
        "applied"
    );
    assert_eq!(
        report["summary"]["first_drift_paths"][0]["path"],
        winner_path
    );
    assert_eq!(report["phases"][0]["status"], "drifted");
    let diff = report["phases"][0]["diffs"]
        .as_array()
        .expect("drift report has diffs")
        .iter()
        .find(|diff| diff["envelope"] == "applied" && diff["path"] == winner_path)
        .unwrap_or_else(|| panic!("CLI applied drift diff missing: {report:#?}"));
    assert_eq!(diff["expected"], expected_winner);
    assert_eq!(diff["actual"], "slot_2");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn audit_resolution_diff_artifact_in_process_writes_matched_and_drift_reports(pool: PgPool) {
    let matched_game = setup_resolved_audit_drift_game(&pool, "artifact_matched", 783).await;
    let matched_path = test_operator_proof_artifact_path("resolution-diff-matched", matched_game);
    let _ = fs::remove_file(&matched_path);

    let matched_output =
        run_audit_resolution_diff_artifact_in_process(&pool, matched_game, &matched_path).await;
    assert!(
        matched_output.status.success(),
        "matched resolution diff artifact should exit zero\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&matched_output.stdout),
        String::from_utf8_lossy(&matched_output.stderr)
    );
    assert!(
        matched_output.stderr.is_empty(),
        "matched resolution diff artifact should not write stderr: {}",
        String::from_utf8_lossy(&matched_output.stderr)
    );
    let matched_file: serde_json::Value =
        serde_json::from_slice(&fs::read(&matched_path).expect("matched artifact report exists"))
            .expect("matched artifact report is JSON");
    let matched_stdout: serde_json::Value =
        serde_json::from_slice(&matched_output.stdout).expect("matched artifact stdout is JSON");
    assert_eq!(matched_stdout, matched_file);
    assert_eq!(matched_file["ok"], true);
    assert_eq!(
        matched_file["artifact_path"].as_str(),
        Some(matched_path.to_string_lossy().as_ref())
    );
    assert_eq!(matched_file["audited_phase_count"], 1);
    assert_eq!(matched_file["matched_phase_count"], 1);
    assert_eq!(matched_file["drifted_phase_count"], 0);
    assert_eq!(matched_file["diff_count"], 0);
    assert_eq!(matched_file["phases"][0]["status"], "matched");

    let drift_game = setup_resolved_audit_drift_game(&pool, "artifact_drift", 784).await;
    let (winner_event_index, expected_winner) =
        perturb_stored_resolution_winner(&pool, drift_game, "slot_2").await;
    let winner_path = format!("$.events[{winner_event_index}].payload.winner");
    let drift_path = test_operator_proof_artifact_path("resolution-diff-drift", drift_game);
    let _ = fs::remove_file(&drift_path);

    let drift_output =
        run_audit_resolution_diff_artifact_in_process(&pool, drift_game, &drift_path).await;
    assert!(
        !drift_output.status.success(),
        "drifted resolution diff artifact should exit non-zero\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&drift_output.stdout),
        String::from_utf8_lossy(&drift_output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&drift_output.stderr)
            .contains("resolution diff artifact found drift"),
        "drift artifact stderr should name drift\nstderr:\n{}",
        String::from_utf8_lossy(&drift_output.stderr)
    );
    let drift_file: serde_json::Value =
        serde_json::from_slice(&fs::read(&drift_path).expect("drift artifact report exists"))
            .expect("drift artifact report is JSON");
    let drift_stdout: serde_json::Value =
        serde_json::from_slice(&drift_output.stdout).expect("drift artifact stdout is JSON");
    assert_eq!(drift_stdout, drift_file);
    assert_eq!(drift_file["ok"], false);
    assert_eq!(
        drift_file["artifact_path"].as_str(),
        Some(drift_path.to_string_lossy().as_ref())
    );
    assert_eq!(drift_file["audited_phase_count"], 1);
    assert_eq!(drift_file["matched_phase_count"], 0);
    assert_eq!(drift_file["drifted_phase_count"], 1);
    assert_eq!(drift_file["diff_count"], 1);
    assert_eq!(drift_file["first_drift_paths"][0]["path"], winner_path);
    assert_eq!(drift_file["phases"][0]["status"], "drifted");
    assert_eq!(
        drift_file["phases"][0]["diffs"][0]["expected"],
        expected_winner
    );
    assert_eq!(drift_file["phases"][0]["diffs"][0]["actual"], "slot_2");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn audit_trace_inspection_artifact_in_process_writes_filtered_and_empty_reports(
    pool: PgPool,
) {
    let traced_game = setup_resolved_audit_drift_game(&pool, "trace_artifact", 785).await;
    let trace_report = inspect_resolution_traces(&pool, traced_game, None)
        .await
        .expect("resolved setup has inspectable traces");
    assert_eq!(trace_report.traces.len(), 1);
    let run_id = trace_report.traces[0].run_id.clone();
    let decision_count = trace_report.traces[0].decisions.len();
    let trace_path = test_operator_proof_artifact_path("trace-inspection", traced_game);
    let _ = fs::remove_file(&trace_path);

    let traced_output = run_audit_trace_inspection_artifact_in_process(
        &pool,
        traced_game,
        Some(&run_id),
        &trace_path,
    )
    .await;
    assert!(
        traced_output.status.success(),
        "trace inspection artifact should exit zero\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&traced_output.stdout),
        String::from_utf8_lossy(&traced_output.stderr)
    );
    assert!(
        traced_output.stderr.is_empty(),
        "trace inspection artifact should not write stderr: {}",
        String::from_utf8_lossy(&traced_output.stderr)
    );
    let traced_file: serde_json::Value =
        serde_json::from_slice(&fs::read(&trace_path).expect("trace artifact report exists"))
            .expect("trace artifact report is JSON");
    let traced_stdout: serde_json::Value =
        serde_json::from_slice(&traced_output.stdout).expect("trace artifact stdout is JSON");
    assert_eq!(traced_stdout, traced_file);
    assert_eq!(traced_file["ok"], true);
    assert_eq!(traced_file["artifact_version"], 1);
    assert_eq!(
        traced_file["artifact_path"].as_str(),
        Some(trace_path.to_string_lossy().as_ref())
    );
    assert_eq!(traced_file["game_id"], traced_game.to_string());
    assert_eq!(traced_file["trace_count"], 1);
    assert_eq!(
        traced_file["decision_count"],
        serde_json::json!(decision_count)
    );
    assert_eq!(traced_file["traces"][0]["run_id"], run_id);
    assert_eq!(traced_file["traces"][0]["phase_id"], "D01");
    assert!(traced_file["traces"][0]["applied_stream_seq"].is_number());
    assert!(traced_file["traces"][0]["trace_stream_seq"].is_number());
    assert!(traced_file["normalized_fields"]
        .as_array()
        .expect("trace artifact normalized fields")
        .iter()
        .any(|field| field == "$.traces[*].decisions[*].applied_stream_seq"));

    let empty_game = Uuid::new_v4();
    let empty_host = user("trace_empty_host");
    handle(
        &pool,
        &empty_host,
        Command::CreateGame {
            game: empty_game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .expect("create empty trace artifact game");
    let empty_path = test_operator_proof_artifact_path("trace-inspection-empty", empty_game);
    let _ = fs::remove_file(&empty_path);

    let empty_output =
        run_audit_trace_inspection_artifact_in_process(&pool, empty_game, None, &empty_path).await;
    assert!(
        !empty_output.status.success(),
        "empty trace inspection artifact should exit non-zero\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&empty_output.stdout),
        String::from_utf8_lossy(&empty_output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&empty_output.stderr)
            .contains("trace inspection artifact found no stored traces"),
        "empty trace artifact stderr should name missing traces\nstderr:\n{}",
        String::from_utf8_lossy(&empty_output.stderr)
    );
    let empty_file: serde_json::Value =
        serde_json::from_slice(&fs::read(&empty_path).expect("empty trace artifact report exists"))
            .expect("empty trace artifact report is JSON");
    let empty_stdout: serde_json::Value =
        serde_json::from_slice(&empty_output.stdout).expect("empty trace artifact stdout is JSON");
    assert_eq!(empty_stdout, empty_file);
    assert_eq!(empty_file["ok"], false);
    assert_eq!(
        empty_file["artifact_path"].as_str(),
        Some(empty_path.to_string_lossy().as_ref())
    );
    assert_eq!(empty_file["game_id"], empty_game.to_string());
    assert_eq!(empty_file["trace_count"], 0);
    assert_eq!(empty_file["decision_count"], 0);
    assert!(empty_file["traces"]
        .as_array()
        .expect("empty trace artifact traces")
        .is_empty());
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn audit_projection_rebuild_artifact_in_process_writes_matched_and_drift_reports(
    pool: PgPool,
) {
    let matched_game =
        setup_resolved_audit_drift_game(&pool, "projection_artifact_matched", 786).await;
    let matched_path =
        test_operator_proof_artifact_path("projection-rebuild-matched", matched_game);
    let _ = fs::remove_file(&matched_path);

    let matched_output =
        run_audit_projection_rebuild_artifact_in_process(&pool, matched_game, &matched_path).await;
    assert!(
        matched_output.status.success(),
        "matched projection rebuild artifact should exit zero\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&matched_output.stdout),
        String::from_utf8_lossy(&matched_output.stderr)
    );
    assert!(
        matched_output.stderr.is_empty(),
        "matched projection rebuild artifact should not write stderr: {}",
        String::from_utf8_lossy(&matched_output.stderr)
    );
    let matched_file: serde_json::Value =
        serde_json::from_slice(&fs::read(&matched_path).expect("matched rebuild artifact exists"))
            .expect("matched rebuild artifact is JSON");
    let matched_stdout: serde_json::Value =
        serde_json::from_slice(&matched_output.stdout).expect("matched rebuild stdout is JSON");
    assert_eq!(matched_stdout, matched_file);
    assert_eq!(matched_file["ok"], true);
    assert_eq!(matched_file["artifact_version"], 1);
    assert_eq!(
        matched_file["artifact_path"].as_str(),
        Some(matched_path.to_string_lossy().as_ref())
    );
    assert_eq!(matched_file["game_id"], matched_game.to_string());
    assert_eq!(matched_file["isolation"], "rollback-only transaction");
    assert!(matched_file["table_count"].as_u64().unwrap_or_default() > 0);
    assert_eq!(
        matched_file["matched_table_count"],
        matched_file["table_count"]
    );
    assert_eq!(matched_file["drifted_table_count"], 0);
    assert!(matched_file["tables"]
        .as_array()
        .expect("matched rebuild tables")
        .iter()
        .all(|table| table["matches"] == true));

    let drift_game = setup_resolved_audit_drift_game(&pool, "projection_artifact_drift", 787).await;
    tamper_live_slot_state_role(&pool, drift_game, "slot_1", "tampered_projection_role").await;
    let drift_path = test_operator_proof_artifact_path("projection-rebuild-drift", drift_game);
    let _ = fs::remove_file(&drift_path);

    let drift_output =
        run_audit_projection_rebuild_artifact_in_process(&pool, drift_game, &drift_path).await;
    assert!(
        !drift_output.status.success(),
        "drifted projection rebuild artifact should exit non-zero\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&drift_output.stdout),
        String::from_utf8_lossy(&drift_output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&drift_output.stderr)
            .contains("projection rebuild artifact audit found drift"),
        "drift rebuild artifact stderr should name drift\nstderr:\n{}",
        String::from_utf8_lossy(&drift_output.stderr)
    );
    let drift_file: serde_json::Value =
        serde_json::from_slice(&fs::read(&drift_path).expect("drift rebuild artifact exists"))
            .expect("drift rebuild artifact is JSON");
    let drift_stdout: serde_json::Value =
        serde_json::from_slice(&drift_output.stdout).expect("drift rebuild stdout is JSON");
    assert_eq!(drift_stdout, drift_file);
    assert_eq!(drift_file["ok"], false);
    assert_eq!(
        drift_file["artifact_path"].as_str(),
        Some(drift_path.to_string_lossy().as_ref())
    );
    assert_eq!(drift_file["game_id"], drift_game.to_string());
    assert_eq!(drift_file["drifted_table_count"], 1);
    let slot_state = drift_file["tables"]
        .as_array()
        .expect("drift rebuild tables")
        .iter()
        .find(|table| table["table"] == "slot_state")
        .expect("slot_state drift table");
    assert_eq!(slot_state["matches"], false);
    let before_slot = slot_state["before"]
        .as_array()
        .expect("slot_state before rows")
        .iter()
        .find(|row| row["slot_id"] == "slot_1")
        .expect("tampered slot before row");
    let rebuilt_slot = slot_state["rebuilt"]
        .as_array()
        .expect("slot_state rebuilt rows")
        .iter()
        .find(|row| row["slot_id"] == "slot_1")
        .expect("rebuilt slot row");
    assert_eq!(before_slot["role_key"], "<private>");
    assert_eq!(rebuilt_slot["role_key"], "<private>");
    let live_slots = projections::slot_state(&pool, drift_game)
        .await
        .expect("live drifted projection rows after artifact audit");
    let live_role = live_slots
        .iter()
        .find(|row| row.slot_id == "slot_1")
        .and_then(|row| row.role_key.as_deref());
    assert_eq!(live_role, Some("tampered_projection_role"));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn audit_large_action_graph_performance_artifact_in_process_writes_pass_and_threshold_failure_reports(
    pool: PgPool,
) {
    let pass_path =
        test_operator_proof_artifact_path("large-action-graph-performance-pass", Uuid::new_v4());
    let _ = fs::remove_file(&pass_path);

    let pass_output =
        run_audit_large_action_graph_performance_artifact_in_process(&pool, &pass_path, None).await;
    assert!(
        pass_output.status.success(),
        "large action performance artifact should exit zero\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&pass_output.stdout),
        String::from_utf8_lossy(&pass_output.stderr)
    );
    assert!(
        pass_output.stderr.is_empty(),
        "large action performance artifact should not write stderr: {}",
        String::from_utf8_lossy(&pass_output.stderr)
    );
    let pass_file: serde_json::Value =
        serde_json::from_slice(&fs::read(&pass_path).expect("passing large graph artifact exists"))
            .expect("passing large graph artifact is JSON");
    let pass_stdout: serde_json::Value =
        serde_json::from_slice(&pass_output.stdout).expect("passing large graph stdout is JSON");
    assert_eq!(pass_stdout, pass_file);
    assert_eq!(pass_file["ok"], true);
    assert_eq!(pass_file["artifact_version"], 1);
    assert_eq!(
        pass_file["artifact_path"].as_str(),
        Some(pass_path.to_string_lossy().as_ref())
    );
    assert_eq!(pass_file["pack"], "mafiascum");
    assert_eq!(pass_file["phase_id"], "N01");
    assert_eq!(pass_file["roster_count"], 40);
    assert_eq!(pass_file["submitted_action_count"], 29);
    assert_eq!(
        pass_file["threshold_ms"],
        serde_json::json!(LARGE_ACTION_GRAPH_PERFORMANCE_THRESHOLD_MS)
    );
    assert!(
        pass_file["resolve_elapsed_ms"].as_u64().unwrap_or(u64::MAX)
            <= LARGE_ACTION_GRAPH_PERFORMANCE_THRESHOLD_MS,
        "passing report should stay under the local regression ceiling: {pass_file:#?}"
    );
    assert_eq!(pass_file["replay_audit_ok"], true);
    assert_eq!(pass_file["replay_audited"], 1);
    assert_eq!(pass_file["replay_skipped"], 0);
    assert_eq!(pass_file["projection_rebuild_ok"], true);
    assert_eq!(pass_file["phase_trace_anchored"], true);
    assert_eq!(pass_file["decision_trace_anchored"], true);
    assert_eq!(pass_file["pgo_triggered"], true);
    assert_eq!(pass_file["babysitter_death"], true);
    assert_eq!(pass_file["hider_death"], true);
    assert_eq!(pass_file["lovers_linked"], true);
    assert!(
        pass_file["resolution_inner_event_count"]
            .as_u64()
            .unwrap_or(u64::MAX)
            < 200,
        "large graph inner events should remain bounded: {pass_file:#?}"
    );
    assert!(
        pass_file["stream_event_count"].as_u64().unwrap_or(u64::MAX) <= 200,
        "large graph stream event count should remain bounded: {pass_file:#?}"
    );
    assert!(
        pass_file["trace_row_count"].as_u64().unwrap_or_default() > 0,
        "large graph report should inspect stored trace rows: {pass_file:#?}"
    );

    let threshold_path = test_operator_proof_artifact_path(
        "large-action-graph-performance-threshold",
        Uuid::new_v4(),
    );
    let _ = fs::remove_file(&threshold_path);

    let threshold_output = run_audit_large_action_graph_performance_artifact_in_process(
        &pool,
        &threshold_path,
        Some(0),
    )
    .await;
    assert!(
        !threshold_output.status.success(),
        "threshold-regressed large action performance artifact should exit non-zero\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&threshold_output.stdout),
        String::from_utf8_lossy(&threshold_output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&threshold_output.stderr)
            .contains("large action graph performance artifact failed its ceiling or audits"),
        "threshold failure stderr should name performance artifact failure\nstderr:\n{}",
        String::from_utf8_lossy(&threshold_output.stderr)
    );
    let threshold_file: serde_json::Value = serde_json::from_slice(
        &fs::read(&threshold_path).expect("threshold large graph artifact exists"),
    )
    .expect("threshold large graph artifact is JSON");
    let threshold_stdout: serde_json::Value = serde_json::from_slice(&threshold_output.stdout)
        .expect("threshold large graph stdout is JSON");
    assert_eq!(threshold_stdout, threshold_file);
    assert_eq!(threshold_file["ok"], false);
    assert_eq!(threshold_file["artifact_version"], 1);
    assert_eq!(
        threshold_file["artifact_path"].as_str(),
        Some(threshold_path.to_string_lossy().as_ref())
    );
    assert_eq!(threshold_file["pack"], "mafiascum");
    assert_eq!(threshold_file["phase_id"], "N01");
    assert_eq!(threshold_file["roster_count"], 40);
    assert_eq!(threshold_file["submitted_action_count"], 29);
    assert_eq!(threshold_file["threshold_ms"], 0);
    assert!(
        threshold_file["resolve_elapsed_ms"]
            .as_u64()
            .unwrap_or_default()
            > 0,
        "zero-threshold report should prove an elapsed-time regression boundary: {threshold_file:#?}"
    );
    assert_eq!(threshold_file["replay_audit_ok"], true);
    assert_eq!(threshold_file["replay_audited"], 1);
    assert_eq!(threshold_file["replay_skipped"], 0);
    assert_eq!(threshold_file["projection_rebuild_ok"], true);
    assert_eq!(threshold_file["phase_trace_anchored"], true);
    assert_eq!(threshold_file["decision_trace_anchored"], true);
    assert_eq!(threshold_file["pgo_triggered"], true);
    assert_eq!(threshold_file["babysitter_death"], true);
    assert_eq!(threshold_file["hider_death"], true);
    assert_eq!(threshold_file["lovers_linked"], true);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn audit_determinism_fuzz_artifact_in_process_writes_pass_and_missing_family_reports(
    _pool: PgPool,
) {
    let family_specs = operator_proof::determinism_fuzz_family_specs();
    let expected_family_count = family_specs.len() as u64;
    let expected_seed_count = family_specs
        .iter()
        .map(|family| family.seeds.len() as u64)
        .sum::<u64>();

    let pass_path = test_operator_proof_artifact_path("determinism-fuzz-pass", Uuid::new_v4());
    let _ = fs::remove_file(&pass_path);

    let pass_output = run_audit_determinism_fuzz_artifact_in_process(&pass_path, None);
    assert!(
        pass_output.status.success(),
        "determinism fuzz artifact should exit zero\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&pass_output.stdout),
        String::from_utf8_lossy(&pass_output.stderr)
    );
    assert!(
        pass_output.stderr.is_empty(),
        "determinism fuzz artifact should not write stderr: {}",
        String::from_utf8_lossy(&pass_output.stderr)
    );
    let pass_file: serde_json::Value =
        serde_json::from_slice(&fs::read(&pass_path).expect("passing determinism artifact exists"))
            .expect("passing determinism artifact is JSON");
    let pass_stdout: serde_json::Value =
        serde_json::from_slice(&pass_output.stdout).expect("passing determinism stdout is JSON");
    assert_eq!(pass_stdout, pass_file);
    assert_eq!(pass_file["ok"], true);
    assert_eq!(pass_file["artifact_version"], 1);
    assert_eq!(
        pass_file["artifact_path"].as_str(),
        Some(pass_path.to_string_lossy().as_ref())
    );
    assert_eq!(
        pass_file["test_filter"],
        "replay_audit_and_rebuild_deterministically"
    );
    assert!(pass_file["command"]
        .as_str()
        .expect("passing determinism command")
        .contains("cargo test -p commands --test pipeline replay_audit_and_rebuild_deterministically -- --ignored --nocapture"));
    assert_eq!(pass_file["family_count"], expected_family_count);
    assert_eq!(pass_file["passed_family_count"], expected_family_count);
    assert_eq!(pass_file["failed_family_count"], 0);
    assert_eq!(pass_file["seed_count"], expected_seed_count);
    assert_eq!(pass_file["expected_family_count"], expected_family_count);
    assert_eq!(pass_file["expected_seed_count"], expected_seed_count);
    assert_eq!(pass_file["family_manifest_matched"], true);
    assert!(pass_file.get("first_failing_seed").is_none());
    assert!(pass_file["elapsed_ms"].as_u64().unwrap_or_default() > 0);
    assert!(pass_file["proof_boundary"]
        .as_str()
        .expect("determinism proof boundary")
        .contains("not exhaustive state-space verification"));
    let pass_families = pass_file["families"]
        .as_array()
        .expect("passing determinism families");
    assert_eq!(pass_families.len(), family_specs.len());
    for (family_json, spec) in pass_families.iter().zip(family_specs.iter()) {
        assert_eq!(family_json["id"], spec.id);
        assert_eq!(family_json["selector"], spec.selector);
        assert_eq!(family_json["pack"], spec.pack);
        assert_eq!(family_json["phase_scope"], spec.phase_scope);
        assert_eq!(family_json["seed_count"], spec.seeds.len() as u64);
        assert_eq!(family_json["status"], "passed");
        assert!(family_json.get("first_failing_seed").is_none());
    }

    let missing_path =
        test_operator_proof_artifact_path("determinism-fuzz-missing", Uuid::new_v4());
    let _ = fs::remove_file(&missing_path);

    let missing_output = run_audit_determinism_fuzz_artifact_in_process(
        &missing_path,
        Some("no_such_determinism_family_selector"),
    );
    assert!(
        !missing_output.status.success(),
        "missing-family determinism artifact should exit non-zero\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&missing_output.stdout),
        String::from_utf8_lossy(&missing_output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&missing_output.stderr)
            .contains("determinism fuzz artifact found failed or missing seeded families"),
        "missing-family stderr should name determinism artifact failure\nstderr:\n{}",
        String::from_utf8_lossy(&missing_output.stderr)
    );
    let missing_file: serde_json::Value = serde_json::from_slice(
        &fs::read(&missing_path).expect("missing determinism artifact exists"),
    )
    .expect("missing determinism artifact is JSON");
    let missing_stdout: serde_json::Value =
        serde_json::from_slice(&missing_output.stdout).expect("missing determinism stdout is JSON");
    assert_eq!(missing_stdout, missing_file);
    assert_eq!(missing_file["ok"], false);
    assert_eq!(missing_file["artifact_version"], 1);
    assert_eq!(
        missing_file["artifact_path"].as_str(),
        Some(missing_path.to_string_lossy().as_ref())
    );
    assert_eq!(
        missing_file["test_filter"],
        "no_such_determinism_family_selector"
    );
    assert_eq!(missing_file["family_count"], expected_family_count);
    assert_eq!(missing_file["passed_family_count"], 0);
    assert_eq!(missing_file["failed_family_count"], 0);
    assert_eq!(missing_file["seed_count"], expected_seed_count);
    assert_eq!(missing_file["expected_family_count"], expected_family_count);
    assert_eq!(missing_file["expected_seed_count"], expected_seed_count);
    assert_eq!(missing_file["family_manifest_matched"], true);
    assert!(missing_file.get("first_failing_seed").is_none());
    let missing_families = missing_file["families"]
        .as_array()
        .expect("missing determinism families");
    assert_eq!(missing_families.len(), family_specs.len());
    assert!(missing_families
        .iter()
        .all(|family| family["status"] == "not_run"));
}

#[test]
fn pack_declared_pk_prompt_policies_have_semantic_minimizer_coverage() {
    #[derive(Debug, Eq, Ord, PartialEq, PartialOrd)]
    struct DeclaredPkPolicy {
        pack: String,
        id: String,
        prompt_reason: String,
        decision: String,
        effect: String,
    }

    struct PkCoverage {
        pack: &'static str,
        id: &'static str,
        prompt_reason: &'static str,
        golden: &'static str,
        fixture_stem: &'static str,
        fixture_json: String,
    }

    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("commands crate lives under crates/commands");
    let packs_dir = repo_root.join("packs");
    let mut declared = BTreeSet::new();
    let mut pack_dirs = fs::read_dir(&packs_dir)
        .unwrap_or_else(|err| panic!("read packs dir {packs_dir:?}: {err}"))
        .map(|entry| entry.expect("read packs dir entry").path())
        .collect::<Vec<_>>();
    pack_dirs.sort();

    for pack_dir in pack_dirs {
        let pack_path = pack_dir.join("pack.json");
        if !pack_path.exists() {
            continue;
        }
        let pack_name = pack_dir
            .file_name()
            .and_then(|name| name.to_str())
            .expect("pack dir name is utf-8");
        let raw = fs::read_to_string(&pack_path)
            .unwrap_or_else(|err| panic!("read {pack_path:?}: {err}"));
        let pack_json: serde_json::Value =
            serde_json::from_str(&raw).unwrap_or_else(|err| panic!("parse {pack_path:?}: {err}"));
        let prompt_policies = pack_json["day_vote_prompt_policies"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|policy| policy["prompt_kind"] == "pk");
        for policy in prompt_policies {
            let id = policy["id"]
                .as_str()
                .unwrap_or_else(|| panic!("{pack_name} PK prompt policy is missing id"));
            let prompt_reason = policy["prompt_reason"].as_str().unwrap_or_else(|| {
                panic!("{pack_name} PK prompt policy {id} is missing prompt_reason")
            });
            let effect = pack_json["host_prompt_resolution_effects"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|effect| {
                    effect["id"] == id
                        && effect["prompt_kind"] == "pk"
                        && effect["prompt_reason"] == prompt_reason
                })
                .unwrap_or_else(|| {
                    panic!("{pack_name} PK prompt policy {id} has no matching resolution effect")
                });
            declared.insert(DeclaredPkPolicy {
                pack: pack_name.to_string(),
                id: id.to_string(),
                prompt_reason: prompt_reason.to_string(),
                decision: effect["decision"]
                    .as_str()
                    .unwrap_or_else(|| {
                        panic!("{pack_name} PK prompt policy {id} effect is missing decision")
                    })
                    .to_string(),
                effect: effect["effect"]
                    .as_str()
                    .unwrap_or_else(|| {
                        panic!("{pack_name} PK prompt policy {id} effect is missing effect")
                    })
                    .to_string(),
            });
        }
    }

    let epicmafia_pk_case = generated_epicmafia_pk_case(95_777);
    let coverage = vec![
        PkCoverage {
            pack: "epicmafia",
            id: "pk_host_decides_tie",
            prompt_reason: "host_decides_tie",
            golden: "pk_host_decides_tie_prompt.json",
            fixture_stem: "generated-epicmafia-pk-d01-minimizer-ready",
            fixture_json: generated_epicmafia_pk_case_fixture_json(
                &epicmafia_pk_case,
                epicmafia_pk_case.seed + 47_000,
            ),
        },
        PkCoverage {
            pack: "test_dynamic_vote_pk",
            id: "pk_host_decides_tie",
            prompt_reason: "host_decides_tie",
            golden: "dynamic_vote_grant_pk_tie_prompt.json",
            fixture_stem: "dynamic-vote-pk-resolution-semantic-expectations",
            fixture_json: dynamic_vote_pk_prompt_fixture_json(),
        },
    ];

    let covered = coverage
        .iter()
        .map(|coverage| DeclaredPkPolicy {
            pack: coverage.pack.to_string(),
            id: coverage.id.to_string(),
            prompt_reason: coverage.prompt_reason.to_string(),
            decision: "SelectSlot".to_string(),
            effect: "PkKill".to_string(),
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(
        declared, covered,
        "every pack-declared PK host prompt policy must have explicit semantic minimizer coverage"
    );

    for coverage in coverage {
        let golden_path = packs_dir
            .join(coverage.pack)
            .join("golden")
            .join(coverage.golden);
        let golden_raw = fs::read_to_string(&golden_path)
            .unwrap_or_else(|err| panic!("read PK golden {golden_path:?}: {err}"));
        let golden_json: serde_json::Value = serde_json::from_str(&golden_raw)
            .unwrap_or_else(|err| panic!("parse PK golden {golden_path:?}: {err}"));
        assert!(
            golden_json["expected_events"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|event| event["kind"] == "HostPromptIssued"
                    && event["payload"]["kind"] == "pk"
                    && event["payload"]["metadata"]["policy"] == coverage.id),
            "{} golden {} should contain its PK HostPromptIssued event",
            coverage.pack,
            coverage.golden
        );

        let fixture: serde_json::Value = serde_json::from_str(&coverage.fixture_json)
            .unwrap_or_else(|err| panic!("parse {} fixture JSON: {err}", coverage.fixture_stem));
        assert_eq!(fixture["pack"], coverage.pack);
        assert!(
            fixture["host_prompt_decision"]["prompt_id"]
                .as_str()
                .is_some_and(|prompt_id| prompt_id.contains(":pk:")),
            "{} should carry a PK host prompt decision",
            coverage.fixture_stem
        );
        let inner_events = fixture["expectations"]["inner_events"]
            .as_array()
            .unwrap_or_else(|| panic!("{} should carry inner expectations", coverage.fixture_stem));
        assert!(
            inner_events
                .iter()
                .any(|event| event["kind"] == "HostPromptIssued"
                    && event["payload"]["kind"] == "pk"
                    && event["payload"]["metadata"]["policy"] == coverage.id),
            "{} should expect PK prompt issue",
            coverage.fixture_stem
        );
        assert!(
            inner_events
                .iter()
                .any(|event| event["kind"] == "PlayerKilled"
                    && event["payload"]["cause"] == "host_prompt:pk"),
            "{} should expect host-selected PK kill",
            coverage.fixture_stem
        );
        assert!(
            fixture["expectations"]["trace_decisions"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|decision| decision["stage"] == "host_prompt:resolve"
                    && decision["outcome"] == "pk_selected"
                    && decision["detail"]["kind"] == "pk"
                    && decision["detail"]["reason"] == coverage.prompt_reason),
            "{} should expect PK prompt resolution trace",
            coverage.fixture_stem
        );
    }
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn chinese_folded_state_cascade_fixtures_replay_semantic_expectations_through_minimizer(
    pool: PgPool,
) {
    for (stem, fixture_json) in [
        (
            "chinese-folded-wolf-beauty-drag-semantic-expectations",
            chinese_folded_wolf_beauty_drag_fixture_json(),
        ),
        (
            "chinese-folded-cupid-lover-suicide-semantic-expectations",
            chinese_folded_cupid_lover_suicide_fixture_json(),
        ),
        (
            "chinese-folded-hunter-retaliation-semantic-expectations",
            chinese_folded_hunter_retaliation_fixture_json(),
        ),
        (
            "chinese-folded-hunter-poison-suppression-semantic-expectations",
            chinese_folded_hunter_poison_suppression_fixture_json(),
        ),
    ] {
        let fixture: serde_json::Value =
            serde_json::from_str(&fixture_json).expect("Chinese folded-state fixture JSON parses");
        assert_eq!(
            fixture["setup_phases"].as_array().map_or(0, Vec::len),
            1,
            "{stem} should seed one folded setup phase"
        );
        let expectation_count = generated_expectation_count(&fixture["expectations"]);
        assert!(
            expectation_count >= 3,
            "{stem} should preserve multiple folded-state semantic expectations"
        );

        let artifacts = GeneratedShrinkArtifacts::new(stem);
        artifacts.remove_existing();
        artifacts.write_fixture(&fixture_json);
        let report = artifacts.run_minimizer(&pool).await;

        assert_eq!(report["original"]["ok"], true, "{stem} should replay");
        assert_eq!(report["original"]["resolution_audited"], 2);
        assert_eq!(report["original"]["trace_count"], 2);
        assert_eq!(
            report["original"]["semantic_expectations_checked"],
            serde_json::json!(expectation_count),
            "{stem} should check every folded-state expectation"
        );
        assert_eq!(report["reduction"]["replay_success"], true);
        assert_eq!(
            report["write_reduced"]["promoted_success_fixture"], true,
            "{stem} should promote the reduced success fixture"
        );
    }
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn phase5_sheriff_badge_fixtures_replay_semantic_expectations_through_minimizer(
    pool: PgPool,
) {
    for (stem, fixture_json, expected_audited, expected_traces) in [
        (
            "chinese-sheriff-badge-election-semantic-expectations",
            chinese_sheriff_badge_election_fixture_json(),
            1,
            1,
        ),
        (
            "chinese-sheriff-badge-pass-semantic-expectations",
            chinese_sheriff_badge_pass_fixture_json(),
            2,
            2,
        ),
        (
            "chinese-sheriff-badge-destroy-semantic-expectations",
            chinese_sheriff_badge_destroy_fixture_json(),
            3,
            3,
        ),
    ] {
        let fixture: serde_json::Value =
            serde_json::from_str(&fixture_json).expect("Sheriff badge fixture JSON parses");
        let expectation_count = generated_expectation_count(&fixture["expectations"]);
        assert!(
            expectation_count >= 5,
            "{stem} should preserve BadgeChanged, vote weight, trace, and projection semantics"
        );

        let artifacts = GeneratedShrinkArtifacts::new(stem);
        artifacts.remove_existing();
        artifacts.write_fixture(&fixture_json);
        let report = artifacts.run_minimizer(&pool).await;

        assert_eq!(report["original"]["ok"], true, "{stem} should replay");
        assert_eq!(
            report["original"]["resolution_audited"],
            serde_json::json!(expected_audited),
            "{stem} should audit every setup and target phase"
        );
        assert_eq!(
            report["original"]["trace_count"],
            serde_json::json!(expected_traces),
            "{stem} should inspect every setup and target trace"
        );
        assert_eq!(
            report["original"]["projection_audit_ok"],
            serde_json::json!(true),
            "{stem} should rebuild folded sheriff_badge projection state"
        );
        assert_eq!(
            report["original"]["semantic_expectations_checked"],
            serde_json::json!(expectation_count),
            "{stem} should check every sheriff badge semantic expectation"
        );
        assert_eq!(report["reduction"]["replay_success"], true);
        assert_eq!(
            report["write_reduced"]["promoted_success_fixture"], true,
            "{stem} should promote the reduced success fixture"
        );
    }
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn phase5_ita_buffered_release_fixture_replays_semantic_expectations_through_minimizer(
    pool: PgPool,
) {
    for (stem, fixture_json, min_expectations, audited, trace_count) in [
        (
            "ita-buffered-release-semantic-expectations",
            ita_buffered_release_fixture_json(),
            8,
            2,
            2,
        ),
        (
            "ita-buffered-release-invalidated-semantic-expectations",
            ita_buffered_release_invalidated_fixture_json(),
            10,
            2,
            2,
        ),
        (
            "ita-buffered-release-refunded-semantic-expectations",
            ita_buffered_release_refunded_fixture_json(),
            7,
            2,
            2,
        ),
        (
            "ita-buffered-release-hp-hybrid-semantic-expectations",
            ita_buffered_release_hp_hybrid_fixture_json(),
            11,
            2,
            2,
        ),
    ] {
        let fixture: serde_json::Value =
            serde_json::from_str(&fixture_json).expect("Buffered ITA release fixture JSON parses");
        let expectation_count = generated_expectation_count(&fixture["expectations"]);
        assert!(
            expectation_count >= min_expectations,
            "{stem} should preserve release-time ITA semantics"
        );

        let artifacts = GeneratedShrinkArtifacts::new(stem);
        artifacts.remove_existing();
        artifacts.write_fixture(&fixture_json);
        let report = artifacts.run_minimizer(&pool).await;

        assert_eq!(report["original"]["ok"], true, "{stem} original replay");
        assert_eq!(
            report["original"]["resolution_audited"],
            serde_json::json!(audited),
            "{stem} audited envelope count"
        );
        assert_eq!(
            report["original"]["trace_count"],
            serde_json::json!(trace_count),
            "{stem} trace count"
        );
        assert_eq!(
            report["original"]["projection_audit_ok"],
            serde_json::json!(true),
            "{stem} projection audit"
        );
        assert_eq!(
            report["original"]["semantic_expectations_checked"],
            serde_json::json!(expectation_count),
            "{stem} semantic expectation count"
        );
        assert_eq!(report["reduction"]["replay_success"], true, "{stem} replay");
        assert_eq!(
            report["write_reduced"]["promoted_success_fixture"], true,
            "{stem} promotion"
        );
    }
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn phase5_ita_lifecycle_fixture_replays_semantic_expectations_through_minimizer(
    pool: PgPool,
) {
    let stem = "ita-lifecycle-controls-semantic-expectations";
    let fixture_json = ita_lifecycle_controls_fixture_json();
    let fixture: serde_json::Value =
        serde_json::from_str(&fixture_json).expect("ITA lifecycle fixture JSON parses");
    let expectation_count = generated_expectation_count(&fixture["expectations"]);
    assert!(
        expectation_count >= 6,
        "ITA lifecycle fixture should preserve control semantics"
    );

    let artifacts = GeneratedShrinkArtifacts::new(stem);
    artifacts.remove_existing();
    artifacts.write_fixture(&fixture_json);
    let report = artifacts.run_minimizer(&pool).await;

    assert_eq!(report["original"]["ok"], true, "{stem} original replay");
    assert_eq!(
        report["original"]["resolution_audited"],
        serde_json::json!(1),
        "{stem} audited envelope count"
    );
    assert_eq!(
        report["original"]["trace_count"],
        serde_json::json!(1),
        "{stem} trace count"
    );
    assert_eq!(
        report["original"]["projection_audit_ok"],
        serde_json::json!(true),
        "{stem} projection audit"
    );
    assert_eq!(
        report["original"]["semantic_expectations_checked"],
        serde_json::json!(expectation_count),
        "{stem} semantic expectation count"
    );
    assert_eq!(report["reduction"]["replay_success"], true, "{stem} replay");
    assert_eq!(
        report["write_reduced"]["promoted_success_fixture"], true,
        "{stem} promotion"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn phase5_day_note_and_revote_prompt_fixtures_replay_semantic_expectations_through_minimizer(
    pool: PgPool,
) {
    for (stem, fixture_json, expected_audited, expected_traces, min_expectations) in [
        (
            "mafia-universe-day-notes-semantic-expectations",
            mafia_universe_day_notes_fixture_json(),
            2,
            2,
            7,
        ),
        (
            "mafiascum-no-majority-revote-resolution-semantic-expectations",
            mafiascum_no_majority_revote_prompt_fixture_json(),
            1,
            1,
            6,
        ),
        (
            "mafiascum-beloved-princess-skip-next-day-semantic-expectations",
            mafiascum_beloved_princess_skip_next_day_fixture_json(),
            1,
            1,
            7,
        ),
        (
            "mafiascum-virgin-night-skip-next-day-semantic-expectations",
            mafiascum_virgin_night_skip_next_day_fixture_json(),
            1,
            1,
            6,
        ),
        (
            "dynamic-vote-no-majority-revote-semantic-expectations",
            dynamic_vote_no_majority_revote_prompt_fixture_json(),
            2,
            2,
            6,
        ),
        (
            "dynamic-vote-pk-resolution-semantic-expectations",
            dynamic_vote_pk_prompt_fixture_json(),
            3,
            3,
            7,
        ),
    ] {
        let fixture: serde_json::Value =
            serde_json::from_str(&fixture_json).expect("Phase 5 fixture JSON parses");
        let expectation_count = generated_expectation_count(&fixture["expectations"]);
        assert!(
            expectation_count >= min_expectations,
            "{stem} should preserve the announcement/prompt semantic contract"
        );

        let artifacts = GeneratedShrinkArtifacts::new(stem);
        artifacts.remove_existing();
        artifacts.write_fixture(&fixture_json);
        let report = artifacts.run_minimizer(&pool).await;

        assert_eq!(report["original"]["ok"], true, "{stem} should replay");
        assert_eq!(
            report["original"]["resolution_audited"],
            serde_json::json!(expected_audited),
            "{stem} should audit every command-resolved phase"
        );
        assert_eq!(
            report["original"]["trace_count"],
            serde_json::json!(expected_traces),
            "{stem} should inspect every command-resolved trace"
        );
        assert_eq!(
            report["original"]["semantic_expectations_checked"],
            serde_json::json!(expectation_count),
            "{stem} should check every emitted Phase 5 expectation"
        );
        assert_eq!(report["reduction"]["replay_success"], true);
        assert_eq!(
            report["write_reduced"]["promoted_success_fixture"], true,
            "{stem} should promote the reduced success fixture"
        );
    }
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn submit_vote_hammer_uses_folded_vote_weight_grant(pool: PgPool) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "test_dynamic_vote_hammer".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "vanilla_townie"),
        ("slot_2", "user_2", "mafia_goon"),
        ("slot_3", "user_3", "vote_granter"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();

    handle(
        &pool,
        &user("user_3"),
        Command::SubmitAction {
            game,
            action_id: "grant_vote_power_n01".into(),
            actor_slot: "slot_3".into(),
            template_id: "grant_vote_power".into(),
            targets: vec!["slot_1".into()],
            grant_id: None,
        },
    )
    .await
    .unwrap();
    handle(&pool, &h, Command::ResolvePhase { game, seed: 784 })
        .await
        .expect("host resolves dynamic hammer grant action");
    handle(
        &pool,
        &h,
        Command::SetSlotStatus {
            game,
            slot: "slot_3".into(),
            status: domain::SlotLifecycle::Dead,
        },
    )
    .await
    .expect("host marks grant source dead before the next day");
    handle(&pool, &h, Command::AdvancePhase { game })
        .await
        .expect("host advances N01 to D02 after dynamic hammer grant");

    let snapshot = load_engine_snapshot(&pool, game, "D02")
        .await
        .expect("load dynamic hammer snapshot");
    assert!(
        !snapshot
            .slots
            .iter()
            .find(|slot| slot.slot_id == "slot_3")
            .expect("slot_3 snapshot")
            .is_alive(),
        "slot_3 must be outside the alive vote-weight denominator"
    );
    assert!(
        snapshot.action_grants.iter().any(|grant| {
            grant.target == "slot_1"
                && grant.grant_id == "vote_power_boost"
                && grant.kind == domain::GrantKind::VoteWeight
                && grant.vote_weight == Some(2.0)
        }),
        "folded VoteWeight grant must be visible to live hammer simulation"
    );

    let hammer_ack = handle(
        &pool,
        &user("user_1"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .expect("single granted 2.0-weight ballot reaches majority and hammers");
    assert_eq!(
        hammer_ack.stream_seqs.len(),
        2,
        "dynamic hammer vote appends VoteSubmitted and ThreadLocked atomically"
    );
    assert_eq!(
        tally_for(&pool, game, "D02", "slot_2").await,
        1,
        "running votecount remains ballot-counted while hammer simulation uses resolver weights"
    );
    assert!(
        phase_state(&pool, game).await.unwrap().unwrap().locked,
        "folded VoteWeight grant lets the first D02 ballot hammer"
    );

    let lock_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ThreadLocked' ORDER BY stream_seq DESC LIMIT 1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(lock_payload["reason"], "hammer");
    assert_eq!(lock_payload["phase_id"], "D02");
    assert_eq!(lock_payload["actor"], "slot_1");
    assert_eq!(lock_payload["target"], "slot_2");

    let late_vote_err = handle(
        &pool,
        &user("user_2"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_2".into(),
            target: VoteTarget::Slot("slot_1".into()),
        },
    )
    .await
    .expect_err("dynamic hammer lock rejects later ballots");
    assert_eq!(late_vote_err, Reject::PhaseLocked);

    let grants_before = serde_json::to_string(&action_grants(&pool, game).await.unwrap()).unwrap();
    let phase_before = serde_json::to_string(&phase_state(&pool, game).await.unwrap()).unwrap();
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        grants_before,
        serde_json::to_string(&action_grants(&pool, game).await.unwrap()).unwrap(),
        "action_grant rebuild must preserve dynamic hammer VoteWeight grant"
    );
    assert_eq!(
        phase_before,
        serde_json::to_string(&phase_state(&pool, game).await.unwrap()).unwrap(),
        "phase_state rebuild must preserve dynamic hammer lock"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn host_prompt_skip_next_day_rejects_unsupported_pack_cadence(pool: PgPool) {
    let game = Uuid::new_v4();
    let h = user("host_h");

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "test_skip_next_day_day_only".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "beloved_princess"),
        ("slot_2", "user_2", "vanilla_townie"),
        ("slot_3", "user_3", "vanilla_townie"),
        ("slot_4", "user_4", "mafia_goon"),
        ("slot_5", "user_5", "mafia_goon"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();

    for (user_id, actor_slot) in [
        ("user_2", "slot_2"),
        ("user_3", "slot_3"),
        ("user_4", "slot_4"),
    ] {
        handle(
            &pool,
            &user(user_id),
            Command::SubmitVote {
                game,
                actor_slot: actor_slot.into(),
                target: VoteTarget::Slot("slot_1".into()),
            },
        )
        .await
        .unwrap();
    }
    handle(&pool, &h, Command::ResolvePhase { game, seed: 7422 })
        .await
        .expect("host resolves day-only Beloved Princess lynch prompt");

    let phase_before = phase_state(&pool, game)
        .await
        .unwrap()
        .expect("day phase remains current");
    assert_eq!(phase_before.phase_id, "D01");
    let prompt_before = host_prompts(&pool, game).await.unwrap();
    assert_eq!(prompt_before.len(), 1);
    assert_eq!(prompt_before[0].prompt_id, "D01:skip_next_day:slot_1");
    assert_eq!(prompt_before[0].status, "pending");

    let err = handle(
        &pool,
        &h,
        Command::ResolveHostPrompt {
            game,
            prompt_id: "D01:skip_next_day:slot_1".into(),
            decision: HostPromptDecision::Acknowledge {
                metadata: serde_json::json!({
                    "operator_note": "unsupported in day-only cadence"
                }),
            },
        },
    )
    .await
    .expect_err("day-only pack cannot advance skip-next-day to N02");
    assert_eq!(err, Reject::InvalidTarget);

    let prompt_after = host_prompts(&pool, game).await.unwrap();
    assert_eq!(prompt_after.len(), 1);
    assert_eq!(
        prompt_after[0].status, "pending",
        "rejected prompt transition must not append HostPromptResolved"
    );
    assert_eq!(
        phase_state(&pool, game).await.unwrap().unwrap().phase_id,
        "D01",
        "rejected prompt transition must preserve phase_state"
    );

    let rejected_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 \
         AND kind IN ('HostPromptResolved', 'PhaseAdvanced') \
         AND stream_seq > (SELECT MIN(stream_seq) FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied')",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        rejected_events, 0,
        "rejected prompt transition must append no HostPromptResolved or PhaseAdvanced"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn host_resolve_phase_loads_action_submissions_from_stream(pool: PgPool) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "mafia_goon"),
        ("slot_2", "user_2", "doctor"),
        ("slot_3", "user_3", "vanilla_townie"),
        ("slot_4", "user_4", "vanilla_townie"),
        ("slot_5", "user_5", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();

    handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "night_kill_withdrawn".into(),
            actor_slot: "slot_1".into(),
            template_id: "factional_kill".into(),
            targets: vec!["slot_4".into()],
            grant_id: None,
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_1"),
        Command::WithdrawAction {
            game,
            action_id: "night_kill_withdrawn".into(),
            actor_slot: "slot_1".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "night_kill_1".into(),
            actor_slot: "slot_1".into(),
            template_id: "factional_kill".into(),
            targets: vec!["slot_3".into()],
            grant_id: None,
        },
    )
    .await
    .unwrap();

    let err = handle(
        &pool,
        &user("user_2"),
        Command::SubmitAction {
            game,
            action_id: "bad_doctor_kill".into(),
            actor_slot: "slot_2".into(),
            template_id: "factional_kill".into(),
            targets: vec!["slot_1".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("actor cannot submit an action template missing from their role");
    assert_eq!(err, Reject::InvalidTarget);

    let err = handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "bad_self_kill".into(),
            actor_slot: "slot_1".into(),
            template_id: "factional_kill".into(),
            targets: vec!["slot_1".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("action constraints reject self-targeting factional kill");
    assert_eq!(err, Reject::InvalidTarget);

    let kinds: Vec<String> = eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .filter(|event| event.kind == "ActionSubmitted" || event.kind == "ActionWithdrawn")
        .map(|event| event.kind)
        .collect();
    assert_eq!(
        kinds,
        vec![
            "ActionSubmitted".to_string(),
            "ActionWithdrawn".to_string(),
            "ActionSubmitted".to_string()
        ]
    );

    handle(&pool, &h, Command::ResolvePhase { game, seed: 4242 })
        .await
        .expect("host resolves night action");

    let applied_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied' \
         AND payload->>'phase_id' = 'N01'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let applied = domain::validate_resolution_json(&applied_payload, domain::RESULT_VERSION)
        .expect("withdrawn-action ResolutionApplied validates");
    assert!(
        applied.events.iter().any(|indexed| matches!(
            &indexed.event,
            domain::InnerEvent::PlayerKilled { slot_id, cause, attackers, .. }
                if slot_id == "slot_3"
                    && cause == "factional_kill"
                    && attackers == &vec!["slot_1".to_string()]
        )),
        "live SubmitAction should be the only projected kill"
    );
    assert!(
        !applied.events.iter().any(|indexed| {
            serde_json::to_value(&indexed.event)
                .expect("inner event serializes")
                .to_string()
                .contains("night_kill_withdrawn")
        }),
        "withdrawn action id must not appear in ResolutionApplied"
    );
    let trace_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionTrace' \
         AND payload->>'phase_id' = 'N01'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    domain::validate_trace_json(&trace_payload, domain::TRACE_VERSION)
        .expect("withdrawn-action ResolutionTrace validates");
    assert!(
        !trace_payload.to_string().contains("night_kill_withdrawn"),
        "withdrawn action id must not appear in persisted ResolutionTrace"
    );

    let slots = slot_state(&pool, game).await.unwrap();
    assert!(
        !slots.iter().find(|s| s.slot_id == "slot_3").unwrap().alive,
        "SubmitAction was loaded into domain::resolve and projected"
    );
    assert!(
        slots.iter().find(|s| s.slot_id == "slot_4").unwrap().alive,
        "WithdrawAction suppressed the withdrawn night action"
    );
    let slots_before = serde_json::to_string(&slots).unwrap();
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        slots_before,
        serde_json::to_string(&slot_state(&pool, game).await.unwrap()).unwrap(),
        "slot_state rebuild must preserve live-vs-withdrawn action resolution"
    );
    let trace_after_rebuild = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionTrace' \
         AND payload->>'phase_id' = 'N01'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        trace_payload, trace_after_rebuild,
        "projection rebuild must not rewrite persisted withdrawn-action trace envelope"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn action_submission_rejects_and_traces_invalid_template_ids(pool: PgPool) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "mafia_goon"),
        ("slot_2", "user_2", "doctor"),
        ("slot_3", "user_3", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();

    let err = handle(
        &pool,
        &user("user_2"),
        Command::SubmitAction {
            game,
            action_id: "doctor_bad_kill".into(),
            actor_slot: "slot_2".into(),
            template_id: "factional_kill".into(),
            targets: vec!["slot_1".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("doctor cannot front-door submit a mafia role template");
    assert_eq!(err, Reject::InvalidTarget);
    assert!(
        !eventstore::load_stream(&pool, game)
            .await
            .unwrap()
            .iter()
            .any(|event| event.kind == "ActionSubmitted"
                && event.payload["action_id"].as_str() == Some("doctor_bad_kill")),
        "invalid command template must not append ActionSubmitted"
    );

    projections::append_and_project(
        &pool,
        game,
        &[eventstore::EventInput::new(
            "ActionSubmitted",
            1,
            serde_json::json!({
                "action_id": "historical_bad_kill",
                "template_id": "factional_kill",
                "actor": "slot_2",
                "targets": ["slot_1"],
                "phase_id": "N01"
            }),
            eventstore::ActorId::Slot("slot_2".into()),
            0,
        )],
    )
    .await
    .unwrap();
    handle(&pool, &h, Command::ResolvePhase { game, seed: 4343 })
        .await
        .expect("resolver remains total over historical invalid template ids");

    let applied_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied' \
         AND payload->>'phase_id' = 'N01'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let applied = domain::validate_resolution_json(&applied_payload, domain::RESULT_VERSION)
        .expect("valid ResolutionApplied");
    assert!(
        !applied
            .events
            .iter()
            .any(|indexed| matches!(&indexed.event, domain::InnerEvent::PlayerKilled { .. })),
        "historical invalid template id must not resolve as the actor's action"
    );
    let halt = applied
        .events
        .iter()
        .find_map(|indexed| match &indexed.event {
            domain::InnerEvent::ActionIngestHalted {
                action_id,
                actor,
                actor_role,
                template_id,
                targets,
                phase_id,
                phase_kind,
                phase_number,
                reason,
                grant_id,
            } if action_id == "historical_bad_kill" => Some((
                actor,
                actor_role,
                template_id,
                targets,
                phase_id,
                phase_kind,
                phase_number,
                reason,
                grant_id,
            )),
            _ => None,
        })
        .expect("historical invalid template id should emit ActionIngestHalted");
    assert_eq!(halt.0, "slot_2");
    assert_eq!(halt.1.as_deref(), Some("doctor"));
    assert_eq!(halt.2, "factional_kill");
    assert_eq!(halt.3, &vec!["slot_1".to_string()]);
    assert_eq!(halt.4, "N01");
    assert_eq!(*halt.5, domain::pack::PhaseKind::Night);
    assert_eq!(*halt.6, 1);
    assert_eq!(halt.7, "template_not_available_to_actor");
    assert_eq!(halt.8.as_deref(), None);

    let trace_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionTrace' \
         AND payload->>'phase_id' = 'N01'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let trace = domain::validate_trace_json(&trace_payload, domain::TRACE_VERSION)
        .expect("valid ResolutionTrace");
    assert_decision_trace(
        &trace,
        DecisionTraceExpectation {
            stage: "submission_ingest",
            source: "action:historical_bad_kill",
            outcome: "submission_template_rejected",
            detail: vec![
                ("action_id", serde_json::json!("historical_bad_kill")),
                ("actor", serde_json::json!("slot_2")),
                ("actor_role", serde_json::json!("doctor")),
                ("template_id", serde_json::json!("factional_kill")),
                ("grant_id", serde_json::Value::Null),
                ("targets", serde_json::json!(["slot_1"])),
                (
                    "reason",
                    serde_json::json!("template_not_available_to_actor"),
                ),
            ],
        },
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn action_submission_requires_open_matching_phase(pool: PgPool) {
    let host = "host_h";
    let h = user(host);
    let game = Uuid::new_v4();

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "mafia_goon"),
        ("slot_2", "user_2", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    let err = handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "before_phase".into(),
            actor_slot: "slot_1".into(),
            template_id: "factional_kill".into(),
            targets: vec!["slot_2".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("cannot submit before a phase opens");
    assert_eq!(err, Reject::PhaseLocked);

    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();
    let err = handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "wrong_window".into(),
            actor_slot: "slot_1".into(),
            template_id: "factional_kill".into(),
            targets: vec!["slot_2".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("night action cannot be submitted in day phase");
    assert_eq!(err, Reject::PhaseLocked);

    handle(
        &pool,
        &h,
        Command::OpenDayPhase {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();
    handle(&pool, &h, Command::LockThread { game })
        .await
        .unwrap();
    let err = handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "locked".into(),
            actor_slot: "slot_1".into(),
            template_id: "factional_kill".into(),
            targets: vec!["slot_2".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("locked phase blocks action submissions");
    assert_eq!(err, Reject::PhaseLocked);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn action_submission_rejects_cadence_and_exhausted_constraints(pool: PgPool) {
    let host = "host_h";
    let h = user(host);
    let game = Uuid::new_v4();

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "vigilante"),
        ("slot_2", "user_2", "odd_night_cop"),
        ("slot_3", "user_3", "non_consecutive_cop"),
        ("slot_4", "user_4", "mafia_goon"),
        ("slot_5", "user_5", "vanilla_townie"),
        ("slot_6", "user_6", "vanilla_townie"),
        ("slot_7", "user_7", "cooldown_cop"),
        ("slot_8", "user_8", "lazy_cop"),
        ("slot_9", "user_9", "indecisive_cop"),
        ("slot_10", "user_10", "uncooperative_cop"),
        ("slot_11", "user_11", "roaming_cop"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "vig_n01".into(),
            actor_slot: "slot_1".into(),
            template_id: "night_kill".into(),
            targets: vec!["slot_5".into()],
            grant_id: None,
        },
    )
    .await
    .expect("first one-shot use is valid");
    handle(
        &pool,
        &user("user_3"),
        Command::SubmitAction {
            game,
            action_id: "cop_n01".into(),
            actor_slot: "slot_3".into(),
            template_id: "investigate_alignment".into(),
            targets: vec!["slot_4".into()],
            grant_id: None,
        },
    )
    .await
    .expect("first non-consecutive target is valid");
    handle(
        &pool,
        &user("user_7"),
        Command::SubmitAction {
            game,
            action_id: "cooldown_cop_n01".into(),
            actor_slot: "slot_7".into(),
            template_id: "investigate_alignment".into(),
            targets: vec!["slot_4".into()],
            grant_id: None,
        },
    )
    .await
    .expect("first cooldown action is valid");
    handle(
        &pool,
        &user("user_9"),
        Command::SubmitAction {
            game,
            action_id: "indecisive_cop_n01".into(),
            actor_slot: "slot_9".into(),
            template_id: "investigate_alignment".into(),
            targets: vec!["slot_4".into()],
            grant_id: None,
        },
    )
    .await
    .expect("first indecisive target is valid");
    handle(
        &pool,
        &user("user_10"),
        Command::SubmitAction {
            game,
            action_id: "uncooperative_cop_n01".into(),
            actor_slot: "slot_10".into(),
            template_id: "investigate_alignment".into(),
            targets: vec!["slot_4".into()],
            grant_id: None,
        },
    )
    .await
    .expect("uncooperative action submits normally");
    handle(
        &pool,
        &user("user_11"),
        Command::SubmitAction {
            game,
            action_id: "roaming_cop_n01".into(),
            actor_slot: "slot_11".into(),
            template_id: "investigate_alignment".into(),
            targets: vec!["slot_4".into()],
            grant_id: None,
        },
    )
    .await
    .expect("first roaming target is valid");
    handle(&pool, &h, Command::ResolvePhase { game, seed: 8801 })
        .await
        .expect("host resolves first cadence night");
    let first_applied_payload = resolution_payload(&pool, game, "N01", 8801).await;
    let first_applied =
        domain::validate_resolution_json(&first_applied_payload, domain::RESULT_VERSION)
            .expect("cadence N01 ResolutionApplied validates");
    assert!(
        first_applied.events.iter().any(|indexed| matches!(
            &indexed.event,
            domain::InnerEvent::InvestigationResult {
                mode: domain::InvestigateMode::Parity,
                investigator,
                target,
                result,
            } if investigator == "slot_10"
                && target == "slot_4"
                && result == &serde_json::json!("ambiguous")
        )),
        "uncooperative investigation should resolve through Command::ResolvePhase with ambiguous feedback"
    );
    let counters = action_counters(&pool, game).await.unwrap();
    assert!(
        counters.iter().any(|counter| {
            counter.slot_id == "slot_1"
                && counter.counter_id == "x_shot:night_kill"
                && counter.template_id == "night_kill"
                && counter.consumed_action == "vig_n01"
                && counter.cadence_policy == "x_shot"
                && counter.phase_scope == "game"
                && counter.limit == 1
                && counter.used == 1
                && counter.remaining == 0
                && counter.phase_id == "N01"
                && counter.phase_kind == "Night"
                && counter.phase_number == 1
        }),
        "resolved one-shot action should fold into a typed action counter: {counters:?}"
    );
    assert!(
        counters.iter().any(|counter| {
            counter.slot_id == "slot_7"
                && counter.counter_id == "cooldown:investigate_alignment"
                && counter.template_id == "investigate_alignment"
                && counter.consumed_action == "cooldown_cop_n01"
                && counter.cadence_policy == "cooldown"
                && counter.phase_scope == "phase_kind"
                && counter.limit == 1
                && counter.used == 1
                && counter.remaining == 1
                && counter.phase_id == "N01"
                && counter.phase_kind == "Night"
                && counter.phase_number == 1
        }),
        "resolved cooldown action should fold into a typed action counter: {counters:?}"
    );
    assert!(
        !slot_effects(&pool, game)
            .await
            .unwrap()
            .iter()
            .any(|effect| effect.slot_id == "slot_1" && effect.effect == "used:night_kill"),
        "one-shot usage should no longer be encoded as a slot effect"
    );
    let counters_before_rebuild = serde_json::to_string(&counters).unwrap();
    rebuild(&pool, game).await.unwrap();
    assert_eq!(
        counters_before_rebuild,
        serde_json::to_string(&action_counters(&pool, game).await.unwrap()).unwrap(),
        "action_counter rebuild should preserve x-shot and cooldown counters"
    );

    handle(
        &pool,
        &h,
        Command::OpenDayPhase {
            game,
            phase: "N02".into(),
        },
    )
    .await
    .unwrap();

    let err = handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "vig_n02".into(),
            actor_slot: "slot_1".into(),
            template_id: "night_kill".into(),
            targets: vec!["slot_6".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("one-shot use should be rejected before append");
    assert_eq!(err, Reject::InvalidTarget);

    let err = handle(
        &pool,
        &user("user_2"),
        Command::SubmitAction {
            game,
            action_id: "odd_cop_n02".into(),
            actor_slot: "slot_2".into(),
            template_id: "investigate_alignment".into(),
            targets: vec!["slot_4".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("odd-night action cannot be submitted on even night");
    assert_eq!(err, Reject::InvalidTarget);

    let err = handle(
        &pool,
        &user("user_3"),
        Command::SubmitAction {
            game,
            action_id: "cop_repeat_n02".into(),
            actor_slot: "slot_3".into(),
            template_id: "investigate_alignment".into(),
            targets: vec!["slot_4".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("non-consecutive repeat target should be rejected before append");
    assert_eq!(err, Reject::InvalidTarget);

    let err = handle(
        &pool,
        &user("user_7"),
        Command::SubmitAction {
            game,
            action_id: "cooldown_cop_n02".into(),
            actor_slot: "slot_7".into(),
            template_id: "investigate_alignment".into(),
            targets: vec!["slot_4".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("cooldown action cannot be submitted on the next matching night");
    assert_eq!(err, Reject::InvalidTarget);

    let err = handle(
        &pool,
        &user("user_8"),
        Command::SubmitAction {
            game,
            action_id: "lazy_cop_n02".into(),
            actor_slot: "slot_8".into(),
            template_id: "investigate_alignment".into(),
            targets: vec!["slot_4".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("lazy action cannot submit with only one living non-town");
    assert_eq!(err, Reject::InvalidTarget);

    let err = handle(
        &pool,
        &user("user_9"),
        Command::SubmitAction {
            game,
            action_id: "indecisive_cop_n02".into(),
            actor_slot: "slot_9".into(),
            template_id: "investigate_alignment".into(),
            targets: vec!["slot_4".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("indecisive repeat target should be rejected before append");
    assert_eq!(err, Reject::InvalidTarget);

    handle(
        &pool,
        &user("user_3"),
        Command::SubmitAction {
            game,
            action_id: "cop_fresh_n02".into(),
            actor_slot: "slot_3".into(),
            template_id: "investigate_alignment".into(),
            targets: vec!["slot_6".into()],
            grant_id: None,
        },
    )
    .await
    .expect("non-consecutive action can target a different slot");

    let submitted: Vec<_> = eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .filter(|event| {
            event.kind == "ActionSubmitted" && event.payload["phase_id"].as_str() == Some("N02")
        })
        .map(|event| event.payload["action_id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        submitted,
        vec!["cop_fresh_n02".to_string()],
        "cadence rejects must not append ActionSubmitted events"
    );

    handle(&pool, &h, Command::ResolvePhase { game, seed: 8802 })
        .await
        .expect("host resolves allowed non-consecutive action");
    let applied_payload = resolution_payload(&pool, game, "N02", 8802).await;
    let applied = domain::validate_resolution_json(&applied_payload, domain::RESULT_VERSION)
        .expect("non-consecutive N02 ResolutionApplied validates");
    assert!(
        applied.events.iter().any(|indexed| matches!(
            &indexed.event,
            domain::InnerEvent::InvestigationResult {
                mode: domain::InvestigateMode::Parity,
                investigator,
                target,
                result,
            } if investigator == "slot_3"
                && target == "slot_6"
                && result == &serde_json::json!("town")
        )),
        "different-target non-consecutive action should resolve through Command::ResolvePhase"
    );
    assert!(
        action_history(&pool, game)
            .await
            .unwrap()
            .iter()
            .any(|record| {
                record.slot_id == "slot_3"
                    && record.template_id == "investigate_alignment"
                    && record.phase_id == "N02"
                    && record.targets == vec!["slot_6".to_string()]
                    && record.status == "resolved"
            }),
        "allowed non-consecutive N02 action should fold into action_history"
    );
    let audit = audit_resolution_envelopes(&pool, game)
        .await
        .expect("non-consecutive cadence resolution audit");
    assert!(
        audit.ok,
        "non-consecutive cadence resolution audit drifted: {audit:?}"
    );
    assert_eq!(audit.audited, 2);
    assert_eq!(audit.skipped, 0);

    let history_before_rebuild = serde_json::to_string(&action_history(&pool, game).await.unwrap())
        .expect("serialize action history before rebuild");
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        history_before_rebuild,
        serde_json::to_string(&action_history(&pool, game).await.unwrap())
            .expect("serialize action history after rebuild"),
        "action_history rebuild should preserve allowed non-consecutive resolution"
    );

    handle(
        &pool,
        &h,
        Command::OpenDayPhase {
            game,
            phase: "N03".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_7"),
        Command::SubmitAction {
            game,
            action_id: "cooldown_cop_n03".into(),
            actor_slot: "slot_7".into(),
            template_id: "investigate_alignment".into(),
            targets: vec!["slot_4".into()],
            grant_id: None,
        },
    )
    .await
    .expect("cooldown expires after one matching night cycle");
    let err = handle(
        &pool,
        &user("user_11"),
        Command::SubmitAction {
            game,
            action_id: "roaming_cop_n03".into(),
            actor_slot: "slot_11".into(),
            template_id: "investigate_alignment".into(),
            targets: vec!["slot_4".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("roaming action cannot repeat any prior resolved target");
    assert_eq!(err, Reject::InvalidTarget);
    assert!(
        eventstore::load_stream(&pool, game)
            .await
            .unwrap()
            .into_iter()
            .any(|event| event.kind == "ActionSubmitted"
                && event.payload["phase_id"].as_str() == Some("N03")
                && event.payload["action_id"].as_str() == Some("cooldown_cop_n03")),
        "expired cooldown submission should append on N03"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn action_submission_respects_multi_cycle_cooldown_expiry(pool: PgPool) {
    let host = "host_long_cooldown";
    let h = user(host);
    let game = Uuid::new_v4();

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "long_cooldown_user_1", "long_cooldown_cop"),
        ("slot_2", "long_cooldown_user_2", "mafia_goon"),
        ("slot_3", "long_cooldown_user_3", "vanilla_townie"),
        ("slot_4", "long_cooldown_user_4", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("long_cooldown_user_1"),
        Command::SubmitAction {
            game,
            action_id: "long_cooldown_n01".into(),
            actor_slot: "slot_1".into(),
            template_id: "investigate_alignment".into(),
            targets: vec!["slot_2".into()],
            grant_id: None,
        },
    )
    .await
    .expect("first long-cooldown action is valid");
    handle(&pool, &h, Command::ResolvePhase { game, seed: 8804 })
        .await
        .expect("host resolves first long-cooldown action");

    let counters = action_counters(&pool, game).await.unwrap();
    assert!(
        counters.iter().any(|counter| {
            counter.slot_id == "slot_1"
                && counter.counter_id == "cooldown:investigate_alignment"
                && counter.template_id == "investigate_alignment"
                && counter.consumed_action == "long_cooldown_n01"
                && counter.cadence_policy == "cooldown"
                && counter.phase_scope == "phase_kind"
                && counter.limit == 2
                && counter.used == 1
                && counter.remaining == 2
                && counter.phase_id == "N01"
                && counter.phase_kind == "Night"
                && counter.phase_number == 1
        }),
        "resolved long-cooldown action should fold the declared two-cycle counter: {counters:?}"
    );

    for (phase, action_id) in [("N02", "long_cooldown_n02"), ("N03", "long_cooldown_n03")] {
        handle(
            &pool,
            &h,
            Command::OpenDayPhase {
                game,
                phase: phase.into(),
            },
        )
        .await
        .unwrap();
        let err = handle(
            &pool,
            &user("long_cooldown_user_1"),
            Command::SubmitAction {
                game,
                action_id: action_id.into(),
                actor_slot: "slot_1".into(),
                template_id: "investigate_alignment".into(),
                targets: vec!["slot_2".into()],
                grant_id: None,
            },
        )
        .await
        .expect_err("two-cycle cooldown should reject before expiry");
        assert_eq!(err, Reject::InvalidTarget);
    }
    let rejected_actions: Vec<_> = eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .filter(|event| event.kind == "ActionSubmitted")
        .filter_map(|event| event.payload["action_id"].as_str().map(str::to_string))
        .filter(|action_id| action_id == "long_cooldown_n02" || action_id == "long_cooldown_n03")
        .collect();
    assert!(
        rejected_actions.is_empty(),
        "blocked long-cooldown submissions must reject before append: {rejected_actions:?}"
    );

    handle(
        &pool,
        &h,
        Command::OpenDayPhase {
            game,
            phase: "N04".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("long_cooldown_user_1"),
        Command::SubmitAction {
            game,
            action_id: "long_cooldown_n04".into(),
            actor_slot: "slot_1".into(),
            template_id: "investigate_alignment".into(),
            targets: vec!["slot_3".into()],
            grant_id: None,
        },
    )
    .await
    .expect("two-cycle cooldown expires on the first matching night after N03");
    handle(&pool, &h, Command::ResolvePhase { game, seed: 8805 })
        .await
        .expect("host resolves expired long-cooldown action");

    let n04_payload = resolution_payload(&pool, game, "N04", 8805).await;
    let n04 = domain::validate_resolution_json(&n04_payload, domain::RESULT_VERSION)
        .expect("long cooldown N04 ResolutionApplied validates");
    assert!(
        n04.events.iter().any(|indexed| matches!(
            &indexed.event,
            domain::InnerEvent::InvestigationResult {
                mode: domain::InvestigateMode::Parity,
                investigator,
                target,
                result,
            } if investigator == "slot_1"
                && target == "slot_3"
                && result == &serde_json::json!("town")
        )),
        "expired long-cooldown action should resolve through Command::ResolvePhase"
    );

    let counters = action_counters(&pool, game).await.unwrap();
    assert!(
        counters.iter().any(|counter| {
            counter.slot_id == "slot_1"
                && counter.counter_id == "cooldown:investigate_alignment"
                && counter.template_id == "investigate_alignment"
                && counter.consumed_action == "long_cooldown_n04"
                && counter.cadence_policy == "cooldown"
                && counter.phase_scope == "phase_kind"
                && counter.limit == 2
                && counter.used == 1
                && counter.remaining == 2
                && counter.phase_id == "N04"
                && counter.phase_kind == "Night"
                && counter.phase_number == 4
        }),
        "expired long-cooldown action should refresh the cooldown counter: {counters:?}"
    );

    let counters_before_rebuild = serde_json::to_string(&counters).unwrap();
    let projection_audit = audit_rebuild(&pool, game)
        .await
        .expect("long-cooldown projection rebuild");
    assert!(
        projection_audit.ok,
        "long-cooldown projection rebuild audit drifted: {projection_audit:?}"
    );
    assert_eq!(
        counters_before_rebuild,
        serde_json::to_string(&action_counters(&pool, game).await.unwrap()).unwrap(),
        "action_counter rebuild should preserve long-cooldown expiry proof"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn action_submission_rejects_disabled_endgame_threshold_before_append(pool: PgPool) {
    let host = "host_h";
    let h = user(host);
    let game = Uuid::new_v4();

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "disabled_endgame_cop"),
        ("slot_2", "user_2", "mafia_goon"),
        ("slot_3", "user_3", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();
    let err = handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "disabled_endgame_cop_n01".into(),
            actor_slot: "slot_1".into(),
            template_id: "investigate_alignment".into(),
            targets: vec!["slot_2".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("disabled-endgame action rejects at configured living threshold");
    assert_eq!(err, Reject::InvalidTarget);
    assert!(
        !eventstore::load_stream(&pool, game)
            .await
            .unwrap()
            .into_iter()
            .any(|event| event.kind == "ActionSubmitted"
                && event.payload["action_id"].as_str() == Some("disabled_endgame_cop_n01")),
        "disabled-endgame rejection must not append ActionSubmitted"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn action_submission_rejects_lost_team_kill_with_teammate_alive(pool: PgPool) {
    let host = "host_h";
    let h = user(host);
    let game = Uuid::new_v4();

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "lost_mafia_goon"),
        ("slot_2", "user_2", "mafia_goon"),
        ("slot_3", "user_3", "vanilla_townie"),
        ("slot_4", "user_4", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();
    let err = handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "lost_factional_n01".into(),
            actor_slot: "slot_1".into(),
            template_id: "factional_kill".into(),
            targets: vec!["slot_3".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("Lost mafia cannot submit team kill while a mafia teammate is alive");
    assert_eq!(err, Reject::InvalidTarget);
    assert!(
        !eventstore::load_stream(&pool, game)
            .await
            .unwrap()
            .into_iter()
            .any(|event| event.kind == "ActionSubmitted"
                && event.payload["action_id"].as_str() == Some("lost_factional_n01")),
        "Lost team-kill rejection must not append ActionSubmitted"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn action_submission_rejects_recluse_team_kill_with_non_recluse_teammate_alive(pool: PgPool) {
    let host = "host_h";
    let h = user(host);
    let game = Uuid::new_v4();

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "recluse_mafia_goon"),
        ("slot_2", "user_2", "mafia_goon"),
        ("slot_3", "user_3", "vanilla_townie"),
        ("slot_4", "user_4", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();
    let err = handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "recluse_factional_n01".into(),
            actor_slot: "slot_1".into(),
            template_id: "factional_kill".into(),
            targets: vec!["slot_3".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err(
        "Recluse mafia cannot submit team kill while a non-Recluse mafia teammate is alive",
    );
    assert_eq!(err, Reject::InvalidTarget);
    assert!(
        !eventstore::load_stream(&pool, game)
            .await
            .unwrap()
            .into_iter()
            .any(|event| event.kind == "ActionSubmitted"
                && event.payload["action_id"].as_str() == Some("recluse_factional_n01")),
        "Recluse team-kill rejection must not append ActionSubmitted"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn action_submission_allows_simultaneous_duplicate_base_template(pool: PgPool) {
    let host = "host_h";
    let h = user(host);
    let game = Uuid::new_v4();

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "simultaneous_vigilante"),
        ("slot_2", "user_2", "mafia_goon"),
        ("slot_3", "user_3", "mafia_goon"),
        ("slot_4", "user_4", "mafia_goon"),
        ("slot_5", "user_5", "vanilla_townie"),
        ("slot_6", "user_6", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "simul_vig_n01_a".into(),
            actor_slot: "slot_1".into(),
            template_id: "night_kill".into(),
            targets: vec!["slot_2".into()],
            grant_id: None,
        },
    )
    .await
    .expect("first Simultaneous action submits");
    handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "simul_vig_n01_b".into(),
            actor_slot: "slot_1".into(),
            template_id: "night_kill".into(),
            targets: vec!["slot_3".into()],
            grant_id: None,
        },
    )
    .await
    .expect("Simultaneous action allows a second active same-template submission");

    let submitted: Vec<_> = eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .filter(|event| {
            event.kind == "ActionSubmitted" && event.payload["phase_id"].as_str() == Some("N01")
        })
        .map(|event| event.payload["action_id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        submitted,
        vec!["simul_vig_n01_a".to_string(), "simul_vig_n01_b".to_string()],
        "both Simultaneous submissions should append"
    );

    handle(&pool, &h, Command::ResolvePhase { game, seed: 8811 })
        .await
        .expect("host resolves Simultaneous duplicate submissions");
    let applied_payload = resolution_payload(&pool, game, "N01", 8811).await;
    let applied = domain::validate_resolution_json(&applied_payload, domain::RESULT_VERSION)
        .expect("Simultaneous ResolutionApplied validates");
    let killed = applied
        .events
        .iter()
        .filter_map(|indexed| match &indexed.event {
            domain::InnerEvent::PlayerKilled { slot_id, cause, .. } => {
                Some((slot_id.as_str(), cause.as_str()))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        killed,
        vec![("slot_2", "night_kill"), ("slot_3", "night_kill")],
        "both Simultaneous night kills should resolve"
    );

    let slots_before = serde_json::to_string(&slot_state(&pool, game).await.unwrap()).unwrap();
    let slots = slot_state(&pool, game).await.unwrap();
    assert!(
        slots
            .iter()
            .any(|slot| slot.slot_id == "slot_2" && !slot.alive)
            && slots
                .iter()
                .any(|slot| slot.slot_id == "slot_3" && !slot.alive),
        "both killed slots should project dead"
    );
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        slots_before,
        serde_json::to_string(&slot_state(&pool, game).await.unwrap()).unwrap(),
        "slot_state rebuild should preserve Simultaneous duplicate kills"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn action_submission_rejects_inactive_novice_and_activated_actions(pool: PgPool) {
    let host = "host_h";
    let h = user(host);
    let game = Uuid::new_v4();

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "novice_cop"),
        ("slot_2", "user_2", "activated_cop"),
        ("slot_3", "user_3", "mafia_goon"),
        ("slot_4", "user_4", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();
    for (user_id, actor_slot, action_id) in [
        ("user_1", "slot_1", "novice_cop_n01"),
        ("user_2", "slot_2", "activated_cop_n01"),
    ] {
        let err = handle(
            &pool,
            &user(user_id),
            Command::SubmitAction {
                game,
                action_id: action_id.into(),
                actor_slot: actor_slot.into(),
                template_id: "investigate_alignment".into(),
                targets: vec!["slot_3".into()],
                grant_id: None,
            },
        )
        .await
        .expect_err("activation-gated action cannot submit before active_from threshold");
        assert_eq!(err, Reject::InvalidTarget);
    }
    assert!(
        eventstore::load_stream(&pool, game)
            .await
            .unwrap()
            .into_iter()
            .filter(|event| event.kind == "ActionSubmitted")
            .all(|event| event.payload["phase_id"].as_str() != Some("N01")),
        "pre-activation rejects must not append ActionSubmitted events"
    );

    handle(
        &pool,
        &h,
        Command::OpenDayPhase {
            game,
            phase: "N02".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "novice_cop_n02".into(),
            actor_slot: "slot_1".into(),
            template_id: "investigate_alignment".into(),
            targets: vec!["slot_3".into()],
            grant_id: None,
        },
    )
    .await
    .expect("novice action is valid once active");
    handle(
        &pool,
        &user("user_2"),
        Command::SubmitAction {
            game,
            action_id: "activated_cop_n02".into(),
            actor_slot: "slot_2".into(),
            template_id: "investigate_alignment".into(),
            targets: vec!["slot_4".into()],
            grant_id: None,
        },
    )
    .await
    .expect("activated action is valid once active");

    let submitted: Vec<_> = eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .filter(|event| {
            event.kind == "ActionSubmitted" && event.payload["phase_id"].as_str() == Some("N02")
        })
        .map(|event| event.payload["action_id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        submitted,
        vec![
            "novice_cop_n02".to_string(),
            "activated_cop_n02".to_string()
        ],
        "active novice/activated gates should permit N02 submissions"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn action_submission_spends_explicit_extra_action_grant(pool: PgPool) {
    let host = "host_h";
    let h = user(host);
    let game = Uuid::new_v4();

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "motivator"),
        ("slot_2", "user_2", "cop"),
        ("slot_3", "user_3", "mafia_goon"),
        ("slot_4", "user_4", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "motivate_n01".into(),
            actor_slot: "slot_1".into(),
            template_id: "motivate".into(),
            targets: vec!["slot_2".into()],
            grant_id: None,
        },
    )
    .await
    .expect("motivator submits grant action");
    handle(&pool, &h, Command::ResolvePhase { game, seed: 8811 })
        .await
        .expect("host resolves grant");

    handle(
        &pool,
        &h,
        Command::OpenDayPhase {
            game,
            phase: "N02".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_2"),
        Command::SubmitAction {
            game,
            action_id: "cop_base_n02".into(),
            actor_slot: "slot_2".into(),
            template_id: "cop_investigate".into(),
            targets: vec!["slot_3".into()],
            grant_id: None,
        },
    )
    .await
    .expect("base action is valid");

    let err = handle(
        &pool,
        &user("user_2"),
        Command::SubmitAction {
            game,
            action_id: "cop_duplicate_n02".into(),
            actor_slot: "slot_2".into(),
            template_id: "cop_investigate".into(),
            targets: vec!["slot_4".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("duplicate base action requires explicit grant spend");
    assert_eq!(err, Reject::ActionAlreadySubmitted);

    handle(
        &pool,
        &user("user_2"),
        Command::SubmitAction {
            game,
            action_id: "cop_extra_n02".into(),
            actor_slot: "slot_2".into(),
            template_id: "cop_investigate".into(),
            targets: vec!["slot_4".into()],
            grant_id: Some("extra_action".into()),
        },
    )
    .await
    .expect("extra action grant permits one additional submission");

    let err = handle(
        &pool,
        &user("user_2"),
        Command::SubmitAction {
            game,
            action_id: "cop_extra_again_n02".into(),
            actor_slot: "slot_2".into(),
            template_id: "cop_investigate".into(),
            targets: vec!["slot_4".into()],
            grant_id: Some("extra_action".into()),
        },
    )
    .await
    .expect_err("single-use extra action grant cannot be overspent in a phase");
    assert_eq!(err, Reject::InvalidTarget);

    let submitted: Vec<_> = eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .filter(|event| {
            event.kind == "ActionSubmitted" && event.payload["phase_id"].as_str() == Some("N02")
        })
        .map(|event| {
            (
                event.payload["action_id"].as_str().unwrap().to_string(),
                event.payload["grant_id"].as_str().map(str::to_string),
            )
        })
        .collect();
    assert_eq!(
        submitted,
        vec![
            ("cop_base_n02".to_string(), None),
            (
                "cop_extra_n02".to_string(),
                Some("extra_action".to_string())
            ),
        ],
        "only the base action and one explicit grant-spend action are persisted"
    );

    handle(&pool, &h, Command::ResolvePhase { game, seed: 8812 })
        .await
        .expect("host resolves base plus extra action");
    let payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied' \
         AND payload->>'phase_id' = 'N02'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let applied: domain::ResolutionApplied = serde_json::from_value(payload).unwrap();
    assert!(
        applied.events.iter().any(|indexed| {
            matches!(
                &indexed.event,
                domain::InnerEvent::ActionGrantConsumed {
                    grant_id,
                    actor,
                    action_id,
                    source_action,
                    remaining_uses,
                    ..
                } if grant_id == "extra_action"
                    && actor == "slot_2"
                    && action_id == "cop_extra_n02"
                    && source_action == "motivate_n01"
                    && *remaining_uses == 0
            )
        }),
        "ResolvePhase records durable extra-action grant consumption"
    );
    let trace_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionTrace' \
         AND payload->>'phase_id' = 'N02'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        trace_payload["generated"]
            .as_array()
            .expect("generated trace rows")
            .iter()
            .any(|row| row["action_id"] == "cop_extra_n02"
                && row["source"] == "ActionGrantConsumed"
                && row["detail"]["grant_id"] == "extra_action"
                && row["detail"]["source_action"] == "motivate_n01"),
        "ResolutionTrace.generated must preserve ActionGrantConsumed source_action"
    );
    let results = applied
        .events
        .iter()
        .filter(|indexed| {
            matches!(&indexed.event, domain::InnerEvent::InvestigationResult { investigator, .. }
                if investigator == "slot_2")
        })
        .count();
    assert_eq!(
        results, 2,
        "ResolvePhase consumes the granted extra submission"
    );
    let grants = action_grants(&pool, game).await.unwrap();
    assert_eq!(grants.len(), 1);
    assert_eq!(grants[0].grant_id, "extra_action");
    assert_eq!(
        grants[0].uses, 0,
        "ActionGrantConsumed decrements the projected remaining uses"
    );

    handle(
        &pool,
        &h,
        Command::OpenDayPhase {
            game,
            phase: "N03".into(),
        },
    )
    .await
    .unwrap();
    let err = handle(
        &pool,
        &user("user_2"),
        Command::SubmitAction {
            game,
            action_id: "cop_extra_n03".into(),
            actor_slot: "slot_2".into(),
            template_id: "cop_investigate".into(),
            targets: vec!["slot_3".into()],
            grant_id: Some("extra_action".into()),
        },
    )
    .await
    .expect_err("consumed extra-action grant cannot be reused next phase");
    assert_eq!(err, Reject::InvalidTarget);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn action_submission_spends_inventor_item_grant(pool: PgPool) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "inventor"),
        ("slot_2", "user_2", "vanilla_townie"),
        ("slot_3", "user_3", "mafia_goon"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "invent_n01".into(),
            actor_slot: "slot_1".into(),
            template_id: "grant_item".into(),
            targets: vec!["slot_2".into()],
            grant_id: None,
        },
    )
    .await
    .expect("inventor grants a single-use item");
    handle(&pool, &h, Command::ResolvePhase { game, seed: 9911 })
        .await
        .expect("host resolves item grant");

    let grants = action_grants(&pool, game).await.unwrap();
    assert_eq!(grants.len(), 1);
    assert_eq!(grants[0].grant_id, "single_use_item");
    assert_eq!(grants[0].kind, "Item");
    assert_eq!(grants[0].slot_id, "slot_2");
    assert_eq!(grants[0].source_slot, "slot_1");
    assert_eq!(grants[0].source_action, "invent_n01");
    assert_eq!(grants[0].uses, 1);

    handle(
        &pool,
        &h,
        Command::OpenDayPhase {
            game,
            phase: "N02".into(),
        },
    )
    .await
    .unwrap();

    let err = handle(
        &pool,
        &user("user_2"),
        Command::SubmitAction {
            game,
            action_id: "item_missing_grant_n02".into(),
            actor_slot: "slot_2".into(),
            template_id: "single_use_item".into(),
            targets: vec!["slot_3".into()],
            grant_id: None,
        },
    )
    .await
    .expect_err("item action requires an explicit matching item grant");
    assert_eq!(err, Reject::InvalidTarget);

    handle(
        &pool,
        &user("user_2"),
        Command::SubmitAction {
            game,
            action_id: "item_investigate_n02".into(),
            actor_slot: "slot_2".into(),
            template_id: "single_use_item".into(),
            targets: vec!["slot_3".into()],
            grant_id: Some("single_use_item".into()),
        },
    )
    .await
    .expect("single-use item permits its generated action");

    handle(&pool, &h, Command::ResolvePhase { game, seed: 9912 })
        .await
        .expect("host resolves item use");
    let payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied' \
         AND payload->>'phase_id' = 'N02'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let applied: domain::ResolutionApplied = serde_json::from_value(payload).unwrap();
    assert!(
        applied.events.iter().any(|indexed| {
            matches!(
                &indexed.event,
                domain::InnerEvent::ActionGrantConsumed {
                    grant_id,
                    actor,
                    action_id,
                    source_action,
                    remaining_uses,
                    ..
                } if grant_id == "single_use_item"
                    && actor == "slot_2"
                    && action_id == "item_investigate_n02"
                    && source_action == "invent_n01"
                    && *remaining_uses == 0
            )
        }),
        "ResolvePhase records durable item grant consumption"
    );
    assert!(
        applied.events.iter().any(|indexed| {
            matches!(
                &indexed.event,
                domain::InnerEvent::ActionUseCounted {
                    counter_id,
                    actor,
                    template_id,
                    consumed_action,
                    cadence_policy,
                    phase_scope,
                    remaining,
                    ..
                } if counter_id == "inventory:single_use_item"
                    && actor == "slot_2"
                    && template_id == "single_use_item"
                    && consumed_action == "item_investigate_n02"
                    && cadence_policy == "inventory"
                    && phase_scope == "grant"
                    && *remaining == 0
            )
        }),
        "ResolvePhase records typed inventory counter consumption"
    );
    assert!(
        applied.events.iter().any(|indexed| {
            matches!(
                &indexed.event,
                domain::InnerEvent::InvestigationResult {
                    investigator,
                    target,
                    result,
                    ..
                } if investigator == "slot_2" && target == "slot_3" && result == "scum"
            )
        }),
        "the generated item action resolves through the pure engine"
    );
    let grants = action_grants(&pool, game).await.unwrap();
    assert_eq!(grants.len(), 1);
    assert_eq!(grants[0].source_action, "invent_n01");
    assert_eq!(
        grants[0].uses, 0,
        "ActionGrantConsumed decrements the projected item"
    );
    let counters = action_counters(&pool, game).await.unwrap();
    assert!(counters.iter().any(|counter| {
        counter.slot_id == "slot_2"
            && counter.counter_id == "inventory:single_use_item"
            && counter.template_id == "single_use_item"
            && counter.consumed_action == "item_investigate_n02"
            && counter.cadence_policy == "inventory"
            && counter.phase_scope == "grant"
            && counter.remaining == 0
    }));

    let grants_before = serde_json::to_string(&grants).unwrap();
    let counters_before = serde_json::to_string(&counters).unwrap();
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        grants_before,
        serde_json::to_string(&action_grants(&pool, game).await.unwrap()).unwrap(),
        "action_grant rebuild should preserve generated item consumption"
    );
    assert_eq!(
        counters_before,
        serde_json::to_string(&action_counters(&pool, game).await.unwrap()).unwrap(),
        "action_counter rebuild should preserve generated item inventory consumption"
    );

    handle(
        &pool,
        &h,
        Command::OpenDayPhase {
            game,
            phase: "N03".into(),
        },
    )
    .await
    .unwrap();
    let err = handle(
        &pool,
        &user("user_2"),
        Command::SubmitAction {
            game,
            action_id: "item_reuse_n03".into(),
            actor_slot: "slot_2".into(),
            template_id: "single_use_item".into(),
            targets: vec!["slot_3".into()],
            grant_id: Some("single_use_item".into()),
        },
    )
    .await
    .expect_err("consumed item grant cannot be reused");
    assert_eq!(err, Reject::InvalidTarget);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn inventor_vest_item_marks_and_consumes_bulletproof_vest(pool: PgPool) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "inventor"),
        ("slot_2", "user_2", "vanilla_townie"),
        ("slot_3", "user_3", "mafia_goon"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: "grant_vest_n01".into(),
            actor_slot: "slot_1".into(),
            template_id: "grant_vest_item".into(),
            targets: vec!["slot_2".into()],
            grant_id: None,
        },
    )
    .await
    .expect("inventor grants a vest item");
    handle(&pool, &h, Command::ResolvePhase { game, seed: 9921 })
        .await
        .expect("host resolves vest item grant");

    handle(
        &pool,
        &h,
        Command::OpenDayPhase {
            game,
            phase: "N02".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_2"),
        Command::SubmitAction {
            game,
            action_id: "use_vest_n02".into(),
            actor_slot: "slot_2".into(),
            template_id: "bulletproof_vest_item".into(),
            targets: vec!["slot_2".into()],
            grant_id: Some("bulletproof_vest_item".into()),
        },
    )
    .await
    .expect("generated vest item marks the actor");
    handle(&pool, &h, Command::ResolvePhase { game, seed: 9922 })
        .await
        .expect("host resolves vest item use");

    let n02_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied' \
         AND payload->>'phase_id' = 'N02'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let n02 = domain::validate_resolution_json(&n02_payload, domain::RESULT_VERSION).unwrap();
    assert!(n02.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::ActionGrantConsumed {
            grant_id,
            actor,
            action_id,
            source_action,
            remaining_uses,
            ..
        } if grant_id == "bulletproof_vest_item"
            && actor == "slot_2"
            && action_id == "use_vest_n02"
            && source_action == "grant_vest_n01"
            && *remaining_uses == 0
    )));
    assert!(n02.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::EffectsMarked {
            effect,
            target,
            actor,
            ..
        }
            if effect == "bulletproof_vest" && target == "slot_2" && actor == "slot_2"
    )));

    let notifications = player_notifications(&pool, game).await.unwrap();
    assert!(
        notifications.iter().any(|notice| notice.phase_id == "N02"
            && notice.audience_slot == "slot_2"
            && notice.effect == "bulletproof_vest"
            && notice.status == "marked"),
        "vest item mark should notify the recipient"
    );
    assert!(
        slot_effects(&pool, game)
            .await
            .unwrap()
            .iter()
            .any(|effect| effect.slot_id == "slot_2" && effect.effect == "bulletproof_vest"),
        "vest item mark should persist into projection state"
    );
    assert_eq!(
        action_grants(&pool, game).await.unwrap()[0].uses,
        0,
        "vest item grant is consumed once it is used"
    );

    handle(
        &pool,
        &h,
        Command::OpenDayPhase {
            game,
            phase: "N03".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_3"),
        Command::SubmitAction {
            game,
            action_id: "mafia_kill_n03".into(),
            actor_slot: "slot_3".into(),
            template_id: "factional_kill".into(),
            targets: vec!["slot_2".into()],
            grant_id: None,
        },
    )
    .await
    .expect("mafia submits the kill that should hit the vest");
    handle(&pool, &h, Command::ResolvePhase { game, seed: 9923 })
        .await
        .expect("host resolves vest save");

    let n03_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied' \
         AND payload->>'phase_id' = 'N03'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let n03 = domain::validate_resolution_json(&n03_payload, domain::RESULT_VERSION).unwrap();
    assert!(n03.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerSaved { slot_id, reasons, sources }
            if slot_id == "slot_2"
                && reasons == &vec!["bulletproof_vest".to_string()]
                && sources == &vec!["slot_2".to_string()]
    )));
    assert!(n03.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::EffectsCleared { effect, targets, actor, .. }
            if effect == "bulletproof_vest"
                && targets == &vec!["slot_2".to_string()]
                && actor == "slot_2"
    )));
    assert!(n03.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::ActionUseCounted {
            counter_id,
            actor,
            template_id,
            consumed_action,
            cadence_policy,
            phase_scope,
            remaining,
            ..
        } if counter_id == "shield:bulletproof_vest"
            && actor == "slot_2"
            && template_id == "bulletproof_vest"
            && consumed_action == "factional_kill"
            && cadence_policy == "shield"
            && phase_scope == "effect"
            && *remaining == 0
    )));
    assert!(
        slot_state(&pool, game)
            .await
            .unwrap()
            .iter()
            .any(|slot| slot.slot_id == "slot_2" && slot.alive),
        "vest should save slot_2 from the kill"
    );
    let before_rebuild = slot_effects(&pool, game).await.unwrap();
    assert!(
        !before_rebuild
            .iter()
            .any(|effect| effect.slot_id == "slot_2" && effect.effect == "bulletproof_vest"),
        "vest save should consume the projected vest effect"
    );
    let before_counter_rebuild = action_counters(&pool, game).await.unwrap();
    assert!(
        before_counter_rebuild
            .iter()
            .any(|counter| counter.slot_id == "slot_2"
                && counter.counter_id == "shield:bulletproof_vest"
                && counter.template_id == "bulletproof_vest"
                && counter.consumed_action == "factional_kill"
                && counter.cadence_policy == "shield"
                && counter.phase_scope == "effect"
                && counter.remaining == 0),
        "vest save should record typed shield consumption"
    );
    let before_json = serde_json::to_string(&before_rebuild).unwrap();
    let before_counter_json = serde_json::to_string(&before_counter_rebuild).unwrap();
    let before_notifications = player_notifications(&pool, game).await.unwrap();
    assert!(
        before_notifications.iter().all(|notice| {
            notice.phase_id != "N03"
                || notice.effect != "bulletproof_vest"
                || notice.status != "cleared"
        }),
        "automatic vest save must consume the vest without emitting a private clear notice"
    );
    assert!(
        player_notifications_for_slot(&pool, game, "slot_3")
            .await
            .unwrap()
            .iter()
            .all(|notice| notice.effect != "bulletproof_vest"),
        "the attacker must not receive the target's private vest notices"
    );
    rebuild(&pool, game).await.unwrap();
    assert_eq!(
        before_json,
        serde_json::to_string(&slot_effects(&pool, game).await.unwrap()).unwrap(),
        "slot_effect rebuild should preserve generated vest consumption"
    );
    assert_eq!(
        before_counter_json,
        serde_json::to_string(&action_counters(&pool, game).await.unwrap()).unwrap(),
        "action_counter rebuild should preserve generated vest shield consumption"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn resolution_scoped_effects_do_not_enter_command_snapshot(pool: PgPool) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, role) in [
        ("slot_1", "fruit_vendor"),
        ("slot_2", "vanilla_townie"),
        ("slot_3", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();

    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "EffectsMarked",
            1,
            serde_json::json!({
                "effect": "fruit_received",
                "target": "slot_2",
                "actor": "slot_1",
                "source_action": "fixture:send_fruit_n01",
                "phase_id": "N01",
                "phase_kind": "Night",
                "phase_number": 1,
                "duration": "Resolution",
                "visibility": "Target"
            }),
            ActorId::Host,
            0,
        )],
    )
    .await
    .unwrap();

    let snapshot = load_engine_snapshot(&pool, game, "N01")
        .await
        .expect("load snapshot after resolution-scoped fixture mark");
    let slot = snapshot
        .slots
        .iter()
        .find(|slot| slot.slot_id == "slot_2")
        .expect("slot_2 snapshot");
    assert!(
        slot.effects.is_empty(),
        "resolution-scoped EffectsMarked must expire before command snapshot tag state"
    );
    assert!(
        snapshot.effect_records.is_empty(),
        "resolution-scoped EffectsMarked must expire before command snapshot metadata state"
    );
    assert!(
        slot_effects(&pool, game).await.unwrap().is_empty(),
        "resolution-scoped EffectsMarked must not project as durable slot_effect"
    );

    rebuild(&pool, game)
        .await
        .expect("projection rebuild after resolution-scoped fixture mark");
    assert!(
        slot_effects(&pool, game).await.unwrap().is_empty(),
        "slot_effect rebuild must preserve resolution-scoped expiry"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn non_occupant_voting_as_slot_is_not_your_slot(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    handle(
        &pool,
        &user("host_h"),
        Command::AddSlot {
            game,
            slot: "slot_2".into(),
        },
    )
    .await
    .unwrap();

    // user_b is not the occupant of slot_1.
    let err = handle(
        &pool,
        &user("user_b"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .expect_err("non-occupant cannot vote as the slot");
    assert_eq!(err, Reject::NotYourSlot);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vote_in_locked_phase_is_phase_locked(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    add_vanilla_slot(&pool, game, "host_h", "slot_2").await;

    // Host locks the thread.
    handle(&pool, &user("host_h"), Command::LockThread { game })
        .await
        .expect("lock");

    let err = handle(
        &pool,
        &user("user_a"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .expect_err("vote in locked phase rejected");
    assert_eq!(err, Reject::PhaseLocked);

    // Unlock → the same vote now acks.
    handle(&pool, &user("host_h"), Command::UnlockThread { game })
        .await
        .unwrap();
    handle(
        &pool,
        &user("user_a"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .expect("vote after unlock");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn stale_host_phase_controls_reject_before_duplicate_lifecycle_events(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let host = user("host_h");

    handle(&pool, &host, Command::LockThread { game })
        .await
        .expect("initial lock");
    let duplicate_lock = handle(&pool, &host, Command::LockThread { game })
        .await
        .expect_err("stale lock control rejects once phase is already locked");
    assert_eq!(duplicate_lock, Reject::PhaseLocked);

    let locked_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM events WHERE stream_id = $1 AND kind = 'ThreadLocked'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        locked_count, 1,
        "stale lock rejection must not append a duplicate ThreadLocked event"
    );
    assert!(
        phase_state(&pool, game).await.unwrap().unwrap().locked,
        "stale lock rejection must preserve the locked projection"
    );

    handle(&pool, &host, Command::UnlockThread { game })
        .await
        .expect("unlock");
    let duplicate_unlock = handle(&pool, &host, Command::UnlockThread { game })
        .await
        .expect_err("stale unlock control rejects once phase is open");
    assert_eq!(duplicate_unlock, Reject::PhaseLocked);

    let unlocked_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM events WHERE stream_id = $1 AND kind = 'ThreadUnlocked'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        unlocked_count, 1,
        "stale unlock rejection must not append a duplicate ThreadUnlocked event"
    );
    assert!(
        !phase_state(&pool, game).await.unwrap().unwrap().locked,
        "stale unlock rejection must preserve the open projection"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn concurrent_host_resolve_phase_serializes_to_one_ack(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let host = user("host_h");

    let (first, second) = tokio::join!(
        handle(&pool, &host, Command::ResolvePhase { game, seed: 71_001 },),
        handle(&pool, &host, Command::ResolvePhase { game, seed: 71_002 },),
    );

    let results = [first, second];
    let ack_count = results.iter().filter(|result| result.is_ok()).count();
    let phase_locked_count = results
        .iter()
        .filter(|result| matches!(result, Err(Reject::PhaseLocked)))
        .count();
    assert_eq!(ack_count, 1, "exactly one concurrent resolve should ACK");
    assert_eq!(
        phase_locked_count, 1,
        "the losing concurrent resolve should revalidate after the winner locks"
    );

    let resolution_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        resolution_count, 1,
        "concurrent resolve must not append duplicate resolution envelopes"
    );

    let lock_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM events WHERE stream_id = $1 AND kind = 'ThreadLocked'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        lock_count, 1,
        "concurrent resolve must not append duplicate phase locks"
    );
    assert!(
        phase_state(&pool, game).await.unwrap().unwrap().locked,
        "winning resolve should leave the phase locked"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn concurrent_player_vote_and_host_resolve_phase_serializes_vote_before_resolution(
    pool: PgPool,
) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    add_vanilla_slot(&pool, game, "host_h", "slot_2").await;

    let lock_key = 41_006_i64;
    install_vote_insert_blocker(&pool, game, lock_key).await;
    let mut blocker = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(lock_key)
        .execute(&mut *blocker)
        .await
        .unwrap();

    let vote_pool = pool.clone();
    let vote = tokio::spawn(async move {
        handle(
            &vote_pool,
            &user("user_a"),
            Command::SubmitVote {
                game,
                actor_slot: "slot_1".into(),
                target: VoteTarget::Slot("slot_2".into()),
            },
        )
        .await
    });
    wait_for_advisory_wait_count(&pool, 1).await;

    let resolve_pool = pool.clone();
    let resolve = tokio::spawn(async move {
        handle(
            &resolve_pool,
            &user("host_h"),
            Command::ResolvePhase { game, seed: 71_003 },
        )
        .await
    });
    tokio::time::sleep(Duration::from_millis(100)).await;

    sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(lock_key)
        .execute(&mut *blocker)
        .await
        .unwrap();

    let vote = vote
        .await
        .unwrap()
        .expect("vote wins the phase boundary first");
    let resolve = resolve
        .await
        .unwrap()
        .expect("resolve runs after the racing vote commits");
    assert_eq!(vote.stream_seqs.len(), 1);
    assert!(
        resolve.stream_seqs.len() >= 3,
        "resolve appends resolution envelopes and a phase lock"
    );
    assert!(
        vote.stream_seqs[0] < resolve.stream_seqs[0],
        "vote must serialize before the phase resolution starts"
    );

    let events = eventstore::load_stream(&pool, game)
        .await
        .expect("load event stream");
    let vote_seq = events
        .iter()
        .find(|event| event.kind == "VoteSubmitted")
        .expect("vote event")
        .stream_seq;
    let resolution_seq = events
        .iter()
        .find(|event| event.kind == "ResolutionApplied")
        .expect("resolution event")
        .stream_seq;
    let lock_seq = events
        .iter()
        .find(|event| event.kind == "ThreadLocked")
        .expect("thread lock event")
        .stream_seq;
    assert!(
        vote_seq < resolution_seq && resolution_seq < lock_seq,
        "racing vote must be part of the resolved phase, not appended after closure"
    );

    let outcomes = day_vote_outcomes(&pool, game)
        .await
        .expect("day vote outcome projection");
    assert_eq!(outcomes.len(), 1);
    assert_eq!(outcomes[0].votes["slot_1"], "slot_2");
    assert!(
        phase_state(&pool, game).await.unwrap().unwrap().locked,
        "resolve should leave the phase locked"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn concurrent_cohost_deadline_and_host_resolve_phase_serializes_deadline_before_resolution(
    pool: PgPool,
) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    handle(
        &pool,
        &user("host_h"),
        Command::AddCohost {
            game,
            user: "cohost_c".into(),
        },
    )
    .await
    .expect("delegate cohost deadline authority");

    let lock_key = 41_007_i64;
    install_deadline_insert_blocker(&pool, game, lock_key).await;
    let mut blocker = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(lock_key)
        .execute(&mut *blocker)
        .await
        .unwrap();

    let deadline_pool = pool.clone();
    let deadline = tokio::spawn(async move {
        handle(
            &deadline_pool,
            &user("cohost_c"),
            Command::ExtendDeadline {
                game,
                phase: "D01".into(),
                at: 72_501,
            },
        )
        .await
    });
    wait_for_advisory_wait_count(&pool, 1).await;

    let resolve_pool = pool.clone();
    let resolve = tokio::spawn(async move {
        handle(
            &resolve_pool,
            &user("host_h"),
            Command::ResolvePhase { game, seed: 72_502 },
        )
        .await
    });
    tokio::time::sleep(Duration::from_millis(100)).await;

    sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(lock_key)
        .execute(&mut *blocker)
        .await
        .unwrap();

    let deadline = deadline
        .await
        .unwrap()
        .expect("deadline extension wins the phase boundary first");
    let resolve = resolve
        .await
        .unwrap()
        .expect("resolve runs after the racing deadline commits");
    assert_eq!(deadline.stream_seqs.len(), 1);
    assert!(
        resolve.stream_seqs.len() >= 3,
        "resolve appends resolution envelopes and a phase lock"
    );
    assert!(
        deadline.stream_seqs[0] < resolve.stream_seqs[0],
        "deadline must serialize before the phase resolution starts"
    );

    let events = eventstore::load_stream(&pool, game)
        .await
        .expect("load event stream");
    let deadline_seq = events
        .iter()
        .find(|event| event.kind == "DeadlineExtended")
        .expect("deadline event")
        .stream_seq;
    let resolution_seq = events
        .iter()
        .find(|event| event.kind == "ResolutionApplied")
        .expect("resolution event")
        .stream_seq;
    let lock_seq = events
        .iter()
        .find(|event| event.kind == "ThreadLocked")
        .expect("thread lock event")
        .stream_seq;
    assert!(
        deadline_seq < resolution_seq && resolution_seq < lock_seq,
        "racing deadline extension must be part of the phase before resolution closes it"
    );

    let phase = phase_state(&pool, game).await.unwrap().unwrap();
    assert_eq!(phase.phase_id, "D01");
    assert!(phase.locked);
    assert_eq!(
        phase.deadline,
        Some(72_501),
        "locked phase should retain the serialized deadline extension"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn concurrent_host_advance_phase_serializes_to_one_ack(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let host = user("host_h");
    handle(&pool, &host, Command::ResolvePhase { game, seed: 72_001 })
        .await
        .expect("resolve D01 before racing advance");

    let (first, second) = tokio::join!(
        handle(&pool, &host, Command::AdvancePhase { game }),
        handle(&pool, &host, Command::AdvancePhase { game }),
    );

    let results = [first, second];
    let ack_count = results.iter().filter(|result| result.is_ok()).count();
    let invalid_target_count = results
        .iter()
        .filter(|result| matches!(result, Err(Reject::InvalidTarget)))
        .count();
    assert_eq!(ack_count, 1, "exactly one concurrent advance should ACK");
    assert_eq!(
        invalid_target_count, 1,
        "the losing concurrent advance should revalidate after the winner advances"
    );

    let advance_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM events WHERE stream_id = $1 AND kind = 'PhaseAdvanced' \
         AND payload->>'source_phase_id' = 'D01'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        advance_count, 1,
        "concurrent advance must not append duplicate phase transitions"
    );

    let phase = phase_state(&pool, game).await.unwrap().unwrap();
    assert_eq!(phase.phase_id, "N01");
    assert!(
        !phase.locked,
        "winning advance should leave the next phase open"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn concurrent_host_deadline_advance_serializes_to_one_ack(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let host = user("host_h");
    handle(
        &pool,
        &host,
        Command::ExtendDeadline {
            game,
            phase: "D01".into(),
            at: 100,
        },
    )
    .await
    .expect("set D01 deadline before racing deadline advance");
    handle(&pool, &host, Command::ResolvePhase { game, seed: 72_101 })
        .await
        .expect("resolve D01 before racing deadline advance");

    let (first, second) = tokio::join!(
        handle(
            &pool,
            &host,
            Command::AdvancePhaseByDeadline {
                game,
                phase: "D01".into(),
                observed_at: 101,
            },
        ),
        handle(
            &pool,
            &host,
            Command::AdvancePhaseByDeadline {
                game,
                phase: "D01".into(),
                observed_at: 101,
            },
        ),
    );

    let results = [first, second];
    let ack_count = results.iter().filter(|result| result.is_ok()).count();
    let invalid_target_count = results
        .iter()
        .filter(|result| matches!(result, Err(Reject::InvalidTarget)))
        .count();
    assert_eq!(
        ack_count, 1,
        "exactly one concurrent deadline advance should ACK"
    );
    assert_eq!(
        invalid_target_count, 1,
        "the losing concurrent deadline advance should revalidate after the winner advances"
    );
    let ack = results
        .iter()
        .find_map(|result| result.as_ref().ok())
        .expect("one deadline advance ACK");
    assert_eq!(
        ack.stream_seqs.len(),
        2,
        "deadline advance appends elapsed evidence plus the phase transition atomically"
    );

    let deadline_evidence_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM events WHERE stream_id = $1 AND kind = 'PhaseDeadlineElapsed' \
         AND payload->>'phase_id' = 'D01'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        deadline_evidence_count, 1,
        "concurrent deadline advance must not append duplicate deadline evidence"
    );
    let advance_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM events WHERE stream_id = $1 AND kind = 'PhaseAdvanced' \
         AND payload->>'source_phase_id' = 'D01' \
         AND payload->>'reason' = 'deadline_elapsed'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        advance_count, 1,
        "concurrent deadline advance must not append duplicate phase transitions"
    );

    let phase = phase_state(&pool, game).await.unwrap().unwrap();
    assert_eq!(phase.phase_id, "N01");
    assert!(
        !phase.locked,
        "winning deadline advance should leave the next phase open"
    );
    assert_eq!(
        phase.deadline, None,
        "deadline-derived advance must clear the phase deadline on the next phase"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn concurrent_host_mixed_advance_serializes_to_one_ack(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let host = user("host_h");
    handle(
        &pool,
        &host,
        Command::ExtendDeadline {
            game,
            phase: "D01".into(),
            at: 100,
        },
    )
    .await
    .expect("set D01 deadline before racing mixed advance");
    handle(&pool, &host, Command::ResolvePhase { game, seed: 72_201 })
        .await
        .expect("resolve D01 before racing mixed advance");

    let (normal, deadline) = tokio::join!(
        handle(&pool, &host, Command::AdvancePhase { game }),
        handle(
            &pool,
            &host,
            Command::AdvancePhaseByDeadline {
                game,
                phase: "D01".into(),
                observed_at: 101,
            },
        ),
    );

    let results = [normal, deadline];
    let ack_count = results.iter().filter(|result| result.is_ok()).count();
    let invalid_target_count = results
        .iter()
        .filter(|result| matches!(result, Err(Reject::InvalidTarget)))
        .count();
    assert_eq!(
        ack_count, 1,
        "exactly one mixed normal/deadline advance should ACK"
    );
    assert_eq!(
        invalid_target_count, 1,
        "the losing mixed normal/deadline advance should revalidate after the winner advances"
    );
    let ack = results
        .iter()
        .find_map(|result| result.as_ref().ok())
        .expect("one mixed advance ACK");
    assert!(
        ack.stream_seqs.len() == 1 || ack.stream_seqs.len() == 2,
        "mixed advance winner appends either a normal phase advance or deadline evidence plus phase advance"
    );

    let deadline_evidence_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM events WHERE stream_id = $1 AND kind = 'PhaseDeadlineElapsed' \
         AND payload->>'phase_id' = 'D01'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        deadline_evidence_count <= 1,
        "mixed normal/deadline advance must not append duplicate deadline evidence"
    );
    let advance_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM events WHERE stream_id = $1 AND kind = 'PhaseAdvanced' \
         AND payload->>'source_phase_id' = 'D01'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        advance_count, 1,
        "mixed normal/deadline advance must not append duplicate phase transitions"
    );

    let phase = phase_state(&pool, game).await.unwrap().unwrap();
    assert_eq!(phase.phase_id, "N01");
    assert!(
        !phase.locked,
        "winning mixed advance should leave the next phase open"
    );
    assert_eq!(
        phase.deadline, None,
        "mixed advance must clear the old phase deadline on the next phase"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn concurrent_player_action_and_host_advance_phase_rejects_late_action(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let host = user("host_h");
    for (slot, occupant, role) in [
        ("slot_4", "action-goon", "mafia_goon"),
        ("slot-2", "town-target-2", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &host,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &host,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .expect("start directly in N01");
    handle(&pool, &host, Command::ResolvePhase { game, seed: 72_301 })
        .await
        .expect("lock N01 before racing stale player action against advance");

    let action_pool = pool.clone();
    let action = tokio::spawn(async move {
        handle(
            &action_pool,
            &user("action-goon"),
            Command::SubmitAction {
                game,
                action_id: "late_night_action".into(),
                actor_slot: "slot_4".into(),
                template_id: "factional_kill".into(),
                targets: vec!["slot-2".into()],
                grant_id: None,
            },
        )
        .await
    });
    let advance_pool = pool.clone();
    let advance = tokio::spawn(async move {
        handle(
            &advance_pool,
            &user("host_h"),
            Command::AdvancePhase { game },
        )
        .await
    });

    let action = action
        .await
        .unwrap()
        .expect_err("late action must reject while the host advances the phase");
    assert!(
        matches!(action, Reject::PhaseLocked | Reject::InvalidTarget),
        "late action should refresh against either locked N01 or current D02"
    );
    let advance = advance
        .await
        .unwrap()
        .expect("host phase advance wins the transition");
    assert_eq!(advance.stream_seqs.len(), 1);

    let phase = phase_state(&pool, game).await.unwrap().unwrap();
    assert_eq!(phase.phase_id, "D02");
    assert!(
        !phase.locked,
        "host advance should leave the next day phase open"
    );
    let late_action_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM events WHERE stream_id = $1 AND kind = 'ActionSubmitted' \
         AND payload->>'action_id' = 'late_night_action'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        late_action_count, 0,
        "stale player action must not append into the old phase while host advances"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn duplicate_add_slot_rejects_without_duplicate_event(pool: PgPool) {
    let game = Uuid::new_v4();
    let host = user("host_h");
    handle(
        &pool,
        &host,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .expect("create setup game");

    handle(
        &pool,
        &host,
        Command::AddSlot {
            game,
            slot: "slot_extra".into(),
        },
    )
    .await
    .expect("initial slot add");
    let duplicate = handle(
        &pool,
        &host,
        Command::AddSlot {
            game,
            slot: "slot_extra".into(),
        },
    )
    .await
    .expect_err("stale duplicate add-slot rejects once the slot exists");
    assert_eq!(duplicate, Reject::InvalidTarget);

    let slot_added_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM events \
         WHERE stream_id = $1 AND kind = 'SlotAdded' \
           AND payload->>'slot_id' = 'slot_extra'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        slot_added_count, 1,
        "stale duplicate add-slot rejection must not append duplicate SlotAdded events"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn duplicate_official_votecount_publish_rejects_without_duplicate_post(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let host = user("host_h");
    add_vanilla_slot(&pool, game, "host_h", "slot_2").await;
    handle(
        &pool,
        &user("user_a"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .expect("seed vote for official count");

    handle(&pool, &host, Command::PublishVotecount { game })
        .await
        .expect("initial official votecount publish");
    let duplicate = handle(&pool, &host, Command::PublishVotecount { game })
        .await
        .expect_err("stale publish control rejects once the same official count exists");
    assert_eq!(duplicate, Reject::InvalidTarget);

    let official_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM thread_view \
         WHERE game_id = $1 \
           AND channel_id = 'main' \
           AND author_user = 'host' \
           AND phase_id = 'D01' \
           AND body = 'Official votecount for D01\n- slot_2: 1'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        official_count, 1,
        "stale official votecount rejection must not append a duplicate post"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn duplicate_slot_lifecycle_status_rejects_without_duplicate_event(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let host = user("host_h");

    handle(
        &pool,
        &host,
        Command::SetSlotStatus {
            game,
            slot: "slot_1".into(),
            status: domain::SlotLifecycle::Dead,
        },
    )
    .await
    .expect("initial dead status");
    let duplicate_dead = handle(
        &pool,
        &host,
        Command::SetSlotStatus {
            game,
            slot: "slot_1".into(),
            status: domain::SlotLifecycle::Dead,
        },
    )
    .await
    .expect_err("stale mark-dead control rejects once slot is already dead");
    assert_eq!(duplicate_dead, Reject::InvalidTarget);

    handle(
        &pool,
        &host,
        Command::SetSlotStatus {
            game,
            slot: "slot_1".into(),
            status: domain::SlotLifecycle::Alive,
        },
    )
    .await
    .expect("restore alive before modkill status");

    handle(
        &pool,
        &host,
        Command::SetSlotStatus {
            game,
            slot: "slot_1".into(),
            status: domain::SlotLifecycle::Modkilled,
        },
    )
    .await
    .expect("initial modkilled status");
    let duplicate_modkilled = handle(
        &pool,
        &host,
        Command::SetSlotStatus {
            game,
            slot: "slot_1".into(),
            status: domain::SlotLifecycle::Modkilled,
        },
    )
    .await
    .expect_err("stale modkill control rejects once slot is already modkilled");
    assert_eq!(duplicate_modkilled, Reject::InvalidTarget);

    handle(
        &pool,
        &host,
        Command::SetSlotStatus {
            game,
            slot: "slot_1".into(),
            status: domain::SlotLifecycle::Alive,
        },
    )
    .await
    .expect("restore alive status");
    let duplicate_alive = handle(
        &pool,
        &host,
        Command::SetSlotStatus {
            game,
            slot: "slot_1".into(),
            status: domain::SlotLifecycle::Alive,
        },
    )
    .await
    .expect_err("stale restore-alive control rejects once slot is already alive");
    assert_eq!(duplicate_alive, Reject::InvalidTarget);

    let lifecycle_events = sqlx::query_as::<_, (String, i64)>(
        "SELECT payload->>'status' AS status, count(*) AS count \
         FROM events \
         WHERE stream_id = $1 AND kind = 'SlotStatusChanged' \
         GROUP BY payload->>'status' \
         ORDER BY payload->>'status'",
    )
    .bind(game)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        lifecycle_events,
        vec![
            ("alive".into(), 2),
            ("dead".into(), 1),
            ("modkilled".into(), 1)
        ],
        "stale lifecycle rejection must not append duplicate SlotStatusChanged events"
    );

    let slot = slot_state(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .find(|row| row.slot_id == "slot_1")
        .expect("slot projection");
    assert!(
        slot.alive && slot.status == "alive",
        "duplicate alive rejection must preserve restored alive projection"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn concurrent_host_lifecycle_collision_serializes_to_one_ack(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let host = user("host_h");

    let (dead, modkilled) = tokio::join!(
        handle(
            &pool,
            &host,
            Command::SetSlotStatus {
                game,
                slot: "slot_1".into(),
                status: domain::SlotLifecycle::Dead,
            },
        ),
        handle(
            &pool,
            &host,
            Command::SetSlotStatus {
                game,
                slot: "slot_1".into(),
                status: domain::SlotLifecycle::Modkilled,
            },
        ),
    );

    let results = [dead, modkilled];
    let ack_count = results.iter().filter(|result| result.is_ok()).count();
    let invalid_target_count = results
        .iter()
        .filter(|result| matches!(result, Err(Reject::InvalidTarget)))
        .count();
    assert_eq!(
        ack_count, 1,
        "exactly one lifecycle collision command should ACK"
    );
    assert_eq!(
        invalid_target_count, 1,
        "losing lifecycle collision command should revalidate after the winner changes the slot"
    );

    let lifecycle_events = sqlx::query_as::<_, (String, i64)>(
        "SELECT payload->>'status' AS status, count(*) AS count \
         FROM events \
         WHERE stream_id = $1 AND kind = 'SlotStatusChanged' \
         GROUP BY payload->>'status' \
         ORDER BY payload->>'status'",
    )
    .bind(game)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        lifecycle_events.len(),
        1,
        "lifecycle collision must append only the winning terminal status"
    );
    assert_eq!(
        lifecycle_events[0].1, 1,
        "winning lifecycle status must be appended once"
    );
    assert!(
        lifecycle_events[0].0 == "dead" || lifecycle_events[0].0 == "modkilled",
        "winning lifecycle status should be terminal"
    );

    let slot = slot_state(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .find(|row| row.slot_id == "slot_1")
        .expect("slot projection");
    assert!(
        !slot.alive,
        "winning lifecycle command should kill the slot"
    );
    assert_eq!(
        slot.status, lifecycle_events[0].0,
        "slot projection should converge to the single winning terminal status"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn submit_vote_enforces_pack_no_lynch_and_self_vote_policy(pool: PgPool) {
    let game = setup_game_with_pack(
        &pool,
        "host_h",
        "slot_1",
        "user_a",
        "test_no_lynch_forbidden",
    )
    .await;
    add_vanilla_slot(&pool, game, "host_h", "slot_2").await;

    let self_vote_err = handle(
        &pool,
        &user("user_a"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_1".into()),
        },
    )
    .await
    .expect_err("self-vote should be rejected when pack disallows it");
    assert_eq!(self_vote_err, Reject::InvalidTarget);

    let no_lynch_err = handle(
        &pool,
        &user("user_a"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::NoLynch,
        },
    )
    .await
    .expect_err("no-lynch should be rejected when pack disallows it");
    assert_eq!(no_lynch_err, Reject::InvalidTarget);

    let rejected_vote_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM events WHERE stream_id = $1 AND kind = 'VoteSubmitted'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        rejected_vote_count, 0,
        "invalid pack-disallowed ballots must reject before VoteSubmitted"
    );

    handle(
        &pool,
        &user("user_a"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .expect("legal slot vote still works");
    assert_eq!(tally_for(&pool, game, "D01", "slot_2").await, 1);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn submit_vote_rejects_dead_target_as_invalid_target(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    add_vanilla_slot(&pool, game, "host_h", "slot_2").await;

    handle(
        &pool,
        &user("host_h"),
        Command::SetSlotStatus {
            game,
            slot: "slot_2".into(),
            status: domain::SlotLifecycle::Dead,
        },
    )
    .await
    .expect("host marks vote target dead");

    let err = handle(
        &pool,
        &user("user_a"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .expect_err("dead vote target should be rejected before VoteSubmitted");
    assert_eq!(err, Reject::InvalidTarget);
    assert_eq!(tally_for(&pool, game, "D01", "slot_2").await, 0);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn slot_lifecycle_death_clears_current_ballots_by_and_for_slot(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    add_vanilla_slot(&pool, game, "host_h", "slot_2").await;
    add_vanilla_slot(&pool, game, "host_h", "slot_3").await;
    handle(
        &pool,
        &user("host_h"),
        Command::AssignSlot {
            game,
            slot: "slot_2".into(),
            user: "user_b".into(),
        },
    )
    .await
    .expect("assign slot_2");

    handle(
        &pool,
        &user("user_a"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .expect("slot_1 votes target that will die");
    handle(
        &pool,
        &user("user_b"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_2".into(),
            target: VoteTarget::Slot("slot_3".into()),
        },
    )
    .await
    .expect("slot_2 casts a ballot before dying");
    assert_eq!(tally_for(&pool, game, "D01", "slot_2").await, 1);
    assert_eq!(tally_for(&pool, game, "D01", "slot_3").await, 1);

    handle(
        &pool,
        &user("host_h"),
        Command::SetSlotStatus {
            game,
            slot: "slot_2".into(),
            status: domain::SlotLifecycle::Dead,
        },
    )
    .await
    .expect("host marks voted target and voter dead");

    assert_eq!(
        votecount(&pool, game).await.unwrap(),
        Vec::<projections::VoteCountRow>::new(),
        "slot death clears current ballots cast by and targeting that slot"
    );
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        votecount(&pool, game).await.unwrap(),
        Vec::<projections::VoteCountRow>::new(),
        "votecount rebuild preserves lifecycle-cleared current ballots"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn submit_vote_hammer_locks_phase_when_threshold_is_reached(pool: PgPool) {
    let game = Uuid::new_v4();
    let h = user("host_h");
    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "test_hammer_majority".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "vanilla_townie"),
        ("slot_2", "user_2", "vanilla_townie"),
        ("slot_3", "user_3", "mafia_goon"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();

    let first_ack = handle(
        &pool,
        &user("user_1"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_3".into()),
        },
    )
    .await
    .expect("first vote does not hammer");
    assert_eq!(first_ack.stream_seqs.len(), 1);
    assert!(
        !phase_state(&pool, game).await.unwrap().unwrap().locked,
        "one vote is below majority threshold"
    );

    let hammer_ack = handle(
        &pool,
        &user("user_2"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_2".into(),
            target: VoteTarget::Slot("slot_3".into()),
        },
    )
    .await
    .expect("second vote reaches majority and hammers");
    assert_eq!(
        hammer_ack.stream_seqs.len(),
        2,
        "hammer vote appends VoteSubmitted and ThreadLocked atomically"
    );
    assert_eq!(tally_for(&pool, game, "D01", "slot_3").await, 2);
    assert!(
        phase_state(&pool, game).await.unwrap().unwrap().locked,
        "hammer locks the current day phase"
    );

    let lock_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ThreadLocked' ORDER BY stream_seq DESC LIMIT 1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(lock_payload["reason"], "hammer");
    assert_eq!(lock_payload["phase_id"], "D01");
    assert_eq!(lock_payload["actor"], "slot_2");
    assert_eq!(lock_payload["target"], "slot_3");

    let late_vote_err = handle(
        &pool,
        &user("user_3"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_3".into(),
            target: VoteTarget::Slot("slot_1".into()),
        },
    )
    .await
    .expect_err("locked hammer phase rejects later ballots");
    assert_eq!(late_vote_err, Reject::PhaseLocked);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn dead_slot_voting_is_slot_not_alive(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    add_vanilla_slot(&pool, game, "host_h", "slot_2").await;

    // Kill slot_1 via a ResolutionApplied envelope (the engine's seam).
    let applied = domain::events::ResolutionApplied {
        phase_id: "N01".into(),
        phase_kind: domain::pack::PhaseKind::Night,
        phase_number: 1,
        run_id: "r1".into(),
        result_version: domain::RESULT_VERSION,
        seed: 1,
        counts: domain::events::ResolutionCounts {
            events: 2,
            kills: 1,
            saves: 0,
        },
        events: vec![
            domain::events::IndexedEvent {
                index: 0,
                event: domain::InnerEvent::PlayerKilled {
                    slot_id: "slot_1".into(),
                    cause: "factional_kill".into(),
                    attackers: vec![],
                    unstoppable: false,
                    death_reveal: domain::DeathRevealMode::Full,
                },
            },
            domain::events::IndexedEvent {
                index: 1,
                event: domain::InnerEvent::PhaseAnnouncement(domain::PhaseAnnouncement {
                    phase_id: "N01".into(),
                    template_id: None,
                    audience: None,
                    deaths: vec![domain::Death {
                        slot_id: "slot_1".into(),
                        cause: "factional_kill".into(),
                        template_id: None,
                        audience: None,
                    }],
                }),
            },
        ],
        started_at: 1,
        finished_at: 2,
    };
    projections::append_and_project(
        &pool,
        game,
        &[eventstore::EventInput::new(
            "ResolutionApplied",
            1,
            serde_json::to_value(&applied).unwrap(),
            eventstore::ActorId::System,
            2,
        )],
    )
    .await
    .unwrap();

    let err = handle(
        &pool,
        &user("user_a"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .expect_err("dead slot cannot vote");
    assert_eq!(err, Reject::SlotNotAlive);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn changing_vote_overwrites_and_withdraw_removes(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    for s in ["slot_2", "slot_3"] {
        add_vanilla_slot(&pool, game, "host_h", s).await;
    }

    // A votes slot_2, then changes to slot_3 → only ONE ballot counts (overwrite).
    handle(
        &pool,
        &user("user_a"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_2".into()),
        },
    )
    .await
    .unwrap();
    assert_eq!(tally_for(&pool, game, "D01", "slot_2").await, 1);

    handle(
        &pool,
        &user("user_a"),
        Command::SubmitVote {
            game,
            actor_slot: "slot_1".into(),
            target: VoteTarget::Slot("slot_3".into()),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        tally_for(&pool, game, "D01", "slot_2").await,
        0,
        "overwritten"
    );
    assert_eq!(
        tally_for(&pool, game, "D01", "slot_3").await,
        1,
        "no double count"
    );

    // Withdraw removes the ballot entirely.
    handle(
        &pool,
        &user("user_a"),
        Command::WithdrawVote {
            game,
            actor_slot: "slot_1".into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        tally_for(&pool, game, "D01", "slot_3").await,
        0,
        "withdrawn"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn no_lynch_votes_resolve_to_official_engine_outcome(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_1").await;
    for (slot, occupant, role) in [
        ("slot_2", "user_2", "vanilla_townie"),
        ("slot_3", "user_3", "mafia_goon"),
    ] {
        handle(
            &pool,
            &user("host_h"),
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &user("host_h"),
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &user("host_h"),
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }

    for (user_id, actor_slot) in [("user_1", "slot_1"), ("user_2", "slot_2")] {
        handle(
            &pool,
            &user(user_id),
            Command::SubmitVote {
                game,
                actor_slot: actor_slot.into(),
                target: VoteTarget::NoLynch,
            },
        )
        .await
        .unwrap();
    }
    assert_eq!(tally_for(&pool, game, "D01", "no_lynch").await, 2);

    handle(
        &pool,
        &user("host_h"),
        Command::ResolvePhase { game, seed: 9306 },
    )
    .await
    .expect("host resolves no-lynch day vote");

    let official = day_vote_outcomes(&pool, game)
        .await
        .expect("official day vote outcomes");
    assert_eq!(official.len(), 1);
    assert_eq!(official[0].phase_id, "D01");
    assert_eq!(official[0].status, "NoLynch");
    assert_eq!(official[0].winner_slot, None);
    assert_eq!(official[0].tallies["no_lynch"], serde_json::json!(2.0));
    assert_eq!(official[0].votes["slot_1"], "no_lynch");
    assert_eq!(official[0].votes["slot_2"], "no_lynch");

    let payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied' \
         AND payload->>'phase_id' = 'D01'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let applied = domain::validate_resolution_json(&payload, domain::RESULT_VERSION).unwrap();
    assert!(
        applied.events.iter().all(|indexed| !matches!(
            &indexed.event,
            domain::InnerEvent::PlayerKilled { cause, .. } if cause == "day_vote"
        )),
        "NoLynch official outcome must not emit a day-vote death"
    );
}

/// The defensive `(stream_id, stream_seq)` uniqueness backstop still surfaces
/// through the real pipeline as retryable `Reject::StreamConflict` if a bypass
/// writer collides inside the append transaction.
#[sqlx::test(migrations = "../projections/migrations")]
async fn defensive_unique_conflict_surfaces_as_retryable_stream_conflict(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    install_forced_deadline_stream_conflict(&pool, game).await;

    let res = handle(
        &pool,
        &user("host_h"),
        Command::ExtendDeadline {
            game,
            phase: "D01".into(),
            at: 5,
        },
    )
    .await;

    let err = res.expect_err("the forced bypass conflict must reject");
    assert_eq!(
        err,
        Reject::StreamConflict,
        "Conflict → retryable StreamConflict"
    );
    assert!(err.is_retryable(), "the caller is told to reload + retry");
    drop_forced_deadline_stream_conflict(&pool).await;
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn concurrent_submit_action_revalidates_after_winning_action(pool: PgPool) {
    let host = user("host_h");
    let game = Uuid::new_v4();
    handle(
        &pool,
        &host,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_4", "action-goon", "mafia_goon"),
        ("slot-2", "town-target-2", "vanilla_townie"),
        ("slot-3", "town-target-3", "vanilla_townie"),
    ] {
        handle(
            &pool,
            &host,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &host,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &host,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();

    let lock_key = 41_005_i64;
    install_action_insert_blocker(&pool, game, lock_key).await;

    // Run the harness blocker and advisory-wait poller on a separate pool so
    // they cannot contend with the command transactions under test.
    let aux_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(4)
        .connect_with((*pool.connect_options()).clone())
        .await
        .expect("harness aux pool connects to the per-test database");

    let mut blocker = aux_pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(lock_key)
        .execute(&mut *blocker)
        .await
        .unwrap();

    let first_pool = pool.clone();
    let first = tokio::spawn(async move {
        handle(
            &first_pool,
            &user("action-goon"),
            Command::SubmitAction {
                game,
                action_id: "race_first".into(),
                actor_slot: "slot_4".into(),
                template_id: "factional_kill".into(),
                targets: vec!["slot-2".into()],
                grant_id: None,
            },
        )
        .await
    });
    wait_for_advisory_wait_count(&aux_pool, 1).await;

    let second_pool = pool.clone();
    let second = tokio::spawn(async move {
        handle(
            &second_pool,
            &user("action-goon"),
            Command::SubmitAction {
                game,
                action_id: "race_second".into(),
                actor_slot: "slot_4".into(),
                template_id: "factional_kill".into(),
                targets: vec!["slot-3".into()],
                grant_id: None,
            },
        )
        .await
    });
    wait_for_advisory_wait_count(&aux_pool, 2).await;

    sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(lock_key)
        .execute(&mut *blocker)
        .await
        .unwrap();

    let first = first.await.unwrap().expect("first racing action wins");
    assert_eq!(first.stream_seqs.len(), 1);
    let second = second
        .await
        .unwrap()
        .expect_err("second racing action revalidates after first append");
    assert_eq!(second, Reject::ActionAlreadySubmitted);

    let actions: Vec<String> = eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .filter(|event| event.kind == "ActionSubmitted")
        .filter_map(|event| event.payload["action_id"].as_str().map(str::to_string))
        .collect();
    assert_eq!(
        actions,
        vec!["race_first".to_string()],
        "same-action race must append only the winning action"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn command_receipt_replays_only_an_identical_payload(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let command_id = Uuid::new_v4();
    let command = Command::SubmitPost {
        game,
        channel_id: "main".into(),
        actor_slot: "slot_1".into(),
        body: "stable idempotent body".into(),
        media: Vec::new(),
    };

    let first = handle_idempotent(&pool, &user("user_a"), command_id, command.clone())
        .await
        .expect("first command commits");
    let replay = handle_idempotent(&pool, &user("user_a"), command_id, command)
        .await
        .expect("same id and payload replays");
    assert_eq!(replay, first);

    let conflict = handle_idempotent(
        &pool,
        &user("user_a"),
        command_id,
        Command::SubmitPost {
            game,
            channel_id: "main".into(),
            actor_slot: "slot_1".into(),
            body: "different body under the same id".into(),
            media: Vec::new(),
        },
    )
    .await
    .expect_err("same id with a different payload conflicts");
    assert_eq!(conflict, Reject::CommandIdConflict);

    let receipt = sqlx::query(
        "SELECT octet_length(command_fingerprint) AS fingerprint_bytes, stream_seqs \
         FROM command_receipt WHERE principal_user_id = $1 AND command_id = $2",
    )
    .bind("user_a")
    .bind(command_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(receipt.get::<i32, _>("fingerprint_bytes"), 32);
    assert_eq!(receipt.get::<Vec<i64>, _>("stream_seqs"), first.stream_seqs);

    let posts: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(posts, 1, "replay and conflict append no additional event");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn cancellation_while_waiting_for_command_lock_rolls_back_receipt_and_transaction(
    pool: PgPool,
) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let command_id = Uuid::new_v4();
    let command = Command::SubmitPost {
        game,
        channel_id: "main".into(),
        actor_slot: "slot_1".into(),
        body: "cancelled at command lock".into(),
        media: Vec::new(),
    };

    let mut blocker = pool.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))")
        .bind(game)
        .execute(&mut *blocker)
        .await
        .unwrap();

    let task_pool = pool.clone();
    let task_command = command.clone();
    let task = tokio::spawn(async move {
        handle_idempotent(&task_pool, &user("user_a"), command_id, task_command).await
    });
    wait_for_advisory_wait_count(&pool, 1).await;
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    blocker.commit().await.unwrap();

    wait_for_cancelled_command_cleanup(&pool, game, command_id, "cancelled at command lock").await;
    let ack = handle_idempotent(&pool, &user("user_a"), command_id, command)
        .await
        .expect("same id retries after cancellation rollback");
    assert_eq!(ack.stream_seqs.len(), 1);
    wait_for_no_command_runtime_resources(&pool).await;
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn cancellation_during_projection_rolls_back_event_projection_receipt_and_locks(
    pool: PgPool,
) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let command_id = Uuid::new_v4();
    let body = "cancelled during projection";
    let command = Command::SubmitPost {
        game,
        channel_id: "main".into(),
        actor_slot: "slot_1".into(),
        body: body.into(),
        media: Vec::new(),
    };
    let lock_key = 41_009_i64;
    install_thread_view_insert_blocker(&pool, game, lock_key).await;
    let mut blocker = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(lock_key)
        .execute(&mut *blocker)
        .await
        .unwrap();

    let task_pool = pool.clone();
    let task_command = command.clone();
    let task = tokio::spawn(async move {
        handle_idempotent(&task_pool, &user("user_a"), command_id, task_command).await
    });
    wait_for_advisory_wait_count(&pool, 1).await;
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());

    sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(lock_key)
        .execute(&mut *blocker)
        .await
        .unwrap();
    drop(blocker);
    drop_thread_view_insert_blocker(&pool).await;

    wait_for_cancelled_command_cleanup(&pool, game, command_id, body).await;
    let ack = handle_idempotent(&pool, &user("user_a"), command_id, command)
        .await
        .expect("cancelled projection leaves the command retryable");
    assert_eq!(ack.stream_seqs.len(), 1);
    wait_for_no_command_runtime_resources(&pool).await;
}
