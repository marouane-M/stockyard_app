"""Business validation and preview for simulated storage jobs.

The planner is deliberately independent from the UI. It checks the current
heightfield, product densities, machine travel limits and the selected zone
before a job can be created or started.
"""
from __future__ import annotations

import math
from typing import Iterable

import numpy as np

from .inventory import AREA, CELL, NX, NY, X, Y, overlap
from .models import MachineConfig, Product, Selection, SimulationJobConfig

LANES: dict[str, tuple[float, float]] = {
    "south": (-48.0, -14.0),
    "north": (14.0, 48.0),
}
FILL_FACTORS: dict[str, float] = {
    "mound": 0.46,
    "gaussian": 0.36,
    "longitudinal": 0.68,
    "alternating": 0.62,
    "conical": 0.34,
}


def _shape_capacity(length_m: float, width_m: float, height_m: float, storage_type: str) -> float:
    """Conservative preview capacity, distinct from authoritative deposited volume.

    Longitudinal strategies use a repose-angle cross-section and an end-effect
    factor. Gaussian/conical preview modes use lower empirical shape factors.
    """
    if min(length_m, width_m, height_m) <= 0:
        return 0.0
    if storage_type in ("gaussian", "conical"):
        factor = FILL_FACTORS[storage_type]
        return length_m * width_m * height_m * factor
    tangent = math.tan(math.radians(34.0 if storage_type != "conical" else 38.0))
    natural_width = 2.0 * height_m / tangent
    if natural_width <= width_m:
        cross_section = height_m * height_m / tangent
    else:
        cross_section = width_m * height_m - width_m * width_m * tangent / 4.0
    # End slopes and the discrete moving discharge reduce usable capacity versus
    # an ideal infinite prism. This makes the preview deliberately conservative.
    end_factor = 0.58 if storage_type == "mound" else 0.64
    return max(0.0, length_m * cross_section * end_factor)


def _height_for_volume(volume_m3: float, length_m: float, width_m: float, storage_type: str,
                       upper_m: float = 18.0) -> float:
    if volume_m3 <= 0:
        return 0.0
    low, high = 0.0, upper_m
    for _ in range(48):
        middle = (low + high) / 2.0
        if _shape_capacity(length_m, width_m, middle, storage_type) >= volume_m3:
            high = middle
        else:
            low = middle
    return high


def _issue(code: str, title: str, message: str, **details) -> dict:
    return {"code": code, "title": title, "message": message, "details": details}


def _area_from_config(config: SimulationJobConfig) -> dict:
    lane_y0, lane_y1 = LANES[config.lane]
    if config.area is not None:
        area = config.area.model_dump()
    else:
        area = {
            "x0": config.start_m,
            "x1": config.end_m,
            "y0": lane_y0,
            "y1": lane_y1,
            "source": "form",
        }
    return area


def _selection(area: dict) -> Selection:
    return Selection(x0=area["x0"], x1=area["x1"], y0=area["y0"], y1=area["y1"])


def _product_map(products: Iterable[Product]) -> dict[str, Product]:
    return {product.id: product for product in products}


def _occupied_products(product_volume: dict[str, np.ndarray], fraction: np.ndarray,
                       products: dict[str, Product]) -> list[dict]:
    rows: list[dict] = []
    for product_id, volumes in product_volume.items():
        volume = float(np.dot(volumes, fraction))
        if volume <= 1e-8:
            continue
        product = products.get(product_id)
        rows.append({
            "product_id": product_id,
            "name": product.name if product else product_id,
            "color": product.color if product else "#64748b",
            "volume_m3": volume,
            "tonnage_t": volume * (product.density_t_m3 if product else 0.0),
        })
    return sorted(rows, key=lambda row: row["volume_m3"], reverse=True)


