"""Conservative finite-volume deposit accounting, independent of scanner estimates.
Cell overlap is integrated exactly for an axis-aligned selection in the yard frame.
"""
from __future__ import annotations
from collections import defaultdict
import numpy as np
from .models import Selection
from .stratigraphy import DepositStratigraphy

CELL = 2.0
NX, NY = 180, 54
X0, Y0 = 0.0, -54.0
AREA = CELL * CELL
X = X0 + (np.arange(NX) + 0.5) * CELL
Y = Y0 + (np.arange(NY) + 0.5) * CELL
XX, YY = np.meshgrid(X, Y)
CHEMISTRY = ("bpl_pct", "co2_pct", "mgo_pct", "sio2_pct", "cao_pct", "moisture_pct")


def overlap(selection: Selection) -> np.ndarray:
    wx = np.clip(np.minimum(X+CELL/2, selection.x1)-np.maximum(X-CELL/2, selection.x0), 0, CELL)/CELL
    wy = np.clip(np.minimum(Y+CELL/2, selection.y1)-np.maximum(Y-CELL/2, selection.y0), 0, CELL)/CELL
    return np.outer(wy, wx).ravel()


def deposit_footprint(x: float, y: float, mass: float, product: dict, sigma: float,
                      bounds: tuple[float, float, float, float] | None = None) -> dict:
    # Truncated Gaussian on the correct lane, renormalized: no mass lost at its edge.
    eligible = (np.abs(YY) >= 14) & (np.abs(YY) <= 48) & ((YY > 0) == (y > 0))
    if bounds is not None:
        x0, x1, y0, y1 = bounds
        eligible &= (XX >= x0) & (XX <= x1) & (YY >= y0) & (YY <= y1)
    d2 = (XX-x)**2 + (YY-y)**2
    w = np.exp(-d2/(2*sigma*sigma)) * eligible * (d2 < (3*sigma)**2)
    indices = np.flatnonzero(w.ravel() > 0)
    values = w.ravel()[indices]
    if len(indices) == 0:
        raise ValueError("Le point de dépôt est hors de la zone de stockage.")
    volumes = values/values.sum() * (mass/product["density_t_m3"])
    return {"indices": indices.tolist(), "volumes_m3": volumes.tolist(),
            "mass_t": mass, "volume_m3": mass/product["density_t_m3"],
            "product": dict(product), "center": [x, y]}


