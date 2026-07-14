#!/usr/bin/env python3
"""
B'Tselem interactive map source discovery.

Purpose
-------
This is a read-only discovery tool for the first integration step of the
ME Security Monitor. It inspects the public B'Tselem map page and its
publicly referenced assets to identify possible data services such as:

- GeoJSON / JSON / TopoJSON
- ArcGIS REST / FeatureServer / MapServer
- WMS / WFS
- Mapbox / CARTO
- Leaflet data loaders
- iframe-based map applications
- downloadable KML / KMZ / CSV / SHP / ZIP resources
- source maps and JavaScript configuration files

The script does NOT:
- bypass authentication,
- execute browser JavaScript,
- crawl the whole website,
- download large geospatial datasets,
- republish B'Tselem content.

Outputs
-------
data/btselem-discovery.json
data/btselem-discovery.md
data/btselem-discovery/raw/   (small HTML/JS samples when enabled)

Usage
-----
python scripts/discover_btselem_sources.py

Optional:
python scripts/discover_btselem_sources.py \
  --url https://www.btselem.org/map \
  --output-dir data \
  --save-assets \
  --max-assets 40

Exit codes
----------
0: discovery completed
1: fatal network or parsing error
2: page downloaded but no useful map candidates found
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import mimetypes
import re
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse
from urllib.request import Request, urlopen


DEFAULT_URL = "https://www.btselem.org/map"
DEFAULT_OUTPUT_DIR = Path("data")
DEFAULT_TIMEOUT = 25
DEFAULT_MAX_BYTES = 4_000_000
DEFAULT_MAX_ASSETS = 40

USER_AGENT = (
    "ME-Security-Monitor-Btselem-Discovery/1.0 "
    "(read-only source discovery; contact repository owner)"
)

MAP_KEYWORDS = (
    "geojson",
    "topojson",
    "featureserver",
    "mapserver",
    "arcgis",
    "wms",
    "wfs",
    "getcapabilities",
    "mapbox",
    "leaflet",
    "openlayers",
    "carto",
    "tilelayer",
    "vectorgrid",
    "featurecollection",
    "kml",
    "kmz",
    "shapefile",
    ".shp",
    ".csv",
    ".json",
    ".geojson",
    "/tiles/",
    "{z}",
    "{x}",
    "{y}",
)

LIKELY_DATA_EXTENSIONS = (
    ".json",
    ".geojson",
    ".topojson",
    ".kml",
    ".kmz",
    ".csv",
    ".zip",
    ".shp",
    ".gpx",
    ".xml",
    ".pbf",
)

TEXT_CONTENT_TYPES = (
    "text/",
    "application/javascript",
    "application/x-javascript",
    "application/json",
    "application/geo+json",
    "application/xml",
    "application/vnd.geo+json",
)

URL_PATTERN = re.compile(
    r"""(?P<quote>["'`])(?P<url>
        (?:
            https?://
            |
            //
            |
            /
            |
            \./
            |
            \.\./
        )
        [^"'`\s<>]{3,}
    )(?P=quote)""",
    re.IGNORECASE | re.VERBOSE,
)

UNQUOTED_SERVICE_PATTERN = re.compile(
    r"""(?:
        https?://[^\s"'`<>\\]+
        |
        //[\w.-]+/[^\s"'`<>\\]+
    )""",
    re.IGNORECASE | re.VERBOSE,
)

SERVICE_PATTERNS: dict[str, re.Pattern[str]] = {
    "arcgis": re.compile(
        r"(?:arcgis|featureserver|mapserver|rest/services)",
        re.IGNORECASE,
    ),
    "geojson": re.compile(
        r"(?:geojson|featurecollection|application/geo\+json)",
        re.IGNORECASE,
    ),
    "wms_wfs": re.compile(
        r"(?:\bwms\b|\bwfs\b|getcapabilities|geoserver)",
        re.IGNORECASE,
    ),
    "mapbox": re.compile(
        r"(?:mapbox|api\.mapbox\.com|tilesets?|styles/v\d)",
        re.IGNORECASE,
    ),
    "carto": re.compile(
        r"(?:carto|cartodb|sql\.api)",
        re.IGNORECASE,
    ),
    "leaflet": re.compile(
        r"(?:leaflet|L\.geoJSON|L\.tileLayer|L\.map\()",
        re.IGNORECASE,
    ),
    "openlayers": re.compile(
        r"(?:openlayers|\bol\.Map\b|\bol\.layer\b)",
        re.IGNORECASE,
    ),
    "download": re.compile(
        r"(?:\.geojson|\.json|\.topojson|\.kml|\.kmz|\.csv|\.zip|\.shp|\.gpx|\.pbf)(?:[?#]|$)",
        re.IGNORECASE,
    ),
    "tile_template": re.compile(
        r"(?:\{z\}.*\{x\}.*\{y\}|/tiles?/|tilelayer)",
        re.IGNORECASE,
    ),
    "api": re.compile(
        r"(?:/api/|/ajax/|graphql|endpoint|fetch\(|axios|XMLHttpRequest)",
        re.IGNORECASE,
    ),
}


@dataclass(slots=True)
class AssetReference:
    url: str
    kind: str
    source: str
    same_origin: bool
    map_relevance: list[str]


@dataclass(slots=True)
class CandidateEndpoint:
    url: str
    discovered_in: str
    discovery_method: str
    categories: list[str]
    same_origin: bool
    probe_status: int | None = None
    content_type: str = ""
    content_length: int | None = None
    final_url: str = ""
    response_hint: str = ""
    error: str = ""


class PageAssetParser(HTMLParser):
    """Collect public asset references without executing JavaScript."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.references: list[tuple[str, str, str]] = []
        self.inline_scripts: list[str] = []
        self.meta_values: list[tuple[str, str]] = []
        self._inside_script = False
        self._script_parts: list[str] = []
        self._script_has_src = False

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        values = {key.lower(): value or "" for key, value in attrs}
        tag = tag.lower()

        if tag == "script":
            self._inside_script = True
            self._script_parts = []
            self._script_has_src = bool(values.get("src"))
            if values.get("src"):
                self.references.append(
                    (values["src"], "script", "script[src]")
                )

        elif tag == "link" and values.get("href"):
            rel = values.get("rel", "").lower()
            kind = "stylesheet" if "stylesheet" in rel else "link"
            self.references.append(
                (values["href"], kind, f"link[rel={rel or 'unknown'}]")
            )

        elif tag == "iframe" and values.get("src"):
            self.references.append(
                (values["src"], "iframe", "iframe[src]")
            )

        elif tag in {"img", "source", "video", "audio"}:
            for attribute in ("src", "srcset"):
                if values.get(attribute):
                    self.references.append(
                        (
                            values[attribute],
                            "media",
                            f"{tag}[{attribute}]",
                        )
                    )

        elif tag in {"a", "area"} and values.get("href"):
            self.references.append(
                (values["href"], "link", f"{tag}[href]")
            )

        elif tag == "meta":
            for attribute in ("content", "property", "name"):
                if values.get(attribute):
                    self.meta_values.append(
                        (attribute, values[attribute])
                    )

        for attribute in (
            "data-url",
            "data-src",
            "data-endpoint",
            "data-api",
            "data-geojson",
            "data-layer",
            "data-map",
        ):
            if values.get(attribute):
                self.references.append(
                    (
                        values[attribute],
                        "data_attribute",
                        f"{tag}[{attribute}]",
                    )
                )

    def handle_data(self, data: str) -> None:
        if self._inside_script and not self._script_has_src:
            self._script_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script":
            if self._inside_script and not self._script_has_src:
                script = "".join(self._script_parts).strip()
                if script:
                    self.inline_scripts.append(script)
            self._inside_script = False
            self._script_parts = []
            self._script_has_src = False


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize_url(
    value: str,
    base_url: str,
    *,
    remove_tracking: bool = True,
) -> str | None:
    """Resolve a URL and remove fragments/tracking parameters."""
    value = value.strip().replace("\\/", "/")

    if not value:
        return None

    if value.startswith(("#", "javascript:", "mailto:", "tel:", "data:")):
        return None

    # srcset may contain multiple "url width" pairs.
    if "," in value and not value.lower().startswith(("http://", "https://")):
        value = value.split(",", 1)[0].strip().split(" ", 1)[0]

    absolute = urljoin(base_url, value)
    parsed = urlparse(absolute)

    if parsed.scheme not in {"http", "https"}:
        return None

    query = parse_qsl(parsed.query, keep_blank_values=True)

    if remove_tracking:
        query = [
            (key, val)
            for key, val in query
            if not key.lower().startswith(("utm_", "fbclid", "gclid"))
        ]

    normalized = urlunparse(
        (
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            parsed.path,
            parsed.params,
            urlencode(query, doseq=True),
            "",  # fragment
        )
    )

    return normalized


def same_origin(url_a: str, url_b: str) -> bool:
    a = urlparse(url_a)
    b = urlparse(url_b)
    return (
        a.scheme.lower(),
        a.netloc.lower(),
    ) == (
        b.scheme.lower(),
        b.netloc.lower(),
    )


def url_categories(value: str) -> list[str]:
    found = [
        name
        for name, pattern in SERVICE_PATTERNS.items()
        if pattern.search(value)
    ]
    return sorted(set(found))


def is_map_relevant(value: str) -> bool:
    lowered = value.lower()
    return any(keyword.lower() in lowered for keyword in MAP_KEYWORDS)


def is_likely_data_url(url: str) -> bool:
    path = urlparse(url).path.lower()
    return (
        path.endswith(LIKELY_DATA_EXTENSIONS)
        or bool(url_categories(url))
    )


def safe_filename(url: str, prefix: str = "") -> str:
    parsed = urlparse(url)
    stem = Path(parsed.path).name or "index"
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem)[:90]
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:10]
    return f"{prefix}{stem}-{digest}"


