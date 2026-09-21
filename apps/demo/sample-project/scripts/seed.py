#!/usr/bin/env python3
"""Prints a fake weekly harvest summary. Not wired to anything real."""

from lib.models import HarvestRecord
from lib.utils import group_by_crop, total_weight_kg

SAMPLE = [
    HarvestRecord("tomato", 1450, "2026-09-14T09:00:00Z"),
    HarvestRecord("tomato", 900, "2026-09-16T09:00:00Z"),
    HarvestRecord("courgette", 3200, "2026-09-15T09:00:00Z"),
]


def main() -> None:
    grouped = group_by_crop(SAMPLE)
    for crop, records in grouped.items():
        print(f"{crop}: {total_weight_kg(records):.2f}kg over {len(records)} pickings")


if __name__ == "__main__":
    main()
