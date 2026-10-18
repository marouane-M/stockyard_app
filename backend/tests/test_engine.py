import copy
import math
from pathlib import Path
import numpy as np
import pytest
from app.engine import Engine
from app.models import (Selection, ConfigChange, Correction, BeamEdit, SiteConfig, ScannerConfig, MachineConfig)
from app.geometry import GeoConverter, scanner_matrix, transform_points, process_scan
from app.inventory import AREA, CELL, NX, NY, overlap
from app.journal import Journal


def run(engine, n=30):
    engine.command("start")
    for _ in range(n):
        engine.step(.1)
    engine.command("stop")
    return engine


def test_starts_empty_and_stopped():
    e = Engine()
    assert not e.running
    assert not np.any(e.central.heights)
    assert e.report(Selection())["total_tonnage_t"] == 0


def test_start_stop_mass_balance_and_mesh_volume():
    e = run(Engine(), 20)
    expected = e.machine_config.flow_t_h/3600*.1*e.machine_config.time_scale*20
    report = e.report(Selection())
    assert report["total_tonnage_t"] == pytest.approx(expected)
    assert e.central.heights.sum()*AREA == pytest.approx(report["total_volume_m3"])
    before = copy.deepcopy(e.snapshot())
    e.step(.1)
    assert e.sequence == before["sequence"]
    assert e.travel == before["machine"]["travel_m"]


def test_fractional_interval_is_conservative():
    e = run(Engine(), 80)
    cut = 103.37
    left = e.report(Selection(x1=cut))["total_tonnage_t"]
    right = e.report(Selection(x0=cut))["total_tonnage_t"]
    total = e.report(Selection())["total_tonnage_t"]
    assert left > 0 and right > 0
    assert left + right == pytest.approx(total, rel=1e-12)


def test_partial_cell_exact_overlap():
    a = overlap(Selection(x0=0.5, x1=1.5, y0=-53.5,y1=-52.5))
    assert a.sum() == pytest.approx(.25)
    assert np.count_nonzero(a) == 1


def test_rectangle_outside_deposits_zero():
    e = run(Engine(), 20)
    assert e.report(Selection(x0=250,x1=300))["total_tonnage_t"] == 0
    assert e.report(Selection(y0=14,y1=48))["total_tonnage_t"] == 0


def test_reverses_and_creates_multiple_products():
    e = run(Engine(), 200)
    assert e.pass_number >= 1
    assert e.direction == -1
    assert len(e.report(Selection())["products"]) >= 2
    assert e.machine_config.travel_min_m <= e.travel <= e.machine_config.travel_max_m


def test_empty_preserves_journal_and_stops():
    e = run(Engine(),10)
    old = e.instance
    previous_events = len(e.journal.memory)
    with pytest.raises(ValueError):
        e.command("empty")
    e.command("empty", True)
    assert e.instance != old
    assert e.report(Selection())["total_tonnage_t"] == 0
    assert len(e.journal.memory) > previous_events


def test_scanner_points_come_from_acquisition_pose():
    e = run(Engine(), 8)
    r = e.latest_record(with_scan=True)
    original = process_scan(r)
    e.travel = 300
    assert process_scan(r) == original
    cfg = ScannerConfig(**r["scanner_config"])
    rig = MachineConfig(**r["machine_config"])
    matrix = scanner_matrix(r["pose"], rig, cfg)
    assert original["origin"] == pytest.approx(matrix[:3,3])
    assert original["valid_count"] > 0
    assert all(-.31 <= p[2] <= 40 for p in original["points"])


def test_mount_transform_follows_chain():
    rig = MachineConfig(boom_length_m=32,pivot_height_m=9)
    scan = ScannerConfig(mount_z_m=0)
    pose = {"travel_m":40,"slew_deg":90,"luff_deg":0}
    matrix = scanner_matrix(pose,rig,scan)
    assert matrix[:3,3] == pytest.approx([40,32,9])
    pose["travel_m"] = 55
    assert scanner_matrix(pose,rig,scan)[:3,3] == pytest.approx([55,32,9])


def test_scanner_off_does_not_stop_deposition():
    e = Engine()
    e.set_config(ConfigChange(scanner=ScannerConfig(enabled=False), reason="Test scanner désactivé"))
    run(e,15)
    assert e.report(Selection())["total_tonnage_t"] > 0
    assert e.latest_record(with_scan=True) is None


