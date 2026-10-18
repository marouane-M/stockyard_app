"""Domain models. Units and acquisition frames are explicit; no PLC wire contract."""
from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)


class SiteConfig(Model):
    # A real map coordinate used ONLY as an illustrative anchor, not a surveyed yard.
    latitude: float = Field(33.110, ge=-80, le=80)
    longitude: float = Field(-8.610, ge=-180, le=180)
    altitude_m: float = Field(0, ge=-500, le=9000)
    heading_deg: float = Field(0, ge=-180, le=180)  # yard +X counterclockwise from East
    name: str = Field("Parc de démonstration", min_length=1, max_length=80)


class MachineConfig(Model):
    travel_min_m: float = Field(30, ge=18, le=330)
    travel_max_m: float = Field(330, ge=30, le=342)
    speed_m_s: float = Field(0.06, ge=0.005, le=0.3)
    flow_t_h: float = Field(1800, ge=0, le=6000)
    time_scale: float = Field(300, ge=1, le=600)
    slew_deg: float = Field(90, ge=-110, le=110)
    luff_deg: float = Field(12, ge=0, le=30)
    oscillation_deg: float = Field(3, ge=0, le=10)
    lane: Literal["north", "south"] = "south"
    auto_products: bool = True
    alternate_lanes: bool = True
    product_id: str = "LAVE-A"
    boom_length_m: float = Field(32, ge=24, le=35)
    pivot_height_m: float = Field(9, ge=6, le=15)
    footprint_sigma_m: float = Field(5.0, ge=2, le=8)  # legacy Gaussian profile only
    deposition_profile: Literal["mound", "gaussian"] = "mound"
    repose_angle_deg: float = Field(34.0, ge=20, le=45)  # illustrative, not laboratory data

    @model_validator(mode="after")
    def validate_interval(self):
        if self.travel_max_m - self.travel_min_m < 12:
            raise ValueError("L'intervalle de translation doit être d'au moins 12 m.")
        # Keep the illustrative machine on its lane, not arbitrary unsafe poses.
        if abs(self.slew_deg) < 70:
            raise ValueError("La valeur absolue de l'orientation doit être comprise entre 70° et 110°.")
        return self


class ScannerConfig(Model):
    enabled: bool = True
    rate_hz: float = Field(5, ge=1, le=10)
    samples: int = Field(81, ge=9, le=241)
    fov_deg: float = Field(90, ge=10, le=120)
    min_range_m: float = Field(0.5, ge=0.1, le=10)
    max_range_m: float = Field(70, ge=15, le=120)
    noise_std_m: float = Field(0.025, ge=0, le=1)
    dropout_pct: float = Field(1, ge=0, le=80)
    range_bias_m: float = Field(0, ge=-3, le=3)
    range_scale: float = Field(1, ge=0.8, le=1.2)
    min_quality: int = Field(25, ge=0, le=100)
    z_min_m: float = Field(-0.3, ge=-10, le=0)
    z_max_m: float = Field(40, ge=1, le=100)
    mount_x_m: float = Field(0, ge=-3, le=3)
    mount_y_m: float = Field(0, ge=-3, le=3)
    mount_z_m: float = Field(-0.7, ge=-3, le=3)
    mount_roll_deg: float = Field(0, ge=-25, le=25)
    mount_pitch_deg: float = Field(0, ge=-25, le=25)
    mount_yaw_deg: float = Field(0, ge=-25, le=25)

    @model_validator(mode="after")
    def validate_ranges(self):
        if self.max_range_m <= self.min_range_m:
            raise ValueError("La portée maximale doit dépasser la portée minimale.")
        return self


class Product(Model):
    id: str = Field(min_length=1, max_length=30, pattern=r"^[A-Z0-9-]+$")
    name: str = Field(min_length=1, max_length=70)
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    density_t_m3: float = Field(1.65, ge=0.1, le=5)
    bpl_pct: float = Field(68, ge=0, le=100)
    co2_pct: float = Field(5, ge=0, le=100)
    mgo_pct: float = Field(0.7, ge=0, le=100)
    sio2_pct: float = Field(3.1, ge=0, le=100)
    cao_pct: float = Field(47, ge=0, le=100)
    moisture_pct: float = Field(8, ge=0, le=100)
    quality: Literal["SIMULATED"] = "SIMULATED"




