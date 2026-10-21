import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {oneShotExecutionOutcome} from './release_coordinator.mjs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CANONICAL_RELEASE_TOPOLOGY as topology, receiptDigest, assertFullCommit} from './release_coordinator_contract.mjs';
import {publishImmutableJson} from './immutable_json_receipt.mjs';
import {assertNoDeploymentsInReleaseWindow, loadStagingServiceHistory, RAILWAY_REQUEST_SETTLE_MS, RELEASE_WINDOW_LEAD_MS, TERMINAL_DEPLOYMENT_STATUSES} from './railway_deployment_history.mjs';
import {readStagingReleaseMutationLease, fenceStagingReleaseForAbandonment,
  readStagingAbandonmentFence, archiveStagingAbandonmentFence,
  releaseStagingReleaseMutationLease} from './release_git_authority.mjs';

export {completeHistory, deploymentHistoryQuery} from './railway_deployment_history.mjs';
export const ABANDONMENT_SETTLE_MS = RAILWAY_REQUEST_SETTLE_MS;
const root = fileURLToPath(new URL('..', import.meta.url));

export function assertNoReleaseDeployments(intent, histories) {
  assert.equal(intent.operation_kind, 'release-coordinator', 'only coordinator leases can be abandoned');
  assert.deepEqual(Object.keys(histories).sort(), Object.values(topology.services).sort());
  for (const rows of Object.values(histories)) assertNoDeploymentsInReleaseWindow(intent.created_at, rows);
  return histories;
}


export function assertFailedMigration(intent, histories, failure) {
  assert.equal(intent.operation_kind, 'release-coordinator');
  const op = failure.intent;
  const {receipt_sha256, ...base} = op;
  assert.equal(receipt_sha256, receiptDigest(base), 'migration intent digest mismatch');
  assert.equal(op.kind, 'fmarch-database-one-shot-intent');
  assert.equal(op.release_commit, intent.release_commit);
  assert.equal(op.staging_mutation_lease_commit, failure.lease);
  assert.equal(op.environment, 'staging');
  assert.equal(op.project_id, topology.project_id);
  assert.equal(op.environment_id, topology.environments.staging.id);
  assert.equal(op.service_id, topology.services.migrator);
  assert.equal(op.phase, 'migrate');
  assert.equal(op.generation, 0, 'only the first failed migration can be retired');
  assert.match(op.operation_id, /^[0-9a-f]{64}$/u);
  assert.equal(op.start_command, `fmarch-migrate --operation-id ${op.operation_id}`);
  const identity = {...base, kind:'fmarch-database-one-shot-operation-id', start_command_base:'fmarch-migrate'};
  delete identity.start_command; delete identity.operation_id;
  assert.equal(op.operation_id, receiptDigest(identity), 'migration operation identity mismatch');
  const cutoff=Date.parse(intent.created_at)-5*60_000;
  assert.ok(Number.isFinite(cutoff));
  assert.deepEqual(Object.keys(histories).sort(), Object.values(topology.services).sort());
  let found=0;
  for(const [serviceId, rows] of Object.entries(histories)) {
    assert.ok(rows.length>0, 'empty history cannot prove failed release retirement');
    for(const row of rows) {
      assert.ok(Number.isFinite(Date.parse(row.createdAt)));
      assert.ok(TERMINAL_DEPLOYMENT_STATUSES.includes(row.status), 'nonterminal deployment prevents retirement');
      if(Date.parse(row.createdAt)<cutoff) continue;
      assert.equal(serviceId, topology.services.migrator, 'application deployment prevents failed migration retirement');
      assert.equal(row.id, failure.deployment_id, 'additional release-window deployment prevents retirement');
      assert.equal(row.projectId, op.project_id); assert.equal(row.environmentId, op.environment_id);
      assert.equal(row.serviceId, op.service_id);
      assert.equal(row.meta?.imageDigest, op.digest);
      assert.equal(row.meta?.image, `${op.repository}@${op.digest}`);
      assert.equal(row.meta?.serviceManifest?.deploy?.startCommand, op.start_command);
      assert.equal(row.meta?.serviceManifest?.deploy?.restartPolicyType, 'NEVER');
      assert.equal(row.deploymentStopped, true);
      assert.equal(row.instances?.length, 1, 'failed migration must have one stopped instance');
      assert.equal(row.instances[0].status, 'CRASHED');
      assert.equal(oneShotExecutionOutcome(row)?.status,'CRASHED');
      found++;
    }
  }
  assert.equal(found,1,'exact failed migration missing');
  return histories;
}

