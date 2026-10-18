export type Vec3 = [number, number, number];
export type Mode = "2d" | "3d";
export type Area = { x0: number; x1: number; y0: number; y1: number };
export type MachineConfig = {
  travel_min_m: number; travel_max_m: number; speed_m_s: number; flow_t_h: number;
  time_scale: number; slew_deg: number; luff_deg: number; oscillation_deg: number;
  lane: "north" | "south"; auto_products: boolean; alternate_lanes: boolean;
  product_id: string; boom_length_m: number; pivot_height_m: number; footprint_sigma_m: number;
  deposition_profile: "mound" | "gaussian"; repose_angle_deg: number;
};
export type ScannerConfig = {
  enabled: boolean; rate_hz: number; samples: number; fov_deg: number;
  min_range_m: number; max_range_m: number; noise_std_m: number; dropout_pct: number;
  range_bias_m: number; range_scale: number; min_quality: number; z_min_m: number; z_max_m: number;
  mount_x_m: number; mount_y_m: number; mount_z_m: number;
  mount_roll_deg: number; mount_pitch_deg: number; mount_yaw_deg: number;
};
export type Site = { latitude: number; longitude: number; altitude_m: number; heading_deg: number; name: string };
export type Product = {
  id: string; name: string; color: string; density_t_m3: number; bpl_pct: number;
  co2_pct: number; mgo_pct: number; sio2_pct: number; cao_pct: number; moisture_pct: number;
  quality: "SIMULATED";
};
export type Config = { machine: MachineConfig; scanner: ScannerConfig; site: Site; products: Product[]; version: number };
export type Pose = {
  machine_id: string; acquired_at: number; sequence: number; travel_m: number;
  slew_deg: number; luff_deg: number; boom_extension_m: number; direction: number;
  lane: "north" | "south"; state: string; quality: string; plc_connection: string; position_quality: string;
};
export type Grid = { nx: number; ny: number; cell_m: number; x0: number; y0: number; heights_m: number[]; product_indices: number[] };
export type InventoryRow = {
  product_id: string; name: string; color: string; volume_m3: number; tonnage_t: number;
  density_t_m3: number; bpl_pct: number; co2_pct: number; mgo_pct: number; sio2_pct: number;
  cao_pct: number; moisture_pct: number; first_acquired_at: number; last_acquired_at: number;
  deposits: number; quality: string; surface_status: string; lot?: string; machine_id?: string;
};
export type Report = {
  selection: Area & { until_sequence?: number | null }; products: InventoryRow[]; lots: InventoryRow[];
  total_tonnage_t: number; total_volume_m3: number; area_m2: number; occupied_area_m2: number;
  max_height_m: number; observed_lidar_volume_m3: number; scan_coverage_pct: number; mass_basis: string;
  surface_status: string; quality: string; method: string; instance?: string; revision?: number;
  machine?: Pose; scanner_id?: string; last_acquisition_at?: number | null;
};

export type SimulationPassConfig = {
  product_id: string; target_tonnage_t: number; direction: "forward" | "backward" | "auto"; lane: "north" | "south" | "auto";
};
export type SimulationJobConfig = {
  name: string; storage_type: "mound" | "gaussian" | "longitudinal" | "alternating" | "conical";
  start_m: number; end_m: number; lane: "north" | "south"; travel_speed_m_s: number; flow_t_h: number;
  time_scale: number; reset_before_start: boolean; passes: SimulationPassConfig[];
};
export type SimulationJob = {
  id: string; name: string; status: "PRET" | "EN_COURS" | "EN_PAUSE" | "TERMINE" | "ARRETE" | "ERREUR";
  created_at: number; started_at: number | null; finished_at: number | null; operator: string; reason: string;
  config: SimulationJobConfig; current_pass_index: number; progress_pct: number; message: string;
  results: {
    total_tonnage_t: number; total_volume_m3: number; max_height_m: number; duration_s: number; distance_m: number; target_tonnage_t?: number;
    products: Record<string, { product_id: string; name: string; color: string; tonnage_t: number; volume_m3: number }>;
    passes: { index: number; product_id: string; target_tonnage_t: number; deposited_tonnage_t: number; status: string }[];
  };
};

export type Frame = {
  kind: "snapshot"; instance: string; revision: number; server_time: number; mode: "LIVE" | "HISTORICAL";
  running: boolean; scope: "SIMULATOR_ONLY"; sequence: number; simulation_time_s: number;
  config: Config; machine: Pose; machine_rig: MachineConfig; scanner_mount: ScannerConfig; head_xyz: Vec3;
  scanner: { id: string; enabled: boolean; acquiring: boolean; last_acquired_at: number | null;
    record_id: string | null; sequence: number | null; rate_hz: number; quality: string;
    points: Vec3[]; origin: Vec3 | []; valid_count: number; total_count: number };
  communication: { online: boolean; pending_records: number; gap_state: "OPEN" | "RECOVERING" | "RECONCILED";
    acquisition_continues: boolean; outage_started_at: number | null; last_outage_duration_s: number;
    accepted_records: number; captured_records: number };
  grid: Grid | null; measured_heights_m: (number | null)[] | null; totals: Report;
  active_product: Product; active_job?: SimulationJob | null; jobs_summary?: { id: string; name: string; status: string; progress_pct: number; total_tonnage_t: number }[]; pass_number: number; alarm: string | null;
};
export type MapManifest = {
  enabled: boolean; site: Site; tiles: { z: number; x: number; y: number; corners: Vec3[] }[];
  attribution: string; notice: string; geographic_origin: Vec3;
};
export type ScanDetail = {
  id: string; sequence: number; acquired_at: number; acquisition_instance: string; pose: Pose;
  config_version: number; scanner_config: ScannerConfig; origin: Vec3; valid_count: number;
  raw: { frame: string; angles_rad: number[]; ranges_m: (number | null)[]; qualities: number[] };
  corrections: AuditEvent[];
  beams: { index: number; angle_deg: number; raw_range_m: number | null; raw_quality: number;
    range_m: number | null; quality: number; accepted: boolean; world_xyz: Vec3 | null; corrected: boolean }[];
};
export type AuditEvent = {
  type: string; at: number; operator?: string; reason?: string; action?: string; online?: boolean;
  record_id?: string; revision_id?: string; updates?: { index: number; range_m: number | null; quality: number }[];
};
export type Layer = "map" | "piles" | "machine" | "scanner" | "points" | "measured" | "grid" | "labels";
export type Layers = Record<Layer, boolean>;
export type Picked = "machine" | "scanner" | "pile";
export type SelectionTool = "navigate" | "interval" | "rectangle";
export type LaneScope = "all" | "north" | "south";
