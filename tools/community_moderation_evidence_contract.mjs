import assert from "node:assert/strict";

// Compare observations from the API and rendered moderator surface against
// fixture content, so current content cannot stand in for a captured report.
export function assertModerationRevisionStage(stage, expected) {
  const { revision, retracted, api, rendered } = stage;
  const { captured, bodies, reportId, caseId, topic, sourceSeq, reporterPrincipalId } = expected;
  assert.ok(Number.isInteger(revision) && revision >= 0 && revision < bodies.length);
  assert.equal(api.case.case_id, caseId);
  assert.equal(api.case.surface_id, topic);
  assert.equal(api.case.source_seq, sourceSeq);
  assert.equal(api.case.target_revision, revision);
  assert.equal(api.case.target_retracted, retracted);
  assert.equal(api.case.target_body, bodies[revision]);
  assert.equal(api.reports.length, 1);
  const report = api.reports.find(item => item.report_id === reportId);
  assert.equal(report?.reporter_principal_id, reporterPrincipalId);
  assert.deepEqual(report?.evidence, { status: "captured", content: captured }, "reported evidence changed with the source post");
  assert.equal(rendered.currentBody, bodies[revision]);
  assert.equal(rendered.currentHeading.trim(), `Revision ${revision}${retracted ? " · retracted by author" : ""}`);
  assert.equal(rendered.queueHeading, `Current content · revision ${revision}${retracted ? " · retracted by author" : ""}`);
  assert.equal(rendered.queueBody, bodies[revision]);
  assert.ok(rendered.reporter.includes(reporterPrincipalId));
  assert.equal(rendered.capturedHeading, `Content captured with report · revision ${captured.revision}`);
  assert.equal(rendered.capturedBody, captured.body);
  assert.deepEqual(rendered.capturedQuotations, captured.quotations.map(item => item.excerpt));
  assert.equal(api.content_history.length, revision + 1);
  assert.equal(rendered.history.length, revision + 1);
  for (let index = 0; index <= revision; index += 1) {
    const current = index === revision;
    const retained = api.content_history[index];
    const visible = rendered.history[index];
    const isRetracted = current && retracted;
    assert.deepEqual(retained.content, {
      ...captured,
      revision: index,
      body: bodies[index],
      profile_mentions: index === 0 ? captured.profile_mentions : [],
      retracted: isRetracted,
    }, `revision ${index} history drifted`);
    if (current) assert.equal(retained.superseded_at, null);
    else assert.ok(Number.isSafeInteger(retained.superseded_at) && retained.superseded_at > 0);
    assert.equal(visible.heading, `Revision ${index} · ${current ? "current" : "superseded"}`);
    assert.equal(visible.body, bodies[index]);
    assert.equal(visible.retracted, isRetracted);
    assert.deepEqual(visible.quotations, captured.quotations.map(item => item.excerpt));
  }
}

export function assertModerationEvidenceAccess(access, expected) {
  for (const key of ["memberCaseStatus", "memberQueueStatus", "memberSelectedPageStatus"]) {
    assert.equal(access[key], 403, `${key} admitted a member to retained evidence`);
  }
  assert.deepEqual(Object.keys(access.ownReceipt).sort(), ["report_id", "status", "submitted_at"]);
  assert.equal(access.ownReceipt.report_id, expected.reportId);
  assert.equal(access.publicPost?.source_seq, expected.sourceSeq);
  assert.equal(access.publicPost.retracted, true);
  assert.equal(access.publicPost.body, "");
  assert.deepEqual(access.publicPost.quotations, []);
  assert.deepEqual(access.publicPost.mentions, []);
  for (const body of expected.bodies) {
    assert.ok(!access.publicText.includes(body), "public retracted post exposed retained content");
    assert.ok(!access.deniedPageText.includes(body), "denied moderator page exposed retained content");
    assert.ok(!JSON.stringify(access.ownReceipt).includes(body), "private receipt exposed retained content");
  }
}
