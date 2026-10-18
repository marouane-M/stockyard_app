"""Regression tests for the incremental v2 stockpile-height update."""
import copy
import json
import numpy as np
import pytest
from app.deposition import deposit_mound
from app.engine import Engine
from app.inventory import AREA, NX, NY, XX, YY, Inventory
from app.models import ConfigChange, MachineConfig, Selection, default_products


def pour(inventory, sequence, x=121., y=-31., mass=100., angle=34., product=None):
    dep = deposit_mound(x, y, mass, product or default_products()[0].model_dump(),
                        inventory.heights, angle)
    inventory.integrate({"id": f"mound-{sequence}", "sequence": sequence,
                         "acquired_at": float(sequence), "lot": "MOUND", "deposit": dep})
    return dep


def test_same_place_grows_upwards_and_outwards_without_losing_mass():
    inv = Inventory()
    pour(inv, 1)
    first = inv.heights.copy()
    first_count = np.count_nonzero(first)
    for n in range(2, 17):
        before = inv.heights.copy()
        pour(inv, n)
        assert np.all(inv.heights >= before)  # old columns are never removed
    assert inv.heights.max() > 2 * first.max()
    assert np.count_nonzero(inv.heights) > first_count
    assert inv.heights.sum() * AREA == pytest.approx(1600 / 1.65, rel=1e-12)
    assert inv.report(Selection())["total_tonnage_t"] == pytest.approx(1600)


def test_conical_profile_has_peak_and_sloping_sides():
    inv = Inventory()
    pour(inv, 1, mass=1000)
    grid = inv.heights.reshape(NY, NX)
    row, col = np.unravel_index(np.argmax(grid), grid.shape)
    section = grid[row]
    assert section[col] > section[col + 1] > section[col + 2] > 0
    assert section[0] == 0 and section[-1] == 0
    # Interior of an isolated cone has the configured slope on the 2 m grid.
    assert section[col] - section[col + 1] == pytest.approx(np.tan(np.radians(34)) * 2)


@pytest.mark.parametrize("x,y", [(0.,-14.), (359.,-48.), (121.,31.), (359.,48.)])
def test_edges_and_lane_constraints_keep_mass(x, y):
    inv = Inventory()
    pour(inv, 1, x=x, y=y, mass=1000)
    eligible = ((np.abs(YY) >= 14) & (np.abs(YY) <= 48) & ((YY > 0) == (y > 0))).ravel()
    assert not np.any(inv.heights[~eligible])
    assert inv.heights.sum() * AREA == pytest.approx(1000 / 1.65, rel=1e-12)


def test_higher_angle_is_taller_and_narrower_for_same_volume():
    low, high = Inventory(), Inventory()
    pour(low, 1, mass=1000, angle=20)
    pour(high, 1, mass=1000, angle=45)
    assert high.heights.max() > low.heights.max()
    assert np.count_nonzero(high.heights) < np.count_nonzero(low.heights)
    assert high.heights.sum() == pytest.approx(low.heights.sum())


def test_mass_and_density_control_volume_not_a_display_height_multiplier():
    normal, dense = Inventory(), Inventory()
    p = default_products()[0].model_dump()
    pour(normal, 1, mass=100, product=p)
    pour(dense, 1, mass=100, product={**p, "density_t_m3": p["density_t_m3"] * 2})
    assert dense.heights.sum() == pytest.approx(normal.heights.sum() / 2)
    assert dense.heights.max() < normal.heights.max()


def test_zero_mass_is_no_deposit_and_inputs_are_not_mutated():
    h = np.zeros(NX * NY)
    p = default_products()[0].model_dump()
    original = copy.deepcopy(p)
    dep = deposit_mound(121, -31, 0, p, h)
    assert dep["indices"] == [] and dep["volumes_m3"] == []
    deposit_mound(121, -31, 100, p, h)
    assert not np.any(h) and p == original


@pytest.mark.parametrize("kwargs", [
    {"mass": -1}, {"mass": float("nan")}, {"x": float("inf")},
    {"y": 0}, {"x": -1}, {"repose_angle_deg": 70},
])
def test_invalid_mound_input_is_rejected(kwargs):
    args = {"x": 121, "y": -31, "mass": 100, "product": default_products()[0].model_dump(),
            "heights": np.zeros(NX * NY)}
    args.update(kwargs)
    with pytest.raises(ValueError):
        deposit_mound(**args)


