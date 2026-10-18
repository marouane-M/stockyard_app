from __future__ import annotations
import asyncio
import contextlib
import csv
import io
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse
import httpx
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from .engine import Engine
from .geometry import GeoConverter
from .models import (Command, ConfigChange, Correction, Selection, SiteConfig,
                     SimulationJobCreate, SimulationJobCommand, SimulationJobValidationRequest)

logger = logging.getLogger("stockyard")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def create_app(engine: Engine | None = None, auto_tick: bool = True) -> FastAPI:
    lock = asyncio.Lock()
    service = engine
    cache: dict[tuple[int,int,int], tuple[bytes, str]] = {}
    provider_url = (os.getenv("MAP_TILE_URL", "").strip() or "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}")
    attribution = os.getenv("MAP_ATTRIBUTION", "Esri World Imagery · Sources : Esri, Maxar, Earthstar Geographics et contributeurs")
    map_enabled = os.getenv("MAP_ENABLED", "true").lower() == "true"

    async def acquisition_loop():
        while True:
            begin = time.monotonic()
            async with lock:
                try:
                    service.step(0.1)
                except Exception:
                    logger.exception("Acquisition interrompue")
                    service.running = False
                    service.error = "Acquisition interrompue : consultez les journaux du serveur."
            await asyncio.sleep(max(0.01, 0.1-(time.monotonic()-begin)))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        nonlocal service
        if service is None:
            site = SiteConfig(latitude=float(os.getenv("SITE_ORIGIN_LAT", "33.110")),
                              longitude=float(os.getenv("SITE_ORIGIN_LON", "-8.610")),
                              altitude_m=float(os.getenv("SITE_ORIGIN_ALT_M", "0")),
                              heading_deg=float(os.getenv("SITE_HEADING_DEG", "0")),
                              name=os.getenv("SITE_NAME", "Parc de démonstration"))
            service = Engine(Path(os.getenv("DATA_DIR", "./data"))/"events.jsonl", site)
        task = asyncio.create_task(acquisition_loop()) if auto_tick else None
        app.state.engine = service
        async with httpx.AsyncClient(timeout=12, follow_redirects=False) as client:
            app.state.http = client
            yield
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="Parc de stockage — API de simulation", version="0.2.0", lifespan=lifespan,
                  description="Simulation uniquement. Aucun ordre vers un automate ou un scanner industriel.")
    origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in origins],
                       allow_methods=["GET", "POST", "PATCH"], allow_headers=["Content-Type"])

    @app.exception_handler(ValueError)
    async def value_error(request, exc):
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        fields = [".".join(str(v) for v in e["loc"][1:]) for e in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": "Valeur invalide ou hors limites : " + ", ".join(fields)})

    @app.get("/health")
    async def health():
        return {"status": "ok", "scope": "SIMULATOR_ONLY", "version": "0.2.0"}

    @app.get("/api/snapshot")
    async def snapshot(until_sequence: int | None = Query(None, ge=0)):
        async with lock:
            return service.snapshot(until_sequence)

    @app.get("/api/config")
    async def get_config():
        async with lock:
            return service.configuration()

    @app.patch("/api/config")
    async def config(change: ConfigChange):
        async with lock:
            service.set_config(change)
            return service.snapshot()

    @app.post("/api/control")
    async def control(command: Command):
        async with lock:
            service.command(command.action, command.confirm)
            return service.snapshot()

    @app.post("/api/inventory/selection")
    async def inventory(selection: Selection):
        async with lock:
            return service.report(selection)

    @app.post("/api/inventory/export")
    async def export(selection: Selection):
        async with lock:
            report = service.report(selection)
        buff = io.StringIO()
        writer = csv.writer(buff, delimiter=";")
        writer.writerow(["Produit", "Lot", "Tonnage (t)", "Volume (m³)", "Densité (t/m³)",
                         "BPL (%)", "CO₂ (%)", "MgO (%)", "SiO₂ (%)", "CaO (%)", "Humidité (%)",
                         "Première acquisition (UTC)", "Dernière acquisition (UTC)", "Machine",
                         "Début X (m)", "Fin X (m)", "Début Y (m)", "Fin Y (m)", "Statut"])
        def safe(value):
            text = str(value)
            return "'"+text if text.startswith(("=", "+", "-", "@")) else text
        def n(value):
            return f"{value:.5f}".replace(".", ",")
        from datetime import datetime, timezone
        for row in report["lots"]:
            writer.writerow([safe(row["name"]), row["lot"], *[n(row[k]) for k in
                ("tonnage_t", "volume_m3", "density_t_m3", "bpl_pct", "co2_pct", "mgo_pct", "sio2_pct", "cao_pct", "moisture_pct")],
                datetime.fromtimestamp(row["first_acquired_at"], timezone.utc).isoformat(),
                datetime.fromtimestamp(row["last_acquired_at"], timezone.utc).isoformat(), "STK-001",
                n(selection.x0), n(selection.x1), n(selection.y0), n(selection.y1), "SIMULATION — NON VALIDÉ"])
        return Response("\ufeff"+buff.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="inventaire-selection.csv"'})

    @app.get("/api/scans/latest")
    async def scan_latest():
        async with lock:
            return service.scan_detail()

    @app.get("/api/scans/{record_id}")
    async def scan_detail(record_id: str):
        async with lock:
            return service.scan_detail(record_id)

    @app.post("/api/scans/{record_id}/corrections")
    async def correction(record_id: str, body: Correction):
        async with lock:
            return service.correct(record_id, body)

    @app.get("/api/simulation/jobs")
    async def simulation_jobs():
        async with lock:
            return service.list_jobs()

    @app.post("/api/simulation/jobs/validate")
    async def simulation_validate(payload: SimulationJobValidationRequest):
        async with lock:
            return service.validate_job(payload.config)

    @app.post("/api/simulation/jobs")
    async def simulation_create(payload: SimulationJobCreate):
        async with lock:
            return service.create_job(payload)

    @app.post("/api/simulation/jobs/{job_id}/command")
    async def simulation_command(job_id: str, command: SimulationJobCommand):
        async with lock:
            return service.job_action(job_id, command.action, command.confirm)

    @app.get("/api/history")
    async def history():
        async with lock:
            return service.history()

    @app.get("/api/audit")
    async def audit():
        async with lock:
            return list(reversed(service.audit[-80:]))

    @app.get("/api/map")
    async def map_manifest():
        async with lock:
            geo = GeoConverter(service.site)
            return {"enabled": map_enabled, "site": service.site.model_dump(),
                    "tiles": geo.tile_manifest() if map_enabled else [], "attribution": attribution,
                    "notice": "Coordonnée d'exemple, implantation synthétique non topographiée. "
                              "Fond image plan ; ce n'est pas un modèle altimétrique.",
                    "geographic_origin": geo.yard_to_geo(0,0)}

    @app.get("/api/map/tiles/{z}/{x}/{y}")
    async def tile(z: int, x: int, y: int):
        if not map_enabled or urlparse(provider_url).scheme != "https":
            raise HTTPException(503, "Fond cartographique désactivé ou non configuré en HTTPS.")
        async with lock:
            allowed = {(t["z"], t["x"], t["y"]) for t in GeoConverter(service.site).tile_manifest()}
        key = (z,x,y)
        if key not in allowed:
            raise HTTPException(404, "Tuile hors de l'emprise autorisée.")
        if key in cache:
            return Response(cache[key][0], media_type=cache[key][1], headers={"Cache-Control":"public, max-age=300"})
        try:
            response = await app.state.http.get(provider_url.format(z=z,x=x,y=y),
                                                headers={"User-Agent":"StockyardDemo/0.2 (interactive viewport)"})
            response.raise_for_status()
            if not response.headers.get("content-type", "").startswith("image/") or len(response.content)>2_000_000:
                raise ValueError("Réponse cartographique non valide.")
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            logger.warning("Fond image indisponible : %s", type(exc).__name__)
            raise HTTPException(503, "Fond satellite indisponible. Vérifiez Internet et les droits du fournisseur.") from exc
        if len(cache) >= 64:
            cache.pop(next(iter(cache)))
        cache[key] = (response.content, response.headers.get("content-type", "image/jpeg"))
        return Response(response.content, media_type=response.headers.get("content-type","image/jpeg"),
                        headers={"Cache-Control":"public, max-age=300"})

    @app.websocket("/ws/live")
    async def live(ws: WebSocket):
        # Same origin policy for the simulator; authentication is a production task.
        origin = ws.headers.get("origin")
        if origin and origin not in [o.strip() for o in origins]:
            await ws.close(code=1008, reason="Origine non autorisée")
            return
        await ws.accept()
        previous_revision = -1
        try:
            while True:
                async with lock:
                    changed = service.revision != previous_revision
                    frame = service.snapshot(with_grid=changed)
                    previous_revision = service.revision
                await ws.send_json(frame)
                await asyncio.sleep(0.2)
        except (WebSocketDisconnect, RuntimeError, OSError):
            logger.info("Client temps réel déconnecté")

    return app


app = create_app()
