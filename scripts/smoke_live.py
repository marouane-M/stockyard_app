"""Local end-to-end API/WS smoke test. Starts a temporary simulator, not Docker.
Run from a Python environment with backend/requirements.txt installed.
"""
from __future__ import annotations
import asyncio
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
import httpx
import websockets

ROOT = Path(__file__).resolve().parents[1]

async def verify(port: int) -> dict:
    base = f"http://127.0.0.1:{port}"
    async with httpx.AsyncClient(base_url=base,timeout=8) as client:
        await client.post("/api/control",json={"action":"start"})
        async with websockets.connect(f"ws://127.0.0.1:{port}/ws/live") as one:
            async with websockets.connect(f"ws://127.0.0.1:{port}/ws/live") as two:
                a=json.loads(await asyncio.wait_for(one.recv(),5))
                b=json.loads(await asyncio.wait_for(two.recv(),5))
                assert a["instance"]==b["instance"]
                assert a["grid"] and b["grid"]
                await asyncio.sleep(.7)
        await client.post("/api/control",json={"action":"outage"})
        before=(await client.get("/api/snapshot")).json()
        await asyncio.sleep(.5)
        during=(await client.get("/api/snapshot")).json()
        assert during["communication"]["pending_records"]>0
        assert during["totals"]["total_tonnage_t"]==before["totals"]["total_tonnage_t"]
        await client.post("/api/control",json={"action":"restore"})
        await asyncio.sleep(.8)
        stopped=(await client.post("/api/control",json={"action":"stop"})).json()
        await asyncio.sleep(.3)
        final=(await client.get("/api/snapshot")).json()
        assert stopped["sequence"]==final["sequence"]
        assert final["communication"]["pending_records"]==0
        assert abs(final["totals"]["total_tonnage_t"]-final["sequence"]*15)<1e-6
        scan=(await client.get("/api/scans/latest")).json()
        edit=await client.post(f'/api/scans/{scan["id"]}/corrections',json={
            "operator":"Recette locale", "reason":"Vérification de la chaîne HTTP",
            "updates":[{"index":0,"range_m":None,"quality":0}]})
        assert edit.status_code==200 and edit.json()["raw"]==scan["raw"]
        left=(await client.post("/api/inventory/selection",json={"x1":63.7})).json()
        right=(await client.post("/api/inventory/selection",json={"x0":63.7})).json()
        total=final["totals"]["total_tonnage_t"]
        assert abs(left["total_tonnage_t"]+right["total_tonnage_t"]-total)<1e-6
        export=await client.post("/api/inventory/export",json={"x1":63.7})
        assert export.status_code==200 and "Tonnage (t)" in export.text
        return {"status":"PASS", "server":"Uvicorn local, sans Docker", "websocket_clients":2,
                "sequence":final["sequence"], "tonnage_t":total,
                "raw_preserved_after_correction":True,"exact_spatial_partition":True,
                "outage_reconciled":True,"stop_verified":True,"csv_export":True,
                "map_imagery":"désactivée pour ce test","frontend":"non exécuté"}

def main():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1",0)); port=sock.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix="parc-smoke-") as directory:
        env={**os.environ,"DATA_DIR":directory,"MAP_ENABLED":"false"}
        with open(Path(directory)/"uvicorn.log","w") as logfile:
            process=subprocess.Popen([sys.executable,"-m","uvicorn","app.main:app","--host","127.0.0.1",
                                      "--port",str(port)],cwd=ROOT/"backend",env=env,stdout=logfile,stderr=logfile)
            try:
                for _ in range(80):
                    if process.poll() is not None: raise RuntimeError("Le serveur temporaire n'a pas démarré.")
                    try:
                        if httpx.get(f"http://127.0.0.1:{port}/health",timeout=.5).is_success: break
                    except httpx.HTTPError: pass
                    time.sleep(.1)
                else: raise TimeoutError("Serveur temporaire indisponible.")
                print(json.dumps(asyncio.run(verify(port)),ensure_ascii=False,indent=2))
            finally:
                process.terminate()
                try: process.wait(timeout=8)
                except subprocess.TimeoutExpired: process.kill();process.wait()
if __name__=="__main__": main()
