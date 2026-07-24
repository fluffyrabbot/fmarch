import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const mashScaleAcceptanceVersion = 1;

export function mashScaleAcceptanceDiff(report) {
  const diffs = [];
  check(report?.artifact_version === mashScaleAcceptanceVersion, "artifact_version", diffs);
  check(report?.ok === true, "ok", diffs);
  check(typeof report?.artifact_path === "string" && report.artifact_path.length > 0, "artifact_path", diffs);
  check(typeof report?.proof_boundary === "string" && report.proof_boundary.includes("60-seat"), "proof_boundary", diffs);
  check(report?.roster_count === 60, "roster_count", diffs);
  check(report?.event_count === 5, "event_count", diffs);
  check(report?.total_participation_rows === 300, "total_participation_rows", diffs);

  const concurrency = report?.concurrency;
  check(concurrency?.requested === 40, "concurrency.requested", diffs);
  check(concurrency?.acknowledged === 40, "concurrency.acknowledged", diffs);
  check(concurrency?.unexpected_rejections === 0, "concurrency.unexpected_rejections", diffs);
  check(concurrency?.final_participation_rows === 40, "concurrency.final_participation_rows", diffs);
  check(concurrency?.duplicate_participation_rows === 0, "concurrency.duplicate_participation_rows", diffs);
  check(withinBudget(concurrency), "concurrency.elapsed_ms", diffs);

  const scheduler = report?.scheduler;
  check(scheduler?.replicas === 2, "scheduler.replicas", diffs);
  check(scheduler?.open_claimed_games === 1, "scheduler.open_claimed_games", diffs);
  check(scheduler?.lock_claimed_games === 1, "scheduler.lock_claimed_games", diffs);
  check(scheduler?.failed_games === 0, "scheduler.failed_games", diffs);
  check(scheduler?.opened_and_locked_events === 5, "scheduler.opened_and_locked_events", diffs);
  check(scheduler?.narrative_posts === 10, "scheduler.narrative_posts", diffs);
  check(scheduler?.distinct_narrative_receipts === 10, "scheduler.distinct_narrative_receipts", diffs);
  check(scheduler?.published_narratives === 10, "scheduler.published_narratives", diffs);
  check(withinBudget(scheduler), "scheduler.elapsed_ms", diffs);

  const page = report?.participation_page;
  check(page?.page_limit === 100, "participation_page.page_limit", diffs);
  check(page?.rows_returned === 60, "participation_page.rows_returned", diffs);
  check(page?.next_cursor === null, "participation_page.next_cursor", diffs);
  check(page?.cursor_page_size === 25, "participation_page.cursor_page_size", diffs);
  check(page?.cursor_round_trip_rows === 50, "participation_page.cursor_round_trip_rows", diffs);
  check(page?.cursor_distinct_rows === 50, "participation_page.cursor_distinct_rows", diffs);
  check(page?.maximum_rows_examined === 202, "participation_page.maximum_rows_examined", diffs);
  check(Number.isInteger(page?.rows_examined) && page.rows_examined <= 202, "participation_page.rows_examined", diffs);
  check(page?.keyset_index_used === true, "participation_page.keyset_index_used", diffs);

  const attention = report?.player_attention;
  check(attention?.open_events_visible_to_player === 5, "player_attention.open_events_visible_to_player", diffs);
  check(attention?.open_events_player_can_act_on === 5, "player_attention.open_events_player_can_act_on", diffs);
  check(
    attention?.attention_items === attention?.open_events_player_can_act_on,
    "player_attention.attention_items",
    diffs,
  );

  const host = report?.host_console;
  check(host?.slot_count === 60, "host_console.slot_count", diffs);
  check(host?.day_event_count === 5, "host_console.day_event_count", diffs);
  check(host?.participant_references === 300, "host_console.participant_references", diffs);
  check(host?.maximum_attention_tasks === 8, "host_console.maximum_attention_tasks", diffs);
  check(
    Number.isInteger(host?.attention_task_count) &&
      host.attention_task_count <= host.maximum_attention_tasks,
    "host_console.attention_task_count",
    diffs,
  );
  check(
    Number.isInteger(host?.serialized_bytes) &&
      Number.isInteger(host?.maximum_serialized_bytes) &&
      host.serialized_bytes <= host.maximum_serialized_bytes,
    "host_console.serialized_bytes",
    diffs,
  );
  check(withinBudget(host), "host_console.elapsed_ms", diffs);

  const rebuild = report?.rebuild;
  check(rebuild?.ok === true, "rebuild.ok", diffs);
  check(rebuild?.diff_count === 0, "rebuild.diff_count", diffs);
  check(rebuild?.participation_rows_after_rebuild === 300, "rebuild.participation_rows_after_rebuild", diffs);
  check(rebuild?.published_narratives_after_rebuild === 10, "rebuild.published_narratives_after_rebuild", diffs);
  check(withinBudget(rebuild), "rebuild.elapsed_ms", diffs);
  return diffs;
}

export function assertMashScaleAcceptance(report) {
  const diffs = mashScaleAcceptanceDiff(report);
  if (diffs.length > 0) {
    throw new Error(`mash scale acceptance artifact drifted: ${diffs.join(", ")}`);
  }
  return report;
}

function withinBudget(value) {
  return (
    Number.isInteger(value?.elapsed_ms) &&
    value.elapsed_ms >= 0 &&
    Number.isInteger(value?.threshold_ms) &&
    value.threshold_ms > 0 &&
    value.elapsed_ms <= value.threshold_ms
  );
}

function check(condition, path, diffs) {
  if (!condition) diffs.push(path);
}

async function main(path) {
  if (!path) {
    throw new Error("usage: node tools/mash_scale_acceptance_contract.mjs <report.json>");
  }
  const report = JSON.parse(await readFile(path, "utf8"));
  assertMashScaleAcceptance(report);
  console.log(`mash scale acceptance artifact passed: ${path}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main(process.argv[2]);
}