/**
 * Retire a lease whose release deployed but whose acceptance failed. Every
 * deployment in the release window must be terminal and must run exactly an
 * image of the lease's own attempt receipt, so nothing foreign or in flight is
 * hidden by the retirement. Staging keeps serving those images; the next
 * release replaces them.
 */
export function assertFailedAcceptance(intent, histories, failure) {
  assert.equal(intent.operation_kind, 'release-coordinator', 'only coordinator leases can be retired');
  const attempt = failure.attempt;
  const {receipt_sha256, ...base} = attempt ?? {};
  assert.equal(receipt_sha256, receiptDigest(base), 'release attempt digest mismatch');
  assert.equal(attempt.kind, 'fmarch-release-attempt');
  assert.equal(attempt.environment, 'staging');
  assert.equal(attempt.commit, intent.release_commit, 'release attempt commit differs from the lease');
  assert.equal(attempt.staging_mutation_lease_commit, failure.lease, 'release attempt belongs to another lease');
  assert.deepEqual(attempt.topology?.services, topology.services, 'release attempt topology drifted');
  const runtime = `${topology.images.runtime}@${attempt.images?.runtime}`;
  const images = {
    [topology.services.migrator]: runtime,
    [topology.services.api]: runtime,
    [topology.services.frontend]: `${topology.images.frontend}@${attempt.images?.frontend}`,
  };
  const cutoff = Date.parse(intent.created_at) - RELEASE_WINDOW_LEAD_MS;
  assert.ok(Number.isFinite(cutoff));
  assert.deepEqual(Object.keys(histories).sort(), Object.values(topology.services).sort());
  let released = 0;
  for (const [serviceId, rows] of Object.entries(histories)) {
    assert.ok(Array.isArray(rows) && rows.length > 0, 'empty history cannot prove failed acceptance retirement');
    for (const row of rows) {
      assert.ok(Number.isFinite(Date.parse(row.createdAt)), 'deployment time missing');
      assert.ok(TERMINAL_DEPLOYMENT_STATUSES.includes(row.status), 'nonterminal deployment prevents retirement');
      if (Date.parse(row.createdAt) < cutoff) continue;
      assert.equal(row.serviceId, serviceId);
      assert.equal(row.meta?.image, images[serviceId], 'release-window deployment is not this lease\'s release image');
      released++;
    }
  }
  assert.ok(released > 0, 'no release deployment exists; use pre-deployment abandonment');
  return histories;
}

function assertRecoveryHistories(intent, histories, document) {
  if (document?.failed_migration) return assertFailedMigration(intent, histories, document.failed_migration);
  if (document?.failed_acceptance) return assertFailedAcceptance(intent, histories, document.failed_acceptance);
  return assertNoReleaseDeployments(intent, histories);
}
const recoveryStatus = document => document.failed_migration ? 'retired-after-failed-migration'
  : document.failed_acceptance ? 'retired-after-failed-acceptance' : 'abandoned-before-deployment';

/**
 * The coordinator PID is evidence for this Mac's process table. When it was
 * never captured (for example a coordinator run from a background shell),
 * `unknown` records that honestly; the process-table scan still refuses any
 * live coordinator and the operator confirmation covers every host.
 */
export function parseStoppedPid(value) {
  if (value === undefined) return null;
  if (value === 'unknown') return 'unknown';
  const pid = Number(value);
  assert.ok(Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid, 'invalid stopped coordinator PID');
  return pid;
}

function assertStopped(pid) {
  if(typeof pid === 'number') {
    assert.ok(Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid, 'invalid stopped coordinator PID');
    try {process.kill(pid,0); assert.fail('coordinator PID is still alive');}
    catch (error) {if(error.code !== 'ESRCH') throw error;}
  }
  const processes = execFileSync('ps',['-axo','command='],{encoding:'utf8'});
  assert.equal(processes.split('\n').some(s=> /(?:^|\s)node\s+(?:\S*\/)?release_coordinator\.mjs(?:\s|$)/u.test(s)), false,
    'another local release coordinator is active');
}

async function histories() {
  const result = {};
  for (const serviceId of Object.values(topology.services)) {
    result[serviceId] = await loadStagingServiceHistory(serviceId, `fmarch-abandon-${process.pid}`);
  }
  return result;
}

export async function finishAbandonment({document, token, fence, releaseCommit}, operations) {
  assert.ok(operations.now() >= Date.parse(document.created_at) + ABANDONMENT_SETTLE_MS, 'recovery settle interval has not elapsed');
  await operations.assertStopped();
  await operations.assertFence();
  const after = assertRecoveryHistories(document.original_intent, await operations.histories(), document);
  assert.equal(receiptDigest(after), document.history_sha256, 'deployment history changed under recovery fence');
  await operations.publishEvidence({kind:'fmarch-staging-abandonment-evidence', token, fence,
    release_commit:releaseCommit, history_sha256:receiptDigest(after), histories:after});
  await operations.archiveFence();
  await operations.assertStopped();
  await operations.assertFence();
  await operations.releaseFence();
  await operations.publishResult({status:recoveryStatus(document), token, fence});
}

