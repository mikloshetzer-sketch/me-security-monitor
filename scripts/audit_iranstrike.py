#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
IranStrike public-source integration audit.

Purpose
-------
Identify whether iranstrike.com exposes stable, public, technically reusable
data endpoints that could support a separate Iran-focused layer.

The script performs read-only requests only. It does not authenticate, bypass
access controls, solve CAPTCHAs, or attempt to call private/administrative APIs.

Outputs
-------
data/iranstrike-audit.json
data/iranstrike-audit.md
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


BASE_URL = "https://iranstrike.com/"
OUTPUT_JSON = Path("data/iranstrike-audit.json")
OUTPUT_MD = Path("data/iranstrike-audit.md")

TIMEOUT = 30
MAX_BYTES = 8 * 1024 * 1024
MAX_ASSETS = 80
REQUEST_DELAY_SECONDS = 0.25

USER_AGENT = (
    "ME-Security-Monitor-IranStrike-Audit/1.0 "
    "(read-only OSINT integration assessment)"
)

COMMON_PATHS = [
    "/robots.txt",
    "/sitemap.xml",
    "/manifest.json",
    "/site.webmanifest",
    "/asset-manifest.json",
    "/service-worker.js",
    "/sw.js",
    "/api",
    "/api/events",
    "/api/incidents",
    "/api/alerts",
    "/api/strikes",
    "/api/missiles",
    "/api/feed",
    "/api/status",
    "/api/health",
    "/api/infrastructure",
    "/api/countries",
]

URL_PATTERN = re.compile(
    r"""(?:
        https?://[^\s"'<>\\]+
        |
        wss?://[^\s"'<>\\]+
        |
        /(?:api|data|events|alerts|feed|incidents|strikes|missiles|radar|
            infrastructure|status|countries|graphql|socket|ws)
        [A-Za-z0-9_./?=&%:{}$@+~-]*
    )""",
    re.IGNORECASE | re.VERBOSE,
)

JSON_FILE_PATTERN = re.compile(
    r"""["']([^"']+\.(?:json|geojson|topojson)(?:\?[^"']*)?)["']""",
    re.IGNORECASE,
)

FETCH_PATTERN = re.compile(
    r"""(?:fetch|axios\.(?:get|post)|new\s+WebSocket|EventSource)\s*
        \(\s*["'`]([^"'`]+)["'`]""",
    re.IGNORECASE | re.VERBOSE,
)

ENV_PATTERN = re.compile(
    r"""(?:NEXT_PUBLIC_|VITE_|REACT_APP_)[A-Z0-9_]+""",
    re.IGNORECASE,
)

API_HINT_PATTERN = re.compile(
    r"""(?:api|endpoint|websocket|socket|supabase|firebase|graphql|
         telegram|eventsource|polling|interval|missile|strike|alert|
         infrastructure|cloudflare|mapbox|arcgis|geojson)""",
    re.IGNORECASE | re.VERBOSE,
)


def utc_now() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass
class FetchResult:
    url: str
    final_url: str = ""
    status: Optional[int] = None
    content_type: str = ""
    content_length: int = 0
    sha256: str = ""
    error: str = ""
    headers: Optional[Dict[str, str]] = None
    body_text: str = ""


class AssetParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.scripts: List[str] = []
        self.links: List[str] = []
        self.iframes: List[str] = []
        self.inline_scripts: List[str] = []
        self._inside_script = False
        self._script_buffer: List[str] = []
        self.meta: List[Dict[str, str]] = []

    def handle_starttag(
        self,
        tag: str,
        attrs: List[Tuple[str, Optional[str]]],
    ) -> None:
        attr_map = {
            key.lower(): value or ""
            for key, value in attrs
        }

        if tag.lower() == "script":
            src = attr_map.get("src", "")
            if src:
                self.scripts.append(src)
            else:
                self._inside_script = True
                self._script_buffer = []

        elif tag.lower() == "link":
            href = attr_map.get("href", "")
            if href:
                self.links.append(href)

        elif tag.lower() == "iframe":
            src = attr_map.get("src", "")
            if src:
                self.iframes.append(src)

        elif tag.lower() == "meta":
            self.meta.append(attr_map)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self._inside_script:
            self.inline_scripts.append(
                "".join(self._script_buffer)
            )
            self._inside_script = False
            self._script_buffer = []

    def handle_data(self, data: str) -> None:
        if self._inside_script:
            self._script_buffer.append(data)


