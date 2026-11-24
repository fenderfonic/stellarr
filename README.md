# Stellarr

Stellarr is a self-hosted 3D explorer for Radarr and Sonarr catalogues. It reads from the native APIs and stores a local SQLite snapshot for exploration. With no connections or saved catalogue, it opens a synthetic demo spanning film, television and music.

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

## Connect a catalogue

Create the local settings file with owner-only permissions.

```sh
(umask 077 && cp -n .env.example .env)
```

Edit `.env` and enter each service's base URL and API key from its **Settings → General** page. Include the configured URL base if present, for example `http://nas:7878/radarr`. Leave the API key blank for an unused service. `.env` and the default `data/` directory are ignored by Git.

From the Stellarr directory, load settings, test connections, import and start the server in the same shell.

```sh
set -a
. ./.env
set +a
.venv/bin/python -m backend.sync test
.venv/bin/python -m backend.sync sync
.venv/bin/uvicorn backend.main:app
```

Run `sync` again and reload the cockpit to refresh the view. Add `radarr` or `sonarr` after `test` or `sync` to target one service. Each successful refresh replaces that source's previous snapshot. A failed refresh reports the error, preserves the last successful snapshot and allows the other source to refresh. Local artwork comes from the configured source and can be unavailable while it is offline. Override the database path with `STELLARR_DB`. Use **Demo** in the cockpit or set `STELLARR_DEMO=1` before starting the server to open synthetic mode.

## Explore

Drag to orbit, right-drag to pan and scroll to zoom. On touch screens, drag with one finger to orbit or use two fingers to pan and pinch. Search titles, people, genres or IDs and filter by galaxy, availability or genre. Press Enter on a match to focus it, or select a filament directly. Follow connections from the selection panel. Back restores the preceding selection, filters and camera. Home returns to the starting view. Replay progressively reveals filaments.

## Catalogue coverage

- Radarr provides films, credited cast and crew, and collection membership. Collection titles outside the library are marked **External discovery**. Older instances can omit the optional credits or collections routes. [Radarr v3 contract](https://github.com/Radarr/Radarr/blob/131bf152540047c50b2689964cabef9c1548973a/src/Radarr.Api.V3/openapi.json)
- Sonarr provides series and episode membership, metadata and artwork. In this API contract, television credits and collection membership are unavailable. A series is **Owned** when at least one episode file is reported. Episode and film ownership follows the native file flag. [Sonarr v3 contract](https://github.com/Sonarr/Sonarr/blob/03f822c78293981e6e1459fbce59d11476b2107f/src/Sonarr.Api.V3/openapi.json)
- The v3 responses used here do not establish a movie-to-TV relationship. An unlinked title is shown as a point. The music galaxy remains available in demo mode. Native Lidarr ingestion is deferred.

Run the representative native API integration tests with `.venv/bin/python -m unittest tests.test_native -v`.

[Delivery plan](PLAN.md) · [Current state](STATE.md) · [Source provenance](PROVENANCE.md) · [AGPL-3.0 license](LICENSE)
