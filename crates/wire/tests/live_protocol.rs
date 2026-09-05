use serde_json::json;
use std::collections::BTreeMap;
use uuid::Uuid;
use wire::{
    fixture_principal_id, is_valid_live_data_envelope_id, next_live_data_envelope_id,
    CapabilityGrant, Command, CommandDispatch, DayVoteOutcomeDelta, GameThreadAuthor, Hello,
    HostConsoleAuthorityDelta, HostConsoleAuthorityKind, HostConsoleDayEventsDelta,
    HostConsoleHeaderDelta, HostConsoleSchedulerDelta, HostConsoleSlotsDelta,
    HostConsoleStateDelta, HostConsoleTasksDelta, HostConsoleThreadPostRemovedDelta,
    HostConsoleThreadPostsDelta, HostPromptsDelta, LiveAudience, LiveProjectionDelta,
    LiveResyncRequired, LiveScope, LiveWireError, PlayerInvestigationResultsDelta,
    PlayerNotification, PlayerNotificationsDelta, PostCitationsChangedDelta, PostKind, PostRef,
    ProjectionDelta, ServerEnvelope, ServerMsg, SlotMentionNotification, SlotMentionsDelta,
    SubmitPostMention, ThreadPost, ThreadPostMention, ThreadPostRemovedDelta, ThreadPostsDelta,
    VoteCountClearedDelta, VoteCountDelta, LIVE_HEARTBEAT_ENVELOPE_ID, MAX_SAFE_LIVE_ENVELOPE_ID,
    MAX_SAFE_LIVE_INTEGER, PROTOCOL_VERSION,
};

fn game(id: u128) -> Uuid {
    Uuid::from_u128(id)
}

fn phase_id() -> domain::phase::PhaseId {
    domain::phase::PhaseId::parse("D01").expect("static phase id is canonical")
}

fn main_scope(game: Uuid, slot_id: Option<&str>) -> LiveScope {
    LiveScope::new(game, "main", slot_id.map(str::to_string)).unwrap()
}

fn vote_clear(game: Uuid) -> ProjectionDelta {
    ProjectionDelta::VoteCountCleared(VoteCountClearedDelta {
        game,
        phase_id: phase_id(),
        candidate_slot: "slot_2".to_string(),
    })
}

fn thread_removal(game: Uuid) -> ProjectionDelta {
    ProjectionDelta::ThreadPostRemoved(ThreadPostRemovedDelta {
        game,
        channel: "main".to_string(),
        source_seq: 7,
    })
}

fn host_prompts(game: Uuid) -> ProjectionDelta {
    ProjectionDelta::HostPromptsChanged(HostPromptsDelta {
        game,
        prompts: Vec::new(),
    })
}

fn player_notifications(game: Uuid, notifications: Vec<PlayerNotification>) -> ProjectionDelta {
    ProjectionDelta::PlayerNotificationsChanged(PlayerNotificationsDelta {
        game,
        notifications,
    })
}

fn slot_mentions(game: Uuid, mentions: Vec<SlotMentionNotification>) -> ProjectionDelta {
    ProjectionDelta::SlotMentionsChanged(SlotMentionsDelta { game, mentions })
}

fn host_authority() -> HostConsoleAuthorityDelta {
    HostConsoleAuthorityDelta {
        principal_id: fixture_principal_id("wire-live-host"),
        capability: HostConsoleAuthorityKind::HostOf,
        allowed_classes: Vec::new(),
        denied_classes: Vec::new(),
    }
}