def _find_free_area(config: SimulationJobConfig, heights: np.ndarray, machine: MachineConfig,
                    requested_volume_m3: float, width_m: float, fill_factor: float,
                    selected_area: dict) -> dict | None:
    if width_m <= 0 or config.max_height_m <= 0:
        return None
    capacity_per_m = _shape_capacity(1.0, width_m, config.max_height_m, config.storage_type)
    required_length = max(12.0, requested_volume_m3 / max(capacity_per_m, 1e-9))
    required_cells = max(6, math.ceil(required_length / CELL))
    min_col = max(0, math.ceil(machine.travel_min_m / CELL))
    max_col = min(NX, math.floor(machine.travel_max_m / CELL))
    y0, y1 = selected_area["y0"], selected_area["y1"]
    ymask = (Y + CELL / 2 > y0) & (Y - CELL / 2 < y1)
    if not np.any(ymask):
        return None
    field = heights.reshape(NY, NX)
    occupied_by_x = np.any(field[ymask, :] > 0.02, axis=0)
    candidates: list[tuple[float, int, int]] = []
    desired_mid = (selected_area["x0"] + selected_area["x1"]) / 2
    run_start: int | None = None
    for col in range(min_col, max_col + 1):
        blocked = col == max_col or occupied_by_x[col]
        if not blocked and run_start is None:
            run_start = col
        if blocked and run_start is not None:
            run_end = col
            if run_end - run_start >= required_cells:
                for start in range(run_start, run_end - required_cells + 1):
                    end = start + required_cells
                    midpoint = (start + end) * CELL / 2
                    candidates.append((abs(midpoint - desired_mid), start, end))
            run_start = None
    if not candidates:
        return None
    _, start, end = min(candidates)
    return {
        "x0": round(start * CELL, 1),
        "x1": round(end * CELL, 1),
        "y0": y0,
        "y1": y1,
        "source": "suggestion",
        "required_length_m": round(required_length, 1),
    }


def _planned_passes(config: SimulationJobConfig, area: dict, products: dict[str, Product],
                    fill_factor: float) -> list[dict]:
    requested = []
    for index, step in enumerate(config.passes):
        product = products[step.product_id]
        volume = step.target_tonnage_t / product.density_t_m3 if product.density_t_m3 else 0.0
        requested.append((index, step, product, volume))

    length = area["x1"] - area["x0"]
    width = area["y1"] - area["y0"]
    if config.placement_mode == "layered":
        result = []
        cumulative_height = 0.0
        for index, step, product, volume in requested:
            previous_height = cumulative_height
            cumulative_volume = sum(item[3] for item in requested[:index + 1])
            cumulative_height = _height_for_volume(cumulative_volume, length, width, config.storage_type)
            thickness = max(0.0, cumulative_height - previous_height)
            result.append({
                "index": index,
                "product_id": product.id,
                "product_name": product.name,
                "color": product.color,
                "target_tonnage_t": step.target_tonnage_t,
                "target_volume_m3": volume,
                "direction": step.direction,
                "lane": step.lane,
                "x0": area["x0"], "x1": area["x1"],
                "y0": area["y0"], "y1": area["y1"],
                "estimated_z0_m": previous_height,
                "estimated_z1_m": cumulative_height,
                "estimated_height_m": cumulative_height,
            })
        return result

    # Adjacent products receive non-overlapping longitudinal subzones. A one-metre
    # visual/operational gap is left between phases when the selected interval permits it.
    gap = 1.0 if len(requested) > 1 else 0.0
    usable = max(0.0, length - gap * (len(requested) - 1))
    total_volume = sum(item[3] for item in requested)
    cursor = area["x0"]
    result = []
    for position, (index, step, product, volume) in enumerate(requested):
        portion = usable / len(requested) if total_volume <= 0 else usable * volume / total_volume
        x0 = cursor
        x1 = area["x1"] if position == len(requested) - 1 else cursor + portion
        sub_area = max((x1 - x0) * width, 1e-9)
        result.append({
            "index": index,
            "product_id": product.id,
            "product_name": product.name,
            "color": product.color,
            "target_tonnage_t": step.target_tonnage_t,
            "target_volume_m3": volume,
            "direction": step.direction,
            "lane": step.lane,
            "x0": round(x0, 3), "x1": round(x1, 3),
            "y0": area["y0"], "y1": area["y1"],
            "estimated_z0_m": 0.0,
            "estimated_z1_m": _height_for_volume(volume, max(x1 - x0, 0.1), width, config.storage_type),
            "estimated_height_m": _height_for_volume(volume, max(x1 - x0, 0.1), width, config.storage_type),
        })
        cursor = x1 + gap
    return result


