"""Ordered product layers for the simulated deposition ledger.

The scanner and heightfield provide geometry, while the active job provides the
product identity. Every inventory cell keeps a bottom-to-top material stack so
that a later product never erases the products already stored below it.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class MaterialLayer:
    product_id: str
    thickness_m: float
    first_sequence: int
    last_sequence: int
    first_acquired_at: float
    last_acquired_at: float


class DepositStratigraphy:
    """Sparse, ordered material layers for each inventory cell."""

    def __init__(self, cell_count: int, epsilon_m: float = 1e-8):
        if cell_count <= 0:
            raise ValueError("Le nombre de cellules stratigraphiques doit être positif.")
        self.cell_count = int(cell_count)
        self.epsilon_m = float(epsilon_m)
        self.layers: list[list[MaterialLayer]] = [[] for _ in range(self.cell_count)]

    def add(self, cell: int, product_id: str, thickness_m: float,
            sequence: int, acquired_at: float) -> None:
        if cell < 0 or cell >= self.cell_count:
            raise IndexError("Cellule stratigraphique hors limites.")
        if not product_id or thickness_m <= self.epsilon_m:
            return
        stack = self.layers[cell]
        if stack and stack[-1].product_id == product_id:
            top = stack[-1]
            top.thickness_m += float(thickness_m)
            top.last_sequence = max(top.last_sequence, int(sequence))
            top.last_acquired_at = max(top.last_acquired_at, float(acquired_at))
            return
        stack.append(MaterialLayer(
            product_id=product_id,
            thickness_m=float(thickness_m),
            first_sequence=int(sequence),
            last_sequence=int(sequence),
            first_acquired_at=float(acquired_at),
            last_acquired_at=float(acquired_at),
        ))

    def top_product(self, cell: int) -> str | None:
        stack = self.layers[cell]
        return stack[-1].product_id if stack else None

    def packed(self, product_ids: list[str], *, cell_area_m2: float) -> dict:
        """Return a compact sparse JSON representation for Three.js."""
        lookup = {product_id: index for index, product_id in enumerate(product_ids)}
        cell_indices: list[int] = []
        offsets: list[int] = [0]
        products: list[int] = []
        bottoms: list[float] = []
        tops: list[float] = []
        first_sequences: list[int] = []
        last_sequences: list[int] = []
        summary: dict[str, dict] = {}
        max_layers = 0

        for cell, stack in enumerate(self.layers):
            valid = [layer for layer in stack
                     if layer.thickness_m > self.epsilon_m and layer.product_id in lookup]
            if not valid:
                continue
            cell_indices.append(cell)
            max_layers = max(max_layers, len(valid))
            bottom = 0.0
            for layer in valid:
                top = bottom + layer.thickness_m
                products.append(lookup[layer.product_id])
                bottoms.append(round(bottom, 5))
                tops.append(round(top, 5))
                first_sequences.append(layer.first_sequence)
                last_sequences.append(layer.last_sequence)
                row = summary.setdefault(layer.product_id, {
                    "product_id": layer.product_id,
                    "volume_m3": 0.0,
                    "cell_layers": 0,
                    "max_top_m": 0.0,
                })
                row["volume_m3"] += layer.thickness_m * cell_area_m2
                row["cell_layers"] += 1
                row["max_top_m"] = max(row["max_top_m"], top)
                bottom = top
            offsets.append(len(products))

        for row in summary.values():
            row["volume_m3"] = round(float(row["volume_m3"]), 5)
            row["max_top_m"] = round(float(row["max_top_m"]), 5)

        return {
            "version": "DEPOSIT_STRATIGRAPHY_V1",
            "cell_indices": cell_indices,
            "layer_offsets": offsets,
            "product_indices": products,
            "bottom_m": bottoms,
            "top_m": tops,
            "first_sequences": first_sequences,
            "last_sequences": last_sequences,
            "cell_count": len(cell_indices),
            "layer_count": len(products),
            "max_layers": max_layers,
            "products": list(summary.values()),
        }
