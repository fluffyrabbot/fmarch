# Staging Release Game Day

This rehearsal mutates Railway staging deliberately. It never targets
production, never edits migration history, and never reverses an applied
migration. Run it only with two checksum-valid, schema-compatible staging
release receipts: the exact release currently serving and the immediately
preceding application release used for rollback.

The harness exercises seven cohorts in order:

1. delay the exact current migrator and prove the serving API/frontend remain
   unchanged;
2. run a deliberately failing migrator and prove Railway's early deployment
   status cannot substitute for the migrator's exact-commit completion record;
3. retry the migrator with the same commit and runtime digest;
4. deploy an API process that cannot pass `/readyz` and prove the previous API
   remains serving;
5. substitute the prior runtime digest and prove current-release attribution
   rejects it;
6. complete a schema-compatible API/frontend rollback while leaving the
   already-applied schema in place; application rollback never runs the
   migrator;
7. restore the exact current digests, health commits, service policy, and search
   sentinel.

First run the non-mutating preflight:

```sh
node tools/release_gameday.mjs \
  --current-receipt <current-staging-receipt.json> \
  --rollback-receipt <prior-staging-receipt.json> \
  --confirm staging:<current-full-sha>
```

Then repeat with `--execute`. The explicit confirmation binds authority to the
staging environment and exact current commit. An interrupted run enters a
`finally` recovery path that redeploys the current migrator, API, and frontend
digests with their canonical Railway policies.

Every game-day migrator command carries an operation ID bound to its complete
immutable intent, including the current commit, scenario, artifact digest,
start command, canonical database identity, and one-shot deadlines. Its
tamper-evident journal is commit/scenario scoped under
`target/releases/staging/game-day-one-shots/`; rerunning the same drill resumes
the exact operation by design. A commit-scoped tamper-evident `active.json`
fence is durable before any database dispatch and is cleared only after an
immutable exact-resolution marker exists. A restarted harness resolves that
fence before it may begin another database scenario. Dispatch uses Railway's
exact-ID V2 mutation, and a lost V2 response is recovered only by a unique
history match on the exact operation command and digest. Cleanup resolves any
pending exact operation before it may dispatch the restore migrator. The
harness polls the captured ID for up to 15 minutes and requires the same
operation ID and commit in migration completion evidence; it never infers
success from the service's mutable latest deployment. It restores `/bin/false`
immediately after V2 captures the deployment and again after the wait,
including error paths, so the temporary operation command cannot become
ambient redeploy authority.

The secret-free receipt is written under
`target/releases/staging/<commit>.game-day.json`. It records deployment IDs,
observed artifact digests, scenario and recovery durations, health and search
results, schema head, and a canonical SHA-256 receipt hash. A passing result is
operational evidence, not production-promotion authority.

Do not automatically trigger the local coordinator from a `main` push until a
passing game day shows bounded recovery and every coordinated deployment
restores the complete platform policy. Even then, retain local credentials and
release authority; automation may enqueue the local coordinator, but must not
silently choose branch head, rebuild a used SHA tag, or promote production.