class SimulationPass(Model):
    product_id: str = Field(min_length=1, max_length=30, pattern=r"^[A-Z0-9-]+$")
    target_tonnage_t: float = Field(2500, ge=0, le=100000)
    direction: Literal["forward", "backward", "auto"] = "auto"
    lane: Literal["north", "south", "auto"] = "auto"


class SimulationJobConfig(Model):
    name: str = Field("Scénario de démonstration", min_length=1, max_length=100)
    storage_type: Literal["mound", "gaussian", "longitudinal", "alternating", "conical"] = "mound"
    start_m: float = Field(40, ge=0, le=350)
    end_m: float = Field(300, ge=10, le=360)
    lane: Literal["north", "south"] = "south"
    travel_speed_m_s: float = Field(0.08, ge=0.005, le=0.3)
    flow_t_h: float = Field(1800, ge=0, le=6000)
    time_scale: float = Field(300, ge=1, le=600)
    reset_before_start: bool = True
    passes: list[SimulationPass] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def validate_job(self):
        if self.end_m - self.start_m < 12:
            raise ValueError("La distance du job doit être d'au moins 12 m.")
        if self.storage_type == "alternating" and len(self.passes) < 2:
            raise ValueError("Le stockage alterné nécessite au moins deux passages.")
        return self


class SimulationJobCreate(Model):
    config: SimulationJobConfig
    operator: str = Field("Opérateur démo", min_length=1, max_length=80)
    reason: str = Field("Création d'un scénario de simulation", min_length=3, max_length=500)


class SimulationJobCommand(Model):
    action: Literal["start", "pause", "resume", "stop", "duplicate"]
    confirm: bool = False

class Selection(Model):
    x0: float = Field(0, ge=0, le=360)
    x1: float = Field(360, ge=0, le=360)
    y0: float = Field(-54, ge=-54, le=54)
    y1: float = Field(54, ge=-54, le=54)
    until_sequence: int | None = Field(None, ge=0)

    @model_validator(mode="after")
    def validate_area(self):
        if self.x1 <= self.x0 or self.y1 <= self.y0:
            raise ValueError("La zone sélectionnée doit avoir une largeur et une longueur positives.")
        return self


class BeamEdit(Model):
    index: int = Field(ge=0, le=240)
    range_m: float | None = Field(None, ge=0, le=120)
    quality: int = Field(ge=0, le=100)


class Correction(Model):
    operator: str = Field(min_length=1, max_length=80)
    reason: str = Field(min_length=3, max_length=500)
    updates: list[BeamEdit] = Field(min_length=1, max_length=241)

    @model_validator(mode="after")
    def unique_indices(self):
        if len({u.index for u in self.updates}) != len(self.updates):
            raise ValueError("Un seul changement est autorisé par rayon dans une correction.")
        return self


class ConfigChange(Model):
    reason: str = Field(min_length=3, max_length=500)
    operator: str = Field("Opérateur démo", min_length=1, max_length=80)
    machine: MachineConfig | None = None
    scanner: ScannerConfig | None = None
    site: SiteConfig | None = None
    products: list[Product] | None = Field(None, min_length=1, max_length=12)


class Command(Model):
    action: Literal["start", "stop", "empty", "outage", "restore"]
    confirm: bool = False


def default_products() -> list[Product]:
    return [
        Product(id="LAVE-A", name="Phosphate lavé A", color="#dd39b5", density_t_m3=1.65,
                bpl_pct=70, co2_pct=4.5, mgo_pct=0.55, sio2_pct=2.8, cao_pct=49, moisture_pct=8),
        Product(id="LAVE-B", name="Phosphate lavé B", color="#f09a3e", density_t_m3=1.58,
                bpl_pct=66, co2_pct=5.3, mgo_pct=0.8, sio2_pct=4.2, cao_pct=46, moisture_pct=9),
        Product(id="BRUT-A", name="Phosphate brut A", color="#24b9c0", density_t_m3=1.72,
                bpl_pct=62, co2_pct=6.8, mgo_pct=1.1, sio2_pct=5.2, cao_pct=44, moisture_pct=6),
        Product(id="MELANGE", name="Mélange de démonstration", color="#9dcf3e", density_t_m3=1.62,
                bpl_pct=68, co2_pct=5.1, mgo_pct=0.72, sio2_pct=3.5, cao_pct=47, moisture_pct=7),
    ]