fn every_projection_delta_by_audience(game: Uuid) -> [Vec<ProjectionDelta>; 4] {
    let game_deltas = vec![
        ProjectionDelta::VoteCountChanged(VoteCountDelta {
            game,
            phase_id: phase_id(),
            candidate_slot: "slot_2".to_string(),
            count: 1,
        }),
        vote_clear(game),
        ProjectionDelta::DayVoteOutcomeApplied(DayVoteOutcomeDelta {
            game,
            phase_id: phase_id(),
            source_seq: 1,
            event_index: 0,
            status: "resolved".to_string(),
            winner_slot: None,
            contenders: Vec::new(),
            tallies: BTreeMap::new(),
            votes: BTreeMap::new(),
            weights: BTreeMap::new(),
            majority: None,
            thresholds: BTreeMap::new(),
            total_weight: 0.0,
            tiebreak: None,
            reason: None,
        }),
    ];
    let thread_deltas = vec![
        ProjectionDelta::ThreadPostsChanged(ThreadPostsDelta {
            game,
            posts: Vec::new(),
        }),
        thread_removal(game),
        ProjectionDelta::PostCitationsChanged(PostCitationsChangedDelta {
            channel: "main".to_string(),
            quoted: PostRef {
                kind: PostKind::GamePost,
                scope_id: game,
                source_seq: 1,
            },
            citation_count: 0,
        }),
    ];
    let host_deltas = vec![
        ProjectionDelta::HostConsoleStateChanged(HostConsoleStateDelta {
            game,
            authority: host_authority(),
            completed: false,
            phase: None,
            slots: Vec::new(),
            thread_posts: Vec::new(),
            day_event_scheduler: None,
            day_events: Vec::new(),
            tasks: Vec::new(),
        }),
        ProjectionDelta::HostConsoleHeaderChanged(HostConsoleHeaderDelta {
            game,
            authority: host_authority(),
            completed: false,
            phase: None,
        }),
        ProjectionDelta::HostConsoleSlotsChanged(HostConsoleSlotsDelta {
            game,
            slots: Vec::new(),
            removed_slot_ids: Vec::new(),
        }),
        ProjectionDelta::HostConsoleThreadPostsChanged(HostConsoleThreadPostsDelta {
            game,
            posts: Vec::new(),
        }),
        ProjectionDelta::HostConsoleThreadPostRemoved(HostConsoleThreadPostRemovedDelta {
            game,
            stream_seq: 1,
        }),
        ProjectionDelta::HostConsoleDayEventsChanged(HostConsoleDayEventsDelta {
            game,
            day_events: Vec::new(),
            removed_event_ids: Vec::new(),
        }),
        ProjectionDelta::HostConsoleSchedulerChanged(HostConsoleSchedulerDelta {
            game,
            day_event_scheduler: None,
        }),
        ProjectionDelta::HostConsoleTasksChanged(HostConsoleTasksDelta {
            game,
            tasks: Vec::new(),
        }),
        host_prompts(game),
    ];
    let player_slot_deltas = vec![
        player_notifications(game, Vec::new()),
        ProjectionDelta::PlayerInvestigationResultsChanged(PlayerInvestigationResultsDelta {
            game,
            results: Vec::new(),
        }),
        slot_mentions(game, Vec::new()),
    ];
    [game_deltas, thread_deltas, host_deltas, player_slot_deltas]
}

#[test]
fn protocol_v3_reserves_zero_for_hello_and_bounds_positive_data_ids_for_javascript() {
    assert_eq!(PROTOCOL_VERSION, 3);
    assert_eq!(LIVE_HEARTBEAT_ENVELOPE_ID, 0);
    assert_eq!(MAX_SAFE_LIVE_ENVELOPE_ID, 9_007_199_254_740_991);
    assert!(!is_valid_live_data_envelope_id(0));
    assert!(is_valid_live_data_envelope_id(1));
    assert!(is_valid_live_data_envelope_id(MAX_SAFE_LIVE_ENVELOPE_ID));
    assert!(!is_valid_live_data_envelope_id(
        MAX_SAFE_LIVE_ENVELOPE_ID + 1
    ));
    assert_eq!(next_live_data_envelope_id(0), Some(1));
    assert_eq!(next_live_data_envelope_id(MAX_SAFE_LIVE_ENVELOPE_ID), None);
}

#[test]
fn hello_is_closed_scope_bound_and_rejects_v2_locally() {
    let game = game(1);
    let scope = main_scope(game, None);
    let hello = Hello::new("wire-test", scope.clone(), Vec::new()).unwrap();
    let envelope = ServerEnvelope::new(0, ServerMsg::Hello(hello));
    envelope.validate_live().unwrap();

    let mut stale = envelope.clone();
    stale.v = 2;
    assert!(matches!(
        stale.validate_protocol(),
        Err(LiveWireError::UnsupportedProtocolVersion {
            expected: 3,
            actual: 2
        })
    ));

    let stale_hello = json!({
        "protocol_v": 2,
        "server": "wire-test",
        "caps": [],
        "scope": { "game": game, "channel": "main", "slot_id": null }
    });
    assert!(serde_json::from_value::<Hello>(stale_hello).is_err());

    let extra_hello = json!({
        "protocol_v": 3,
        "server": "wire-test",
        "caps": [],
        "scope": { "game": game, "channel": "main", "slot_id": null },
        "unexpected": true
    });
    assert!(serde_json::from_value::<Hello>(extra_hello).is_err());

    let extra_scope = json!({
        "game": game,
        "channel": "main",
        "slot_id": null,
        "unexpected": true
    });
    assert!(serde_json::from_value::<LiveScope>(extra_scope).is_err());
    assert!(LiveScope::new(Uuid::nil(), "main", None).is_err());
    assert!(LiveScope::new(game, " ", None).is_err());
    assert!(LiveScope::new(game, "main", Some(" ".to_string())).is_err());
}