class Inventory:
    def __init__(self):
        self.events: list[dict] = []
        self.heights = np.zeros(NX*NY)
        self.product_volume: dict[str, np.ndarray] = {}
        # Latest deposited product per cell represents the exposed/top material.
        # Per-product volumes remain additive, so underlying products are not lost.
        self.top_product: list[str | None] = [None] * (NX * NY)
        self.stratigraphy = DepositStratigraphy(NX * NY)
        self.seen: set[str] = set()

    def integrate(self, record: dict):
        if record["id"] in self.seen:
            return False
        self.seen.add(record["id"])
        dep = record.get("deposit")
        if not dep:
            return True
        indices = np.asarray(dep["indices"], dtype=int)
        volumes = np.asarray(dep["volumes_m3"], dtype=float)
        self.heights[indices] += volumes / AREA
        p = dep["product"]["id"]
        self.product_volume.setdefault(p, np.zeros(NX*NY))[indices] += volumes
        for cell, volume in zip(indices.tolist(), volumes.tolist()):
            if volume > 0:
                self.top_product[cell] = p
                self.stratigraphy.add(cell, p, volume / AREA, record["sequence"], record["acquired_at"])
        self.events.append({"id": record["id"], "sequence": record["sequence"],
                            "acquired_at": record["acquired_at"], "lot": record["lot"],
                            "machine_id": "STK-001", "deposit": dep})
        return True

    def filtered(self, until: int | None) -> "Inventory":
        if until is None:
            return self
        result = Inventory()
        for event in self.events:
            if event["sequence"] <= until:
                result.integrate(event)
        return result

    def grid(self, products: list[dict]) -> dict:
        ids = [p["id"] for p in products]
        index_by_id = {product_id: index for index, product_id in enumerate(ids)}
        colors = np.array([index_by_id.get(product_id, -1) if product_id else -1
                           for product_id in self.top_product], dtype=int)
        colors[self.heights <= 0] = -1
        return {"nx": NX, "ny": NY, "cell_m": CELL, "x0": X0, "y0": Y0,
                "heights_m": np.round(self.heights, 5).tolist(), "product_indices": colors.tolist(),
                "surface_basis": "SIMULATED_DEPOSIT_LEDGER",
                "stratigraphy": self.stratigraphy.packed(ids, cell_area_m2=AREA)}

    def report(self, selection: Selection, measured: np.ndarray | None = None) -> dict:
        fraction = overlap(selection)
        totals: dict[str, dict] = {}
        lots: dict[str, dict] = {}
        for event in self.events:
            if selection.until_sequence is not None and event["sequence"] > selection.until_sequence:
                continue
            dep = event["deposit"]
            p = dep["product"]
            indices = np.asarray(dep["indices"], dtype=int)
            volume = float(np.dot(np.asarray(dep["volumes_m3"]), fraction[indices]))
            if volume <= 1e-10:
                continue
            mass = volume * p["density_t_m3"]
            def initial():
                return {"product_id": p["id"], "name": p["name"], "color": p["color"],
                        "volume_m3": 0., "tonnage_t": 0., "first_acquired_at": event["acquired_at"],
                        "last_acquired_at": event["acquired_at"], "deposits": 0,
                        **{k: 0. for k in CHEMISTRY}}
            group = totals.setdefault(p["id"], initial())
            lotkey = f'{event["lot"]}:{p["id"]}'
            lot = lots.setdefault(lotkey, {**initial(), "lot": event["lot"], "machine_id": "STK-001"})
            for row in (group, lot):
                row["volume_m3"] += volume
                row["tonnage_t"] += mass
                row["first_acquired_at"] = min(row["first_acquired_at"], event["acquired_at"])
                row["last_acquired_at"] = max(row["last_acquired_at"], event["acquired_at"])
                row["deposits"] += 1
                for k in CHEMISTRY:
                    row[k] += p[k] * mass
        for row in [*totals.values(), *lots.values()]:
            row["density_t_m3"] = row["tonnage_t"] / row["volume_m3"]
            for k in CHEMISTRY:
                row[k] /= row["tonnage_t"]
            row["quality"] = "SIMULATED"
            row["surface_status"] = "MODELED"
        filtered = self.filtered(selection.until_sequence)
        inside = fraction > 0
        occupied = (filtered.heights > 0.001) & inside
        covered = (np.isfinite(measured) if measured is not None else np.zeros(NX*NY, dtype=bool)) & inside
        occupied_area = float(np.sum(fraction[occupied])*AREA)
        observed_volume = 0. if measured is None else float(np.sum(np.maximum(measured[covered], 0)*fraction[covered])*AREA)
        return {"selection": selection.model_dump(), "products": list(totals.values()), "lots": list(lots.values()),
                "total_tonnage_t": sum(r["tonnage_t"] for r in totals.values()),
                "total_volume_m3": sum(r["volume_m3"] for r in totals.values()),
                "area_m2": (selection.x1-selection.x0)*(selection.y1-selection.y0),
                "occupied_area_m2": occupied_area,
                "max_height_m": float(np.max(filtered.heights[inside], initial=0)),
                "observed_lidar_volume_m3": observed_volume,
                "scan_coverage_pct": 100*float(np.sum(fraction[covered & occupied])*AREA)/occupied_area if occupied_area else 0.,
                "mass_basis": "SIMULATED_DEPOSIT_LEDGER",
                "surface_status": "MODELED_NOT_VALIDATED", "quality": "SIMULATED",
                "method": "Intersection exacte des cellules de 2 m ; densité et analyses figées à chaque dépôt. "
                          "Le volume LiDAR est partiel et distinct du bilan matière."}
