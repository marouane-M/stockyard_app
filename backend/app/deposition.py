"""Incremental, mass-conserving mound deposition for the v2 simulator.

This is a geometric heap model, not a granular-flow/avalanche solver. Existing
columns are never removed or rebalanced. Historical records retain their stored
cell contributions; only a newly acquired deposit uses this calculation.
"""
from __future__ import annotations

import math
import numpy as np
from .inventory import AREA, NX, NY, XX, YY


def deposit_mound(x: float, y: float, mass: float, product: dict,
                  heights: np.ndarray, repose_angle_deg: float = 34.0) -> dict:
    """Raise a cone over the current heightfield by exactly mass / density.

    Let d_i be distance from the discharge point and h_i the existing column.
    New material fills max(H - tan(angle)*d_i - h_i, 0). Solve for H so that
    the cell-volume sum is exactly the requested volume. The active-set solution
    is deterministic; increments (not a recomputed final surface) are journaled.
    Both outward growth and vertical growth emerge without a height multiplier.
    """
    density = float(product["density_t_m3"])
    if not all(math.isfinite(v) for v in (x, y, mass, density, repose_angle_deg)):
        raise ValueError("Les paramètres de formation du tas doivent être finis.")
    if mass < 0 or density <= 0 or not 20 <= repose_angle_deg <= 45:
        raise ValueError("Masse, densité ou angle du talus hors limites.")
    if not 0 <= x <= 360 or not 14 <= abs(y) <= 48:
        raise ValueError("Le point de dépôt est hors de la zone de stockage.")
    current = np.asarray(heights, dtype=float).reshape(-1)
    if current.size != NX * NY or not np.isfinite(current).all() or np.any(current < 0):
        raise ValueError("La grille de hauteur du stock est invalide.")
    volume = mass / density
    result = {"indices": [], "volumes_m3": [], "mass_t": mass,
              "volume_m3": volume, "product": dict(product), "center": [x, y],
              "formation_model": "CONSERVATIVE_CONICAL_MOUND_V1",
              "repose_angle_deg": repose_angle_deg}
    if volume == 0:
        return result

    # Same governed storage lanes as v2; no stock is placed on the central rail.
    eligible = ((np.abs(YY) >= 14) & (np.abs(YY) <= 48)
                & ((YY > 0) == (y > 0))).ravel()
    indices = np.flatnonzero(eligible)
    distance = np.hypot(XX.ravel()[indices] - x, YY.ravel()[indices] - y)
    thresholds = current[indices] + math.tan(math.radians(repose_angle_deg)) * distance
    # Subtract the smallest threshold to improve precision for tiny deposits.
    relative = thresholds - thresholds.min()
    ordered = np.sort(relative, kind="stable")
    candidates = (volume / AREA + np.cumsum(ordered)) / np.arange(1, len(ordered) + 1)
    next_level = np.r_[ordered[1:], np.inf]
    level = candidates[np.flatnonzero(candidates <= next_level)[0]]
    increments = np.maximum(level - relative, 0) * AREA
    active = increments > 0
    volumes = increments[active]
    # Correct only accumulated floating-point roundoff, never create extra mass.
    volumes *= volume / float(volumes.sum())
    result["indices"] = indices[active].tolist()
    result["volumes_m3"] = volumes.tolist()
    return result