#[test]
fn hello_canonicalizes_capabilities_and_rejects_noncanonical_identifiers() {
    let game = game(17);
    let scope = main_scope(game, None);
    let hello = Hello::new(
        "wire-test",
        scope.clone(),
        vec![
            CapabilityGrant::HostOf { game },
            CapabilityGrant::GlobalAdmin,
            CapabilityGrant::HostOf { game },
        ],
    )
    .unwrap();
    assert_eq!(
        hello.caps(),
        &[
            CapabilityGrant::GlobalAdmin,
            CapabilityGrant::HostOf { game }
        ]
    );

    let reversed = serde_json::from_value::<Hello>(json!({
        "protocol_v": 3,
        "server": "wire-test",
        "scope": { "game": game, "channel": "main", "slot_id": null },
        "caps": [
            { "kind": "HostOf", "body": { "game": game } },
            { "kind": "GlobalAdmin" },
            { "kind": "HostOf", "body": { "game": game } }
        ]
    }))
    .unwrap();
    assert_eq!(hello, reversed);

    assert!(Hello::new(" wire-test", scope.clone(), Vec::new()).is_err());
    assert!(Hello::new("wire\u{7f}test", scope.clone(), Vec::new()).is_err());
    assert!(Hello::new("wire\u{85}test", scope.clone(), Vec::new()).is_err());
    assert!(LiveScope::new(game, " main", None).is_err());
    assert!(LiveScope::new(game, "main\u{7f}", None).is_err());
    assert!(Hello::new(
        "wire-test",
        scope,
        vec![CapabilityGrant::ChannelMember {
            game,
            channel: " main".to_string(),
        }],
    )
    .is_err());
}

#[test]
fn scoped_capability_adapter_never_invents_cross_game_authority() {
    let expected_game = game(19);
    let other_game = game(20);
    assert_eq!(
        CapabilityGrant::for_game(
            &caps::Capability::SlotOccupant("slot_7".to_string()),
            expected_game,
        )
        .unwrap(),
        CapabilityGrant::SlotOccupant {
            game: expected_game,
            slot: "slot_7".to_string(),
        },
    );
    assert_eq!(
        CapabilityGrant::for_game(
            &caps::Capability::ChannelMember("main".to_string()),
            expected_game,
        )
        .unwrap(),
        CapabilityGrant::ChannelMember {
            game: expected_game,
            channel: "main".to_string(),
        },
    );
    assert!(matches!(
        CapabilityGrant::for_game(&caps::Capability::HostOf(other_game), expected_game),
        Err(LiveWireError::GameMismatch { .. })
    ));
}

#[test]
fn live_audience_is_externally_tagged_and_closed() {
    let game = game(2);
    let audience = LiveAudience::Thread {
        game,
        channel: "main".to_string(),
    };
    assert_eq!(
        serde_json::to_value(&audience).unwrap(),
        json!({ "Thread": { "game": game, "channel": "main" } })
    );
    assert!(serde_json::from_value::<LiveAudience>(json!({
        "Thread": { "game": game, "channel": "main", "unexpected": true }
    }))
    .is_err());
    assert!(serde_json::from_value::<LiveAudience>(json!({
        "Thread": { "game": game, "channel": " " }
    }))
    .is_err());
    assert!(serde_json::from_value::<LiveAudience>(json!({
        "PlayerSlot": { "game": game, "slot_id": " " }
    }))
    .is_err());
    assert!(serde_json::from_value::<LiveAudience>(json!({
        "Game": { "game": Uuid::nil() }
    }))
    .is_err());
}

