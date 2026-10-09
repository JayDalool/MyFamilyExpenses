# AGENTS.md

Repo rules for all coding agents:

- Keep changes small and targeted.
- Do not rewrite unrelated code.
- Prefer maintainable code over clever code.
- Add or update tests when behavior changes.
- Run lint, typecheck, and tests before finishing.
- Document new environment variables.
- Keep secrets out of the repo.

When finishing a task, always report:
1. what changed
2. what was tested
3. remaining risks or assumptions

## Shared tools (jay-dev plugin)

This file wins over the plugin wherever they differ. Architecture:
docs/architecture.md.

- `/jay-dev:studio [quick|standard|deep|exhaustive] <request>` picks the
  level and the specialists; code changes go plan → own branch → PR →
  independent review → UI check → merge gate.
- Merges (Jay, 2026-10-09): agents merge only with `merge-gate merge <n>`.
  It needs, on the PR's current head: green CI, an independent reviewer's
  `REVIEW: APPROVE · head <sha>`, a browser `UI CHECK: PASS · head <sha>` for
  UI or big changes (made-up data only), and a `## Review card` in the PR for
  big changes (`merge-gate classify <n>`). This repo is public, so only
  comments from Jay and collaborators count. Anything the gate blocks waits for
  Jay's Agree on the Repo Board.
- `jay-dev:qa`: browser checks on local dev with made-up expenses and
  receipts only; never real family financial data or real receipt images.
- `jay-dev:security`: auth, draft ownership, receipt uploads, the OCR worker
  and anything that returns files.
- `jay-dev:db`: every Postgres migration.
- React tools (shadcn, Motion, Storybook) are added here once the Next.js
  code is on main; until then use `jay-dev:design-review`.
