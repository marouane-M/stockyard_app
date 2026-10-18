from app.inventory import AREA, Inventory


def product(pid: str, density: float = 2.0):
    return {
        "id": pid,
        "name": pid,
        "color": "#ff00aa" if pid == "A" else "#00bbcc",
        "density_t_m3": density,
        "bpl_pct": 60.0,
        "co2_pct": 1.0,
        "mgo_pct": 1.0,
        "sio2_pct": 1.0,
        "cao_pct": 1.0,
        "moisture_pct": 1.0,
        "quality": "SIMULATED",
    }


def record(rid: str, sequence: int, pid: str, thickness_m: float):
    p = product(pid)
    volume = thickness_m * AREA
    return {
        "id": rid,
        "sequence": sequence,
        "acquired_at": float(sequence),
        "lot": f"LOT-{pid}",
        "deposit": {
            "indices": [0],
            "volumes_m3": [volume],
            "mass_t": volume * p["density_t_m3"],
            "volume_m3": volume,
            "product": p,
            "center": [1.0, -47.0],
        },
    }


def test_products_are_kept_as_ordered_layers_in_the_same_cell():
    inventory = Inventory()
    inventory.integrate(record("r1", 1, "A", 3.0))
    inventory.integrate(record("r2", 2, "B", 1.0))

    grid = inventory.grid([product("A"), product("B")])
    strata = grid["stratigraphy"]
    assert grid["heights_m"][0] == 4.0
    assert grid["product_indices"][0] == 1
    assert strata["cell_indices"] == [0]
    assert strata["layer_offsets"] == [0, 2]
    assert strata["product_indices"] == [0, 1]
    assert strata["bottom_m"] == [0.0, 3.0]
    assert strata["top_m"] == [3.0, 4.0]


def test_consecutive_deposits_of_same_product_are_merged():
    inventory = Inventory()
    inventory.integrate(record("r1", 1, "A", 1.0))
    inventory.integrate(record("r2", 2, "A", 2.0))

    strata = inventory.grid([product("A")])["stratigraphy"]
    assert strata["layer_count"] == 1
    assert strata["bottom_m"] == [0.0]
    assert strata["top_m"] == [3.0]
    assert strata["first_sequences"] == [1]
    assert strata["last_sequences"] == [2]
