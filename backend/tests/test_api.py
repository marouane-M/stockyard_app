from fastapi.testclient import TestClient
from app.engine import Engine
from app.models import Selection
from app.main import create_app


def test_api_control_selection_csv_websocket_and_validation():
    engine = Engine()
    app = create_app(engine,auto_tick=False)
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/api/snapshot").json()["totals"]["total_tonnage_t"] == 0
        assert client.post("/api/control",json={"action":"start"}).status_code == 200
        for _ in range(12): engine.step(.1)
        report = client.post("/api/inventory/selection",json={"x0":0,"x1":150,"y0":-54,"y1":0})
        assert report.status_code == 200
        assert report.json()["total_tonnage_t"] > 0
        assert client.post("/api/control",json={"action":"stop"}).json()["running"] is False
        csv = client.post("/api/inventory/export",json={})
        assert csv.status_code == 200 and "Tonnage (t)" in csv.text and "Phosphate lavé A" in csv.text
        detail = client.get("/api/scans/latest").json()
        correction = client.post(f'/api/scans/{detail["id"]}/corrections',json={
            "operator":"Test", "reason":"Rejet de test", "updates":[{"index":1,"range_m":None,"quality":0}]})
        assert correction.status_code == 200
        assert correction.json()["beams"][1]["corrected"]
        assert client.get("/api/history").json()
        assert client.get("/api/audit").json()
        assert client.get("/api/map").json()["tiles"]
        assert client.get("/api/map/tiles/1/0/0").status_code == 404
        assert client.post("/api/inventory/selection",json={"x0":50,"x1":20}).status_code == 422
        with client.websocket_connect("/ws/live") as ws:
            frame = ws.receive_json()
            assert frame["grid"] is not None
            assert frame["scanner"]["valid_count"] > 0
            next_frame = ws.receive_json()
            assert next_frame["grid"] is None
        assert client.post("/api/control",json={"action":"empty"}).status_code == 422
        assert client.post("/api/control",json={"action":"empty","confirm":True}).json()["totals"]["total_tonnage_t"] == 0


def test_websocket_viewers_do_not_advance_acquisition():
    engine = Engine()
    with TestClient(create_app(engine,auto_tick=False)) as client:
        with client.websocket_connect("/ws/live") as ws1:
            with client.websocket_connect("/ws/live") as ws2:
                assert ws1.receive_json()["sequence"] == 0
                assert ws2.receive_json()["sequence"] == 0
                assert engine.sequence == 0
                assert engine.report(Selection())["total_tonnage_t"] == 0


def test_websocket_rejects_unapproved_origin():
    from starlette.websockets import WebSocketDisconnect
    import pytest
    with TestClient(create_app(Engine(),auto_tick=False)) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/ws/live",headers={"origin":"https://untrusted.invalid"}):
                pass


def test_provider_is_optional_and_map_failure_is_explicit(monkeypatch):
    monkeypatch.setenv("MAP_ENABLED", "false")
    with TestClient(create_app(Engine(),auto_tick=False)) as client:
        assert client.get("/api/map").json()["tiles"] == []
        assert client.get("/api/map/tiles/17/0/0").status_code == 503


def test_job_validation_api_and_positioning_state():
    engine = Engine()
    with TestClient(create_app(engine, auto_tick=False)) as client:
        config = {
            "name": "Job depuis la carte",
            "storage_type": "longitudinal",
            "placement_mode": "adjacent",
            "start_m": 80,
            "end_m": 180,
            "lane": "south",
            "area": {"x0": 80, "x1": 180, "y0": -48, "y1": -14, "source": "map"},
            "max_height_m": 8,
            "travel_speed_m_s": 0.08,
            "flow_t_h": 1800,
            "time_scale": 300,
            "reset_before_start": False,
            "passes": [
                {"product_id": "LAVE-A", "target_tonnage_t": 200, "direction": "forward", "lane": "auto"},
                {"product_id": "LAVE-B", "target_tonnage_t": 150, "direction": "backward", "lane": "auto"},
            ],
        }
        preview = client.post("/api/simulation/jobs/validate", json={"config": config})
        assert preview.status_code == 200
        body = preview.json()
        assert body["valid"] is True
        assert body["area"]["source"] == "map"
        assert body["planned_passes"][0]["x1"] < body["planned_passes"][1]["x0"]
        created = client.post("/api/simulation/jobs", json={
            "config": config, "operator": "Recette", "reason": "Validation API du plan de stockage"
        })
        assert created.status_code == 200
        job = created.json()
        started = client.post(f"/api/simulation/jobs/{job['id']}/command",
                              json={"action": "start", "confirm": True})
        assert started.status_code == 200
        assert started.json()["status"] == "EN_DEPLACEMENT"
        assert engine.truth.heights.sum() == 0