def test_raw_data_immutable_correction_audited_mass_unchanged():
    e = run(Engine(),10)
    r = e.latest_record(with_scan=True)
    raw = copy.deepcopy(r)
    before = e.report(Selection())["total_tonnage_t"]
    valid = process_scan(r)["indices"][0]
    result = e.correct(r["id"], Correction(operator="Test",reason="Rejet d'un retour aberrant",
                        updates=[BeamEdit(index=valid,range_m=None,quality=0)]))
    assert e.raw[r["id"]] == raw
    assert result["beams"][valid]["corrected"]
    assert not result["beams"][valid]["accepted"]
    assert len(result["corrections"]) == 1
    assert e.report(Selection())["total_tonnage_t"] == before


def test_density_revision_not_retroactive():
    e = run(Engine(),10)
    first = e.report(Selection())
    products = [p.model_copy(deep=True) for p in e.products]
    products[0].density_t_m3 = 2.5
    e.set_config(ConfigChange(products=products, reason="Nouvelle densité de démonstration"))
    assert e.report(Selection())["total_volume_m3"] == first["total_volume_m3"]
    run(e,10)
    result = e.report(Selection())
    assert result["total_tonnage_t"] == pytest.approx(first["total_tonnage_t"]*2)
    assert result["total_volume_m3"] < first["total_volume_m3"]*2


def test_outage_live_backfill_and_exact_reconciliation():
    e = run(Engine(),8)
    before = e.central.heights.copy()
    e.command("outage")
    run(e,12)
    assert np.array_equal(before,e.central.heights)
    assert len(e.pending) == 12
    assert e.snapshot()["communication"]["gap_state"] == "OPEN"
    e.command("restore")
    assert e.snapshot()["communication"]["gap_state"] == "RECOVERING"
    e.command("start")
    e.step(.1)
    latest = e.latest_record()
    assert latest["sequence"] == e.sequence # LIVE before older BACKFILL completes.
    assert len(e.pending) == 10
    e.command("stop")
    for _ in range(6):
        e.step(.1)
    assert not e.pending
    assert e.snapshot()["communication"]["gap_state"] == "RECONCILED"
    assert np.allclose(e.central.heights,e.truth.heights)


def test_idempotent_acceptance():
    e = run(Engine(),8)
    r = e.latest_record()
    before = e.central.heights.copy()
    assert not e.accept(r["id"])
    assert np.array_equal(before,e.central.heights)


def test_replay_earlier_interval():
    e = run(Engine(),30)
    earlier = e.report(Selection(until_sequence=10))
    now = e.report(Selection())
    assert earlier["total_tonnage_t"] == pytest.approx(now["total_tonnage_t"]/3)
    frame = e.snapshot(10)
    assert frame["mode"] == "HISTORICAL"
    assert frame["machine"]["sequence"] == 10
    assert frame["scanner"]["sequence"] <= 10


def test_recovery_after_restart_and_reconciliation(tmp_path):
    path = tmp_path/"events.jsonl"
    e = run(Engine(path),10)
    e.command("outage")
    run(e,6)
    before = e.report(Selection())["total_tonnage_t"]
    restored = Engine(path)
    assert not restored.running
    assert restored.report(Selection())["total_tonnage_t"] == pytest.approx(before)
    assert len(restored.pending) == 6
    assert restored.instance == e.instance
    restored.command("restore")
    for _ in range(4): restored.step(.1)
    assert not restored.pending
    assert np.allclose(restored.central.heights,e.truth.heights)


def test_truncated_tail_is_preserved_not_silently_dropped(tmp_path):
    path = tmp_path/"events.jsonl"
    e = run(Engine(path),4)
    with path.open("ab") as f: f.write(b'{"type": "acqui')
    restored = Engine(path)
    assert restored.sequence == e.sequence
    assert path.with_suffix(".incomplete").read_bytes() == b'{"type": "acqui'


def test_corrupt_middle_fails_closed(tmp_path):
    path = tmp_path/"events.jsonl"
    path.write_text('{"type":"x"}\ninvalid\n{"type":"y"}\n')
    with pytest.raises(RuntimeError): Journal(path).read()


def test_geo_roundtrip_and_tile_manifest():
    geo = GeoConverter(SiteConfig(heading_deg=28))
    lon,lat,alt = geo.yard_to_geo(187.45,-31.9,3.25)
    assert geo.geo_to_yard(lon,lat,alt) == pytest.approx([187.45,-31.9,3.25],abs=1e-5)
    manifest = geo.tile_manifest()
    assert 1 < len(manifest) <= 64
    assert all(len(t["corners"])==4 for t in manifest)


def test_site_change_requires_empty_yard():
    e = run(Engine(),3)
    with pytest.raises(ValueError):
        e.set_config(ConfigChange(site=SiteConfig(longitude=-8.5),reason="Déplacer le site"))


@pytest.mark.parametrize("payload", [{"x0":20,"x1":10},{"y0":0,"y1":0},{"x0":-1},{"x1":math.nan}])
def test_rejects_invalid_selection(payload):
    with pytest.raises(ValueError): Selection(**payload)


