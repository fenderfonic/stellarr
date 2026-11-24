import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from . import store
from .arr import ArrError, SOURCES, connection
from .fixture import make_graph

app = FastAPI(title="Stellarr")
demo_catalogue = {"mode": "demo", **make_graph()}


@app.get("/api/graph")
def graph(demo: bool = False):
    if demo or os.environ.get("STELLARR_DEMO") == "1":
        return demo_catalogue
    snapshots = store.load()
    if not snapshots and not any(os.environ.get(f"{source.upper()}_API_KEY", "").strip() for source in SOURCES):
        return demo_catalogue
    return {
        "mode": "catalogue",
        "sources": list(snapshots),
        "nodes": [node for snapshot in snapshots.values() for node in snapshot["nodes"]],
        "links": [link for snapshot in snapshots.values() for link in snapshot["links"]],
    }


@app.get("/api/artwork/{source}/{id}")
def artwork(source: str, id: str):
    if source not in SOURCES:
        raise HTTPException(404)
    entry = store.load().get(source, {}).get("artwork", {}).get(id, {})
    if "local" not in entry:
        raise HTTPException(404)
    try:
        client = connection(source)
        if not client:
            raise HTTPException(404)
        data, mime = client.fetch(entry["local"], image=True)
    except ArrError:
        raise HTTPException(404) from None
    return Response(data, media_type=mime, headers={"Cache-Control": "private, max-age=3600"})


dist = Path(__file__).resolve().parents[1] / "dist"
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
