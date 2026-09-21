"""Small pure helpers used by scripts/seed.py and the test suite."""

from .models import HarvestRecord


def total_weight_kg(records: list[HarvestRecord]) -> float:
    return sum(record.weight_kg() for record in records)


def group_by_crop(records: list[HarvestRecord]) -> dict[str, list[HarvestRecord]]:
    grouped: dict[str, list[HarvestRecord]] = {}
    for record in records:
        grouped.setdefault(record.crop, []).append(record)
    return grouped