def decode_body(
    raw: bytes,
    headers: Dict[str, str],
) -> bytes:
    encoding = headers.get("content-encoding", "").lower()

    if "gzip" in encoding:
        try:
            return gzip.decompress(raw)
        except OSError:
            return raw

    return raw


def fetch(
    url: str,
    method: str = "GET",
    max_bytes: int = MAX_BYTES,
) -> FetchResult:
    request = urllib.request.Request(
        url,
        method=method,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": (
                "text/html,application/json,text/plain,"
                "application/javascript,*/*;q=0.8"
            ),
            "Accept-Encoding": "gzip",
        },
    )

    context = ssl.create_default_context()

    try:
        with urllib.request.urlopen(
            request,
            timeout=TIMEOUT,
            context=context,
        ) as response:
            raw = response.read(max_bytes + 1)

            if len(raw) > max_bytes:
                raw = raw[:max_bytes]

            headers = {
                key.lower(): value
                for key, value in response.headers.items()
            }

            decoded = decode_body(raw, headers)

            charset = response.headers.get_content_charset() or "utf-8"

            try:
                text = decoded.decode(
                    charset,
                    errors="replace",
                )
            except LookupError:
                text = decoded.decode(
                    "utf-8",
                    errors="replace",
                )

            return FetchResult(
                url=url,
                final_url=response.geturl(),
                status=response.status,
                content_type=headers.get(
                    "content-type",
                    "",
                ),
                content_length=len(decoded),
                sha256=sha256(decoded),
                headers=headers,
                body_text=text,
            )

    except urllib.error.HTTPError as exc:
        try:
            raw = exc.read(max_bytes)
            text = raw.decode("utf-8", errors="replace")
        except Exception:
            text = ""

        return FetchResult(
            url=url,
            final_url=exc.geturl(),
            status=exc.code,
            content_type=exc.headers.get(
                "Content-Type",
                "",
            ),
            content_length=len(text.encode("utf-8")),
            error=f"HTTP {exc.code}: {exc.reason}",
            headers={
                key.lower(): value
                for key, value in exc.headers.items()
            },
            body_text=text,
        )

    except Exception as exc:
        return FetchResult(
            url=url,
            error=f"{type(exc).__name__}: {exc}",
            headers={},
        )


def same_origin(url: str) -> bool:
    target = urllib.parse.urlparse(url)
    base = urllib.parse.urlparse(BASE_URL)

    return (
        target.scheme in {"http", "https"} and
        target.netloc.lower() == base.netloc.lower()
    )


def absolute_url(value: str, parent: str) -> str:
    return urllib.parse.urljoin(parent, value.strip())


def normalize_candidate(
    value: str,
    parent_url: str,
) -> Optional[str]:
    value = (
        value.strip()
        .replace("\\u002F", "/")
        .replace("\\/", "/")
        .rstrip("),;]")
    )

    if not value:
        return None

    if value.startswith(("ws://", "wss://")):
        return value

    if value.startswith(("http://", "https://", "/")):
        return absolute_url(value, parent_url)

    return None


def extract_candidates(
    text: str,
    parent_url: str,
) -> Dict[str, List[str]]:
    urls: Set[str] = set()
    json_files: Set[str] = set()
    fetch_targets: Set[str] = set()
    env_names: Set[str] = set()
    hints: Set[str] = set()

    for match in URL_PATTERN.findall(text):
        candidate = normalize_candidate(
            match,
            parent_url,
        )
        if candidate:
            urls.add(candidate)

    for match in JSON_FILE_PATTERN.findall(text):
        candidate = absolute_url(match, parent_url)
        json_files.add(candidate)
        urls.add(candidate)

    for match in FETCH_PATTERN.findall(text):
        candidate = normalize_candidate(
            match,
            parent_url,
        )
        if candidate:
            fetch_targets.add(candidate)
            urls.add(candidate)

    env_names.update(ENV_PATTERN.findall(text))

    for line in text.splitlines():
        if API_HINT_PATTERN.search(line):
            cleaned = re.sub(r"\s+", " ", line).strip()
            if 0 < len(cleaned) <= 500:
                hints.add(cleaned)

        if len(hints) >= 120:
            break

    return {
        "urls": sorted(urls),
        "json_files": sorted(json_files),
        "fetch_targets": sorted(fetch_targets),
        "environment_names": sorted(env_names),
        "interesting_snippets": sorted(hints)[:120],
    }


