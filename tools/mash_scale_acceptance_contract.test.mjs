import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertMashScaleAcceptance,
  mashScaleAcceptanceDiff,
} from "./mash_scale_acceptance_contract.mjs";

function validReport() {
  return {
    artifact_version: 1,
    artifact_path: "target/mash-scale-acceptance/report.json",
    ok: true,
    proof_boundary: "Local deterministic 60-seat scale proof.",
    game_id: "6d617368-7363-416c-8000-000000000013",
    roster_count: 60,
    event_count: 5,
    total_participation_rows: 300,
    concurrency: {
      requested: 40,
      acknowledged: 40,
      retryable_conflicts: 0,
      retries: 0,
      unexpected_rejections: 0,
      final_participation_rows: 40,
      duplicate_participation_rows: 0,
      elapsed_ms: 900,
      threshold_ms: 20_000,
    },
    scheduler: {
      replicas: 2,
      open_claimed_games: 1,
      lock_claimed_games: 1,
      failed_games: 0,
      opened_and_locked_events: 5,
      narrative_posts: 10,
      distinct_narrative_receipts: 10,
      published_narratives: 10,
      elapsed_ms: 120,
      threshold_ms: 5_000,
    },
    participation_page: {
      page_limit: 100,
      rows_returned: 60,
      next_cursor: null,
      cursor_page_size: 25,
      cursor_round_trip_rows: 50,
      cursor_distinct_rows: 50,
      rows_examined: 120,
      maximum_rows_examined: 202,
      keyset_index_used: true,
    },
    player_attention: {
      open_events_visible_to_player: 5,
      open_events_player_can_act_on: 5,
      attention_items: 5,
    },
    host_console: {
      slot_count: 60,
      day_event_count: 5,
      participant_references: 300,
      attention_task_count: 5,
      maximum_attention_tasks: 8,
      serialized_bytes: 28_000,
      maximum_serialized_bytes: 512 * 1024,
      elapsed_ms: 30,
      threshold_ms: 2_000,
    },
    rebuild: {
      ok: true,
      diff_count: 0,
      participation_rows_after_rebuild: 300,
      published_narratives_after_rebuild: 10,
      elapsed_ms: 700,
      threshold_ms: 5_000,
    },
  };
}

test("mash scale artifact accepts the complete bounded 60-seat proof", () => {
  assert.equal(assertMashScaleAcceptance(validReport()).ok, true);
});

test("mash scale artifact rejects concurrency, receipt, pagination, and rebuild drift", () => {
  const report = validReport();
  report.concurrency.duplicate_participation_rows = 1;
  report.scheduler.distinct_narrative_receipts = 9;
  report.participation_page.cursor_distinct_rows = 49;
  report.participation_page.rows_examined = 203;
  report.player_attention.attention_items = 4;
  report.host_console.attention_task_count = 9;
  report.rebuild.ok = false;
  assert.deepEqual(mashScaleAcceptanceDiff(report), [
    "concurrency.duplicate_participation_rows",
    "scheduler.distinct_narrative_receipts",
    "participation_page.cursor_distinct_rows",
    "participation_page.rows_examined",
    "player_attention.attention_items",
    "host_console.attention_task_count",
    "rebuild.ok",
  ]);
});

test("mash scale artifact rejects every elapsed-time ceiling regression", () => {
  const report = validReport();
  report.concurrency.elapsed_ms = report.concurrency.threshold_ms + 1;
  report.scheduler.elapsed_ms = report.scheduler.threshold_ms + 1;
  report.host_console.elapsed_ms = report.host_console.threshold_ms + 1;
  report.rebuild.elapsed_ms = report.rebuild.threshold_ms + 1;
  assert.deepEqual(mashScaleAcceptanceDiff(report), [
    "concurrency.elapsed_ms",
    "scheduler.elapsed_ms",
    "host_console.elapsed_ms",
    "rebuild.elapsed_ms",
  ]);
});