def fetch_bytes(
    url: str,
    *,
    timeout: int,
    max_bytes: int,
    method: str = "GET",
) -> tuple[bytes, dict[str, str], int, str]:
    request = Request(
        url,
        method=method,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": (
                "text/html,application/xhtml+xml,application/json,"
                "application/geo+json,application/javascript,text/javascript,"
                "application/xml,text/xml;q=0.9,*/*;q=0.5"
            ),
        },
    )

    with urlopen(request, timeout=timeout) as response:
        status = getattr(response, "status", response.getcode())
        headers = {
            key.lower(): value
            for key, value in response.headers.items()
        }
        final_url = response.geturl()

        if method == "HEAD":
            return b"", headers, status, final_url

        content_length = headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > max_bytes:
                    raise ValueError(
                        f"Response too large: {content_length} bytes"
                    )
            except ValueError as exc:
                if "too large" in str(exc):
                    raise

        body = response.read(max_bytes + 1)
        if len(body) > max_bytes:
            raise ValueError(
                f"Response exceeded {max_bytes} byte safety limit"
            )

        return body, headers, status, final_url


def decode_text(body: bytes, headers: dict[str, str]) -> str:
    content_type = headers.get("content-type", "")
    match = re.search(r"charset=([A-Za-z0-9._-]+)", content_type)
    charset = match.group(1) if match else "utf-8"

    try:
        return body.decode(charset, errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")


def response_hint(
    body: bytes,
    headers: dict[str, str],
) -> str:
    content_type = headers.get("content-type", "").lower()
    text = body[:1500].decode("utf-8", errors="ignore").lstrip()

    if "application/geo+json" in content_type:
        return "GeoJSON content type"

    if "application/json" in content_type or text.startswith(("{", "[")):
        try:
            parsed = json.loads(text if len(body) <= 1500 else body.decode("utf-8"))
            if isinstance(parsed, dict):
                object_type = parsed.get("type")
                if object_type in {
                    "FeatureCollection",
                    "Feature",
                    "Topology",
                }:
                    return f"JSON geospatial object: {object_type}"
                keys = ", ".join(list(parsed.keys())[:8])
                return f"JSON object keys: {keys}"
            if isinstance(parsed, list):
                return f"JSON array ({len(parsed)} sampled entries)"
        except (json.JSONDecodeError, UnicodeDecodeError):
            return "JSON-like response"

    if "<wms_capabilities" in text.lower():
        return "WMS GetCapabilities response"

    if "<wfs_capabilities" in text.lower():
        return "WFS GetCapabilities response"

    if "currentversion" in text.lower() and "services" in text.lower():
        return "Possible ArcGIS REST response"

    return ""


def discover_urls_from_text(
    text: str,
    base_url: str,
) -> list[tuple[str, str]]:
    discovered: dict[str, str] = {}

    for match in URL_PATTERN.finditer(text):
        raw = match.group("url")
        normalized = normalize_url(raw, base_url)
        if normalized:
            discovered.setdefault(normalized, "quoted_url")

    for raw in UNQUOTED_SERVICE_PATTERN.findall(text):
        normalized = normalize_url(raw, base_url)
        if normalized:
            discovered.setdefault(normalized, "unquoted_service_url")

    # Extract sourceMappingURL comments.
    for raw in re.findall(
        r"sourceMappingURL\s*=\s*([^\s*]+)",
        text,
        flags=re.IGNORECASE,
    ):
        normalized = normalize_url(raw.strip(), base_url)
        if normalized:
            discovered.setdefault(normalized, "source_map")

    # Extract common fetch/ajax paths that may not include a full URL.
    patterns = (
        r"\bfetch\s*\(\s*['\"]([^'\"]+)['\"]",
        r"\baxios\.(?:get|post)\s*\(\s*['\"]([^'\"]+)['\"]",
        r"\burl\s*:\s*['\"]([^'\"]+)['\"]",
        r"\bdataUrl\s*[:=]\s*['\"]([^'\"]+)['\"]",
        r"\bgeojson\s*[:=]\s*['\"]([^'\"]+)['\"]",
    )

    for pattern in patterns:
        for raw in re.findall(pattern, text, flags=re.IGNORECASE):
            normalized = normalize_url(raw, base_url)
            if normalized:
                discovered.setdefault(normalized, "javascript_loader")

    return sorted(discovered.items())


def probe_candidate(
    candidate: CandidateEndpoint,
    *,
    timeout: int,
    max_bytes: int,
) -> CandidateEndpoint:
    """Probe a candidate conservatively, downloading only a small sample."""
    try:
        body, headers, status, final_url = fetch_bytes(
            candidate.url,
            timeout=timeout,
            max_bytes=max_bytes,
        )
        candidate.probe_status = status
        candidate.content_type = headers.get("content-type", "")
        candidate.final_url = final_url
        candidate.content_length = (
            int(headers["content-length"])
            if headers.get("content-length", "").isdigit()
            else len(body)
        )
        candidate.response_hint = response_hint(body, headers)

    except HTTPError as exc:
        candidate.probe_status = exc.code
        candidate.error = f"HTTP {exc.code}: {exc.reason}"

    except (URLError, TimeoutError, ValueError, OSError) as exc:
        candidate.error = str(exc)

    return candidate


def add_candidate(
    candidates: dict[str, CandidateEndpoint],
    *,
    url: str,
    discovered_in: str,
    method: str,
    root_url: str,
) -> None:
    categories = url_categories(url)

    if not categories and not is_likely_data_url(url):
        return

    if url not in candidates:
        candidates[url] = CandidateEndpoint(
            url=url,
            discovered_in=discovered_in,
            discovery_method=method,
            categories=categories or ["possible_data"],
            same_origin=same_origin(root_url, url),
        )
    else:
        current = candidates[url]
        current.categories = sorted(
            set(current.categories + categories)
        )


def write_markdown_report(
    report: dict[str, Any],
    output_path: Path,
) -> None:
    page = report["page"]
    candidates = report["candidate_endpoints"]
    technologies = report["technology_signals"]
    notes = report["interpretation"]

    lines = [
        "# B’Tselem map source discovery",
        "",
        f"- Generated: `{report['generated_at']}`",
        f"- Page: `{page['requested_url']}`",
        f"- Final URL: `{page['final_url']}`",
        f"- HTTP status: `{page['status']}`",
        f"- Content type: `{page['content_type']}`",
        f"- HTML bytes: `{page['bytes']}`",
        "",
        "## Technology signals",
        "",
    ]

    if technologies:
        for name, evidence in technologies.items():
            lines.append(f"- **{name}**: {', '.join(evidence[:8])}")
    else:
        lines.append("- No decisive mapping technology identified statically.")

    lines.extend(
        [
            "",
            "## Candidate data endpoints",
            "",
        ]
    )

    if not candidates:
        lines.append(
            "No likely public data endpoint was found by static inspection."
        )
    else:
        for index, item in enumerate(candidates, start=1):
            lines.extend(
                [
                    f"### {index}. `{item['url']}`",
                    "",
                    f"- Categories: `{', '.join(item['categories'])}`",
                    f"- Discovered in: `{item['discovered_in']}`",
                    f"- Method: `{item['discovery_method']}`",
                    f"- Same origin: `{item['same_origin']}`",
                    f"- Probe status: `{item['probe_status']}`",
                    f"- Content type: `{item['content_type'] or 'unknown'}`",
                    f"- Response hint: `{item['response_hint'] or 'none'}`",
                    f"- Error: `{item['error'] or 'none'}`",
                    "",
                ]
            )

    lines.extend(
        [
            "## Interpretation",
            "",
        ]
    )

    for note in notes:
        lines.append(f"- {note}")

    lines.extend(
        [
            "",
            "## Next decision",
            "",
            (
                "Proceed to `update_btselem.py` only after confirming that at "
                "least one stable, publicly accessible endpoint returns "
                "structured geospatial features or stable map-object IDs."
            ),
            "",
        ]
    )

    output_path.write_text("\n".join(lines), encoding="utf-8")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Discover public data sources used by the B'Tselem map."
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_URL,
        help=f"Map page URL (default: {DEFAULT_URL})",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory (default: data)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT,
        help=f"Network timeout in seconds (default: {DEFAULT_TIMEOUT})",
    )
    parser.add_argument(
        "--max-bytes",
        type=int,
        default=DEFAULT_MAX_BYTES,
        help=(
            "Maximum bytes downloaded per HTML/JS asset "
            f"(default: {DEFAULT_MAX_BYTES})"
        ),
    )
    parser.add_argument(
        "--max-assets",
        type=int,
        default=DEFAULT_MAX_ASSETS,
        help=(
            "Maximum referenced script/iframe assets inspected "
            f"(default: {DEFAULT_MAX_ASSETS})"
        ),
    )
    parser.add_argument(
        "--save-assets",
        action="store_true",
        help="Save inspected HTML/JS text samples under output/raw.",
    )
    parser.add_argument(
        "--probe-all",
        action="store_true",
        help=(
            "Probe all candidate URLs. By default only the first 30 "
            "highest-relevance candidates are probed."
        ),
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.25,
        help="Delay between asset requests in seconds (default: 0.25)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose logging.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_arguments()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )

    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = output_dir / "btselem-discovery" / "raw"

    if args.save_assets:
        raw_dir.mkdir(parents=True, exist_ok=True)

    logging.info("Fetching map page: %s", args.url)

    try:
        body, headers, status, final_url = fetch_bytes(
            args.url,
            timeout=args.timeout,
            max_bytes=args.max_bytes,
        )
    except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
        logging.error("Unable to fetch map page: %s", exc)
        return 1

    html_text = decode_text(body, headers)

    if args.save_assets:
        (raw_dir / "map-page.html").write_text(
            html_text,
            encoding="utf-8",
        )

    parser = PageAssetParser()

    try:
        parser.feed(html_text)
    except Exception as exc:  # HTMLParser can tolerate most malformed HTML.
        logging.warning("HTML parsing warning: %s", exc)

    root_url = final_url
    assets: dict[str, AssetReference] = {}
    candidates: dict[str, CandidateEndpoint] = {}
    technology_evidence: dict[str, list[str]] = {}

    def record_technology(text: str, source: str) -> None:
        for category, pattern in SERVICE_PATTERNS.items():
            if pattern.search(text):
                technology_evidence.setdefault(category, [])
                if source not in technology_evidence[category]:
                    technology_evidence[category].append(source)

    record_technology(html_text, "map HTML")

    for raw_url, kind, source in parser.references:
        normalized = normalize_url(raw_url, root_url)

        if not normalized:
            continue

        relevance = url_categories(normalized)

        assets.setdefault(
            normalized,
            AssetReference(
                url=normalized,
                kind=kind,
                source=source,
                same_origin=same_origin(root_url, normalized),
                map_relevance=relevance,
            ),
        )

        add_candidate(
            candidates,
            url=normalized,
            discovered_in="map HTML",
            method=source,
            root_url=root_url,
        )

    inline_script_text = "\n".join(parser.inline_scripts)
    record_technology(inline_script_text, "inline JavaScript")

    for url, method in discover_urls_from_text(
        inline_script_text,
        root_url,
    ):
        add_candidate(
            candidates,
            url=url,
            discovered_in="inline JavaScript",
            method=method,
            root_url=root_url,
        )

    # Prioritize JS and iframe assets, then same-origin references.
    inspectable_assets = sorted(
        (
            asset
            for asset in assets.values()
            if asset.kind in {"script", "iframe", "data_attribute"}
        ),
        key=lambda item: (
            item.kind != "iframe",
            not item.same_origin,
            not bool(item.map_relevance),
            item.url,
        ),
    )[: max(0, args.max_assets)]

    inspected_assets: list[dict[str, Any]] = []

    for asset in inspectable_assets:
        logging.info("Inspecting %s: %s", asset.kind, asset.url)

        time.sleep(max(0, args.delay))

        record: dict[str, Any] = {
            **asdict(asset),
            "status": None,
            "content_type": "",
            "bytes": 0,
            "final_url": "",
            "error": "",
        }

        try:
            asset_body, asset_headers, asset_status, asset_final_url = (
                fetch_bytes(
                    asset.url,
                    timeout=args.timeout,
                    max_bytes=args.max_bytes,
                )
            )

            record.update(
                {
                    "status": asset_status,
                    "content_type": asset_headers.get(
                        "content-type",
                        "",
                    ),
                    "bytes": len(asset_body),
                    "final_url": asset_final_url,
                }
            )

            content_type = record["content_type"].lower()

            if any(
                content_type.startswith(prefix)
                for prefix in TEXT_CONTENT_TYPES
            ) or asset.kind in {"script", "iframe"}:
                asset_text = decode_text(asset_body, asset_headers)
                record_technology(asset_text, asset.url)

                if args.save_assets:
                    filename = safe_filename(
                        asset.url,
                        prefix=f"{asset.kind}-",
                    )
                    suffix = mimetypes.guess_extension(
                        content_type.split(";", 1)[0]
                    ) or ".txt"
                    if not filename.endswith(suffix):
                        filename += suffix
                    (raw_dir / filename).write_text(
                        asset_text,
                        encoding="utf-8",
                    )

                for url, method in discover_urls_from_text(
                    asset_text,
                    asset_final_url,
                ):
                    add_candidate(
                        candidates,
                        url=url,
                        discovered_in=asset.url,
                        method=method,
                        root_url=root_url,
                    )

        except HTTPError as exc:
            record["status"] = exc.code
            record["error"] = f"HTTP {exc.code}: {exc.reason}"

        except (URLError, TimeoutError, ValueError, OSError) as exc:
            record["error"] = str(exc)

        inspected_assets.append(record)

    # Rank candidates by likely usefulness.
    def candidate_score(item: CandidateEndpoint) -> tuple[int, int, str]:
        category_weights = {
            "geojson": 100,
            "arcgis": 95,
            "wms_wfs": 90,
            "download": 85,
            "api": 75,
            "mapbox": 65,
            "carto": 65,
            "tile_template": 35,
            "leaflet": 20,
            "openlayers": 20,
            "possible_data": 10,
        }
        score = sum(
            category_weights.get(category, 0)
            for category in item.categories
        )
        return (
            -score,
            0 if item.same_origin else 1,
            item.url,
        )

    ranked_candidates = sorted(
        candidates.values(),
        key=candidate_score,
    )

    probe_limit = (
        len(ranked_candidates)
        if args.probe_all
        else min(30, len(ranked_candidates))
    )

    for candidate in ranked_candidates[:probe_limit]:
        logging.info("Probing candidate: %s", candidate.url)
        time.sleep(max(0, args.delay))
        probe_candidate(
            candidate,
            timeout=args.timeout,
            max_bytes=min(args.max_bytes, 1_500_000),
        )

    useful_candidates = [
        item
        for item in ranked_candidates
        if (
            item.probe_status is not None
            or item.categories
        )
    ]

    structured_hits = [
        item
        for item in useful_candidates
        if (
            item.response_hint
            or any(
                category
                in {
                    "geojson",
                    "arcgis",
                    "wms_wfs",
                    "download",
                    "api",
                }
                for category in item.categories
            )
        )
    ]

    interpretation = [
        (
            "This report is static discovery: it does not execute the map's "
            "browser JavaScript or capture runtime network traffic."
        ),
        (
            "A GeoJSON, ArcGIS FeatureServer/MapServer, WFS, or stable JSON "
            "endpoint is suitable for the next ingestion step."
        ),
        (
            "Raster tiles alone are useful for display but normally do not "
            "provide object-level geometry or stable IDs for change tracking."
        ),
        (
            "Territorial change can be calculated only from comparable "
            "dated geometries or from snapshots collected consistently over "
            "time."
        ),
        (
            "Before production use, review B'Tselem's applicable terms, "
            "copyright notices, robots policy, and attribution requirements."
        ),
    ]

    if not structured_hits:
        interpretation.append(
            "No decisive structured geospatial endpoint was confirmed. "
            "The next discovery step should use browser network capture "
            "(for example Playwright or DevTools) while manually loading "
            "and toggling map layers."
        )
    else:
        interpretation.append(
            f"{len(structured_hits)} potentially structured endpoint(s) "
            "were identified for manual verification."
        )

    report = {
        "schema_version": 1,
        "generated_at": utc_now_iso(),
        "tool": {
            "name": "discover_btselem_sources.py",
            "version": "1.0",
            "user_agent": USER_AGENT,
            "static_only": True,
        },
        "page": {
            "requested_url": args.url,
            "final_url": final_url,
            "status": status,
            "content_type": headers.get("content-type", ""),
            "bytes": len(body),
        },
        "html_summary": {
            "asset_reference_count": len(assets),
            "inline_script_count": len(parser.inline_scripts),
            "meta_value_count": len(parser.meta_values),
        },
        "technology_signals": {
            key: value
            for key, value in sorted(technology_evidence.items())
        },
        "assets": [
            asdict(item)
            for item in sorted(
                assets.values(),
                key=lambda asset: (asset.kind, asset.url),
            )
        ],
        "inspected_assets": inspected_assets,
        "candidate_endpoints": [
            asdict(item)
            for item in useful_candidates
        ],
        "structured_candidate_count": len(structured_hits),
        "interpretation": interpretation,
    }

    json_path = output_dir / "btselem-discovery.json"
    markdown_path = output_dir / "btselem-discovery.md"

    json_path.write_text(
        json.dumps(
            report,
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    write_markdown_report(report, markdown_path)

    logging.info("JSON report: %s", json_path)
    logging.info("Markdown report: %s", markdown_path)
    logging.info(
        "Candidate endpoints: %d; structured candidates: %d",
        len(useful_candidates),
        len(structured_hits),
    )

    return 0 if structured_hits else 2


if __name__ == "__main__":
    sys.exit(main())