#[test]
fn checked_audience_constructors_cover_every_projection_family() {
    let game = game(3);

    let [game_deltas, thread_deltas, host_deltas, player_slot_deltas] =
        every_projection_delta_by_audience(game);
    assert_eq!(
        game_deltas.len() + thread_deltas.len() + host_deltas.len() + player_slot_deltas.len(),
        18,
        "every ProjectionDelta variant must appear in this exhaustive mapping proof"
    );
    for delta in game_deltas {
        LiveProjectionDelta::game(game, delta).unwrap();
    }
    for delta in thread_deltas {
        LiveProjectionDelta::thread(game, "main", delta).unwrap();
    }
    for delta in host_deltas {
        LiveProjectionDelta::host(game, delta).unwrap();
    }
    for delta in player_slot_deltas {
        LiveProjectionDelta::player_slot(game, "slot_7", delta).unwrap();
    }

    let game_delta = LiveProjectionDelta::game(game, vote_clear(game)).unwrap();
    assert!(matches!(game_delta.audience(), LiveAudience::Game { game: value } if *value == game));

    let thread_delta = LiveProjectionDelta::thread(game, "main", thread_removal(game)).unwrap();
    assert!(matches!(
        thread_delta.audience(),
        LiveAudience::Thread { game: value, channel }
            if *value == game && channel == "main"
    ));

    let host_delta = LiveProjectionDelta::host(game, host_prompts(game)).unwrap();
    assert!(matches!(host_delta.audience(), LiveAudience::Host { game: value } if *value == game));

    let player_delta =
        LiveProjectionDelta::player_slot(game, "slot_7", player_notifications(game, Vec::new()))
            .unwrap();
    assert!(matches!(
        player_delta.audience(),
        LiveAudience::PlayerSlot { game: value, slot_id }
            if *value == game && slot_id == "slot_7"
    ));

    assert!(matches!(
        LiveProjectionDelta::game(game, thread_removal(game)),
        Err(LiveWireError::AudienceDeltaMismatch { .. })
    ));
    assert!(matches!(
        LiveProjectionDelta::thread(game, "main", host_prompts(game)),
        Err(LiveWireError::AudienceDeltaMismatch { .. })
    ));
    assert!(matches!(
        LiveProjectionDelta::host(game, player_notifications(game, Vec::new())),
        Err(LiveWireError::AudienceDeltaMismatch { .. })
    ));
    assert!(matches!(
        LiveProjectionDelta::player_slot(game, "slot_7", vote_clear(game)),
        Err(LiveWireError::AudienceDeltaMismatch { .. })
    ));
}

#[test]
fn checked_live_delta_rejects_mismatched_embedded_game_channel_and_slot() {
    let expected_game = game(4);
    let other_game = game(5);

    assert!(matches!(
        LiveProjectionDelta::thread(expected_game, " ", thread_removal(expected_game)),
        Err(LiveWireError::EmptyIdentifier("channel"))
    ));
    assert!(matches!(
        LiveProjectionDelta::player_slot(
            expected_game,
            " ",
            player_notifications(expected_game, Vec::new())
        ),
        Err(LiveWireError::EmptyIdentifier("slot_id"))
    ));

    assert!(matches!(
        LiveProjectionDelta::game(expected_game, vote_clear(other_game)),
        Err(LiveWireError::GameMismatch { .. })
    ));
    assert!(matches!(
        LiveProjectionDelta::host(expected_game, host_prompts(other_game)),
        Err(LiveWireError::GameMismatch { .. })
    ));

    let mismatched_game_post = ThreadPost {
        game: other_game,
        source_seq: 10,
        stream_seq: 10,
        channel_id: "main".to_string(),
        author: GameThreadAuthor::System,
        phase_id: None,
        body: "wrong game".to_string(),
        media: Vec::new(),
        quotations: Vec::new(),
        mentions: Vec::new(),
        embed: None,
        citation_count: 0,
        occurred_at: 1,
    };
    let mismatched_game_thread = ProjectionDelta::ThreadPostsChanged(ThreadPostsDelta {
        game: expected_game,
        posts: vec![mismatched_game_post],
    });
    assert!(matches!(
        LiveProjectionDelta::thread(expected_game, "main", mismatched_game_thread),
        Err(LiveWireError::GameMismatch { .. })
    ));

    let post = ThreadPost {
        game: expected_game,
        source_seq: 11,
        stream_seq: 11,
        channel_id: "private:other".to_string(),
        author: GameThreadAuthor::System,
        phase_id: None,
        body: "scoped post".to_string(),
        media: Vec::new(),
        quotations: Vec::new(),
        mentions: Vec::new(),
        embed: None,
        citation_count: 0,
        occurred_at: 1,
    };
    let thread = ProjectionDelta::ThreadPostsChanged(ThreadPostsDelta {
        game: expected_game,
        posts: vec![post],
    });
    assert!(matches!(
        LiveProjectionDelta::thread(expected_game, "main", thread),
        Err(LiveWireError::ChannelMismatch { .. })
    ));

    let notification = PlayerNotification {
        game: expected_game,
        phase_id: phase_id(),
        event_index: 0,
        audience_slot: "slot_8".to_string(),
        effect: "inspect".to_string(),
        status: "applied".to_string(),
    };
    assert!(matches!(
        LiveProjectionDelta::player_slot(
            expected_game,
            "slot_7",
            player_notifications(expected_game, vec![notification])
        ),
        Err(LiveWireError::SlotMismatch { .. })
    ));

    let discussion_citation = ProjectionDelta::PostCitationsChanged(PostCitationsChangedDelta {
        channel: "main".to_string(),
        quoted: PostRef {
            kind: PostKind::DiscussionPost,
            scope_id: expected_game,
            source_seq: 1,
        },
        citation_count: 1,
    });
    assert!(matches!(
        LiveProjectionDelta::thread(expected_game, "main", discussion_citation),
        Err(LiveWireError::InvalidGamePostCitation)
    ));

    assert!(matches!(
        LiveProjectionDelta::thread(
            expected_game,
            "main",
            ProjectionDelta::ThreadPostRemoved(ThreadPostRemovedDelta {
                game: expected_game,
                channel: "private:other".to_string(),
                source_seq: 1,
            })
        ),
        Err(LiveWireError::ChannelMismatch { .. })
    ));

    assert!(matches!(
        LiveProjectionDelta::thread(
            expected_game,
            "main",
            ProjectionDelta::PostCitationsChanged(PostCitationsChangedDelta {
                channel: "private:other".to_string(),
                quoted: PostRef {
                    kind: PostKind::GamePost,
                    scope_id: expected_game,
                    source_seq: 1,
                },
                citation_count: 1,
            })
        ),
        Err(LiveWireError::ChannelMismatch { .. })
    ));
}

