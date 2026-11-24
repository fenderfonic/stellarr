"""Deterministic, invented titles and credits for the Stage 1 catalogue."""

from itertools import product

AVAILABILITY = ("Owned", "Owned", "Monitored", "External discovery")
ADJECTIVES = ("Amber", "Silent", "Midnight", "Hollow", "Glass", "Distant", "Hidden", "Silver")
SUBJECTS = ("Harbour", "Meridian", "Signal", "Garden", "Current", "Horizon", "Orchard", "Tide")


def make_graph():
    nodes = []
    links = []

    def node(id, name, kind, **metadata):
        nodes.append(dict(id=id, name=name, kind=kind, **metadata))
        return id

    def link(source, target, label):
        links.append(dict(id=f"{source}:{label}:{target}", **{"from": source, "to": target}, label=label))

    names = ("Mara Vale", "Ren Sato", "Iona West", "Samir Halden", "Jules Arden",
             "Rhea Winter", "Tamsin Cole", "Noor Vega", "Rosa Aster", "Niko Sable",
             "Avery Flint", "Luca Venn", "Erin Lark", "Emil Serra", "Aya North", "Sasha Quill")
    artist_names = ("Arc Lantern", "Low Atlas", "Pale Current", "The Far Fields", "Lumen Choir", "Night Survey")
    cast = [node(f"person-{i}", name, "Person") for i, name in enumerate(names)]
    artists = [node(f"artist-{i}", name, "MusicArtist", galaxy="Music") for i, name in enumerate(artist_names)]

    for i, (adjective, subject) in enumerate(product(ADJECTIVES, SUBJECTS)):
        title = f"{adjective} {subject}"
        year = 1988 + i % 37
        status = AVAILABILITY[i % len(AVAILABILITY)]
        movie = node(f"film-{i}", title, "Movie", galaxy="Movies", year=year, availability=status,
                     summary=f"One of the {subject} cycle films, set at the same coastal survey station in a different era.")
        series = node(f"series-{i}", f"The {title} Files", "Series", galaxy="Television", year=year + 1,
                      availability=status, summary=f"An anthology following the investigators stationed at {title}.")
        album_title = f"{title} (Original Score)" if i < 4 else f"Studies in {title}"
        album = node(f"album-{i}", album_title, "MusicAlbum", galaxy="Music", year=year,
                     availability=status, summary=f"An instrumental release by {artist_names[i % len(artists)]}.")
        link(artists[i % len(artists)], album, "Recorded")
        for slot in (0, 3, 7, 12):
            link(cast[(i + slot) % len(cast)], movie, "Cast in")
            link(cast[(i * 3 + slot) % len(cast)], series, "Cast in")
        # Each cycle revisits the same fictional coastal survey station.
        if i >= len(SUBJECTS):
            link(movie, f"film-{i - len(SUBJECTS)}", "Shares setting with")
        if i >= 2 * len(SUBJECTS):
            link(movie, f"film-{i % len(SUBJECTS)}", "Shares setting with")
        if i < 4:
            link(album, movie, "Original score for")
            link(series, movie, "Adapted from")
        for j, name in enumerate(("Arrival", "A Map of Lights", "Night Watch", "Departure")):
            episode = node(f"episode-{i}-{j}", f"{title} · {name}", "Episode", galaxy="Television",
                           year=year + 1, availability=status)
            track = node(f"track-{i}-{j}", f"{name} at {title}", "Audio", galaxy="Music",
                         year=year, availability=status)
            link(episode, series, "Episode of")
            link(track, album, "Track on")
            link(cast[(i * 3 + j) % len(cast)], episode, "Cast in")
    return dict(nodes=nodes, links=links)
