import pytest

from app.engine import Engine
from app.models import JobArea, SimulationJobConfig, SimulationJobCreate, SimulationPass


def config(**changes):
    data = dict(
        name="Job carte",
        storage_type="longitudinal",
        placement_mode="adjacent",
        start_m=80,
        end_m=180,
        lane="south",
        area=JobArea(x0=80, x1=180, y0=-48, y1=-14, source="map"),
        max_height_m=8,
        travel_speed_m_s=0.08,
        flow_t_h=1800,
        time_scale=300,
        reset_before_start=False,
        passes=[SimulationPass(product_id="LAVE-A", target_tonnage_t=500, direction="forward")],
    )
    data.update(changes)
    return SimulationJobConfig(**data)


def test_map_job_validation_returns_preview_and_non_overlapping_plan():
    engine = Engine()
    cfg = config(passes=[
        SimulationPass(product_id="LAVE-A", target_tonnage_t=500, direction="forward"),
        SimulationPass(product_id="LAVE-B", target_tonnage_t=400, direction="backward"),
    ])
    result = engine.validate_job(cfg)
    assert result["valid"]
    assert result["area"]["source"] == "map"
    assert result["metrics"]["requested_tonnage_t"] == 900
    assert len(result["planned_passes"]) == 2
    first, second = result["planned_passes"]
    assert first["x1"] < second["x0"]
    assert result["metrics"]["estimated_max_height_m"] <= cfg.max_height_m


def test_adjacent_job_rejects_occupied_zone_and_suggests_free_land():
    engine = Engine()
    engine.command("start")
    for _ in range(25):
        engine.step(0.1)
    engine.command("stop")
    occupied_x = engine.travel
    cfg = config(
        start_m=max(30, occupied_x - 12),
        end_m=min(330, occupied_x + 12),
        area=JobArea(x0=max(30, occupied_x - 12), x1=min(330, occupied_x + 12),
                     y0=-48, y1=-14, source="map"),
        passes=[SimulationPass(product_id="LAVE-B", target_tonnage_t=100, direction="forward")],
    )
    result = engine.validate_job(cfg)
    assert not result["valid"]
    assert any(error["code"] == "ZONE_OCCUPEE" for error in result["errors"])
    assert result["suggested_area"] is not None


def test_invalid_capacity_is_blocked_on_creation():
    engine = Engine()
    cfg = config(
        start_m=80,
        end_m=92,
        area=JobArea(x0=80, x1=92, y0=-48, y1=-40, source="map"),
        max_height_m=2,
        passes=[SimulationPass(product_id="LAVE-A", target_tonnage_t=100000, direction="forward")],
    )
    result = engine.validate_job(cfg)
    assert not result["valid"]
    assert any(error["code"] in {"CAPACITE_INSUFFISANTE", "HAUTEUR_DEPASSEE"} for error in result["errors"])
    with pytest.raises(ValueError):
        engine.create_job(SimulationJobCreate(config=cfg, operator="Test", reason="Test capacité"))


def test_stacker_moves_to_job_start_without_deposit_then_executes_inside_bounds():
    engine = Engine()
    cfg = config(passes=[SimulationPass(product_id="LAVE-A", target_tonnage_t=120, direction="forward")])
    job = engine.create_job(SimulationJobCreate(config=cfg, operator="Test", reason="Test déplacement"))
    engine.job_action(job["id"], "start", True)
    assert engine.jobs[job["id"]]["status"] == "EN_DEPLACEMENT"
    assert engine.truth.heights.sum() == 0  # physical field remains empty while positioning
    for _ in range(60):
        engine.step(0.1)
        if engine.jobs[job["id"]]["status"] == "EN_COURS":
            break
    assert engine.jobs[job["id"]]["status"] == "EN_COURS"
    assert engine.travel == pytest.approx(80)
    assert engine.truth.heights.sum() == 0
    engine.step(0.1)
    assert engine.truth.heights.sum() > 0
    record = engine.latest_record()
    dep = record["deposit"]
    assert dep is not None
    # All deposited cells stay in the planned zone.
    from app.inventory import X, Y, NX
    for index in dep["indices"]:
        assert 80 <= X[index % NX] <= 180
        assert -48 <= Y[index // NX] <= -14


def test_layered_deposit_keeps_underlying_product_and_exposes_latest_product():
    from app.inventory import Inventory
    inventory = Inventory()
    product_a = {"id":"LAVE-A","name":"A","color":"#111111","density_t_m3":1.0,
                 "bpl_pct":0,"co2_pct":0,"mgo_pct":0,"sio2_pct":0,"cao_pct":0,"moisture_pct":0}
    product_b = {"id":"LAVE-B","name":"B","color":"#222222","density_t_m3":1.0,
                 "bpl_pct":0,"co2_pct":0,"mgo_pct":0,"sio2_pct":0,"cao_pct":0,"moisture_pct":0}
    base = {"sequence":1,"acquired_at":1.0,"lot":"LOT-A","deposit":{"indices":[100],"volumes_m3":[12.0],"mass_t":12.0,"volume_m3":12.0,"product":product_a}}
    inventory.integrate({"id":"A",**base})
    inventory.integrate({"id":"B","sequence":2,"acquired_at":2.0,"lot":"LOT-B","deposit":{"indices":[100],"volumes_m3":[4.0],"mass_t":4.0,"volume_m3":4.0,"product":product_b}})
    grid = inventory.grid([product_a,product_b])
    assert grid["product_indices"][100] == 1  # B is exposed on top.
    assert inventory.product_volume["LAVE-A"][100] == 12.0
    assert inventory.product_volume["LAVE-B"][100] == 4.0