#[test]
fn checked_live_delta_matches_javascript_integer_and_identifier_boundaries() {
    let game = game(18);
    for invalid in [-1, MAX_SAFE_LIVE_INTEGER + 1] {
        assert!(LiveProjectionDelta::game(
            game,
            ProjectionDelta::VoteCountChanged(VoteCountDelta {
                game,
                phase_id: phase_id(),
                candidate_slot: "slot_2".to_string(),
                count: invalid,
            }),
        )
        .is_err());
    }
    LiveProjectionDelta::game(
        game,
        ProjectionDelta::VoteCountChanged(VoteCountDelta {
            game,
            phase_id: phase_id(),
            candidate_slot: "slot_2".to_string(),
            count: MAX_SAFE_LIVE_INTEGER,
        }),
    )
    .unwrap();

    for invalid in [0, -1, MAX_SAFE_LIVE_INTEGER + 1] {
        assert!(LiveProjectionDelta::thread(
            game,
            "main",
            ProjectionDelta::ThreadPostRemoved(ThreadPostRemovedDelta {
                game,
                channel: "main".to_string(),
                source_seq: invalid,
            }),
        )
        .is_err());
    }
    assert!(LiveProjectionDelta::thread(
        game,
        "main",
        ProjectionDelta::ThreadPostRemoved(ThreadPostRemovedDelta {
            game,
            channel: " main".to_string(),
            source_seq: 1,
        }),
    )
    .is_err());
    assert!(LiveProjectionDelta::thread(
        game,
        "main",
        ProjectionDelta::ThreadPostRemoved(ThreadPostRemovedDelta {
            game,
            channel: "main\u{7f}".to_string(),
            source_seq: 1,
        }),
    )
    .is_err());
}

#[test]
fn live_delta_deserialization_cannot_bypass_closed_shape_or_invariants() {
    let expected_game = game(6);
    let other_game = game(7);
    let mismatched = json!({
        "audience": { "Game": { "game": expected_game } },
        "delta": {
            "kind": "VoteCountCleared",
            "body": {
                "game": other_game,
                "phase_id": "D01",
                "candidate_slot": "slot_2"
            }
        }
    });
    assert!(serde_json::from_value::<LiveProjectionDelta>(mismatched).is_err());

    let extra = json!({
        "audience": { "Thread": { "game": expected_game, "channel": "main" } },
        "delta": {
            "kind": "ThreadPostRemoved",
            "body": { "game": expected_game, "channel": "main", "source_seq": 1 }
        },
        "unexpected": true
    });
    assert!(serde_json::from_value::<LiveProjectionDelta>(extra).is_err());
}

