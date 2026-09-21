"""Plain dataclasses shared by the offline scripts — no ORM, this is a fixture."""

from dataclasses import dataclass


@dataclass(frozen=True)
class HarvestRecord:
    crop: str
    weight_grams: float
    picked_at: str

    def weight_kg(self) -> float:
        return self.weight_grams / 1000