export async function main(argv=process.argv.slice(2)) {
  const args = {};
  for(let i=0;i<argv.length;i++) {
    if(argv[i]==='--apply') args.apply=true;
    else {assert.ok(['--lease','--commit','--stopped-pid','--confirm-stopped','--resume-fence','--failed-migrator','--failure-intent','--failed-acceptance'].includes(argv[i]),'unknown recovery option');args[argv[i].slice(2)]=argv[++i];}
  }
  const token=assertFullCommit(args.lease), releaseCommit=assertFullCommit(args.commit);
  const pid=parseStoppedPid(args['stopped-pid']);
  assert.ok(pid !== null || args['failed-migrator'] || args['resume-fence'], 'pre-deployment abandonment requires --stopped-pid <pid|unknown>');
  assert.equal(args['confirm-stopped'],token,'confirm all coordinators for this exact lease are stopped');
  assertStopped(pid);
  let fence=args['resume-fence'];
  let document=fence ? readStagingAbandonmentFence({fence,token,releaseCommit}) : null;
  const intent=document?.original_intent ?? readStagingReleaseMutationLease({token,releaseCommit});
  if(document) assert.equal(document.stopped_pid,pid);
  let failure = document?.failed_migration ?? null;
  if(args['failed-migrator'] || args['failure-intent']) {
    assert.ok(args['failed-migrator'] && args['failure-intent'], 'failed migration requires deployment and intent');
    const proposed={deployment_id:args['failed-migrator'], lease:token,
      intent:JSON.parse(await readFile(args['failure-intent'],'utf8'))};
    if(failure) assert.deepEqual(proposed,failure,'failed migration recovery changed');
    failure=proposed;
  }
  if(failure) assert.equal(failure.lease,token);
  let acceptance = document?.failed_acceptance ?? null;
  if(args['failed-acceptance']) {
    assert.equal(failure, null, 'a lease retires for one failure only');
    const proposed={lease:token, attempt:JSON.parse(await readFile(args['failed-acceptance'],'utf8'))};
    if(acceptance) assert.deepEqual(proposed,acceptance,'failed acceptance recovery changed');
    acceptance=proposed;
  }
  const before=assertRecoveryHistories(intent,await histories(),{failed_migration:failure, failed_acceptance:acceptance});
  if(!args.apply) {console.log(JSON.stringify({status:'eligible',token,releaseCommit,history_sha256:receiptDigest(before)}));return;}
  if(!fence) {
    const result=fenceStagingReleaseForAbandonment({token,releaseCommit,stoppedPid:pid,historySha256:receiptDigest(before),failedMigration:failure,failedAcceptance:acceptance});
    fence=result.fence; document=result.document;
  }
  const directory=path.join(root,'target/releases/staging/recoveries',`${token}.${fence}`);
  console.log(JSON.stringify({status:'fenced',token,fence,resume:'Repeat the same arguments with --resume-fence '+fence}));
  await publishImmutableJson(path.join(directory,'fence.json'),document);
  // A fence deliberately remains on every error, including lost local receipts.
  while(Date.now() < Date.parse(document.created_at)+ABANDONMENT_SETTLE_MS) {
    console.log('Waiting for any prior Railway request to settle under the recovery fence.');
    await new Promise(resolve=>setTimeout(resolve,Math.min(30_000,Date.parse(document.created_at)+ABANDONMENT_SETTLE_MS-Date.now())));
  }
  await finishAbandonment({document,token,fence,releaseCommit}, {
    now:()=>Date.now(), assertStopped:()=>assertStopped(pid),
    assertFence:()=>readStagingAbandonmentFence({fence,token,releaseCommit}), histories,
    publishEvidence:record=>publishImmutableJson(path.join(directory,'no-deployments.json'),record),
    archiveFence:()=>archiveStagingAbandonmentFence({fence,token,releaseCommit}),
    releaseFence:()=>releaseStagingReleaseMutationLease(fence),
    publishResult:record=>publishImmutableJson(path.join(directory,'released.json'),record),
  });
  console.log(JSON.stringify({status:recoveryStatus(document),token,fence,evidence:directory}));
}
if(pathToFileURL(process.argv[1]??'').href===import.meta.url) main().catch(e=>{console.error(e.message);process.exitCode=1;});
