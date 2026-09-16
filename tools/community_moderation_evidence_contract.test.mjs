import assert from "node:assert/strict";
import test from "node:test";
import { assertModerationRevisionStage, assertModerationEvidenceAccess } from "./community_moderation_evidence_contract.mjs";

function fixture() {
  const captured = { revision: 0, body: "Reported original", quotations: [{ target: { kind: "discussion_post", scope_id: "topic", source_seq: 1 }, excerpt: "Quoted original" }], profile_mentions: [{ profile_id: "profile", offset: 0, len: 3 }], slot_mentions: [], retracted: false };
  const expected = { captured, bodies: [captured.body, "Replacement one", "Replacement two"], reportId: "report", caseId: "case", topic: "topic", sourceSeq: 2, reporterPrincipalId: "member" };
  const contentHistory = expected.bodies.map((body, revision) => ({ content: { ...captured, body, revision, profile_mentions: revision === 0 ? captured.profile_mentions : [], retracted: revision === 2 }, superseded_at: revision === 2 ? null : 42 }));
  const stage = {
    revision: 2, retracted: true,
    api: { case: { case_id: "case", surface_id: "topic", source_seq: 2, target_revision: 2, target_retracted: true, target_body: expected.bodies[2] }, reports: [{ report_id: "report", reporter_principal_id: "member", evidence: { status: "captured", content: structuredClone(captured) } }], content_history: contentHistory },
    rendered: { queue: "Current content · revision 2 · retracted by author\nReplacement two", currentHeading: "Revision 2 · retracted by author", currentBody: expected.bodies[2], reporter: "member", capturedHeading: "Content captured with report · revision 0", capturedBody: captured.body, capturedQuotations: ["Quoted original"], history: contentHistory.map(({ content }, index) => ({ heading: `Revision ${index} · ${index === 2 ? "current" : "superseded"}`, body: content.body, retracted: content.retracted, quotations: ["Quoted original"] })) },
  };
  const access = { memberCaseStatus: 403, memberQueueStatus: 403, memberSelectedPageStatus: 403, ownReceipt: { report_id: "report", status: "received", submitted_at: 42 }, publicPost: { source_seq: 2, retracted: true, body: "", quotations: [], mentions: [] }, publicText: "Retracted by author", deniedPageText: "403 Forbidden" };
  return { expected, stage, access };
}

test("moderation proof accepts distinct immutable evidence, current content, and retained history", () => {
  const { expected, stage, access } = fixture();
  assertModerationRevisionStage(stage, expected);
  assertModerationEvidenceAccess(access, expected);
});

for (const [name, mutate] of [
  ["report replaced by current content", stage => { stage.api.reports[0].evidence.content.body = "Replacement two"; }],
  ["captured quotation dropped", stage => { stage.rendered.capturedQuotations = []; }],
  ["stale current body", stage => { stage.rendered.currentBody = "Reported original"; }],
  ["collapsed revision history", stage => { stage.api.content_history.splice(1, 1); }],
  ["superseded content marked current", stage => { stage.rendered.history[0].heading = "Revision 0 · current"; }],
  ["lost retraction marker", stage => { stage.rendered.currentHeading = "Revision 2"; }],
]) {
  test(`moderation proof rejects ${name}`, () => {
    const { expected, stage } = fixture();
    mutate(stage);
    assert.throws(() => assertModerationRevisionStage(stage, expected));
  });
}

for (const [name, mutate] of [
  ["member case access", access => { access.memberCaseStatus = 200; }],
  ["evidence in receipt", access => { access.ownReceipt.evidence = { body: "Reported original" }; }],
  ["public retained body", access => { access.publicText += " Replacement one"; }],
  ["retained content in denied page", access => { access.deniedPageText += " Reported original"; }],
]) {
  test(`moderation proof rejects ${name}`, () => {
    const { expected, access } = fixture();
    mutate(access);
    assert.throws(() => assertModerationEvidenceAccess(access, expected));
  });
}
