"""Normalised graph shared by the independent catalogue adapters."""

import re
from urllib.parse import urlsplit


def positive_id(value):
    return value if type(value) is int and value > 0 else None


def media_id(source, kind, row, provider):
    external = positive_id(row.get(provider))
    return f"{kind.lower()}:{provider}:{external}" if external else f"{source}:{kind.lower()}:{row['id']}"


def availability(has_file, monitored):
    if has_file:
        return "Owned"
    return "Monitored" if monitored else "Unmonitored"


def cover(images, base_url):
    for kind in ("poster", "screenshot", "headshot", "fanart", "banner"):
        for image in images or []:
            if image.get("coverType") != kind:
                continue
            url = image.get("url") or ""
            prefix = urlsplit(base_url).path.rstrip("/")
            match = re.fullmatch(
                rf"(?:{re.escape(prefix)})?/(?:api/v3/)?mediacover/(\d+/[\w.-]+\.(?:jpg|png|gif))",
                urlsplit(url).path, re.IGNORECASE,
            )
            if match and not urlsplit(url).netloc:
                return {"local": f"mediacover/{match[1]}"}
            for remote in (image.get("remoteUrl"), url):
                if remote:
                    parsed = urlsplit(remote)
                    if parsed.scheme == "https" and parsed.hostname and not (
                        parsed.username or parsed.password or parsed.query or parsed.fragment
                    ):
                        return {"remote": remote}
    return None


class Catalogue:
    def __init__(self, source, base_url):
        self.source = source
        self.base_url = base_url
        self.nodes = {}
        self.links = {}
        self.artwork = {}
        self.notes = []

    def add(self, id, kind, row, *, galaxy=None, status=None, date=None, identifiers=(), **extra):
        node = self.nodes.get(id, {"id": id, "kind": kind})
        node["name"] = row.get("title") or row.get("personName") or node.get("name", id)
        values = {
            "galaxy": galaxy, "availability": status, "date": date,
            "year": positive_id(row.get("year")), "summary": row.get("overview"),
            "genres": row.get("genres"),
            "externalIds": {key: row[field] for key, field in identifiers if row.get(field)},
            **extra,
        }
        node.update({key: value for key, value in values.items() if value is not None and value != {} and value != []})
        artwork = cover(row.get("images"), self.base_url)
        if artwork:
            self.artwork[id] = artwork
            node["artwork"] = artwork.get("remote") or f"/api/artwork/{self.source}/{id}"
        self.nodes[id] = node

    def link(self, source, target, label, detail=None):
        id = f"{source}|{label}|{target}"
        edge = self.links.setdefault(id, {"id": id, "from": source, "to": target, "label": label})
        if detail:
            details = edge.setdefault("details", [])
            if detail not in details:
                details.append(detail)

    def snapshot(self):
        return {"nodes": list(self.nodes.values()), "links": list(self.links.values()),
                "artwork": self.artwork, "notes": self.notes}
