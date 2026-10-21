// Complete Railway deployment history for one staging service, including
// deleted entries. Release recovery decisions read this, never a bounded list.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {CANONICAL_RELEASE_TOPOLOGY as topology} from './release_coordinator_contract.mjs';

// Exceeds a coordinator Railway subprocess's five-minute request timeout, so a
// request whose response was lost has reached deployment history by then.
export const RAILWAY_REQUEST_SETTLE_MS = 6 * 60_000;
// Deployments this long before a lease was created cannot belong to it.
export const RELEASE_WINDOW_LEAD_MS = 5 * 60_000;
export const TERMINAL_DEPLOYMENT_STATUSES = Object.freeze(['SUCCESS', 'FAILED', 'CRASHED', 'REMOVED', 'SKIPPED']);
const root = fileURLToPath(new URL('..', import.meta.url));

export const deploymentHistoryQuery = `query($input: DeploymentListInput!, $after: String) {
  deployments(input:$input,first:100,after:$after) {
    edges {node {id createdAt status projectId environmentId serviceId meta deploymentStopped instances {id status}}} pageInfo {hasNextPage endCursor}
  }
}`;

export async function completeHistory(fetchPage) {
  const rows = [], cursors = new Set(), ids = new Set();
  let after = null;
  for (let page = 0; page < 1000; page++) {
    const result = await fetchPage(after);
    assert.ok(Array.isArray(result?.edges), 'deployment history missing edges');
    assert.equal(typeof result.pageInfo?.hasNextPage, 'boolean', 'history completeness unknown');
    for (const {node} of result.edges) {
      assert.ok(node?.id && !ids.has(node.id), 'duplicate or missing deployment identity');
      ids.add(node.id); rows.push(node);
    }
    if (!result.pageInfo.hasNextPage) return rows.sort((a,b)=>a.id.localeCompare(b.id));
    after = result.pageInfo.endCursor;
    assert.ok(typeof after === 'string' && after && !cursors.has(after), 'history cursor stalled');
    cursors.add(after);
  }
  throw new Error('deployment history exceeded bounded complete scan');
}

export async function loadStagingServiceHistory(serviceId, session) {
  return await completeHistory(async after => {
    const output = execFileSync('railway',['api',deploymentHistoryQuery,'--variables',JSON.stringify({after,input:{
      projectId:topology.project_id,environmentId:topology.environments.staging.id,serviceId,includeDeleted:true,
    }}),'--compact'],{cwd:root,encoding:'utf8',timeout:300_000,stdio:['ignore','pipe','pipe'],env:{...process.env,
      RAILWAY_CALLER:'skill:use-railway@1.5.5',RAILWAY_AGENT_SESSION:session}});
    const response=JSON.parse(output);
    assert.equal(response.errors,undefined,'Railway history query failed');
    return response.data?.deployments;
  });
}

/**
 * Prove a service has no deployment belonging to a release window: every row
 * predates the lease by the window lead and is terminal. An empty history
 * cannot prove anything.
 */
export function assertNoDeploymentsInReleaseWindow(leaseCreatedAt, rows, label = 'service') {
  const cutoff = Date.parse(leaseCreatedAt) - RELEASE_WINDOW_LEAD_MS;
  assert.ok(Number.isFinite(cutoff), 'release lease time missing');
  assert.ok(Array.isArray(rows) && rows.length > 0, `empty ${label} deployment history cannot prove an absent deployment`);
  for (const row of rows) {
    assert.ok(Number.isFinite(Date.parse(row.createdAt)), 'deployment time missing');
    assert.ok(Date.parse(row.createdAt) < cutoff, `${label} deployment exists within or after the release window`);
    assert.ok(TERMINAL_DEPLOYMENT_STATUSES.includes(row.status), `nonterminal ${label} deployment prevents the proof`);
  }
  return rows;
}
