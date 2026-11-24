from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .fixture import make_graph

app = FastAPI(title="Stellarr")
catalogue = JSONResponse(make_graph())


@app.get("/api/graph")
def graph():
    return catalogue


dist = Path(__file__).resolve().parents[1] / "dist"
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
