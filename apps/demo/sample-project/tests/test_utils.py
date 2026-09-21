from lib.models import HarvestRecord
from lib.utils import group_by_crop, total_weight_kg


def test_total_weight_kg_sums_grams_to_kg():
    records = [HarvestRecord("kale", 500, "2026-09-01T00:00:00Z"), HarvestRecord("kale", 500, "2026-09-02T00:00:00Z")]
    assert total_weight_kg(records) == 1.0


def test_group_by_crop_groups_matching_crops_together():
    records = [
        HarvestRecord("kale", 500, "2026-09-01T00:00:00Z"),
        HarvestRecord("leek", 800, "2026-09-02T00:00:00Z"),
        HarvestRecord("kale", 300, "2026-09-03T00:00:00Z"),
    ]
    grouped = group_by_crop(records)
    assert len(grouped["kale"]) == 2
    assert len(grouped["leek"]) == 1