def test_return_pass_raises_existing_ridge_and_stop_preserves_it():
    e = Engine()
    e.scanner_config.enabled = False
    e.machine_config.oscillation_deg = 0
    e.machine_config.auto_products = False
    e.machine_config.alternate_lanes = False
    e.command("start")
    for _ in range(167): e.step(.1)
    first = e.truth.heights.copy()
    for _ in range(166): e.step(.1)
    after = e.truth.heights.copy()
    assert after.max() > first.max()
    ix = int(150 // 2)
    assert after.reshape(NY,NX)[:,ix].max() > first.reshape(NY,NX)[:,ix].max()
    assert e.latest_record()["deposit"]["formation_model"] == "CONSERVATIVE_CONICAL_MOUND_V1"
    e.command("stop")
    for _ in range(10): e.step(.1)
    assert np.array_equal(e.truth.heights, after)


def test_partial_selection_keeps_both_product_contributions():
    inv = Inventory()
    ps = [p.model_dump() for p in default_products()]
    pour(inv, 1, mass=100, product=ps[0])
    pour(inv, 2, mass=200, product=ps[1])
    cut = 121.37
    left, right = inv.report(Selection(x1=cut)), inv.report(Selection(x0=cut))
    for product_id, total in [(ps[0]["id"],100), (ps[1]["id"],200)]:
        a = next(r for r in left["products"] if r["product_id"] == product_id)
        b = next(r for r in right["products"] if r["product_id"] == product_id)
        assert a["tonnage_t"] + b["tonnage_t"] == pytest.approx(total, rel=1e-12)


def test_scanner_observes_taller_surface_after_pouring_at_same_pose():
    from app.geometry import boom_matrix, transform_points, process_scan
    e = Engine()
    e.scanner_config.noise_std_m = 0
    e.scanner_config.dropout_pct = 0
    e.scanner_config.samples = 81
    pose = e.current_pose(1.0)
    tip = transform_points([[e.machine_config.boom_length_m,0,0]], boom_matrix(pose,e.machine_config))[0]
    before = e._raw_scan(pose)
    for n in range(1,8):
        pour(e.truth, n, x=float(tip[0]), y=float(tip[1]), mass=80)
    after = e._raw_scan(pose)
    center = 40
    assert after["ranges_m"][center] < before["ranges_m"][center] - 1
    record={"pose":pose,"machine_config":e.machine_config.model_dump(),
            "scanner_config":e.scanner_config.model_dump(),"scan":after}
    points=process_scan(record)["points"]
    assert max(p[2] for p in points) > 1


def test_v2_journal_without_new_fields_reloads_unchanged_then_adds_mounds(tmp_path):
    path = tmp_path / "events.jsonl"
    old = Engine(path)
    old.machine_config.deposition_profile = "gaussian"
    old.command("start")
    for _ in range(12): old.step(.1)
    old.command("stop")
    heights = old.central.heights.copy()
    mass = old.report(Selection())["total_tonnage_t"]
    # Reproduce an actual v2-format journal: no new config fields or model tag.
    events = [json.loads(line) for line in path.read_text().splitlines()]
    for event in events:
        configs = []
        if "config" in event: configs.append(event["config"]["machine"])
        if "record" in event: configs.append(event["record"]["machine_config"])
        for config in configs:
            config.pop("deposition_profile",None); config.pop("repose_angle_deg",None)
    path.write_text("".join(json.dumps(event)+"\n" for event in events))
    restored = Engine(path)
    assert not restored.running
    assert restored.machine_config.deposition_profile == "mound"
    assert np.array_equal(restored.central.heights, heights)
    assert restored.report(Selection())["total_tonnage_t"] == pytest.approx(mass)
    restored.command("start"); restored.step(.1)
    assert np.all(restored.central.heights >= heights)
    assert restored.latest_record()["deposit"]["formation_model"] == "CONSERVATIVE_CONICAL_MOUND_V1"


def test_changing_shape_settings_does_not_rewrite_stock():
    e = Engine()
    e.command("start")
    for _ in range(15): e.step(.1)
    before = e.truth.heights.copy()
    e.set_config(ConfigChange(machine=e.machine_config.model_copy(update={"repose_angle_deg":45}),
                              reason="Essai du talus pour les prochains dépôts"))
    assert np.array_equal(before,e.truth.heights)
    e.step(.1)
    assert e.latest_record()["deposit"]["repose_angle_deg"] == 45


def test_profile_fields_are_additive_and_validated():
    assert MachineConfig().deposition_profile == "mound"
    for data in ({"repose_angle_deg":19}, {"deposition_profile":"unknown"}):
        with pytest.raises(ValueError): MachineConfig(**data)
