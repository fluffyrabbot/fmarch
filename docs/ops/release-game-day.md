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
