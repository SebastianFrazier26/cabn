# harvest-log

A tiny API + scripts for tracking a kitchen garden's harvests. This is a fake
demo project converted by cabn into a walkable world — nothing here runs
anything real, it just needs to look like a believable small codebase.

## Layout

- `src/` — TypeScript HTTP API (Express-shaped, no real server wiring)
- `lib/` — Python helpers used by the offline scripts
- `scripts/` — one-off Python maintenance script
- `tests/` — a test per language, kept deliberately thin