def classify_endpoint(
    result: FetchResult,
) -> Dict[str, Any]:
    content_type = result.content_type.lower()
    text = result.body_text.strip()

    is_json = (
        "application/json" in content_type or
        "geo+json" in content_type or
        text.startswith("{") or
        text.startswith("[")
    )

    parsed_type = ""
    record_count: Optional[int] = None
    sample_keys: List[str] = []

    if is_json and text:
        try:
            parsed = json.loads(text)

            if isinstance(parsed, list):
                parsed_type = "array"
                record_count = len(parsed)

                if parsed and isinstance(parsed[0], dict):
                    sample_keys = sorted(
                        str(key)
                        for key in parsed[0].keys()
                    )[:40]

            elif isinstance(parsed, dict):
                parsed_type = "object"
                sample_keys = sorted(
                    str(key)
                    for key in parsed.keys()
                )[:40]

                for key in [
                    "events",
                    "incidents",
                    "alerts",
                    "data",
                    "features",
                    "results",
                ]:
                    value = parsed.get(key)
                    if isinstance(value, list):
                        record_count = len(value)
                        break

        except json.JSONDecodeError:
            is_json = False

    cache_control = (
        result.headers or {}
    ).get("cache-control", "")

    cors = (
        result.headers or {}
    ).get("access-control-allow-origin", "")

    return {
        "is_json": is_json,
        "json_type": parsed_type,
        "record_count": record_count,
        "sample_keys": sample_keys,
        "cors": cors,
        "cache_control": cache_control,
        "public_get_candidate": bool(
            result.status == 200 and is_json
        ),
    }


def endpoint_score(
    result: FetchResult,
    classification: Dict[str, Any],
) -> int:
    score = 0
    url_lower = result.url.lower()

    if result.status == 200:
        score += 2

    if classification.get("is_json"):
        score += 4

    if classification.get("record_count") is not None:
        score += 2

    if any(
        token in url_lower
        for token in [
            "event",
            "incident",
            "strike",
            "missile",
            "alert",
            "feed",
            "infrastructure",
            "country",
            "radar",
        ]
    ):
        score += 2

    if classification.get("cors") in {"*", BASE_URL.rstrip("/")}:
        score += 1

    if result.status in {401, 403}:
        score -= 3

    return score


