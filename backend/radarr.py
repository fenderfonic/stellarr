from .arr import ArrError
from .catalogue import Catalogue, availability, media_id, positive_id

IDS = (("TMDB", "tmdbId"), ("IMDb", "imdbId"))


def read(client):
    catalogue = Catalogue("radarr", client.base_url)
    movies = client.rows("movie")
    collections = optional_rows(client, catalogue, "collection")
    for collection in collections:
        collection_id = add_collection(catalogue, collection)
        if not collection_id:
            continue
        for movie in collection.get("movies") or []:
            if not positive_id(movie.get("tmdbId")):
                continue
            id = add_movie(catalogue, movie, "External discovery")
            catalogue.link(id, collection_id, "Part of collection")

    credits_supported = True
    for movie in movies:
        id = add_movie(catalogue, movie, availability(movie.get("hasFile"), movie.get("monitored")))
        collection = movie.get("collection") or {}
        collection_id = add_collection(catalogue, collection)
        if collection_id:
            catalogue.link(id, collection_id, "Part of collection")
        if not credits_supported:
            continue
        try:
            credits = client.rows("credit", {"movieId": movie["id"]})
        except ArrError as exc:
            if exc.status not in (404, 405) or movie is not movies[0]:
                raise
            catalogue.notes.append("This Radarr instance did not expose movie credits.")
            credits_supported = False
            continue
        for credit in credits:
            person = positive_id(credit.get("personTmdbId"))
            if not person or not credit.get("personName") or credit.get("type") not in ("cast", "crew"):
                continue
            person_id = f"person:tmdb:{person}"
            catalogue.add(person_id, "Person", credit, galaxy="Movies",
                          identifiers=(("TMDB", "personTmdbId"),))
            cast = credit.get("type") == "cast"
            catalogue.link(person_id, id, "Cast in" if cast else "Crew on",
                           credit.get("character") if cast else credit.get("job"))
    return catalogue.snapshot()


def optional_rows(client, catalogue, endpoint):
    try:
        return client.rows(endpoint)
    except ArrError as exc:
        if exc.status not in (404, 405):
            raise
        catalogue.notes.append(f"This Radarr instance did not expose {endpoint} records.")
        return []


def add_collection(catalogue, collection):
    tmdb = positive_id(collection.get("tmdbId"))
    if not tmdb:
        return None
    id = f"collection:tmdb:{tmdb}"
    if id not in catalogue.nodes:
        catalogue.add(id, "Collection", collection, galaxy="Movies", identifiers=(("TMDB", "tmdbId"),))
    return id


def add_movie(catalogue, movie, status):
    id = media_id("radarr", "Movie", movie, "tmdbId")
    catalogue.add(id, "Movie", movie, galaxy="Movies", status=status, identifiers=IDS,
                  date=movie.get("inCinemas") or movie.get("releaseDate") or movie.get("digitalRelease"))
    return id
