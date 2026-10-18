import type { Grid, GridStratigraphy } from "@/lib/types";

export const STRATIGRAPHY_OFFSET_M = 0.045;

export type StratifiedGroup = { productIndex: number; start: number; count: number };
export type StratifiedGeometryData = {
  positions: Float32Array;
  indices: Uint32Array;
  groups: StratifiedGroup[];
  layerCount: number;
  cellCount: number;
};

type CellLayer = { product: number; bottom: number; top: number };

type Band = {
  products: Int16Array;
  bottoms: Float32Array;
  tops: Float32Array;
};

function unpack(grid: Grid, strata: GridStratigraphy): Band[] {
  const cells = grid.nx * grid.ny;
  const bands: Band[] = Array.from({ length: Math.max(0, strata.max_layers) }, () => {
    const products = new Int16Array(cells); products.fill(-1);
    return { products, bottoms: new Float32Array(cells), tops: new Float32Array(cells) };
  });
  for (let row = 0; row < strata.cell_indices.length; row++) {
    const cell = strata.cell_indices[row];
    if (cell < 0 || cell >= cells) continue;
    const start = strata.layer_offsets[row] ?? 0;
    const end = strata.layer_offsets[row + 1] ?? start;
    for (let layer = start, bandIndex = 0; layer < end && bandIndex < bands.length; layer++, bandIndex++) {
      const product = strata.product_indices[layer] ?? -1;
      const bottom = strata.bottom_m[layer] ?? 0;
      const top = strata.top_m[layer] ?? bottom;
      if (product < 0 || !Number.isFinite(bottom) || !Number.isFinite(top) || top - bottom <= 0.001) continue;
      bands[bandIndex].products[cell] = product;
      bands[bandIndex].bottoms[cell] = bottom;
      bands[bandIndex].tops[cell] = top;
    }
  }
  return bands;
}

function adjacentCells(nx: number, ny: number, cornerX: number, cornerY: number): number[] {
  const result: number[] = [];
  for (const y of [cornerY - 1, cornerY]) for (const x of [cornerX - 1, cornerX]) {
    if (x >= 0 && y >= 0 && x < nx && y < ny) result.push(y * nx + x);
  }
  return result;
}

function cornerHeight(grid: Grid, band: Band, product: number, cornerX: number, cornerY: number, top: boolean): number {
  let total = 0, count = 0;
  for (const cell of adjacentCells(grid.nx, grid.ny, cornerX, cornerY)) {
    if (band.products[cell] !== product) continue;
    total += top ? band.tops[cell] : band.bottoms[cell];
    count++;
  }
  return count ? total / count : 0;
}

export function buildStratifiedGeometry(grid: Grid): StratifiedGeometryData | null {
  const strata = grid.stratigraphy;
  if (!strata || strata.layer_count <= 0 || strata.cell_indices.length === 0) return null;
  if (strata.layer_offsets.length !== strata.cell_indices.length + 1) throw new Error("Stratigraphie invalide : offsets incohérents.");
  if (strata.product_indices.length !== strata.bottom_m.length || strata.product_indices.length !== strata.top_m.length) {
    throw new Error("Stratigraphie invalide : tableaux de couches incohérents.");
  }

  const bands = unpack(grid, strata);
  const positions: number[] = [];
  const grouped = new Map<number, number[]>();
  const vertexMap = new Map<string, number>();
  const cell = grid.cell_m;

  const vertex = (bandIndex: number, product: number, gx: number, gy: number, height: number, face: "top" | "bottom") => {
    const key = `${bandIndex}:${product}:${gx}:${gy}:${face}`;
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    positions.push(grid.x0 + gx * cell, grid.y0 + gy * cell,
      Math.max(0, height) + (face === "top" ? STRATIGRAPHY_OFFSET_M : STRATIGRAPHY_OFFSET_M * 0.25));
    vertexMap.set(key, index);
    return index;
  };
  const add = (product: number, ...values: number[]) => {
    const list = grouped.get(product) ?? [];
    list.push(...values);
    grouped.set(product, list);
  };

  const same = (band: Band, x: number, y: number, product: number) =>
    x >= 0 && y >= 0 && x < grid.nx && y < grid.ny && band.products[y * grid.nx + x] === product;

  bands.forEach((band, bandIndex) => {
    for (let y = 0; y < grid.ny; y++) for (let x = 0; x < grid.nx; x++) {
      const at = y * grid.nx + x;
      const product = band.products[at];
      if (product < 0 || band.tops[at] - band.bottoms[at] <= 0.001) continue;

      const top00 = cornerHeight(grid, band, product, x, y, true);
      const top10 = cornerHeight(grid, band, product, x + 1, y, true);
      const top11 = cornerHeight(grid, band, product, x + 1, y + 1, true);
      const top01 = cornerHeight(grid, band, product, x, y + 1, true);
      const bot00 = cornerHeight(grid, band, product, x, y, false);
      const bot10 = cornerHeight(grid, band, product, x + 1, y, false);
      const bot11 = cornerHeight(grid, band, product, x + 1, y + 1, false);
      const bot01 = cornerHeight(grid, band, product, x, y + 1, false);

      const t00 = vertex(bandIndex, product, x, y, top00, "top");
      const t10 = vertex(bandIndex, product, x + 1, y, top10, "top");
      const t11 = vertex(bandIndex, product, x + 1, y + 1, top11, "top");
      const t01 = vertex(bandIndex, product, x, y + 1, top01, "top");
      const b00 = vertex(bandIndex, product, x, y, bot00, "bottom");
      const b10 = vertex(bandIndex, product, x + 1, y, bot10, "bottom");
      const b11 = vertex(bandIndex, product, x + 1, y + 1, bot11, "bottom");
      const b01 = vertex(bandIndex, product, x, y + 1, bot01, "bottom");

      // Smooth top interface and lower interface. The lower face becomes visible
      // when an upper product is isolated/hidden by the product filter.
      add(product, t00, t10, t01, t10, t11, t01);
      add(product, b00, b01, b10, b10, b01, b11);

      // Exposed boundaries show the actual vertical material thickness and make
      // A(0–3 m) / B(3–4 m) readable on the pile sides.
      if (!same(band, x - 1, y, product)) add(product, b00, t00, b01, t00, t01, b01);
      if (!same(band, x + 1, y, product)) add(product, b10, b11, t10, t10, b11, t11);
      if (!same(band, x, y - 1, product)) add(product, b00, b10, t00, t00, b10, t10);
      if (!same(band, x, y + 1, product)) add(product, b01, t01, b11, t01, t11, b11);
    }
  });

  const ordered = [...grouped.keys()].sort((a, b) => a - b);
  const flat: number[] = [];
  const groups: StratifiedGroup[] = [];
  for (const productIndex of ordered) {
    const values = grouped.get(productIndex)!;
    groups.push({ productIndex, start: flat.length, count: values.length });
    flat.push(...values);
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(flat),
    groups,
    layerCount: strata.layer_count,
    cellCount: strata.cell_count,
  };
}
