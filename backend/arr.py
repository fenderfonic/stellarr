"""Read-only HTTP client and environment configuration for native v3 APIs."""

import json
import os
from http.client import HTTPException
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


SOURCES = ("radarr", "sonarr")


class ArrError(Exception):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


opener = build_opener(NoRedirect())


class Arr:
    def __init__(self, source, base_url, key):
        self.source = source
        self.base_url = base_url.rstrip("/")
        self.key = key

    def fetch(self, endpoint, params=None, *, image=False):
        suffix = f"?{urlencode(params)}" if params else ""
        request = Request(f"{self.base_url}/api/v3/{endpoint}{suffix}", headers={"X-Api-Key": self.key})
        try:
            with opener.open(request, timeout=15) as response:
                if image:
                    mime = response.headers.get_content_type()
                    if mime not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
                        raise ArrError("Unexpected cover content type")
                    data = response.read(8 * 1024 * 1024 + 1)
                    if len(data) > 8 * 1024 * 1024:
                        raise ArrError("Cover exceeds 8 MiB")
                    return data, mime
                return json.load(response)
        except HTTPError as exc:
            exc.close()
            raise ArrError(f"{endpoint.split('/')[0]} returned HTTP {exc.code}", exc.code) from None
        except (OSError, HTTPException):
            raise ArrError("Connection failed or timed out") from None
        except ValueError:
            raise ArrError("Invalid API response") from None

    def rows(self, endpoint, params=None):
        data = self.fetch(endpoint, params)
        if not isinstance(data, list) or not all(isinstance(item, dict) for item in data):
            raise ArrError(f"Unexpected {endpoint} response")
        return data

    def test(self):
        status = self.fetch("system/status")
        if not isinstance(status, dict) or str(status.get("appName", "")).lower() != self.source:
            raise ArrError(f"Unexpected application at the configured {self.source.title()} URL")
        return status.get("version", "unknown")


def connection(source):
    url = os.environ.get(f"{source.upper()}_URL", "").strip()
    key = os.environ.get(f"{source.upper()}_API_KEY", "").strip()
    if not key:
        return None
    try:
        parsed = urlsplit(url)
        valid = parsed.scheme in ("http", "https") and parsed.hostname and not (
            parsed.username or parsed.password or parsed.query or parsed.fragment
        )
        _ = parsed.port
    except ValueError:
        valid = False
    if not valid:
        raise ArrError(f"Set {source.upper()}_URL to the service's HTTP(S) base URL")
    return Arr(source, url, key)
