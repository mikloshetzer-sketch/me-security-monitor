#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
IranStrike updater and normalizer.

Public endpoints:
- /api/events
- /api/feed
- /api/summary
- /api/vitals

Output:
- data/iranstrike.json

The script keeps normalized fields for the map/dashboard and also preserves
the original source record in raw_source for auditability.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


BASE_URL = "https://iranstrike.com"
ENDPOINTS = {
    "events": f"{BASE_URL}/api/events",
    "feed": f"{BASE_URL}/api/feed",
    "summary": f"{BASE_URL}/api/summary",
    "vitals": f"{BASE_URL}/api/vitals",
}
OUTPUT_PATH = Path("data/iranstrike.json")
TIMEOUT = 45
MAX_RETRIES = 3
USER_AGENT = (
    "ME-Security-Monitor-IranStrike-Updater/1.0 "
    "(read-only OSINT research)"
)


def now_utc() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def clean(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def first_nonempty(*values: Any) -> Any:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str):
            if value.strip():
                return value.strip()
        elif value not in ({}, [], ()):
            return value
    return ""


def fetch_json(url: str) -> Any:
    last_error: Optional[Exception] = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(
                request,
                timeout=TIMEOUT,
            ) as response:
                raw = response.read().decode(
                    "utf-8",
                    errors="replace",
                )

            return json.loads(raw)

        except Exception as exc:
            last_error = exc
            if attempt < MAX_RETRIES:
                time.sleep(attempt * 2)

    raise RuntimeError(
        f"Failed to fetch {url}: {last_error}"
    )


def parse_datetime(value: Any) -> str:
    if value in (None, ""):
        return ""

    if isinstance(value, (int, float)):
        timestamp = float(value)
        if timestamp > 10_000_000_000:
            timestamp /= 1000

        try:
            return (
                datetime.fromtimestamp(
                    timestamp,
                    tz=timezone.utc,
                )
                .replace(microsecond=0)
                .isoformat()
                .replace("+00:00", "Z")
            )
        except (ValueError, OSError, OverflowError):
            return ""

    text = clean(value)
    if not text:
        return ""

    if re.fullmatch(r"\d{10,13}", text):
        return parse_datetime(int(text))

    normalized = text.replace("Z", "+00:00")

    try:
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        else:
            parsed = parsed.astimezone(timezone.utc)

        return (
            parsed.replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z")
        )
    except ValueError:
        pass

    formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y",
    ]

    for fmt in formats:
        try:
            parsed = datetime.strptime(text, fmt).replace(
                tzinfo=timezone.utc
            )
            return (
                parsed.isoformat()
                .replace("+00:00", "Z")
            )
        except ValueError:
            continue

    return text


def value_by_paths(
    obj: Dict[str, Any],
    paths: Iterable[str],
) -> Any:
    for path in paths:
        current: Any = obj
        valid = True

        for part in path.split("."):
            if not isinstance(current, dict) or part not in current:
                valid = False
                break
            current = current[part]

        if valid and current not in (None, "", [], {}):
            return current

    return ""