#[test]
fn resync_requires_nonempty_unique_scope_matching_audiences() {
    let game = game(8);
    let scope = main_scope(game, Some("slot_7"));
    let audiences = vec![
        LiveAudience::PlayerSlot {
            game,
            slot_id: "slot_7".to_string(),
        },
        LiveAudience::Game { game },
        LiveAudience::Thread {
            game,
            channel: "main".to_string(),
        },
    ];
    let resync = LiveResyncRequired::new(scope.clone(), audiences, 42).unwrap();
    assert_eq!(resync.from_event_seq(), 42);
    assert_eq!(resync.scope(), &scope);
    assert_eq!(resync.audiences().len(), 3);

    assert!(matches!(
        LiveResyncRequired::new(scope.clone(), Vec::new(), 0),
        Err(LiveWireError::EmptyResyncAudiences)
    ));
    assert!(matches!(
        LiveResyncRequired::new(
            scope.clone(),
            vec![LiveAudience::Game { game }, LiveAudience::Game { game }],
            0
        ),
        Err(LiveWireError::DuplicateResyncAudience)
    ));
    assert!(matches!(
        LiveResyncRequired::new(
            scope.clone(),
            vec![LiveAudience::Thread {
                game,
                channel: "private:other".to_string()
            }],
            0
        ),
        Err(LiveWireError::ResyncAudienceScopeMismatch)
    ));
    assert!(matches!(
        LiveResyncRequired::new(scope.clone(), vec![LiveAudience::Host { game }], 0),
        Err(LiveWireError::ResyncAudienceScopeMismatch)
    ));
    LiveResyncRequired::new(main_scope(game, None), vec![LiveAudience::Host { game }], 0).unwrap();
    assert!(matches!(
        LiveResyncRequired::new(scope, vec![LiveAudience::Game { game }], -1),
        Err(LiveWireError::InvalidLiveInteger {
            field: "from_event_seq",
            value: -1,
            minimum: 0,
        })
    ));
    LiveResyncRequired::new(
        main_scope(game, None),
        vec![LiveAudience::Game { game }],
        MAX_SAFE_LIVE_INTEGER,
    )
    .unwrap();
    assert!(LiveResyncRequired::new(
        main_scope(game, None),
        vec![LiveAudience::Game { game }],
        MAX_SAFE_LIVE_INTEGER + 1,
    )
    .is_err());
}

#[test]
fn resync_deserialization_rejects_duplicate_and_extra_fields() {
    let game = game(9);
    let duplicate = json!({
        "scope": { "game": game, "channel": "main", "slot_id": null },
        "audiences": [
            { "Game": { "game": game } },
            { "Game": { "game": game } }
        ],
        "from_event_seq": 0
    });
    assert!(serde_json::from_value::<LiveResyncRequired>(duplicate).is_err());

    let extra = json!({
        "scope": { "game": game, "channel": "main", "slot_id": null },
        "audiences": [{ "Game": { "game": game } }],
        "from_event_seq": 0,
        "unexpected": true
    });
    assert!(serde_json::from_value::<LiveResyncRequired>(extra).is_err());
}

#[test]
fn live_server_envelopes_accept_only_hello_zero_and_positive_data_or_resync_ids() {
    let game = game(10);
    let hello = Hello::new("wire-test", main_scope(game, None), Vec::new()).unwrap();
    assert!(ServerEnvelope::new(1, ServerMsg::Hello(hello))
        .validate_live()
        .is_err());

    let delta = LiveProjectionDelta::game(game, vote_clear(game)).unwrap();
    assert!(ServerEnvelope::new(0, ServerMsg::Delta(delta.clone()))
        .validate_live()
        .is_err());
    ServerEnvelope::new(1, ServerMsg::Delta(delta))
        .validate_live()
        .unwrap();

    let resync =
        LiveResyncRequired::new(main_scope(game, None), vec![LiveAudience::Game { game }], 0)
            .unwrap();
    ServerEnvelope::new(2, ServerMsg::ResyncRequired(resync))
        .validate_live()
        .unwrap();
}

#[test]
fn typescript_inventory_exports_scoped_live_types_and_previously_omitted_deltas() {
    let rendered = wire::typescript::render();
    for declaration in [
        "export type LiveScope",
        "export type LiveAudience",
        "export type LiveProjectionDelta",
        "export type LiveResyncRequired",
        "export type ThreadPostRemovedDelta",
        "export type PlayerNotificationsDelta",
        "export type PlayerInvestigationResultsDelta",
    ] {
        assert!(
            rendered.contains(declaration),
            "missing TypeScript declaration: {declaration}"
        );
    }
}

fn mention_post(game: Uuid, mentions: Vec<ThreadPostMention>) -> ThreadPost {
    ThreadPost {
        game,
        source_seq: 12,
        stream_seq: 12,
        channel_id: "main".to_string(),
        author: GameThreadAuthor::Slot {
            slot_id: "slot_1".to_string(),
        },
        phase_id: None,
        body: "@slot_3 you have been quiet".to_string(),
        media: Vec::new(),
        quotations: Vec::new(),
        mentions,
        embed: None,
        citation_count: 0,
        occurred_at: 1,
    }
}

