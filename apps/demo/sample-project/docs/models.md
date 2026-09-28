# Data models

`HarvestRecord` is the one shape every script in this fixture passes around.

## Fields

- `crop` — plain string, no enum (kept loose on purpose)
- `weight_grams` — float, always grams at rest
- `picked_at` — ISO date string, not parsed to a real date anywhere yet

## Why no ORM

This is a fixture project for cabn's demo world, not a real service — a
dataclass is enough to make `lib/` and `scripts/` look like a believable
small codebase without pulling in SQLAlchemy for a `cabn.json` markdown
override to point at.
