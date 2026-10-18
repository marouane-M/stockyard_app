/** Display-only heightfield geometry. Inventory remains authoritative in Python.
 * Coordinates here are yard metres: X rail, Y lateral, Z up. YardScene applies
 * the single existing scene-root conversion to Three.js coordinates.
 */
export type HeightGrid = {
  nx: number; ny: number; cell_m: number; x0: number; y0: number;
  heights_m: readonly number[]; product_indices: readonly number[];
};
export const SURFACE_OFFSET_M = 0.025; // depth bias only, NOT a height multiplier
export const STOCKPILE_DISPLAY_DETAIL = 4; // four render samples per backend cell for a clean surface
export type StockpileSurface = {
  positions: Float32Array; heights: Float32Array; productIndices: Int16Array;
  indices: Uint32Array; peak: { x: number; y: number; height: number };
  maxIndexCount: number;
};

function assertGrid(grid: HeightGrid) {
  const { nx, ny, cell_m: cell, x0, y0 } = grid;
  if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx < 1 || ny < 1 ||
      !Number.isFinite(cell) || cell <= 0 || !Number.isFinite(x0) || !Number.isFinite(y0) ||
      grid.heights_m.length !== nx * ny || grid.product_indices.length !== nx * ny ||
      grid.heights_m.some(h => !Number.isFinite(h) || h < 0)) {
    throw new Error("Grille de surface invalide.");
  }
}

function cellIndex(grid: HeightGrid, x: number, y: number): number {
  return y * grid.nx + x;
}

function cellHeight(grid: HeightGrid, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= grid.nx || y >= grid.ny) return 0;
  return grid.heights_m[cellIndex(grid, x, y)] ?? 0;
}

function productAt(grid: HeightGrid, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= grid.nx || y >= grid.ny) return -1;
  return grid.product_indices[cellIndex(grid, x, y)] ?? -1;
}

function sampleHeight(grid: HeightGrid, gx: number, gy: number): number {
  // Boundary vertices are pinned to ground so the rendered pile has a clean rim.
  if (gx <= 0 || gy <= 0 || gx >= grid.nx || gy >= grid.ny) return 0;

  // Source values are cell-centre heights. Convert render coordinates to
  // fractional cell-centre coordinates, then bilinearly interpolate. This
  // removes the square/pixel look without changing the backend inventory grid.
  const sx = gx - 0.5;
  const sy = gy - 0.5;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const tx = sx - x0;
  const ty = sy - y0;
  const h00 = cellHeight(grid, x0, y0);
  const h10 = cellHeight(grid, x0 + 1, y0);
  const h01 = cellHeight(grid, x0, y0 + 1);
  const h11 = cellHeight(grid, x0 + 1, y0 + 1);
  const a = h00 * (1 - tx) + h10 * tx;
  const b = h01 * (1 - tx) + h11 * tx;
  return a * (1 - ty) + b * ty;
}

function nearestProduct(grid: HeightGrid, gx: number, gy: number): number {
  const x = Math.max(0, Math.min(grid.nx - 1, Math.floor(gx)));
  const y = Math.max(0, Math.min(grid.ny - 1, Math.floor(gy)));
  const direct = productAt(grid, x, y);
  if (direct >= 0) return direct;

  // For interpolated edge vertices, borrow the closest visible product only for
  // display. This does not create mass or modify the authoritative inventory.
  let best = -1;
  let bestH = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const px = x + dx;
    const py = y + dy;
    const h = cellHeight(grid, px, py);
    const product = productAt(grid, px, py);
    if (product >= 0 && h > bestH) {
      best = product;
      bestH = h;
    }
  }
  return best;
}

