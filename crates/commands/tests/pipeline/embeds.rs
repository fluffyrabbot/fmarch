use commands::{handle, Command};
use sqlx::PgPool;

use crate::common::*;

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn submit_post_records_a_main_thread_youtube_embed(pool: PgPool) {
    let host = "host_embed";
    let slot = "slot_1";
    let occupant = "player_embed";
    let game = setup_game(&pool, host, slot, occupant).await;

    handle(
        &pool,
        &user(occupant),
        Command::SubmitPost {
            game,
            channel_id: "main".into(),
            actor_slot: slot.into(),
            body: "".into(),
            media: Vec::new(),
            quotations: Vec::new(),
            mentions: Vec::new(),
            embed_url: Some("https://www.youtube.com/shorts/dQw4w9WgXcQ?t=15".into()),
            embed_snapshot: Some(game_platform::embed::EmbedSnapshot {
                title: "Never Gonna Give You Up".into(),
                author: Some("Rick Astley".into()),
                poster: None,
            }),
        },
    )
    .await
    .expect("youtube embed post");

    let thread = projections::thread_view(&pool, game, None, 10)
        .await
        .expect("thread view");
    let embed = thread.posts[0].embed.clone().expect("stored embed");
    assert_eq!(embed.provider_id, "dQw4w9WgXcQ");
    assert_eq!(embed.start_seconds, Some(15));
    assert_eq!(
        embed
            .snapshot
            .as_ref()
            .map(|snapshot| snapshot.title.as_str()),
        Some("Never Gonna Give You Up")
    );
    assert_eq!(
        embed
            .snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.poster.as_ref()),
        None
    );
    assert_eq!(
        embed.playback_src(),
        "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=15"
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn submit_post_rejects_embeds_off_the_main_thread(pool: PgPool) {
    let host = "host_embed_priv";
    let slot = "slot_1";
    let occupant = "player_embed_priv";
    let game = setup_game(&pool, host, slot, occupant).await;

    let rejected = handle(
        &pool,
        &user(occupant),
        Command::SubmitPost {
            game,
            channel_id: format!("private:role_pm:{slot}"),
            actor_slot: slot.into(),
            body: "clip".into(),
            media: Vec::new(),
            quotations: Vec::new(),
            mentions: Vec::new(),
            embed_url: Some("https://youtu.be/dQw4w9WgXcQ".into()),
            embed_snapshot: None,
        },
    )
    .await;
    assert!(matches!(rejected, Err(commands::Reject::InvalidTarget)));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn submit_post_rejects_unknown_embed_hosts(pool: PgPool) {
    let host = "host_embed_bad";
    let slot = "slot_1";
    let occupant = "player_embed_bad";
    let game = setup_game(&pool, host, slot, occupant).await;

    let rejected = handle(
        &pool,
        &user(occupant),
        Command::SubmitPost {
            game,
            channel_id: "main".into(),
            actor_slot: slot.into(),
            body: "clip".into(),
            media: Vec::new(),
            quotations: Vec::new(),
            mentions: Vec::new(),
            embed_url: Some("https://example.com/watch?v=dQw4w9WgXcQ".into()),
            embed_snapshot: None,
        },
    )
    .await;
    assert!(matches!(rejected, Err(commands::Reject::InvalidTarget)));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn submit_post_rejects_embeds_without_a_snapshot(pool: PgPool) {
    let host = "host_embed_nosnap";
    let slot = "slot_1";
    let occupant = "player_embed_nosnap";
    let game = setup_game(&pool, host, slot, occupant).await;

    let rejected = handle(
        &pool,
        &user(occupant),
        Command::SubmitPost {
            game,
            channel_id: "main".into(),
            actor_slot: slot.into(),
            body: "clip".into(),
            media: Vec::new(),
            quotations: Vec::new(),
            mentions: Vec::new(),
            embed_url: Some("https://youtu.be/dQw4w9WgXcQ".into()),
            embed_snapshot: None,
        },
    )
    .await;
    assert!(matches!(rejected, Err(commands::Reject::InvalidTarget)));
}