def validate_job_plan(config: SimulationJobConfig, products: list[Product], heights: np.ndarray,
                      product_volume: dict[str, np.ndarray], machine: MachineConfig,
                      assume_empty: bool = False) -> dict:
    area = _area_from_config(config)
    errors: list[dict] = []
    warnings: list[dict] = []
    product_by_id = _product_map(products)
    unknown = [step.product_id for step in config.passes if step.product_id not in product_by_id]
    if unknown:
        errors.append(_issue("PRODUIT_INCONNU", "Produit inconnu",
                             f"Le produit {unknown[0]} n'existe pas dans le catalogue.", product_id=unknown[0]))

    lane_y0, lane_y1 = LANES[config.lane]
    if area["y0"] < lane_y0 - 1e-6 or area["y1"] > lane_y1 + 1e-6:
        errors.append(_issue(
            "ZONE_HORS_BASE", "Zone hors de la base sélectionnée",
            "La sélection doit rester entièrement dans la base choisie.",
            lane=config.lane, allowed_y0=lane_y0, allowed_y1=lane_y1,
            selected_y0=area["y0"], selected_y1=area["y1"],
        ))
    if area["x0"] < machine.travel_min_m - 1e-6 or area["x1"] > machine.travel_max_m + 1e-6:
        errors.append(_issue(
            "HORS_COURSE_STACKER", "Zone hors de portée du stacker",
            "Le stacker ne peut pas atteindre toute la zone sélectionnée.",
            travel_min_m=machine.travel_min_m, travel_max_m=machine.travel_max_m,
            selected_x0=area["x0"], selected_x1=area["x1"],
        ))

    selection = _selection(area)
    fraction = overlap(selection)
    physical_heights = np.zeros_like(heights) if assume_empty else np.asarray(heights, dtype=float)
    selected_area_m2 = (area["x1"] - area["x0"]) * (area["y1"] - area["y0"])
    occupied_mask = physical_heights > 0.02
    occupied_area_m2 = float(np.dot(occupied_mask.astype(float), fraction) * AREA)
    existing_volume_m3 = float(np.dot(physical_heights, fraction) * AREA)
    fill_factor = FILL_FACTORS[config.storage_type]

    requested_tonnage_t = sum(float(step.target_tonnage_t) for step in config.passes)
    requested_volume_m3 = 0.0
    if not unknown:
        requested_volume_m3 = sum(
            float(step.target_tonnage_t) / product_by_id[step.product_id].density_t_m3
            for step in config.passes
        )

    length_m = area["x1"] - area["x0"]
    width_m = area["y1"] - area["y0"]
    theoretical_capacity_m3 = _shape_capacity(length_m, width_m, config.max_height_m, config.storage_type)
    if config.placement_mode == "adjacent":
        empty_fraction = fraction * (~occupied_mask)
        free_area_m2 = float(empty_fraction.sum() * AREA)
        free_ratio = free_area_m2 / selected_area_m2 if selected_area_m2 else 0.0
        free_capacity_m3 = theoretical_capacity_m3 * free_ratio
    else:
        free_area_m2 = max(0.0, selected_area_m2 - occupied_area_m2)
        free_capacity_m3 = max(0.0, theoretical_capacity_m3 - existing_volume_m3)

    occupied_products = [] if assume_empty else _occupied_products(product_volume, fraction, product_by_id)
    if config.placement_mode == "adjacent" and occupied_area_m2 > 0.5:
        names = ", ".join(row["name"] for row in occupied_products[:3]) or "matière existante"
        errors.append(_issue(
            "ZONE_OCCUPEE", "Zone déjà occupée",
            f"Le mode côte à côte exige une zone libre. La sélection contient déjà : {names}.",
            occupied_area_m2=round(occupied_area_m2, 2), products=occupied_products,
        ))
    if requested_volume_m3 > free_capacity_m3 + 1e-6:
        errors.append(_issue(
            "CAPACITE_INSUFFISANTE", "Capacité insuffisante",
            "La zone sélectionnée ne peut pas contenir le tonnage demandé avec la hauteur maximale configurée.",
            requested_volume_m3=round(requested_volume_m3, 2),
            available_volume_m3=round(free_capacity_m3, 2),
            missing_volume_m3=round(max(0.0, requested_volume_m3 - free_capacity_m3), 2),
            max_height_m=config.max_height_m,
        ))

    estimated_height_m = _height_for_volume(
        existing_volume_m3 + requested_volume_m3 if config.placement_mode == "layered" else requested_volume_m3,
        length_m, width_m, config.storage_type
    )
    if estimated_height_m > config.max_height_m + 1e-6:
        errors.append(_issue(
            "HAUTEUR_DEPASSEE", "Hauteur maximale dépassée",
            "La hauteur prévue dépasse la limite du job.",
            estimated_height_m=round(estimated_height_m, 2), max_height_m=config.max_height_m,
        ))

    plans: list[dict] = []
    if not unknown:
        plans = _planned_passes(config, area, product_by_id, fill_factor)
        too_short = [plan for plan in plans if plan["x1"] - plan["x0"] < 12.0]
        if too_short:
            errors.append(_issue(
                "SOUS_ZONE_TROP_COURTE", "Répartition des produits impossible",
                "La zone est trop courte pour séparer clairement tous les produits côte à côte.",
                minimum_subzone_length_m=12.0, affected_passes=[plan["index"] + 1 for plan in too_short],
            ))

    duration_s = requested_tonnage_t / config.flow_t_h * 3600 if config.flow_t_h > 0 else 0.0
    suggestion = None
    if errors and not assume_empty:
        suggestion = _find_free_area(config, np.asarray(heights, dtype=float), machine,
                                     requested_volume_m3, area["y1"] - area["y0"], fill_factor, area)
        if suggestion:
            warnings.append(_issue(
                "ZONE_LIBRE_PROPOSEE", "Zone libre disponible",
                "Une zone libre compatible a été trouvée sur la même base.", **suggestion,
            ))

    valid = not errors
    return {
        "valid": valid,
        "status": "VALIDE" if valid else "REFUSE",
        "area": area,
        "placement_mode": config.placement_mode,
        "errors": errors,
        "warnings": warnings,
        "occupied_products": occupied_products,
        "suggested_area": suggestion,
        "planned_passes": plans,
        "metrics": {
            "length_m": round(area["x1"] - area["x0"], 2),
            "width_m": round(area["y1"] - area["y0"], 2),
            "selected_area_m2": round(selected_area_m2, 2),
            "occupied_area_m2": round(occupied_area_m2, 2),
            "existing_volume_m3": round(existing_volume_m3, 2),
            "requested_tonnage_t": round(requested_tonnage_t, 2),
            "requested_volume_m3": round(requested_volume_m3, 2),
            "theoretical_capacity_m3": round(theoretical_capacity_m3, 2),
            "free_capacity_m3": round(free_capacity_m3, 2),
            "estimated_max_height_m": round(estimated_height_m, 2),
            "max_height_m": config.max_height_m,
            "estimated_duration_s": round(duration_s, 2),
            "fill_factor": fill_factor,
        },
        "summary": (
            "La zone et les paramètres du job sont compatibles."
            if valid else
            "Le job ne peut pas être lancé tant que les erreurs de capacité ou d'occupation ne sont pas corrigées."
        ),
        "basis": "APERÇU_DE_SIMULATION_NON_CERTIFIE",
    }