def number(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None

    if isinstance(value, bool):
        return None

    try:
        result = float(value)
        if math.isfinite(result):
            return result
    except (TypeError, ValueError):
        pass

    text = clean(value)
    match = re.search(r"-?\d+(?:\.\d+)?", text)

    if match:
        try:
            result = float(match.group())
            return result if math.isfinite(result) else None
        except ValueError:
            return None

    return None


def extract_coordinates(
    record: Dict[str, Any],
) -> Tuple[Optional[float], Optional[float]]:
    lat = number(
        value_by_paths(
            record,
            [
                "latitude",
                "lat",
                "location.latitude",
                "location.lat",
                "coordinates.latitude",
                "coordinates.lat",
                "geo.latitude",
                "geo.lat",
                "position.latitude",
                "position.lat",
            ],
        )
    )

    lon = number(
        value_by_paths(
            record,
            [
                "longitude",
                "lng",
                "lon",
                "location.longitude",
                "location.lng",
                "location.lon",
                "coordinates.longitude",
                "coordinates.lng",
                "coordinates.lon",
                "geo.longitude",
                "geo.lng",
                "geo.lon",
                "position.longitude",
                "position.lng",
                "position.lon",
            ],
        )
    )

    if lat is not None and lon is not None:
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            return lat, lon

    coordinates = value_by_paths(
        record,
        [
            "coordinates",
            "geometry.coordinates",
            "location.coordinates",
        ],
    )

    if (
        isinstance(coordinates, (list, tuple)) and
        len(coordinates) >= 2
    ):
        first = number(coordinates[0])
        second = number(coordinates[1])

        if first is not None and second is not None:
            # GeoJSON is normally [longitude, latitude].
            if -180 <= first <= 180 and -90 <= second <= 90:
                return second, first

    return None, None


def normalize_category(record: Dict[str, Any]) -> str:
    value = clean(
        value_by_paths(
            record,
            [
                "category",
                "type",
                "eventType",
                "event_type",
                "classification",
                "kind",
                "incidentType",
                "incident_type",
                "subtype",
                "tag",
            ],
        )
    )

    text = (
        f"{value} "
        f"{clean(record.get('title'))} "
        f"{clean(record.get('description'))} "
        f"{clean(record.get('summary'))}"
    ).lower()

    groups = [
        (
            "airstrike",
            [
                "airstrike",
                "air strike",
                "air raid",
                "air attack",
                "bombing",
            ],
        ),
        (
            "missile",
            [
                "missile",
                "rocket",
                "ballistic",
                "interception",
                "projectile",
            ],
        ),
        (
            "drone",
            [
                "drone",
                "uav",
                "unmanned",
            ],
        ),
        (
            "explosion",
            [
                "explosion",
                "blast",
                "detonation",
            ],
        ),
        (
            "ground",
            [
                "ground",
                "clash",
                "raid",
                "incursion",
                "troops",
            ],
        ),
        (
            "infrastructure",
            [
                "infrastructure",
                "airport",
                "port",
                "power",
                "internet",
                "nuclear",
                "refinery",
                "pipeline",
                "facility",
            ],
        ),
        (
            "alert",
            [
                "alert",
                "warning",
                "siren",
                "evacuation",
            ],
        ),
        (
            "political",
            [
                "ceasefire",
                "truce",
                "negotiation",
                "diplomatic",
                "sanction",
                "statement",
            ],
        ),
    ]

    for category, terms in groups:
        if any(term in text for term in terms):
            return category

    return value.lower().replace(" ", "_") if value else "other"


def normalize_severity(record: Dict[str, Any]) -> str:
    value = clean(
        value_by_paths(
            record,
            [
                "severity",
                "level",
                "priority",
                "risk",
                "threatLevel",
                "threat_level",
                "status.severity",
            ],
        )
    ).lower()

    if any(term in value for term in ["critical", "extreme", "red"]):
        return "critical"
    if any(term in value for term in ["high", "major", "orange"]):
        return "high"
    if any(term in value for term in ["medium", "moderate", "yellow"]):
        return "medium"
    if any(term in value for term in ["low", "minor", "green"]):
        return "low"

    return value or "unknown"


def normalize_source_url(record: Dict[str, Any]) -> str:
    value = value_by_paths(
        record,
        [
            "sourceUrl",
            "source_url",
            "url",
            "link",
            "permalink",
            "source.url",
            "originalUrl",
            "original_url",
            "telegramUrl",
            "telegram_url",
        ],
    )
    text = clean(value)

    if text.startswith(("http://", "https://")):
        return text

    return ""


def stable_id(
    record: Dict[str, Any],
    date_iso: str,
    title: str,
    lat: Optional[float],
    lon: Optional[float],
) -> str:
    original = first_nonempty(
        record.get("id"),
        record.get("_id"),
        record.get("eventId"),
        record.get("event_id"),
        record.get("uuid"),
        record.get("slug"),
    )

    if original:
        return f"iranstrike-{original}"

    seed = (
        f"{date_iso}|{title}|"
        f"{lat if lat is not None else ''}|"
        f"{lon if lon is not None else ''}"
    )

    digest = hashlib.sha1(
        seed.encode("utf-8")
    ).hexdigest()[:18]

    return f"iranstrike-{digest}"


def normalize_event(
    record: Dict[str, Any],
    source_collection: str,
) -> Dict[str, Any]:
    lat, lon = extract_coordinates(record)

    date_iso = parse_datetime(
        value_by_paths(
            record,
            [
                "date",
                "timestamp",
                "time",
                "datetime",
                "createdAt",
                "created_at",
                "publishedAt",
                "published_at",
                "occurredAt",
                "occurred_at",
                "eventTime",
                "event_time",
                "updatedAt",
                "updated_at",
            ],
        )
    )

    title = clean(
        first_nonempty(
            value_by_paths(
                record,
                [
                    "title",
                    "headline",
                    "name",
                    "label",
                    "event",
                    "message",
                ],
            ),
            "IranStrike event",
        )
    )

    description = clean(
        value_by_paths(
            record,
            [
                "description",
                "summary",
                "content",
                "text",
                "details",
                "body",
                "message",
                "analysis",
            ],
        )
    )

    location = clean(
        value_by_paths(
            record,
            [
                "location.name",
                "locationName",
                "location_name",
                "place",
                "city",
                "region",
                "province",
                "governorate",
                "country",
            ],
        )
    )

    country = clean(
        value_by_paths(
            record,
            [
                "country",
                "location.country",
                "countryName",
                "country_name",
            ],
        )
    )

    source_name = clean(
        value_by_paths(
            record,
            [
                "source.name",
                "source",
                "channel",
                "provider",
                "origin",
                "author",
            ],
        )
    )

    event = {
        "id": stable_id(
            record,
            date_iso,
            title,
            lat,
            lon,
        ),
        "source": "IranStrike",
        "source_collection": source_collection,
        "source_name": source_name or "IranStrike",
        "source_url": normalize_source_url(record),
        "date": date_iso,
        "title": title,
        "description": description,
        "category": normalize_category(record),
        "severity": normalize_severity(record),
        "location": location,
        "country": country,
        "latitude": lat,
        "longitude": lon,
        "verified": value_by_paths(
            record,
            [
                "verified",
                "isVerified",
                "is_verified",
            ],
        ),
        "confidence": value_by_paths(
            record,
            [
                "confidence",
                "confidenceScore",
                "confidence_score",
                "score",
            ],
        ),
        "status": clean(
            value_by_paths(
                record,
                [
                    "status",
                    "state",
                    "eventStatus",
                    "event_status",
                ],
            )
        ),
        "raw_source": record,
    }

    return event


def extract_list(
    payload: Any,
    keys: Iterable[str],
) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [
            item for item in payload
            if isinstance(item, dict)
        ]

    if not isinstance(payload, dict):
        return []

    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [
                item for item in value
                if isinstance(item, dict)
            ]

    return []


def deduplicate(
    events: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    output: List[Dict[str, Any]] = []
    seen: set = set()

    for event in events:
        key = event.get("id")

        if not key:
            key = (
                event.get("date"),
                event.get("title"),
                event.get("latitude"),
                event.get("longitude"),
            )

        if key in seen:
            continue

        seen.add(key)
        output.append(event)

    return output


def event_dt(event: Dict[str, Any]) -> Optional[datetime]:
    value = clean(event.get("date"))
    if not value:
        return None

    try:
        parsed = datetime.fromisoformat(
            value.replace("Z", "+00:00")
        )
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def count_rows(counter: Counter, limit: int = 15) -> List[Dict[str, Any]]:
    return [
        {"name": name, "count": count}
        for name, count in counter.most_common(limit)
    ]


def build_analytics(
    events: List[Dict[str, Any]],
) -> Dict[str, Any]:
    dated = [
        event for event in events
        if event_dt(event) is not None
    ]

    if not dated:
        return {
            "status": "no_dated_events",
            "overview": {
                "total_events": len(events),
            },
            "daily_trend": [],
            "category_counts": {},
            "top_locations": [],
            "top_countries": [],
        }

    latest = max(
        event_dt(event)
        for event in dated
        if event_dt(event) is not None
    )
    earliest = min(
        event_dt(event)
        for event in dated
        if event_dt(event) is not None
    )

    category_counter = Counter(
        event.get("category") or "other"
        for event in dated
    )
    location_counter = Counter(
        event.get("location") or "Unknown"
        for event in dated
    )
    country_counter = Counter(
        event.get("country") or "Unknown"
        for event in dated
    )
    severity_counter = Counter(
        event.get("severity") or "unknown"
        for event in dated
    )

    daily_counter: Counter = Counter()

    for event in dated:
        dt = event_dt(event)
        if dt is not None:
            daily_counter[dt.date().isoformat()] += 1

    start = max(
        earliest.date(),
        (latest - timedelta(days=179)).date(),
    )
    current = start
    daily_rows = []

    while current <= latest.date():
        key = current.isoformat()
        daily_rows.append({
            "date": key,
            "count": daily_counter.get(key, 0),
        })
        current += timedelta(days=1)

    def period_count(days: int, offset: int = 0) -> int:
        end = latest - timedelta(days=offset)
        start_dt = end - timedelta(days=days - 1)
        return sum(
            1
            for event in dated
            if (
                event_dt(event) is not None and
                start_dt <= event_dt(event) <= end
            )
        )

    current_7 = period_count(7)
    previous_7 = period_count(7, 7)
    current_30 = period_count(30)
    previous_30 = period_count(30, 30)

    def comparison(current_value: int, previous_value: int) -> Dict[str, Any]:
        delta = current_value - previous_value
        percent = (
            round(delta / previous_value * 100, 1)
            if previous_value
            else None
        )

        if previous_value == 0 and current_value > 0:
            direction = "increase"
        elif percent is not None and percent >= 15:
            direction = "increase"
        elif percent is not None and percent <= -15:
            direction = "decrease"
        else:
            direction = "stable"

        return {
            "current": current_value,
            "previous": previous_value,
            "delta": delta,
            "percent_change": percent,
            "direction": direction,
        }

    geocoded_count = sum(
        1
        for event in events
        if (
            event.get("latitude") is not None and
            event.get("longitude") is not None
        )
    )

    return {
        "status": "ok",
        "overview": {
            "total_events": len(events),
            "earliest_event_date": earliest.isoformat().replace("+00:00", "Z"),
            "latest_event_date": latest.isoformat().replace("+00:00", "Z"),
            "geocoded_events": geocoded_count,
            "geocoded_share": round(
                geocoded_count / max(1, len(events)) * 100,
                1,
            ),
            "top_category": (
                category_counter.most_common(1)[0][0]
                if category_counter
                else "other"
            ),
            "top_location": (
                location_counter.most_common(1)[0][0]
                if location_counter
                else "Unknown"
            ),
            "top_country": (
                country_counter.most_common(1)[0][0]
                if country_counter
                else "Unknown"
            ),
        },
        "comparisons": {
            "latest_7_days": comparison(
                current_7,
                previous_7,
            ),
            "latest_30_days": comparison(
                current_30,
                previous_30,
            ),
        },
        "daily_trend": daily_rows,
        "category_counts": dict(
            category_counter.most_common()
        ),
        "severity_counts": dict(
            severity_counter.most_common()
        ),
        "top_locations": count_rows(
            location_counter
        ),
        "top_countries": count_rows(
            country_counter
        ),
    }


def main() -> int:
    print("Fetching IranStrike endpoints...")

    payloads: Dict[str, Any] = {}

    for name, url in ENDPOINTS.items():
        print(f"- {name}: {url}")
        payloads[name] = fetch_json(url)

    event_records = extract_list(
        payloads["events"],
        ["events", "data", "results"],
    )

    feed_events = extract_list(
        payloads["feed"],
        ["events", "data", "results"],
    )

    developments = extract_list(
        payloads["feed"],
        ["developments", "updates", "spotlight"],
    )

    normalized_events = [
        normalize_event(record, "events")
        for record in event_records
    ]

    normalized_events.extend(
        normalize_event(record, "feed")
        for record in feed_events
    )

    normalized_events = deduplicate(
        normalized_events
    )

    normalized_events.sort(
        key=lambda event: (
            clean(event.get("date")),
            clean(event.get("id")),
        ),
        reverse=True,
    )

    normalized_developments = [
        normalize_event(record, "developments")
        for record in developments
    ]

    output = {
        "generated_at": now_utc(),
        "status": "ok",
        "source": {
            "name": "IranStrike",
            "site": BASE_URL,
            "endpoints": ENDPOINTS,
        },
        "reuse_notice": (
            "Public technical accessibility does not itself grant "
            "republication rights. Review IranStrike terms and source "
            "licences before public redistribution."
        ),
        "endpoint_metadata": {
            name: {
                "top_level_type": type(payload).__name__,
                "top_level_keys": (
                    sorted(payload.keys())
                    if isinstance(payload, dict)
                    else []
                ),
            }
            for name, payload in payloads.items()
        },
        "statistics": {
            "events_endpoint_records": len(event_records),
            "feed_event_records": len(feed_events),
            "normalized_events": len(normalized_events),
            "developments": len(normalized_developments),
        },
        "analytics": build_analytics(
            normalized_events
        ),
        "feed_state": {
            key: value
            for key, value in (
                payloads["feed"].items()
                if isinstance(payloads["feed"], dict)
                else []
            )
            if key not in {
                "events",
                "developments",
            }
        },
        "summary": payloads["summary"],
        "vitals": payloads["vitals"],
        "developments": normalized_developments,
        "events": normalized_events,
    }

    OUTPUT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    OUTPUT_PATH.write_text(
        json.dumps(
            output,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        f"Wrote {len(normalized_events)} events "
        f"to {OUTPUT_PATH}"
    )

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
