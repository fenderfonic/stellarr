"""Representative native v3 HTTP responses. All titles, credits and IDs are invented."""

import json
import os
import struct
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit


KEY = "fixture-only-key"
ADJECTIVES = ("Amber", "Silent", "Midnight", "Hollow", "Glass", "Distant", "Hidden", "Silver")
PLACES = ("Harbour", "Meridian", "Signal", "Garden", "Current", "Horizon", "Orchard", "Tide")


def cover():
    """Encode a small, locally served raster stand-in for a native poster."""
    width, height = 144, 216
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            circle = (x - 92) ** 2 + (y - 63) ** 2 < 27 ** 2
            coast = y > 132 + x // 4 + (x % 29) // 2
            rows.extend((233, 174, 102) if circle else
                        (16, 32, 39) if coast else (28 + y // 3, 46 + y // 5, 58 + y // 8))

    def chunk(label, data):
        return struct.pack("!I", len(data)) + label + data + struct.pack("!I", zlib.crc32(label + data))

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


POSTER = cover()


def movie(id):
    return {
        "id": id, "tmdbId": 4000 + id, "imdbId": f"tt{8000 + id:07}",
        "title": f"{ADJECTIVES[(id - 1) // 8]} {PLACES[(id - 1) % 8]}",
        "overview": "A coastal survey crew traces a signal from a station thought lost.",
        "collection": {"tmdbId": 500 + (id - 1) % 8, "title": f"The {PLACES[(id - 1) % 8]} Cycle"},
        "hasFile": id % 3 == 1, "monitored": id % 3 != 0, "genres": ["Mystery", "Drama"],
        "year": 2021, "inCinemas": "2021-03-10T00:00:00Z",
        "images": [{"coverType": "poster", "url": f"/radarr/MediaCover/{id}/poster.png?lastWrite=123"}],
    }


def series(id):
    return {
        "id": id, "tvdbId": 6000 + id, "title": f"The {movie(id)['title']} Files",
        "overview": "An anthology following the investigators at a remote coastal outpost.",
        "year": 2024, "firstAired": "2024-01-10T00:00:00Z", "genres": ["Science Fiction", "Mystery"],
        "monitored": True, "statistics": {"episodeFileCount": 3},
        "images": [{"coverType": "poster", "url": f"/sonarr/MediaCover/{id}/poster.png"}],
    }


def episodes(id, count):
    return [{
        "id": id * 20000 + n, "seriesId": id, "tvdbId": 1000000 + id * 20000 + n,
        "title": "Arrival" if n == 1 else f"Watch Log {n}", "seasonNumber": 1,
        "episodeNumber": n, "airDate": "2024-01-10", "hasFile": n <= 3, "monitored": n != 12,
    } for n in range(1, count + 1)]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        url = urlsplit(self.path)
        service, api, version, endpoint = url.path.strip("/").split("/", 3)
        self.server.requests.append((service, endpoint))
        if self.headers.get("X-Api-Key") != KEY:
            return self.send_error(401)
        if (service, endpoint) in self.server.fail:
            return self.send_error(503)
        assert (api, version) == ("api", "v3")
        params = parse_qs(url.query)
        if endpoint == "system/status":
            data = {"appName": service.title(), "version": "fixture-v3"}
        elif endpoint.startswith("mediacover/"):
            return self.respond(POSTER, "image/png")
        elif service == "radarr" and endpoint == "movie":
            data = [movie(id) for id in range(1, self.server.movies + 1)]
            data.append({"id": 99, "title": "The Uncharted Shore", "hasFile": True})
        elif service == "radarr" and endpoint == "collection":
            data = [{
                **movie(id)["collection"], "movies": [
                    movie(id), {"tmdbId": 9000 + id, "title": f"Beyond {PLACES[id - 1]}",
                                "overview": "An additional film listed by Radarr's collection API.",
                                "genres": ["Mystery"], "year": 2027, "isExisting": False},
                ],
            } for id in range(1, min(self.server.movies, 8) + 1)]
        elif service == "radarr" and endpoint == "credit":
            id = int(params["movieId"][0])
            data = [] if id == 99 else [
                {"personTmdbId": 10 + (id + j) % 25, "personName": f"Performer {(id + j) % 25}",
                 "type": "cast", "character": f"Surveyor {j}"}
                for j in range(6)
            ] + [{"personTmdbId": 560, "personName": "Mara Venn", "type": "crew", "job": "Director"}] * 2
        elif service == "sonarr" and endpoint == "series":
            data = [series(id) for id in range(1, self.server.series + 1)]
        elif service == "sonarr" and endpoint == "episode":
            assert params["includeImages"] == ["true"]
            id = int(params["seriesId"][0])
            data = episodes(id, self.server.episodes)
        else:
            return self.send_error(404)
        self.respond(json.dumps(data).encode(), "application/json")

    def respond(self, data, mime):
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def server(port=0, *, movies=64, series=40, episodes=12):
    http = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    http.fail = set()
    http.requests = []
    http.movies, http.series, http.episodes = movies, series, episodes
    return http


if __name__ == "__main__":
    with server(int(os.environ.get("FIXTURE_PORT", "8020"))) as http:
        print(f"Native fixture listening on {http.server_port}", flush=True)
        http.serve_forever()