export function buildStockpileSurface(grid: HeightGrid, previous?: ArrayLike<number>): StockpileSurface {
  assertGrid(grid);
  const { nx, ny, cell_m: cell, x0, y0 } = grid;
  const detail = STOCKPILE_DISPLAY_DETAIL;
  const vx = nx * detail + 1;
  const vy = ny * detail + 1;
  const count = vx * vy;
  const positions = new Float32Array(count * 3);
  const heights = new Float32Array(count);
  const productIndices = new Int16Array(count); productIndices.fill(-1);
  const triangles: number[] = [];
  const peak = { x: x0, y: y0, height: 0 };

  for (let row = 0; row < vy; row++) for (let col = 0; col < vx; col++) {
    const i = row * vx + col;
    const gx = col / detail;
    const gy = row / detail;
    const x = x0 + gx * cell;
    const y = y0 + gy * cell;
    const h = sampleHeight(grid, gx, gy);
    heights[i] = h;
    positions.set([x, y, h + SURFACE_OFFSET_M], i * 3);
    productIndices[i] = h > 0.001 ? nearestProduct(grid, gx, gy) : -1;
    if (h > peak.height) Object.assign(peak, { x, y, height: h });
  }

  // Ensure the reported/displayed peak is retained exactly even after display
  // interpolation. The mesh remains smooth around it because surrounding render
  // vertices are already bilinear samples.
  let sourcePeak = 0, sourcePeakIndex = -1;
  for (let i = 0; i < grid.heights_m.length; i++) {
    const h = grid.heights_m[i];
    if (h > sourcePeak) { sourcePeak = h; sourcePeakIndex = i; }
  }
  if (sourcePeakIndex >= 0 && sourcePeak > peak.height) {
    const sx = sourcePeakIndex % nx;
    const sy = Math.floor(sourcePeakIndex / nx);
    const col = Math.round((sx + 0.5) * detail);
    const row = Math.round((sy + 0.5) * detail);
    const i = row * vx + col;
    heights[i] = sourcePeak;
    positions[i * 3 + 2] = sourcePeak + SURFACE_OFFSET_M;
    productIndices[i] = grid.product_indices[sourcePeakIndex] ?? -1;
    Object.assign(peak, { x: x0 + (sx + 0.5) * cell, y: y0 + (sy + 0.5) * cell, height: sourcePeak });
  }

  for (let row = 0; row < vy - 1; row++) for (let col = 0; col < vx - 1; col++) {
    const a = row * vx + col;
    const b = a + 1;
    const c = a + vx;
    const d = c + 1;
    const vertices = [a, b, c, d];
    if (!vertices.some(v => heights[v] > 0.001 || (previous?.[v] ?? 0) > 0.001)) continue;
    triangles.push(a, b, c, b, d, c);
  }

  return {
    positions,
    heights,
    productIndices,
    indices: new Uint32Array(triangles),
    peak,
    maxIndexCount: (vx - 1) * (vy - 1) * 6
  };
}

/** Smooth only between received surfaces. No prediction or fabricated height. */
export function writeInterpolatedHeights(positions: Float32Array, from: ArrayLike<number>,
                                         to: ArrayLike<number>, progress: number): number {
  if (positions.length !== to.length * 3 || from.length !== to.length) {
    throw new Error("Tailles de surface incompatibles.");
  }
  const t = Math.max(0, Math.min(1, progress)), blend = t * t * (3 - 2 * t);
  let peak = 0;
  for (let i = 0; i < to.length; i++) {
    const h = from[i] + (to[i] - from[i]) * blend;
    positions[i * 3 + 2] = h + SURFACE_OFFSET_M; peak = Math.max(peak, h);
  }
  return peak;
}

/** Height of the displayed surface directly under the material stream. */
export function sampleStockpileHeight(grid: HeightGrid, positions: ArrayLike<number>, x: number, y: number): number {
  const gx = (x - grid.x0) / grid.cell_m;
  const gy = (y - grid.y0) / grid.cell_m;
  if (gx < 0 || gy < 0 || gx > grid.nx || gy > grid.ny) return 0;
  const detail = STOCKPILE_DISPLAY_DETAIL;
  const vx = grid.nx * detail + 1;
  const col = Math.max(0, Math.min(vx - 1, Math.round(gx * detail)));
  const row = Math.max(0, Math.min(grid.ny * detail, Math.round(gy * detail)));
  const i = row * vx + col;
  const z = positions[i * 3 + 2];
  return Number.isFinite(z) ? Math.max(0, z) : 0;
}
