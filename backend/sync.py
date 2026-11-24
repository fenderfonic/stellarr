"""Run from the repository root with python -m backend.sync."""

import argparse
import time

from . import radarr, sonarr, store
from .arr import ArrError, SOURCES, connection


ADAPTERS = {"radarr": radarr, "sonarr": sonarr}


def run(command, source):
    client = connection(source)
    if not client:
        return f"{source}: unconfigured"
    if command == "test":
        return f"{source}: connected, version {client.test()}"
    started = time.time_ns()
    timer = time.perf_counter()
    snapshot = ADAPTERS[source].read(client)
    store.save(source, started, snapshot)
    notes = " " + " ".join(snapshot["notes"]) if snapshot["notes"] else ""
    return (f"{source}: {len(snapshot['nodes']):,} entities, {len(snapshot['links']):,} relationships "
            f"in {time.perf_counter() - timer:.2f} s.{notes}")


def main():
    parser = argparse.ArgumentParser(description="Test or synchronise Stellarr's native catalogue connections.")
    parser.add_argument("command", choices=("test", "sync"))
    parser.add_argument("source", choices=SOURCES, nargs="?")
    args = parser.parse_args()
    failed = False
    for source in (args.source,) if args.source else SOURCES:
        try:
            print(run(args.command, source))
        except (ArrError, KeyError, TypeError, AttributeError, ValueError) as exc:
            print(f"{source}: {exc if isinstance(exc, ArrError) else 'Unexpected catalogue response'}")
            failed = True
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
