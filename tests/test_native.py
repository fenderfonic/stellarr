import os
import tempfile
import threading
import unittest
from unittest.mock import patch

from backend import store
from backend.arr import ArrError
from backend.main import artwork, graph
from backend.sync import run
from tests.native_fixture import KEY, POSTER, server


class NativeCatalogueTest(unittest.TestCase):
    def setUp(self):
        self.http = server(movies=3, series=2)
        self.addCleanup(self.http.server_close)
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        self.addCleanup(self.http.shutdown)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        settings = {"STELLARR_DB": f"{self.directory.name}/catalogue.sqlite3", "STELLARR_DEMO": ""}
        for source in ("RADARR", "SONARR"):
            settings[f"{source}_URL"] = f"http://127.0.0.1:{self.http.server_port}/{source.lower()}"
            settings[f"{source}_API_KEY"] = KEY
        config = patch.dict(os.environ, settings)
        config.start()
        self.addCleanup(config.stop)

    def test_connection_read_only_metadata_and_idempotency(self):
        for source in ("radarr", "sonarr"):
            self.assertIn("fixture-v3", run("test", source))
            run("sync", source)
        first = graph()
        for source in ("radarr", "sonarr"):
            run("sync", source)
        self.assertEqual(first, graph())
        nodes = {node["id"]: node for node in first["nodes"]}
        self.assertEqual(len(nodes), len(first["nodes"]))
        links = first["links"]
        self.assertEqual(len({link["id"] for link in links}), len(links))
        self.assertTrue(all(link["from"] in nodes and link["to"] in nodes for link in links))
        self.assertTrue(all(nodes[link["from"]]["galaxy"] == nodes[link["to"]]["galaxy"] for link in links))
        self.assertNotIn(KEY, str(first))
        film = nodes["movie:tmdbId:4001"]
        self.assertEqual(film["availability"], "Owned")
        self.assertEqual(film["genres"], ["Mystery", "Drama"])
        self.assertEqual(film["externalIds"]["IMDb"], "tt0008001")
        self.assertEqual(nodes["movie:tmdbId:4002"]["availability"], "Monitored")
        self.assertEqual(nodes["movie:tmdbId:4003"]["availability"], "Unmonitored")
        self.assertEqual(nodes["movie:tmdbId:9001"]["availability"], "External discovery")
        self.assertEqual(nodes["episode:tvdbId:1020001"]["artwork"], nodes["series:tvdbId:6001"]["artwork"])
        self.assertEqual(artwork("radarr", film["id"]).body, POSTER)
        self.assertEqual([link["details"] for link in links if link["label"] == "Crew on"], [["Director"]] * 3)

    def test_partial_source_outage_and_replaced_snapshot(self):
        run("sync", "radarr")
        previous = store.load()["radarr"]
        self.http.fail.add(("radarr", "movie"))
        with self.assertRaisesRegex(ArrError, "HTTP 503"):
            run("sync", "radarr")
        run("sync", "sonarr")
        self.assertEqual(store.load()["radarr"], previous)
        self.assertEqual(graph()["sources"], ["radarr", "sonarr"])
        self.http.series = 1
        run("sync", "sonarr")
        self.assertFalse(any(node["id"] == "series:tvdbId:6002" for node in graph()["nodes"]))

    def test_empty_and_fallback_demo(self):
        self.assertEqual(graph()["nodes"], [])
        self.assertEqual(graph(True)["mode"], "demo")
        with patch.dict(os.environ, {"RADARR_API_KEY": "", "SONARR_API_KEY": ""}):
            self.assertEqual(graph()["mode"], "demo")
            self.assertEqual(run("test", "sonarr"), "sonarr: unconfigured")

    def test_bad_key_and_source_mismatch(self):
        with patch.dict(os.environ, {"RADARR_API_KEY": "incorrect"}):
            with self.assertRaisesRegex(ArrError, "HTTP 401"):
                run("test", "radarr")
        with patch.dict(os.environ, {"RADARR_URL": os.environ["SONARR_URL"]}):
            with self.assertRaisesRegex(ArrError, "Unexpected application"):
                run("test", "radarr")


if __name__ == "__main__":
    unittest.main()
