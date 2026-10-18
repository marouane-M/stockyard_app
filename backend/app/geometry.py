"""Authoritative geometry in yard metres, +X travel, +Y north-of-rail, +Z up.
The browser uses one fixed scene-root basis, (x, y, z) -> (x, z, -y).
"""
from __future__ import annotations
import math
import numpy as np
from pyproj import Transformer
from pyproj.enums import TransformDirection
from .models import MachineConfig, ScannerConfig, SiteConfig


def translation(x: float, y: float, z: float) -> np.ndarray:
    m = np.eye(4)
    m[:3, 3] = (x, y, z)
    return m


def rx(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[1,0,0,0],[0,c,-s,0],[0,s,c,0],[0,0,0,1]], dtype=float)


def ry(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[c,0,s,0],[0,1,0,0],[-s,0,c,0],[0,0,0,1]], dtype=float)


def rz(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[c,-s,0,0],[s,c,0,0],[0,0,1,0],[0,0,0,1]], dtype=float)


def boom_matrix(pose: dict, rig: MachineConfig) -> np.ndarray:
    return (translation(pose["travel_m"], 0, rig.pivot_height_m)
            @ rz(math.radians(pose["slew_deg"]))
            @ ry(math.radians(-pose["luff_deg"])))


def scanner_matrix(pose: dict, rig: MachineConfig, scanner: ScannerConfig) -> np.ndarray:
    # Order matches the frontend Group chain exactly; no independent world pose.
    return (boom_matrix(pose, rig)
            @ translation(rig.boom_length_m + scanner.mount_x_m,
                           scanner.mount_y_m, scanner.mount_z_m)
            @ rx(math.radians(scanner.mount_roll_deg))
            @ ry(math.radians(scanner.mount_pitch_deg))
            @ rz(math.radians(scanner.mount_yaw_deg)))


def transform_points(points: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    p = np.asarray(points, dtype=float).reshape(-1, 3)
    return p @ matrix[:3, :3].T + matrix[:3, 3]


def process_scan(record: dict, overrides: dict[int, dict] | None = None) -> dict:
    """Reprocess against the pose and calibration captured AT ACQUISITION."""
    cfg = ScannerConfig(**record["scanner_config"])
    rig = MachineConfig(**record["machine_config"])
    scan = record["scan"]
    if scan is None:
        return {"points": [], "indices": [], "origin": [], "valid_count": 0, "total_count": 0}
    ranges = np.array([np.nan if v is None else v for v in scan["ranges_m"]], dtype=float)
    qualities = np.array(scan["qualities"], dtype=float)
    for i, edit in (overrides or {}).items():
        if 0 <= i < len(ranges):
            ranges[i] = np.nan if edit["range_m"] is None else edit["range_m"]
            qualities[i] = edit["quality"]
    angles = np.array(scan["angles_rad"], dtype=float)
    r = ranges * cfg.range_scale + cfg.range_bias_m
    valid = (np.isfinite(r) & (r >= cfg.min_range_m) & (r <= cfg.max_range_m)
             & (qualities >= cfg.min_quality))
    local = np.column_stack([np.sin(angles) * r, np.zeros(len(r)), -np.cos(angles) * r])
    matrix = scanner_matrix(record["pose"], rig, cfg)
    points = transform_points(local, matrix)
    valid &= np.isfinite(points).all(axis=1) & (points[:,2] >= cfg.z_min_m) & (points[:,2] <= cfg.z_max_m)
    return {"points": np.round(points[valid], 5).tolist(),
            "indices": np.nonzero(valid)[0].tolist(),
            "origin": matrix[:3, 3].tolist(), "valid_count": int(valid.sum()),
            "total_count": len(r)}


class GeoConverter:
    """WGS84 ellipsoidal height <-> ENU <-> configured yard engineering frame."""
    def __init__(self, config: SiteConfig):
        self.config = config
        self.t = Transformer.from_pipeline(
            f"+proj=pipeline +step +proj=cart +ellps=WGS84 "
            f"+step +proj=topocentric +ellps=WGS84 +lat_0={config.latitude} "
            f"+lon_0={config.longitude} +h_0={config.altitude_m}")
        a = math.radians(config.heading_deg)
        self.c, self.s = math.cos(a), math.sin(a)

    def yard_to_geo(self, x: float, y: float, z: float = 0) -> tuple[float, float, float]:
        e, n = self.c*x - self.s*y, self.s*x + self.c*y
        lon, lat, alt = self.t.transform(e, n, z, direction=TransformDirection.INVERSE)
        return float(lon), float(lat), float(alt)

    def geo_to_yard(self, lon: float, lat: float, alt: float | None = None) -> tuple[float, float, float]:
        e, n, z = self.t.transform(lon, lat, self.config.altitude_m if alt is None else alt)
        return float(self.c*e+self.s*n), float(-self.s*e+self.c*n), float(z)

    def tile_manifest(self, zoom: int = 17) -> list[dict]:
        """Only tiles intersecting this one bounded viewport; no bulk harvesting."""
        def tile_xy(lon: float, lat: float) -> tuple[float, float]:
            lat_r = math.radians(lat)
            return ((lon+180)/360 * 2**zoom,
                    (1-math.asinh(math.tan(lat_r))/math.pi)/2 * 2**zoom)
        def tile_geo(x: float, y: float) -> tuple[float, float]:
            return x / 2**zoom * 360 - 180, math.degrees(math.atan(math.sinh(math.pi*(1-2*y/2**zoom))))
        corners = [self.yard_to_geo(x, y) for x in (-180, 540) for y in (-260, 260)]
        # Unwrap around the site's longitude, including a yard crossing the dateline.
        # Bound the count BEFORE generating geometries; coarsen near the poles.
        while True:
            world = 2**zoom
            anchor_x, _ = tile_xy(self.config.longitude, self.config.latitude)
            tiles = []
            for lon, lat, _ in corners:
                tx, ty = tile_xy(lon, lat)
                tx = anchor_x + (tx-anchor_x+world/2) % world-world/2
                tiles.append((tx, ty))
            xmin, xmax = math.floor(min(t[0] for t in tiles)), math.floor(max(t[0] for t in tiles))
            ymin, ymax = math.floor(min(t[1] for t in tiles)), math.floor(max(t[1] for t in tiles))
            if (xmax-xmin+1)*(ymax-ymin+1) <= 64:
                break
            zoom -= 1
            if zoom < 10:
                raise ValueError("Emprise cartographique trop grande pour cette démonstration.")
        result = []
        for y in range(ymin, ymax+1):
            for x in range(xmin, xmax+1):
                xyz = [self.geo_to_yard(*tile_geo(tx, ty)) for tx, ty in
                       [(x,y),(x+1,y),(x+1,y+1),(x,y+1)]]
                result.append({"z": zoom, "x": x % (2**zoom), "y": y, "corners": xyz})
        return result
