from __future__ import annotations
import math
import time
import uuid
from pathlib import Path
import numpy as np
from .models import (MachineConfig, ScannerConfig, SiteConfig, ConfigChange,
                     Product, Selection, Correction, SimulationJobCreate, SimulationJobConfig, default_products)
from .geometry import scanner_matrix, boom_matrix, transform_points, process_scan, GeoConverter
from .inventory import Inventory, NX, NY, CELL, X0, Y0, deposit_footprint
from .journal import Journal
from .deposition import deposit_mound


class Engine:
    """One shared simulator and central projection, independent of browser clients.

    MACHINE_EDGE / PRIMARY_EDGE here are logical demo roles, NOT field drivers.
    The raw log keeps custody; central acceptance is another durable journal event.
    """
    def __init__(self, journal_path: Path | None = None, site: SiteConfig | None = None):
        self.journal = Journal(journal_path)
        self.machine_config = MachineConfig()
        self.scanner_config = ScannerConfig()
        self.site = site or SiteConfig()
        self.products = default_products()
        self.jobs: dict[str, dict] = {}
        self.active_job_id: str | None = None
        self.audit: list[dict] = []
        self.config_version = 1
        self._clear()
        events = self.journal.read()
        if not events:
            self._persist_reset()
        else:
            for event in events:
                self._replay(event)
            self._rebuild_measured()
        # A server restart never starts a machine automatically, even the simulator.
        self.running = False
        self.error: str | None = None
        self.revision += 1

    def _clear(self):
        self.instance = str(uuid.uuid4())
        self.sequence = 0
        self.travel = self.machine_config.travel_min_m
        self.direction = 1
        self.pass_number = 0
        self.simulation_time = 0.
        self.elapsed = 0.
        self.scan_due = 0.
        self.running = False
        self.online = True
        self.outage_started_at: float | None = None
        self.last_outage_duration_s = 0.
        self.truth = Inventory()
        self.central = Inventory()
        self.raw: dict[str, dict] = {}
        self.accepted: set[str] = set()
        self.pending: list[str] = []
        self.overrides: dict[str, dict[int, dict]] = {}
        self.corrections: list[dict] = []
        self.measured = np.full(NX*NY, np.nan)
        self.measured_seq = np.full(NX*NY, -1, dtype=int)
        self.revision = getattr(self, "revision", 0) + 1
        self.error = None

    def configuration(self) -> dict:
        return {"machine": self.machine_config.model_dump(), "scanner": self.scanner_config.model_dump(),
                "site": self.site.model_dump(), "products": [p.model_dump() for p in self.products],
                "version": self.config_version}

    def _load_config(self, c: dict):
        self.machine_config = MachineConfig(**c["machine"])
        self.scanner_config = ScannerConfig(**c["scanner"])
        self.site = SiteConfig(**c["site"])
        self.products = [Product(**p) for p in c["products"]]
        self.config_version = c.get("version", 1)

    def _persist_reset(self):
        self.journal.append({"type": "reset", "at": time.time(), "instance": self.instance,
                             "config": self.configuration()})

    def _replay(self, e: dict):
        kind = e["type"]
        if kind == "reset":
            self._load_config(e["config"])
            self._clear()
            self.instance = e["instance"]
        elif kind == "config":
            self._load_config(e["config"])
            self.audit.append(e)
        elif kind == "acquisition":
            r = e["record"]
            self.raw[r["id"]] = r
            self.truth.integrate(r)
            self.pending.append(r["id"])
            self.sequence = max(self.sequence, r["sequence"])
            self.travel = r["pose"]["travel_m"]
            self.direction = r["pose"]["direction"]
            self.pass_number = r["pass_number"]
            self.simulation_time = r["simulation_time_s"]
            self._apply_job_record(r)
        elif kind == "acceptance":
            rid = e["record_id"]
            if rid in self.raw and rid not in self.accepted:
                self.accepted.add(rid)
                self.central.integrate(self.raw[rid])
                if rid in self.pending:
                    self.pending.remove(rid)
        elif kind == "correction":
            self._register_correction(e)
        elif kind in ("job_created", "job_state"):
            self._apply_job_event(e)
        elif kind == "transport":
            if not e["online"] and self.online:
                self.outage_started_at = e["at"]
            elif e["online"] and self.outage_started_at is not None:
                self.last_outage_duration_s = e["at"] - self.outage_started_at
                self.outage_started_at = None
            self.online = e["online"]
            self.audit.append(e)
        elif kind == "command":
            self.audit.append(e)

    def set_config(self, change: ConfigChange):
        mc = change.machine or self.machine_config
        sc = change.scanner or self.scanner_config
        site = change.site or self.site
        ps = change.products or self.products
        ids = [p.id for p in ps]
        if len(set(ids)) != len(ids) or mc.product_id not in ids:
            raise ValueError("Les identifiants produits doivent être uniques et le produit actif doit exister.")
        if not {p.id for p in self.products}.issubset(set(ids)):
            raise ValueError("Conservez les produits historiques ; leur suppression rendrait les dépôts ambigus.")
        if site != self.site and (self.running or self.sequence):
            raise ValueError("Arrêtez puis créez un parc vide avant de modifier le repère géographique.")
        if self.running and (mc.boom_length_m != self.machine_config.boom_length_m or
                             mc.pivot_height_m != self.machine_config.pivot_height_m):
            raise ValueError("Arrêtez la simulation avant de modifier les dimensions du stacker.")
        config = {"machine": mc.model_dump(), "scanner": sc.model_dump(), "site": site.model_dump(),
                  "products": [p.model_dump() for p in ps], "version": self.config_version+1}
        event = {"type": "config", "at": time.time(), "operator": change.operator,
                 "reason": change.reason, "before": self.configuration(), "config": config}
        # Commit first. Existing deposit snapshots and scan calibrations never change.
        self.journal.append(event)
        self._load_config(config)
        self.travel = float(np.clip(self.travel, mc.travel_min_m, mc.travel_max_m))
        self.audit.append(event)
        self.revision += 1

    def command(self, action: str, confirm: bool = False):
        if action == "empty":
            if not confirm:
                raise ValueError("Confirmez la création d'un parc vide. Le journal existant sera conservé.")
            event = {"type": "reset", "at": time.time(), "instance": str(uuid.uuid4()),
                     "config": self.configuration()}
            self.journal.append(event)
            self._replay(event)
        elif action in ("start", "stop"):
            if action == "start" and self.error:
                raise ValueError(self.error)
            e = {"type": "command", "at": time.time(), "action": action, "scope": "SIMULATOR_ONLY"}
            self.journal.append(e)
            self.audit.append(e)
            self.running = action == "start"
        elif action in ("outage", "restore"):
            online = action == "restore"
            e = {"type": "transport", "at": time.time(), "online": online}
            self.journal.append(e)
            self.audit.append(e)
            if not online and self.online:
                self.outage_started_at = e["at"]
            if online and self.outage_started_at:
                self.last_outage_duration_s = e["at"] - self.outage_started_at
                self.outage_started_at = None
            self.online = online
        else:
            raise ValueError("Commande de simulation inconnue.")
        self.revision += 1

    def _storage_to_profile(self, storage_type: str) -> str:
        return "gaussian" if storage_type == "gaussian" else "mound"

    def _job_template(self, job_id: str, cfg: dict, operator: str, reason: str) -> dict:
        return {"id": job_id, "name": cfg["name"], "status": "PRET", "created_at": time.time(),
                "started_at": None, "finished_at": None, "operator": operator, "reason": reason,
                "config": cfg, "current_pass_index": 0, "progress_pct": 0.0,
                "message": "Job prêt à lancer", "results": self._empty_job_results(cfg)}

    def _empty_job_results(self, cfg: dict) -> dict:
        return {"total_tonnage_t": 0.0, "total_volume_m3": 0.0, "max_height_m": 0.0,
                "duration_s": 0.0, "distance_m": cfg["end_m"] - cfg["start_m"],
                "products": {},
                "passes": [{"index": i, "product_id": p["product_id"], "target_tonnage_t": p.get("target_tonnage_t", 0.0),
                            "deposited_tonnage_t": 0.0, "status": "EN_ATTENTE"}
                           for i, p in enumerate(cfg["passes"])]}

    def create_job(self, payload: SimulationJobCreate) -> dict:
        ids = {p.id for p in self.products}
        for step in payload.config.passes:
            if step.product_id not in ids:
                raise ValueError(f"Produit inconnu dans le job : {step.product_id}")
        job_id = f"JOB-{len(self.jobs)+1:04}-{uuid.uuid4().hex[:6].upper()}"
        event = {"type": "job_created", "at": time.time(), "job_id": job_id,
                 "job": self._job_template(job_id, payload.config.model_dump(), payload.operator, payload.reason)}
        self.journal.append(event)
        self._replay(event)
        self.revision += 1
        return self.jobs[job_id]

    def _apply_job_event(self, e: dict):
        if e["type"] == "job_created":
            job = e["job"]
            job.setdefault("results", self._empty_job_results(job["config"]))
            self.jobs[job["id"]] = job
        elif e["type"] == "job_state":
            job = self.jobs[e["job_id"]]
            before = job.get("status")
            job.update(e["changes"])
            if job.get("status") == "EN_COURS":
                self.active_job_id = job["id"]
            elif self.active_job_id == job["id"] and job.get("status") in ("TERMINE", "ARRETE", "EN_PAUSE", "ERREUR"):
                self.active_job_id = None
            if before != job.get("status"):
                self.audit.append(e)

    def _active_job(self) -> dict | None:
        if self.active_job_id:
            job = self.jobs.get(self.active_job_id)
            if job and job.get("status") == "EN_COURS":
                return job
        return None

    def _active_job_pass(self) -> tuple[dict, dict] | None:
        job = self._active_job()
        if not job:
            return None
        index = int(job.get("current_pass_index", 0))
        if index >= len(job["config"]["passes"]):
            return None
        return job, job["config"]["passes"][index]

    def _product_by_id(self, product_id: str) -> Product:
        for product in self.products:
            if product.id == product_id:
                return product
        raise ValueError("Produit inconnu dans la configuration.")

    def job_action(self, job_id: str, action: str, confirm: bool = False) -> dict:
        if job_id not in self.jobs:
            raise ValueError("Job de simulation inconnu.")
        job = self.jobs[job_id]
        now = time.time()
        changes: dict = {}
        if action == "start":
            if self.running:
                raise ValueError("Arrêtez le simulateur actif avant de lancer ce job.")
            cfg = SimulationJobConfig(**job["config"])
            if cfg.reset_before_start:
                event = {"type": "reset", "at": now, "instance": str(uuid.uuid4()), "config": self.configuration()}
                self.journal.append(event)
                self._replay(event)
            mc = self.machine_config.model_copy(deep=True)
            mc.travel_min_m = cfg.start_m; mc.travel_max_m = cfg.end_m
            mc.speed_m_s = cfg.travel_speed_m_s; mc.flow_t_h = cfg.flow_t_h; mc.time_scale = cfg.time_scale
            mc.lane = cfg.lane; mc.auto_products = False; mc.alternate_lanes = cfg.storage_type == "alternating"
            mc.deposition_profile = self._storage_to_profile(cfg.storage_type)
            mc.repose_angle_deg = 38.0 if cfg.storage_type == "conical" else mc.repose_angle_deg
            mc.product_id = cfg.passes[0].product_id
            config = {"machine": mc.model_dump(), "scanner": self.scanner_config.model_dump(),
                      "site": self.site.model_dump(), "products": [p.model_dump() for p in self.products],
                      "version": self.config_version + 1}
            ce = {"type": "config", "at": now, "operator": job.get("operator", "Opérateur démo"),
                  "reason": f"Lancement du job {job['name']}", "before": self.configuration(), "config": config}
            self.journal.append(ce); self._load_config(config); self.audit.append(ce)
            first = cfg.passes[0]
            direction = first.direction if first.direction != "auto" else "forward"
            self.direction = 1 if direction == "forward" else -1
            self.travel = cfg.start_m if self.direction == 1 else cfg.end_m
            self.pass_number = 0
            changes = {"status": "EN_COURS", "started_at": now, "finished_at": None,
                       "current_pass_index": 0, "progress_pct": 0.0, "message": "Simulation en cours",
                       "results": self._empty_job_results(job["config"])}
            self.active_job_id = job_id; self.running = True
        elif action == "pause":
            if job.get("status") != "EN_COURS":
                raise ValueError("Seul un job en cours peut être mis en pause.")
            self.running = False
            changes = {"status": "EN_PAUSE", "message": "Job en pause"}
        elif action == "resume":
            if job.get("status") != "EN_PAUSE":
                raise ValueError("Seul un job en pause peut être repris.")
            self.running = True; self.active_job_id = job_id
            changes = {"status": "EN_COURS", "message": "Simulation reprise"}
        elif action == "stop":
            self.running = False
            changes = {"status": "ARRETE", "finished_at": now, "message": "Job arrêté par l'opérateur"}
        else:
            raise ValueError("Action de job inconnue.")
        event = {"type": "job_state", "at": now, "job_id": job_id, "changes": changes}
        self.journal.append(event); self._apply_job_event(event); self.revision += 1
        return self.jobs[job_id]

    def _apply_job_record(self, record: dict):
        job_id = record.get("job_id")
        if not job_id or job_id not in self.jobs or not record.get("deposit"):
            return
        job = self.jobs[job_id]
        dep = record["deposit"]
        product = dep["product"]
        pass_index = int(record.get("job_pass_index", job.get("current_pass_index", 0)))
        results = job.setdefault("results", self._empty_job_results(job["config"]))
        mass = float(dep.get("mass_t", 0.0)); volume = float(dep.get("volume_m3", 0.0))
        results["total_tonnage_t"] += mass; results["total_volume_m3"] += volume
        results["max_height_m"] = max(float(results.get("max_height_m", 0.0)), float(self.truth.heights.max(initial=0)))
        if job.get("started_at"):
            results["duration_s"] = max(0.0, record["acquired_at"] - job["started_at"])
        prod = results["products"].setdefault(product["id"], {"product_id": product["id"], "name": product["name"],
                                                              "color": product["color"], "tonnage_t": 0.0,
                                                              "volume_m3": 0.0})
        prod["tonnage_t"] += mass; prod["volume_m3"] += volume
        if pass_index < len(results["passes"]):
            results["passes"][pass_index]["deposited_tonnage_t"] += mass
            results["passes"][pass_index]["status"] = "EN_COURS"
        target_total = sum(max(0.0, float(p.get("target_tonnage_t") or 0.0)) for p in job["config"]["passes"])
        results["target_tonnage_t"] = target_total
        job["progress_pct"] = min(100.0, 100.0 * results["total_tonnage_t"] / target_total) if target_total else 0.0

    def _finish_active_pass_if_needed(self, bounced: bool = False):
        pair = self._active_job_pass()
        if not pair:
            return
        job, step = pair
        index = int(job.get("current_pass_index", 0))
        stats = job["results"]["passes"][index]
        target = float(step.get("target_tonnage_t") or 0.0)
        complete = (target > 0 and stats["deposited_tonnage_t"] >= target - 1e-6) or bounced
        if not complete:
            return
        stats["status"] = "TERMINE"
        next_index = index + 1
        now = time.time()
        if next_index >= len(job["config"]["passes"]):
            self.running = False
            event = {"type": "job_state", "at": now, "job_id": job["id"],
                     "changes": {"status": "TERMINE", "finished_at": now, "current_pass_index": index,
                                  "progress_pct": 100.0, "message": "Simulation terminée"}}
            self.journal.append(event); self._apply_job_event(event)
            return
        next_step = job["config"]["passes"][next_index]
        job["current_pass_index"] = next_index
        self.machine_config.product_id = next_step["product_id"]
        if next_step.get("lane") in ("north", "south"):
            self.machine_config.lane = next_step["lane"]
        direction = next_step.get("direction")
        if direction == "forward":
            self.direction = 1; self.travel = self.machine_config.travel_min_m
        elif direction == "backward":
            self.direction = -1; self.travel = self.machine_config.travel_max_m
        else:
            self.direction *= -1
            self.travel = self.machine_config.travel_min_m if self.direction == 1 else self.machine_config.travel_max_m
        job["message"] = f"Passage {next_index+1}/{len(job['config']['passes'])}"
        event = {"type": "job_state", "at": now, "job_id": job["id"],
                 "changes": {"current_pass_index": next_index, "message": job["message"]}}
        self.journal.append(event); self._apply_job_event(event)

    def list_jobs(self) -> list[dict]:
        return sorted(self.jobs.values(), key=lambda j: j.get("created_at", 0), reverse=True)

    def active_product(self) -> Product:
        pair = self._active_job_pass()
        if pair:
            return self._product_by_id(pair[1]["product_id"])
        start = next(i for i, p in enumerate(self.products) if p.id == self.machine_config.product_id)
        return self.products[(start + (self.pass_number if self.machine_config.auto_products else 0)) % len(self.products)]

    def current_pose(self, acquired_at: float) -> dict:
        m = self.machine_config
        lane = m.lane
        if m.alternate_lanes and (self.pass_number//2) % 2:
            lane = "south" if lane == "north" else "north"
        sign = 1 if lane == "north" else -1
        slew = sign*abs(m.slew_deg) + m.oscillation_deg*math.sin(self.simulation_time/90)
        return {"machine_id": "STK-001", "acquired_at": acquired_at, "sequence": self.sequence,
                "travel_m": self.travel, "slew_deg": slew, "luff_deg": m.luff_deg,
                "boom_extension_m": 0., "direction": self.direction, "lane": lane,
                "state": "STACKING" if self.running else "STOPPED", "quality": "SIMULATED",
                "plc_connection": "SIMULATOR", "position_quality": "SIMULATED"}

    def _raw_scan(self, pose: dict) -> dict:
        cfg = self.scanner_config
        matrix = scanner_matrix(pose, self.machine_config, cfg)
        angles = np.linspace(-math.radians(cfg.fov_deg)/2, math.radians(cfg.fov_deg)/2, cfg.samples)
        local_dirs = np.column_stack([np.sin(angles), np.zeros(cfg.samples), -np.cos(angles)])
        directions = local_dirs @ matrix[:3,:3].T
        distances = np.arange(cfg.min_range_m, cfg.max_range_m+0.20, 0.20)
        xyz = matrix[:3,3] + directions[:,None,:]*distances[None,:,None]
        ix = np.floor((xyz[:,:,0]-X0)/CELL).astype(int)
        iy = np.floor((xyz[:,:,1]-Y0)/CELL).astype(int)
        inside = (ix>=0)&(ix<NX)&(iy>=0)&(iy<NY)
        heights = np.zeros_like(ix, dtype=float)
        heights[inside] = self.truth.heights[(iy[inside]*NX+ix[inside])]
        crossed = xyz[:,:,2] <= heights
        has_hit = np.any(crossed, axis=1)
        first = np.argmax(crossed, axis=1)
        r = distances[first].copy()
        # Linear refinement along the ray at the first height crossing.
        previous = np.maximum(first-1,0)
        row = np.arange(cfg.samples)
        da = xyz[row,previous,2]-heights[row,previous]
        db = xyz[row,first,2]-heights[row,first]
        alpha = np.divide(da, da-db, out=np.zeros_like(da), where=np.abs(da-db)>1e-10)
        r = distances[previous]+np.clip(alpha,0,1)*(distances[first]-distances[previous])
        rng = np.random.default_rng(self.sequence)
        r += rng.normal(0, cfg.noise_std_m, cfg.samples)
        qualities = rng.integers(75, 101, cfg.samples)
        has_hit &= rng.random(cfg.samples) >= cfg.dropout_pct/100
        qualities[~has_hit] = 0
        return {"frame": "SCANNER_LOCAL_XZ", "angles_rad": angles.tolist(),
                "ranges_m": [round(float(value),5) if ok else None for value,ok in zip(r,has_hit)],
                "qualities": qualities.tolist()}

    def step(self, dt: float = 0.1):
        """Advance exactly once per central acquisition clock tick, not per WebSocket."""
        if not math.isfinite(dt) or dt <= 0 or dt > 1:
            raise ValueError("Le pas d'acquisition doit être compris entre 0 et 1 seconde.")
        self.elapsed += dt
        if self.running:
            if len(self.raw) >= 12000:
                self.error = "Limite de session démo atteinte (12 000 acquisitions). Créez un nouveau parc vide."
                self.running = False
            elif float(self.truth.heights.max()) > 18:
                self.error = "Hauteur limite de démonstration atteinte (18 m). Arrêt du simulateur."
                self.running = False
            else:
                self._acquire(dt)
        # Live records have already been accepted. Drain exact outstanding IDs concurrently.
        if self.online:
            for rid in list(self.pending[:2]):
                self.accept(rid, mode="BACKFILL")

    def _acquire(self, dt: float):
        m = self.machine_config
        previous = (self.simulation_time, self.travel, self.direction, self.pass_number,
                    self.sequence, self.scan_due)
        previous_pass_number = self.pass_number
        self.simulation_time += dt*m.time_scale
        travel = self.travel + self.direction*m.speed_m_s*dt*m.time_scale
        # Reflect any overshoot. No position jumps at the ends of the rail.
        while travel < m.travel_min_m or travel > m.travel_max_m:
            if travel > m.travel_max_m:
                travel = 2*m.travel_max_m - travel
                self.direction = -1
            elif travel < m.travel_min_m:
                travel = 2*m.travel_min_m - travel
                self.direction = 1
            self.pass_number += 1
        self.travel = travel
        self.sequence += 1
        now = time.time()
        pose = self.current_pose(now)
        job_pair = self._active_job_pass()
        product = self.active_product().model_dump()
        tip = transform_points(np.array([[m.boom_length_m,0,0]]), boom_matrix(pose,m))[0]
        mass = m.flow_t_h/3600 * dt*m.time_scale
        if job_pair:
            job, step = job_pair
            pass_stats = job["results"]["passes"][int(job.get("current_pass_index", 0))]
            remaining = max(0.0, float(step.get("target_tonnage_t") or 0.0) - float(pass_stats["deposited_tonnage_t"]))
            if remaining > 0:
                mass = min(mass, remaining)
        dep = None
        if mass > 0:
            if m.deposition_profile == "mound":
                # Use acquisition-side truth, not the possibly disconnected central
                # projection. Journal the increments so LIVE/BACKFILL stay additive.
                dep = deposit_mound(float(tip[0]), float(tip[1]), mass, product,
                                    self.truth.heights, m.repose_angle_deg)
            else:
                dep = deposit_footprint(float(tip[0]), float(tip[1]), mass, product, m.footprint_sigma_m)
        record = {"id": f"{self.instance}-{self.sequence}", "acquisition_instance": self.instance,
                  "stream_id": "STK-001/POSE+SCAN+DEPOSIT", "sequence": self.sequence,
                  "acquired_at": now, "simulation_time_s": self.simulation_time,
                  "pose": pose, "machine_config": m.model_dump(),
                  "scanner_config": self.scanner_config.model_dump(), "config_version": self.config_version,
                  "deposit": dep, "lot": f"LOT-{self.pass_number+1:04}",
                  "pass_number": self.pass_number, "scan": None,
                  "job_id": job_pair[0]["id"] if job_pair else None,
                  "job_pass_index": int(job_pair[0].get("current_pass_index", 0)) if job_pair else None,
                  "job_name": job_pair[0]["name"] if job_pair else None}
        # Synthetic measurements sample the just-deposited physical field.
        self.truth.integrate(record)
        self._apply_job_record(record)
        self.scan_due += dt
        if self.scanner_config.enabled and self.scan_due >= 1/self.scanner_config.rate_hz-1e-9:
            record["scan"] = self._raw_scan(pose)
            self.scan_due %= 1/self.scanner_config.rate_hz
        try:
            self.journal.append({"type": "acquisition", "record": record})
        except OSError:
            (self.simulation_time, self.travel, self.direction, self.pass_number,
             self.sequence, self.scan_due) = previous
            self.truth = Inventory()
            for durable_record in self.raw.values():
                self.truth.integrate(durable_record)
            self.running = False
            self.error = "Échec du journal durable : acquisition arrêtée ; vérifiez le disque."
            raise
        self.raw[record["id"]] = record
        self.pending.append(record["id"])
        if self.online:
            self.accept(record["id"], mode="LIVE")
        self._finish_active_pass_if_needed(bounced=self.pass_number != previous_pass_number)
        self.revision += 1

    def accept(self, record_id: str, mode: str = "BACKFILL") -> bool:
        if record_id in self.accepted:
            return False
        if record_id not in self.raw:
            raise ValueError("Acquisition inconnue.")
        # The durable acceptance is replayable before releasing any logical custody.
        self.journal.append({"type": "acceptance", "record_id": record_id,
                             "at": time.time(), "mode": mode})
        self.accepted.add(record_id)
        record = self.raw[record_id]
        self.central.integrate(record)
        self._integrate_measured(record)
        self.pending.remove(record_id)
        self.revision += 1
        return True

    def _integrate_measured(self, record: dict, target=None, sequences=None):
        if record["scan"] is None:
            return
        target = self.measured if target is None else target
        sequences = self.measured_seq if sequences is None else sequences
        processed = process_scan(record, self.overrides.get(record["id"]))
        points = np.asarray(processed["points"], dtype=float).reshape(-1,3)
        if not len(points):
            return
        ix = np.floor((points[:,0]-X0)/CELL).astype(int)
        iy = np.floor((points[:,1]-Y0)/CELL).astype(int)
        inside = (ix>=0)&(ix<NX)&(iy>=0)&(iy<NY)
        # Average all returns in a cell from the same scan, and reject stale backfill.
        for cell in np.unique(iy[inside]*NX+ix[inside]):
            mask = inside & ((iy*NX+ix)==cell)
            if record["sequence"] >= sequences[cell]:
                target[cell] = max(0., float(points[mask,2].mean()))
                sequences[cell] = record["sequence"]

    def _rebuild_measured(self, until: int | None = None):
        target = np.full(NX*NY, np.nan)
        sequences = np.full(NX*NY, -1, dtype=int)
        for r in sorted((self.raw[rid] for rid in self.accepted), key=lambda x:x["sequence"]):
            if until is None or r["sequence"] <= until:
                self._integrate_measured(r, target, sequences)
        if until is None:
            self.measured, self.measured_seq = target, sequences
        return target

    def latest_record(self, until: int | None = None, with_scan=False) -> dict | None:
        candidates = [r for rid,r in self.raw.items() if rid in self.accepted
                      and (until is None or r["sequence"] <= until)
                      and (not with_scan or r["scan"] is not None)]
        return max(candidates, key=lambda r:r["sequence"], default=None)

    def scan_detail(self, record_id: str | None = None) -> dict:
        r = self.raw.get(record_id) if record_id else self.latest_record(with_scan=True)
        if r is None or r["id"] not in self.accepted or r["scan"] is None:
            raise ValueError("Aucun balayage reçu. Démarrez la simulation et activez le scanner.")
        edits = self.overrides.get(r["id"], {})
        processed = process_scan(r, edits)
        valid = set(processed["indices"])
        world = dict(zip(processed["indices"], processed["points"]))
        return {"id": r["id"], "sequence": r["sequence"], "acquired_at": r["acquired_at"],
                "acquisition_instance": r["acquisition_instance"], "pose": r["pose"],
                "config_version": r["config_version"], "scanner_config": r["scanner_config"],
                "origin": processed["origin"], "valid_count": processed["valid_count"],
                "raw": r["scan"], "corrections": [e for e in self.corrections if e["record_id"] == r["id"]],
                "beams": [{"index": i, "angle_deg": math.degrees(angle), "raw_range_m": distance,
                           "raw_quality": q, "range_m": edits.get(i, {}).get("range_m", distance),
                           "quality": edits.get(i, {}).get("quality", q), "accepted": i in valid,
                           "world_xyz": world.get(i), "corrected": i in edits}
                          for i,(angle,distance,q) in enumerate(zip(r["scan"]["angles_rad"],
                                                                  r["scan"]["ranges_m"],r["scan"]["qualities"]))]}

    def _register_correction(self, event: dict):
        rid = event["record_id"]
        self.overrides.setdefault(rid, {}).update({u["index"]: u for u in event["updates"]})
        self.corrections.append(event)
        self.audit.append(event)

    def correct(self, record_id: str, correction: Correction):
        detail = self.scan_detail(record_id)
        if any(u.index >= len(detail["beams"]) for u in correction.updates):
            raise ValueError("Indice de rayon hors du balayage sélectionné.")
        e = {"type": "correction", "at": time.time(), "record_id": record_id,
             "revision_id": str(uuid.uuid4()), **correction.model_dump()}
        self.journal.append(e)
        self._register_correction(e)
        self._rebuild_measured()
        self.revision += 1
        return self.scan_detail(record_id)

    def report(self, selection: Selection) -> dict:
        observed = self.measured if selection.until_sequence is None else self._rebuild_measured(selection.until_sequence)
        result = self.central.report(selection, observed)
        result["instance"] = self.instance
        result["revision"] = self.revision
        result["machine"] = (self.latest_record(selection.until_sequence) or {}).get("pose", self.current_pose(time.time()))
        result["scanner_id"] = "LIDAR-001"
        result["last_acquisition_at"] = (self.latest_record(selection.until_sequence) or {}).get("acquired_at")
        return result

    def snapshot(self, until: int | None = None, with_grid: bool = True) -> dict:
        record = self.latest_record(until)
        scan_record = self.latest_record(until, with_scan=True)
        scan = (process_scan(scan_record, self.overrides.get(scan_record["id"])) if scan_record else
                {"points": [], "origin": [], "valid_count": 0, "total_count": 0})
        inv = self.central.filtered(until)
        measured = self.measured if until is None else self._rebuild_measured(until)
        pose = record["pose"] if record else self.current_pose(time.time())
        rig = MachineConfig(**record["machine_config"]) if record else self.machine_config
        acquisition_scanner = ScannerConfig(**record["scanner_config"]) if record else self.scanner_config
        active = (record.get("deposit") or {}).get("product") if record and until is not None else None
        expected_ids = {f"{self.instance}-{i}" for i in range(1, self.sequence+1)}
        continuous = self.accepted == expected_ids
        stage = "OPEN" if not self.online else "RECOVERING" if self.pending else "RECONCILED" if continuous else "OPEN"
        return {"kind": "snapshot", "instance": self.instance, "revision": self.revision,
                "server_time": time.time(), "mode": "LIVE" if until is None else "HISTORICAL",
                "running": self.running if until is None else False, "scope": "SIMULATOR_ONLY", "sequence": self.sequence,
                "simulation_time_s": record["simulation_time_s"] if record else 0,
                "config": self.configuration(), "machine": pose,
                "machine_rig": record["machine_config"] if record else self.machine_config.model_dump(),
                "scanner_mount": record["scanner_config"] if record else self.scanner_config.model_dump(),
                "head_xyz": transform_points(np.array([[rig.boom_length_m,0,0]]),
                                               boom_matrix(pose, rig))[0].tolist(),
                "scanner": {"id": "LIDAR-001", "enabled": self.scanner_config.enabled if until is None else acquisition_scanner.enabled,
                            "acquiring": self.running and self.scanner_config.enabled and until is None,
                            "last_acquired_at": scan_record["acquired_at"] if scan_record else None,
                            "record_id": scan_record["id"] if scan_record else None,
                            "sequence": scan_record["sequence"] if scan_record else None,
                            "rate_hz": self.scanner_config.rate_hz if until is None else acquisition_scanner.rate_hz, "quality": "SIMULATED", **scan},
                "communication": {"online": self.online, "pending_records": len(self.pending),
                                  "gap_state": stage, "acquisition_continues": self.running,
                                  "outage_started_at": self.outage_started_at,
                                  "last_outage_duration_s": self.last_outage_duration_s,
                                  "accepted_records": len(self.accepted), "captured_records": len(self.raw)},
                "grid": inv.grid([p.model_dump() for p in self.products]) if with_grid else None,
                "measured_heights_m": [round(float(v),4) if np.isfinite(v) else None for v in measured] if with_grid else None,
                "totals": inv.report(Selection(), measured),
                "active_product": active or self.active_product().model_dump(),
                "active_job": self.jobs.get(self.active_job_id) if self.active_job_id else None,
                "jobs_summary": [{"id": j["id"], "name": j["name"], "status": j["status"],
                                  "progress_pct": j.get("progress_pct", 0), "total_tonnage_t": j.get("results", {}).get("total_tonnage_t", 0)}
                                 for j in self.list_jobs()[:8]],
                "pass_number": record["pass_number"] if record and until is not None else self.pass_number, "alarm": self.error}

    def history(self) -> list[dict]:
        ordered = sorted((self.raw[i] for i in self.accepted), key=lambda r:r["sequence"])
        # Display at most 800 positions; exact queries still address all sequences.
        step = max(1, math.ceil(len(ordered)/800))
        records = ordered[::step]
        if ordered and (not records or records[-1]["id"] != ordered[-1]["id"]):
            records.append(ordered[-1])
        return [{"sequence": r["sequence"], "acquired_at": r["acquired_at"],
                 "simulation_time_s": r["simulation_time_s"], "travel_m": r["pose"]["travel_m"]}
                for r in records]