/// A game mention names a seat over a span. Both directions of the wire carry
/// the same closed shape, and a span that could not annotate any body is not
/// representable on either.
#[test]
fn game_mention_spans_are_closed_and_checked_in_both_directions() {
    let decided = ThreadPostMention::new("slot_3", 0, 6).unwrap();
    let claimed = SubmitPostMention::new("slot_3", 0, 6).unwrap();
    let canonical = json!({ "slot_id": "slot_3", "offset": 0, "len": 6 });

    assert_eq!(serde_json::to_value(&decided).unwrap(), canonical);
    assert_eq!(serde_json::to_value(&claimed).unwrap(), canonical);
    assert_eq!(
        serde_json::from_value::<ThreadPostMention>(canonical.clone()).unwrap(),
        decided
    );
    assert_eq!(
        serde_json::from_value::<SubmitPostMention>(canonical).unwrap(),
        claimed
    );

    for invalid in [
        json!({ "slot_id": "", "offset": 0, "len": 6 }),
        json!({ "slot_id": " slot_3", "offset": 0, "len": 6 }),
        json!({ "slot_id": "slot_3", "offset": -1, "len": 6 }),
        json!({ "slot_id": "slot_3", "offset": 0, "len": 0 }),
        json!({ "slot_id": "slot_3", "offset": 0, "len": -6 }),
        json!({ "slot_id": "slot_3", "offset": MAX_SAFE_LIVE_INTEGER + 1, "len": 6 }),
        json!({ "slot_id": "slot_3", "offset": 0, "len": MAX_SAFE_LIVE_INTEGER + 1 }),
        // A game thread addresses a seat and nothing else: there is no shape
        // here that could carry a profile, not even as an ignored extra key.
        json!({ "slot_id": "slot_3", "offset": 0, "len": 6, "profile_id": "smuggled" }),
        json!({ "slot_id": "slot_3", "offset": 0 }),
    ] {
        assert!(
            serde_json::from_value::<ThreadPostMention>(invalid.clone()).is_err(),
            "ThreadPostMention accepted {invalid}"
        );
        assert!(
            serde_json::from_value::<SubmitPostMention>(invalid.clone()).is_err(),
            "SubmitPostMention accepted {invalid}"
        );
    }

    assert!(matches!(
        ThreadPostMention::new("slot_3", 0, 0),
        Err(LiveWireError::InvalidLiveInteger { field: "len", .. })
    ));
    assert!(matches!(
        SubmitPostMention::new(" ", 0, 6),
        Err(LiveWireError::EmptyIdentifier("slot_id"))
    ));
}

/// `From<SlotMention>` carries the write model's decision rather than
/// re-deriving it, so the live boundary is what stands between a malformed
/// decided value and a subscriber.
#[test]
fn live_thread_delta_rechecks_the_mention_spans_it_did_not_decide() {
    let expected_game = game(12);
    let posts = vec![mention_post(
        expected_game,
        vec![ThreadPostMention::new("slot_3", 0, 6).unwrap()],
    )];
    assert!(LiveProjectionDelta::thread(
        expected_game,
        "main",
        ProjectionDelta::ThreadPostsChanged(ThreadPostsDelta {
            game: expected_game,
            posts,
        }),
    )
    .is_ok());

    let unnamed_seat = ThreadPostMention::from(content_reference::SlotMention {
        slot_id: String::new(),
        span: content_reference::MentionSpan { offset: 0, len: 6 },
    });
    assert!(matches!(
        LiveProjectionDelta::thread(
            expected_game,
            "main",
            ProjectionDelta::ThreadPostsChanged(ThreadPostsDelta {
                game: expected_game,
                posts: vec![mention_post(expected_game, vec![unnamed_seat])],
            }),
        ),
        Err(LiveWireError::EmptyIdentifier("slot_id"))
    ));
}

