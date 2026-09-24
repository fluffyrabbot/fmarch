import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {oneShotExecutionOutcome} from './release_coordinator.mjs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CANONICAL_RELEASE_TOPOLOGY as topology, receiptDigest, assertFullCommit} from './release_coordinator_contract.mjs';
import {publishImmutableJson} from './immutable_json_receipt.mjs';
import {readStagingReleaseMutationLease, fenceStagingReleaseForAbandonment,
  readStagingAbandonmentFence, archiveStagingAbandonmentFence,
  releaseStagingReleaseMutationLease} from './release_git_authority.mjs';

// Exceeds a coordinator Railway subprocess's five-minute request timeout.
export const ABANDONMENT_SETTLE_MS = 6 * 60_000;
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

export function assertNoReleaseDeployments(intent, histories) {
  assert.equal(intent.operation_kind, 'release-coordinator', 'only coordinator leases can be abandoned');
  const cutoff = Date.parse(intent.created_at) - 5 * 60_000;
  assert.ok(Number.isFinite(cutoff));
  assert.deepEqual(Object.keys(histories).sort(), Object.values(topology.services).sort());
  for (const rows of Object.values(histories)) {
    assert.ok(Array.isArray(rows) && rows.length > 0, 'empty deployment history cannot prove abandonment');
    for (const row of rows) {
      assert.ok(Number.isFinite(Date.parse(row.createdAt)), 'deployment time missing');
      assert.ok(Date.parse(row.createdAt) < cutoff, 'deployment exists within or after the release window');
      assert.ok(['SUCCESS','FAILED','CRASHED','REMOVED','SKIPPED'].includes(row.status), 'nonterminal deployment prevents abandonment');
    }
  }
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
      assert.ok(['SUCCESS','FAILED','CRASHED','REMOVED','SKIPPED'].includes(row.status), 'nonterminal deployment prevents retirement');
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

function assertRecoveryHistories(intent, histories, failure) {
  return failure ? assertFailedMigration(intent,histories,failure) : assertNoReleaseDeployments(intent,histories);
}
const recoveryStatus = document => document.failed_migration ? 'retired-after-failed-migration' : 'abandoned-before-deployment';

function assertStopped(pid) {
  if(pid !== null) {
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
    result[serviceId] = await completeHistory(async after => {
      const output = execFileSync('railway',['api',deploymentHistoryQuery,'--variables',JSON.stringify({after,input:{
        projectId:topology.project_id,environmentId:topology.environments.staging.id,serviceId,includeDeleted:true,
      }}),'--compact'],{cwd:root,encoding:'utf8',timeout:300_000,stdio:['ignore','pipe','pipe'],env:{...process.env,
        RAILWAY_CALLER:'skill:use-railway@1.5.5',RAILWAY_AGENT_SESSION:`fmarch-abandon-${process.pid}`}});
      const response=JSON.parse(output);
      assert.equal(response.errors,undefined,'Railway history query failed');
      return response.data?.deployments;
    });
  }
  return result;
}

export async function finishAbandonment({document, token, fence, releaseCommit}, operations) {
  assert.ok(operations.now() >= Date.parse(document.created_at) + ABANDONMENT_SETTLE_MS, 'recovery settle interval has not elapsed');
  await operations.assertStopped();
  await operations.assertFence();
  const after = assertRecoveryHistories(document.original_intent, await operations.histories(), document.failed_migration);
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
    else {assert.ok(['--lease','--commit','--stopped-pid','--confirm-stopped','--resume-fence','--failed-migrator','--failure-intent'].includes(argv[i]),'unknown recovery option');args[argv[i].slice(2)]=argv[++i];}
  }
  const token=assertFullCommit(args.lease), releaseCommit=assertFullCommit(args.commit);
  const pid=args['stopped-pid'] === undefined ? null : Number(args['stopped-pid']);
  assert.ok(pid !== null || args['failed-migrator'] || args['resume-fence'], 'pre-deployment abandonment requires the stopped PID');
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
  const before=assertRecoveryHistories(intent,await histories(),failure);
  if(!args.apply) {console.log(JSON.stringify({status:'eligible',token,releaseCommit,history_sha256:receiptDigest(before)}));return;}
  if(!fence) {
    const result=fenceStagingReleaseForAbandonment({token,releaseCommit,stoppedPid:pid,historySha256:receiptDigest(before),failedMigration:failure});
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
