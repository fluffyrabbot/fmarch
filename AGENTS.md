# Agent Workflow

This repo is currently a one-developer, pre-1.0 workspace. Prefer local proof,
direct `main` work, and atomic history over PR ceremony.

## Default stance

- Assume greenfield/no external users unless the user says otherwise.
- Cut directly to the architecturally superior shape, and resolve breakage with
  further refactor instead of preserving transitional compatibility by default.
- Keep commits atomic and intentional. Each commit should describe one coherent
  change.
- Work directly on `main` unless the user explicitly asks for a branch.
- Push directly to `main` after the relevant local proof is green.
- Treat GitHub primarily as remote backup/history, not as the source of truth for
  CI/CD, until the project is ready for beta/1.0 release discipline.

## Local proof preference

- Prefer local CI/proof for as long as practical.
- Use the narrowest truthful local gate for the touched area, then broaden only
  when the change crosses boundaries.
- For frontend browser/readiness work, prefer the role proof and artifact
  contract lanes before pushing.
- For Postgres-backed Rust work, use a local `DATABASE_URL` proof lane and run
  SQLx-heavy tests serially when needed.
- If Docker is unavailable, a repo-local Postgres under `target/` is an
  acceptable local proof substitute.

## Publishing

- When local proof is green, commit and push in one shell command when possible,
  for example:

  ```sh
  git add <paths> && git commit -m "<atomic message>" && git push origin main
  ```

- Open a PR only when it is useful as a reviewable checkpoint or backup marker.
- Prefer fast-forward-only integration. Avoid merge commits for normal solo flow.

## Followup habit

- After each round, suggest a detailed recommended followup that builds directly
  on the completed work.