def audit() -> Dict[str, Any]:
    report: Dict[str, Any] = {
        "generated_at": utc_now(),
        "target": BASE_URL,
        "policy": {
            "mode": "read_only",
            "authentication_attempted": False,
            "access_control_bypass_attempted": False,
            "max_assets": MAX_ASSETS,
            "max_bytes_per_request": MAX_BYTES,
        },
        "homepage": {},
        "discovery_files": [],
        "assets": [],
        "candidate_endpoints": [],
        "websockets": [],
        "third_party_services": [],
        "environment_names": [],
        "interesting_snippets": [],
        "assessment": {},
    }

    homepage = fetch(BASE_URL)
    report["homepage"] = {
        key: value
        for key, value in asdict(homepage).items()
        if key != "body_text"
    }

    if homepage.status != 200:
        report["assessment"] = {
            "status": "homepage_unavailable",
            "summary": homepage.error or (
                f"Unexpected HTTP status: {homepage.status}"
            ),
        }
        return report

    parser = AssetParser()
    parser.feed(homepage.body_text)

    assets: Set[str] = set()

    for value in (
        parser.scripts +
        parser.links +
        parser.iframes
    ):
        url = absolute_url(value, homepage.final_url or BASE_URL)

        if (
            same_origin(url) and
            url.startswith(("http://", "https://"))
        ):
            assets.add(url)

    homepage_candidates = extract_candidates(
        homepage.body_text +
        "\n".join(parser.inline_scripts),
        homepage.final_url or BASE_URL,
    )

    candidate_urls: Set[str] = set(
        homepage_candidates["urls"]
    )

    environment_names: Set[str] = set(
        homepage_candidates["environment_names"]
    )

    snippets: Set[str] = set(
        homepage_candidates["interesting_snippets"]
    )

    for path in COMMON_PATHS:
        url = absolute_url(path, BASE_URL)
        result = fetch(url)

        report["discovery_files"].append({
            **{
                key: value
                for key, value in asdict(result).items()
                if key != "body_text"
            },
            "classification": classify_endpoint(result),
        })

        if result.status == 200 and result.body_text:
            found = extract_candidates(
                result.body_text,
                result.final_url or url,
            )
            candidate_urls.update(found["urls"])
            environment_names.update(
                found["environment_names"]
            )
            snippets.update(
                found["interesting_snippets"]
            )

        time.sleep(REQUEST_DELAY_SECONDS)

    for asset_url in sorted(assets)[:MAX_ASSETS]:
        result = fetch(asset_url)

        asset_entry: Dict[str, Any] = {
            key: value
            for key, value in asdict(result).items()
            if key != "body_text"
        }

        if (
            result.status == 200 and
            result.body_text and
            any(
                token in result.content_type.lower()
                for token in [
                    "javascript",
                    "json",
                    "text",
                    "html",
                    "manifest",
                ]
            )
        ):
            found = extract_candidates(
                result.body_text,
                result.final_url or asset_url,
            )

            asset_entry["discovered"] = {
                "urls": found["urls"][:100],
                "fetch_targets": found[
                    "fetch_targets"
                ][:100],
                "json_files": found[
                    "json_files"
                ][:100],
                "environment_names": found[
                    "environment_names"
                ][:100],
            }

            candidate_urls.update(found["urls"])
            environment_names.update(
                found["environment_names"]
            )
            snippets.update(
                found["interesting_snippets"]
            )

        report["assets"].append(asset_entry)
        time.sleep(REQUEST_DELAY_SECONDS)

    endpoint_urls: Set[str] = set()

    for url in candidate_urls:
        parsed = urllib.parse.urlparse(url)

        if parsed.scheme in {"ws", "wss"}:
            report["websockets"].append(url)
            continue

        if same_origin(url):
            endpoint_urls.add(url)
        elif parsed.scheme in {"http", "https"}:
            report["third_party_services"].append(url)

    for url in sorted(endpoint_urls):
        path_lower = urllib.parse.urlparse(url).path.lower()

        if not any(
            token in path_lower
            for token in [
                "/api",
                ".json",
                ".geojson",
                "event",
                "incident",
                "strike",
                "missile",
                "alert",
                "feed",
                "status",
                "infrastructure",
                "country",
                "radar",
                "graphql",
            ]
        ):
            continue

        result = fetch(url)
        classification = classify_endpoint(result)

        report["candidate_endpoints"].append({
            **{
                key: value
                for key, value in asdict(result).items()
                if key != "body_text"
            },
            "classification": classification,
            "score": endpoint_score(
                result,
                classification,
            ),
            "sample": (
                result.body_text[:1200]
                if classification.get("is_json")
                else ""
            ),
        })

        time.sleep(REQUEST_DELAY_SECONDS)

    report["candidate_endpoints"].sort(
        key=lambda item: (
            item.get("score", 0),
            item.get("classification", {}).get(
                "record_count"
            ) or -1,
        ),
        reverse=True,
    )

    report["websockets"] = sorted(
        set(report["websockets"])
    )

    report["third_party_services"] = sorted(
        set(report["third_party_services"])
    )[:250]

    report["environment_names"] = sorted(
        environment_names
    )

    report["interesting_snippets"] = sorted(
        snippets
    )[:150]

    usable = [
        item
        for item in report["candidate_endpoints"]
        if item.get(
            "classification",
            {},
        ).get("public_get_candidate")
    ]

    restricted = [
        item
        for item in report["candidate_endpoints"]
        if item.get("status") in {401, 403}
    ]

    if usable:
        status = "public_data_candidates_found"
        summary = (
            f"{len(usable)} public JSON/GeoJSON GET "
            "candidate endpoint(s) found."
        )
    elif report["websockets"]:
        status = "realtime_transport_detected"
        summary = (
            "No public JSON endpoint was confirmed, "
            "but WebSocket references were detected."
        )
    elif restricted:
        status = "restricted_candidates_found"
        summary = (
            "Potential endpoints were detected, "
            "but the tested candidates require authorization "
            "or deny direct access."
        )
    else:
        status = "no_confirmed_public_endpoint"
        summary = (
            "The static audit did not confirm a stable public "
            "JSON/GeoJSON endpoint. Browser network capture may "
            "still be required."
        )

    report["assessment"] = {
        "status": status,
        "summary": summary,
        "public_candidate_count": len(usable),
        "restricted_candidate_count": len(restricted),
        "websocket_reference_count": len(
            report["websockets"]
        ),
        "recommended_next_step": (
            "Review the highest-scoring candidates. "
            "If none contain event records, run a browser "
            "network audit with Playwright or browser DevTools."
        ),
        "legal_note": (
            "Technical accessibility does not grant reuse or "
            "republication rights. Review the site's terms, "
            "robots policy, attribution requirements, and source "
            "licences before integration."
        ),
    }

    return report