/// The submit field is additive: a client that never heard of mentions still
/// posts, and one that sends them reaches the write model with the seats it
/// claimed and no coercion in between.
#[test]
fn submit_post_mentions_are_optional_and_survive_to_the_write_model() {
    let expected_game = game(13);
    let without: Command = serde_json::from_value(json!({
        "SubmitPost": {
            "game": expected_game,
            "channel_id": "main",
            "actor_slot": "slot_1",
            "body": "nobody in particular"
        }
    }))
    .unwrap();
    match without.into_dispatch() {
        CommandDispatch::Direct(commands::Command::SubmitPost { mentions, .. }) => {
            assert!(mentions.is_empty());
        }
        other => panic!("unexpected dispatch: {other:?}"),
    }

    let with: Command = serde_json::from_value(json!({
        "SubmitPost": {
            "game": expected_game,
            "channel_id": "scumchat",
            "actor_slot": "slot_1",
            "body": "@slot_3 you have been quiet",
            "mentions": [{ "slot_id": "slot_3", "offset": 0, "len": 6 }]
        }
    }))
    .unwrap();
    match with.into_dispatch() {
        CommandDispatch::Direct(commands::Command::SubmitPost { mentions, .. }) => {
            assert_eq!(
                mentions,
                vec![content_reference::SlotMentionCandidate {
                    slot_id: "slot_3".to_string(),
                    offset: 0,
                    len: 6,
                }]
            );
        }
        other => panic!("unexpected dispatch: {other:?}"),
    }

    assert!(serde_json::from_value::<Command>(json!({
        "SubmitPost": {
            "game": expected_game,
            "channel_id": "main",
            "actor_slot": "slot_1",
            "body": "@slot_3 you have been quiet",
            "mentions": [{ "slot_id": "slot_3", "offset": 0, "len": 0 }]
        }
    }))
    .is_err());
}

fn slot_mention(game: Uuid, audience_slot: &str) -> SlotMentionNotification {
    SlotMentionNotification {
        game,
        audience_slot: audience_slot.to_string(),
        channel_id: "private:faction:mafia".to_string(),
        source_seq: 443,
        phase_id: None,
        occurred_at: 1,
    }
}

/// RFC 0007 §7: a delivered game mention is addressed to a seat. It rides the
/// `PlayerSlot` audience, it may not be routed to any other, and it names
/// nothing about who is sitting in that seat.
#[test]
fn delivered_slot_mentions_are_seat_addressed_and_carry_no_occupant() {
    let expected_game = game(14);
    let other_game = game(15);

    let delivered = LiveProjectionDelta::player_slot(
        expected_game,
        "slot_7",
        slot_mentions(expected_game, vec![slot_mention(expected_game, "slot_7")]),
    )
    .unwrap();
    assert!(matches!(
        delivered.audience(),
        LiveAudience::PlayerSlot { game: value, slot_id }
            if *value == expected_game && slot_id == "slot_7"
    ));

    // The seat is the whole address: a row for another seat cannot ride this
    // socket, and a row for another game cannot ride it at all.
    assert!(matches!(
        LiveProjectionDelta::player_slot(
            expected_game,
            "slot_7",
            slot_mentions(expected_game, vec![slot_mention(expected_game, "slot_2")]),
        ),
        Err(LiveWireError::SlotMismatch { .. })
    ));
    assert!(matches!(
        LiveProjectionDelta::player_slot(
            expected_game,
            "slot_7",
            slot_mentions(expected_game, vec![slot_mention(other_game, "slot_7")]),
        ),
        Err(LiveWireError::GameMismatch { .. })
    ));

    // Setup discussion is outside a phase, so a phaseless mention is ordinary,
    // and a seat with no name is not representable on the wire.
    assert!(LiveProjectionDelta::player_slot(
        expected_game,
        "slot_7",
        slot_mentions(expected_game, Vec::new()),
    )
    .is_ok());
    let unnamed = SlotMentionNotification {
        audience_slot: String::new(),
        ..slot_mention(expected_game, "slot_7")
    };
    assert!(matches!(
        LiveProjectionDelta::player_slot(
            expected_game,
            "slot_7",
            slot_mentions(expected_game, vec![unnamed]),
        ),
        Err(LiveWireError::EmptyIdentifier("audience_slot"))
    ));

    // Invariant 11: the delivered fact stores no principal, persona, or
    // occupancy, so there is no field here for one to hide in.
    let serialized = serde_json::to_value(slot_mention(expected_game, "slot_7")).unwrap();
    let fields = serialized.as_object().unwrap();
    assert_eq!(
        fields.keys().map(String::as_str).collect::<Vec<_>>(),
        vec![
            "audience_slot",
            "channel_id",
            "game",
            "occurred_at",
            "phase_id",
            "source_seq"
        ],
    );

    // A host audience cannot carry a seat-addressed delivery.
    assert!(matches!(
        LiveProjectionDelta::host(expected_game, slot_mentions(expected_game, Vec::new())),
        Err(LiveWireError::AudienceDeltaMismatch { .. })
    ));
}