def test_invalid_scanner_values_rejected():
    with pytest.raises(ValueError): ScannerConfig(samples=10000)
    with pytest.raises(ValueError): ScannerConfig(range_scale=math.nan)
    with pytest.raises(ValueError): Correction(operator="T",reason="Essai",updates=[
        BeamEdit(index=0,range_m=2,quality=50),BeamEdit(index=0,range_m=3,quality=50)])


def test_historical_pose_rig_not_replaced_by_current_dimensions():
    e = run(Engine(), 8)
    original = e.snapshot(6)
    config = e.machine_config.model_copy(update={"boom_length_m": 25})
    e.set_config(ConfigChange(machine=config, reason="Réglage ultérieur de la flèche"))
    replay = e.snapshot(6)
    assert replay["head_xyz"] == pytest.approx(original["head_xyz"])
    assert replay["machine_rig"]["boom_length_m"] == 32
    assert not replay["running"] and not replay["scanner"]["acquiring"]


def test_outage_timestamps_survive_restart(tmp_path):
    path = tmp_path/"events.jsonl"
    e = run(Engine(path), 4)
    e.command("outage")
    at = e.outage_started_at
    other = Engine(path)
    assert other.outage_started_at == at
    other.command("restore")
    assert other.last_outage_duration_s >= 0
    last_duration = other.last_outage_duration_s
    assert Engine(path).last_outage_duration_s == last_duration


def test_failed_empty_commit_does_not_erase_current_state(monkeypatch):
    e = run(Engine(), 6)
    before = e.snapshot()
    def fail(*args): raise OSError("disque indisponible")
    monkeypatch.setattr(e.journal, "append", fail)
    with pytest.raises(OSError): e.command("empty", True)
    assert e.instance == before["instance"]
    assert e.sequence == before["sequence"]
    assert e.report(Selection())["total_tonnage_t"] == before["totals"]["total_tonnage_t"]


def test_raw_commit_failure_rolls_back_uncommitted_material(monkeypatch):
    e = run(Engine(), 8)
    before = e.snapshot()
    e.command("start")
    def fail(*args): raise OSError("disque plein")
    monkeypatch.setattr(e.journal, "append", fail)
    with pytest.raises(OSError): e.step(.1)
    assert not e.running
    assert e.sequence == before["sequence"]
    assert np.allclose(e.truth.heights, e.central.heights)
    assert "journal" in e.error


def test_four_passes_deposit_in_both_lanes_and_conserve_mass():
    e = run(Engine(), 680)
    assert e.pass_number >= 4
    south = e.report(Selection(y0=-54,y1=0))
    north = e.report(Selection(y0=0,y1=54))
    whole = e.report(Selection())
    assert south["total_tonnage_t"] > 0 and north["total_tonnage_t"] > 0
    assert south["total_tonnage_t"]+north["total_tonnage_t"] == pytest.approx(whole["total_tonnage_t"])
    assert len(whole["products"]) == 4
    assert whole["total_tonnage_t"] == pytest.approx(680*15)


def test_product_chemistry_weighted_and_frozen():
    e = run(Engine(), 6)
    before = e.report(Selection())["products"][0]
    products = [p.model_copy(deep=True) for p in e.products]
    products[0].bpl_pct = before["bpl_pct"]+10
    e.set_config(ConfigChange(products=products, reason="Nouvelle analyse simulée"))
    run(e,6)
    row = e.report(Selection())["products"][0]
    assert row["bpl_pct"] == pytest.approx(before["bpl_pct"]+5)
    assert e.report(Selection(until_sequence=6))["products"][0]["bpl_pct"] == before["bpl_pct"]


def test_blank_audit_reason_rejected():
    with pytest.raises(ValueError):
        Correction(operator="   ", reason="   ", updates=[BeamEdit(index=0, range_m=3, quality=90)])


@pytest.mark.parametrize("site", [SiteConfig(longitude=179.999), SiteConfig(latitude=80)])
def test_map_extent_bounded_at_dateline_and_high_latitude(site):
    tiles = GeoConverter(site).tile_manifest()
    assert 0 < len(tiles) <= 64
    assert all(0 <= t['x'] < 2**t['z'] and 0 <= t['y'] < 2**t['z'] for t in tiles)
    assert all(abs(p[0]) < 2000 and abs(p[1]) < 2000 for t in tiles for p in t['corners'])


def test_empty_buffer_alone_does_not_prove_continuity():
    e = run(Engine(), 8)
    e.accepted.remove(f"{e.instance}-3")
    assert not e.pending
    assert e.snapshot()["communication"]["gap_state"] == "OPEN"