def markdown_report(report: Dict[str, Any]) -> str:
    lines: List[str] = []

    lines.append("# IranStrike integration audit")
    lines.append("")
    lines.append(
        f"- Generated: `{report.get('generated_at', '')}`"
    )
    lines.append(
        f"- Target: `{report.get('target', '')}`"
    )
    lines.append(
        f"- Result: **{report.get('assessment', {}).get('status', '')}**"
    )
    lines.append("")
    lines.append(
        report.get("assessment", {}).get(
            "summary",
            "",
        )
    )
    lines.append("")

    homepage = report.get("homepage", {})
    lines.append("## Homepage")
    lines.append("")
    lines.append(
        f"- HTTP status: `{homepage.get('status')}`"
    )
    lines.append(
        f"- Content type: `{homepage.get('content_type', '')}`"
    )
    lines.append(
        f"- Final URL: `{homepage.get('final_url', '')}`"
    )
    lines.append("")

    lines.append("## Highest-scoring endpoint candidates")
    lines.append("")

    candidates = report.get(
        "candidate_endpoints",
        [],
    )[:20]

    if not candidates:
        lines.append(
            "No endpoint candidates were confirmed."
        )
    else:
        for item in candidates:
            classification = item.get(
                "classification",
                {},
            )

            lines.append(
                f"### Score {item.get('score', 0)} — "
                f"`{item.get('url', '')}`"
            )
            lines.append("")
            lines.append(
                f"- HTTP: `{item.get('status')}`"
            )
            lines.append(
                f"- Content type: "
                f"`{item.get('content_type', '')}`"
            )
            lines.append(
                f"- JSON: `{classification.get('is_json')}`"
            )
            lines.append(
                f"- Record count: "
                f"`{classification.get('record_count')}`"
            )
            lines.append(
                f"- CORS: "
                f"`{classification.get('cors', '')}`"
            )
            lines.append(
                f"- Sample keys: "
                f"`{', '.join(classification.get('sample_keys', []))}`"
            )
            lines.append("")

    lines.append("## WebSocket references")
    lines.append("")

    websockets = report.get("websockets", [])

    if websockets:
        for url in websockets:
            lines.append(f"- `{url}`")
    else:
        lines.append("No WebSocket reference detected.")

    lines.append("")
    lines.append("## Environment-variable names")
    lines.append("")

    env_names = report.get(
        "environment_names",
        [],
    )

    if env_names:
        for name in env_names:
            lines.append(f"- `{name}`")
    else:
        lines.append(
            "No public frontend environment-variable names detected."
        )

    lines.append("")
    lines.append("## Assessment")
    lines.append("")
    lines.append(
        report.get("assessment", {}).get(
            "recommended_next_step",
            "",
        )
    )
    lines.append("")
    lines.append(
        report.get("assessment", {}).get(
            "legal_note",
            "",
        )
    )
    lines.append("")

    return "\n".join(lines)


def main() -> int:
    print("Starting IranStrike public-source audit...")
    report = audit()

    OUTPUT_JSON.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    OUTPUT_JSON.write_text(
        json.dumps(
            report,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    OUTPUT_MD.write_text(
        markdown_report(report),
        encoding="utf-8",
    )

    assessment = report.get("assessment", {})

    print("Audit completed.")
    print(f"Status: {assessment.get('status')}")
    print(
        "Public candidates: "
        f"{assessment.get('public_candidate_count', 0)}"
    )
    print(
        "WebSocket references: "
        f"{assessment.get('websocket_reference_count', 0)}"
    )
    print(f"JSON output: {OUTPUT_JSON}")
    print(f"Markdown output: {OUTPUT_MD}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(
            f"ERROR: {type(exc).__name__}: {exc}",
            file=sys.stderr,
        )
        raise SystemExit(1)
