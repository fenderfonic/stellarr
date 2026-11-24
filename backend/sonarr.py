from .catalogue import Catalogue, availability, media_id

IDS = (("TVDB", "tvdbId"), ("TMDB", "tmdbId"), ("IMDb", "imdbId"), ("TVmaze", "tvMazeId"))


def read(client):
    catalogue = Catalogue("sonarr", client.base_url)
    for series in client.rows("series"):
        series_id = media_id("sonarr", "Series", series, "tvdbId")
        files = (series.get("statistics") or {}).get("episodeFileCount") or 0
        episodes = client.rows("episode", {"seriesId": series["id"], "includeImages": "true"})
        catalogue.add(series_id, "Series", series, galaxy="Television", identifiers=IDS,
                      status=availability(files or any(episode.get("hasFile") for episode in episodes),
                                          series.get("monitored")), date=series.get("firstAired"))
        for episode in episodes:
            id = media_id("sonarr", "Episode", episode, "tvdbId")
            catalogue.add(id, "Episode", episode, galaxy="Television",
                          identifiers=(("TVDB", "tvdbId"),), date=episode.get("airDate") or episode.get("airDateUtc"),
                          status=availability(episode.get("hasFile"), episode.get("monitored")),
                          seriesTitle=series.get("title"), season=episode.get("seasonNumber"),
                          episode=episode.get("episodeNumber"), genres=series.get("genres"))
            if not catalogue.nodes[id].get("artwork") and catalogue.nodes[series_id].get("artwork"):
                catalogue.nodes[id]["artwork"] = catalogue.nodes[series_id]["artwork"]
            catalogue.link(id, series_id, "Episode of")
    return catalogue.snapshot()
