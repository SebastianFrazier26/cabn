"""Frost-risk helper for the planting calendar."""

from .models import HarvestRecord

FROST_LINE_C = 2.0


def frost_nights(lows_c: list[float]) -> int:
    return sum(1 for low in lows_c if low <= FROST_LINE_C)


def safe_to_plant(lows_c: list[float], records: list[HarvestRecord]) -> bool:
    recent = [r for r in records if r.weight_kg() > 0]
    return frost_nights(lows_c) == 0 and len(recent) >
