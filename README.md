# Stellarr

Stellarr is a self-hosted 3D media explorer. The Stage 1 build explores a synthetic catalogue of films, television and music through curved Three.js filaments.

## Run locally

Requires Node.js 20.19+ or 22.12+ and Python 3.10+.

```sh
npm ci
npm run build
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/uvicorn backend.main:app
```

Open http://127.0.0.1:8000. For frontend development, leave Uvicorn running and start `npm run dev` in another terminal.

Drag the scene to orbit, right-drag to pan and scroll to zoom. On touch screens, drag with one finger to orbit or use two fingers to pan and pinch. Search and galaxy or availability filters brighten matching filaments. Press Enter on a search match to focus it, or select a filament directly. Follow connections from the selection panel. Back restores the preceding selection, filters and camera. Home returns to the starting view. Replay progressively reveals the catalogue.

[Delivery plan](PLAN.md) · [Current state](STATE.md) · [Source provenance](PROVENANCE.md) · [AGPL-3.0 license](LICENSE)
