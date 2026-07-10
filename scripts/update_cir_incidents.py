#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
CIR / InfoRes incident updater
ME Security Monitor

Downloads the public ArcGIS FeatureServer incident layer used by the
Centre for Information Resilience Israel–Gaza conflict map and converts
it into a compact JSON file for the dashboard.

Input:
  Public ArcGIS FeatureServer:
  https://services-eu1.arcgis.com/06WOSMGHsCnaFyMp/arcgis/rest/services/
  Indigo_Incidents_Layer_view/FeatureServer/0

Output:
  data/cir-incidents.json
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


LAYER_URL = (
    "https://services-eu1.arcgis.com/06WOSMGHsCnaFyMp/arcgis/rest/services/"
    "Indigo_Incidents_Layer_view/FeatureServer/0"
)

OUTPUT_PATH = Path("data/cir-incidents.json")
PAGE_SIZE = 1000
REQUEST_TIMEOUT = 45
MAX_RETRIES = 3


def now_utc() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def fetch_json(
    url: str,
    params: Optional[Dict[str, Any]] = None,
    timeout: int = REQUEST_TIMEOUT,
) -> Dict[str, Any]:
    if params:
        query = urllib.parse.urlencode(params, doseq=True)
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}{query}"

    last_error: Optional[Exception] = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": (
                        "ME-Security-Monitor/1.0 "
                        "(non-commercial OSINT research)"
                    ),
                    "Accept": "application/json",
                },
            )

            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read().decode("utf-8", errors="replace")

            payload = json.loads(raw)

            if isinstance(payload, dict) and payload.get("error"):
                raise RuntimeError(
                    f"ArcGIS error response: {payload.get('error')}"
                )

            if not isinstance(payload, dict):
                raise RuntimeError("Unexpected non-object JSON response.")

            return payload

        except Exception as exc:
            last_error = exc
            if attempt < MAX_RETRIES:
                time.sleep(attempt * 2)

    raise RuntimeError(f"Request failed after {MAX_RETRIES} attempts: {last_error}")


def arcgis_ms_to_iso(value: Any) -> str:
    if value in (None, ""):
        return ""

    try:
        milliseconds = int(value)
    except (TypeError, ValueError):
        return str(value)

    return (
        datetime.fromtimestamp(milliseconds / 1000, tz=timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def first_nonempty(*values: Any) -> str:
    for value in values:
        text = clean_text(value)
        if text:
            return text
    return ""


def valid_url(value: Any) -> str:
    text = clean_text(value)
    if text.startswith("http://") or text.startswith("https://"):
        return text
    return ""


def collect_links(attributes: Dict[str, Any]) -> List[str]:
    candidates: List[Any] = [
        attributes.get("Link_1"),
        attributes.get("Link_2"),
        attributes.get("Link_3"),
        attributes.get("Link_4"),
        attributes.get("Link_5"),
        attributes.get("Link_6"),
        attributes.get("Link_7"),
        attributes.get("ip1"),
        attributes.get("ip2"),
        attributes.get("ip3"),
        attributes.get("ip4"),
        attributes.get("ip5"),
        attributes.get("ip6"),
        attributes.get("ip7"),
        attributes.get("Links"),
    ]

    links: List[str] = []

    for candidate in candidates:
        text = clean_text(candidate)
        if not text:
            continue

        for part in text.replace("\n", " ").split():
            url = valid_url(part.strip(" ,;|"))
            if url and url not in links:
                links.append(url)

    return links


def normalize_feature(feature: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    attributes = feature.get("attributes") or {}
    geometry = feature.get("geometry") or {}

    if not isinstance(attributes, dict) or not isinstance(geometry, dict):
        return None

    longitude = geometry.get("x")
    latitude = geometry.get("y")

    try:
        longitude = float(longitude)
        latitude = float(latitude)
    except (TypeError, ValueError):
        return None

    event_id = first_nonempty(
        attributes.get("Incident_Number"),
        attributes.get("OBJECTID1"),
        attributes.get("OBJECTID"),
    )

    if not event_id:
        event_id = f"CIR-{latitude:.6f}-{longitude:.6f}"

    date_iso = arcgis_ms_to_iso(attributes.get("Date"))
    incident_date = clean_text(attributes.get("Incident_Date"))

    main_category = first_nonempty(
        attributes.get("Main_Category"),
        attributes.get("Main_Category_"),
        attributes.get("Category"),
    )

    sub_category = first_nonempty(
        attributes.get("Sub_Category"),
        attributes.get("Sub_Category_"),
    )

    location = first_nonempty(
        attributes.get("Location"),
        attributes.get("Location_Zone"),
    )

    casualties = first_nonempty(
        attributes.get("Casualties_"),
        attributes.get("Casualties"),
    )

    return {
        "id": str(event_id),
        "source": "CIR",
        "source_name": "Centre for Information Resilience",
        "source_layer": "Indigo_Incidents_Layer",
        "date": date_iso,
        "incident_date_text": incident_date,
        "location": location,
        "location_zone": clean_text(attributes.get("Location_Zone")),
        "coordinates_text": clean_text(attributes.get("Coordinates")),
        "latitude": latitude,
        "longitude": longitude,
        "main_category": main_category,
        "sub_category": sub_category,
        "category": first_nonempty(
            attributes.get("Category"),
            main_category,
        ),
        "violence": clean_text(attributes.get("Violence")),
        "description": clean_text(attributes.get("Description")),
        "casualties": casualties,
        "minor_casualties": clean_text(attributes.get("Minor_Casualties")),
        "graphic_warning": clean_text(attributes.get("graphic_warning")),
        "ceasefire_monitoring": clean_text(
            attributes.get("Ceasefire_Monitoring")
        ),
        "links": collect_links(attributes),
        "object_id": attributes.get("OBJECTID1")
        or attributes.get("OBJECTID"),
    }


def get_record_count() -> int:
    payload = fetch_json(
        f"{LAYER_URL}/query",
        {
            "f": "json",
            "where": "1=1",
            "returnCountOnly": "true",
        },
    )

    count = payload.get("count")

    if not isinstance(count, int):
        raise RuntimeError("ArcGIS did not return a valid record count.")

    return count


def fetch_page(offset: int) -> Dict[str, Any]:
    return fetch_json(
        f"{LAYER_URL}/query",
        {
            "f": "json",
            "where": "1=1",
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": "4326",
            "orderByFields": "OBJECTID1 ASC",
            "resultOffset": str(offset),
            "resultRecordCount": str(PAGE_SIZE),
        },
    )


def iter_features(total_count: int) -> Iterable[Dict[str, Any]]:
    offset = 0

    while offset < total_count:
        payload = fetch_page(offset)
        features = payload.get("features", [])

        if not isinstance(features, list):
            raise RuntimeError(
                f"Unexpected ArcGIS response at offset {offset}: "
                "features is not a list."
            )

        if not features:
            break

        for feature in features:
            if isinstance(feature, dict):
                yield feature

        offset += len(features)
        print(f"Downloaded {min(offset, total_count)} / {total_count} records")

        if len(features) < PAGE_SIZE:
            break

        time.sleep(0.25)


def deduplicate(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    output = []

    for event in events:
        key = (
            event.get("id"),
            event.get("latitude"),
            event.get("longitude"),
            event.get("date"),
        )

        if key in seen:
            continue

        seen.add(key)
        output.append(event)

    return output


def sort_key(event: Dict[str, Any]) -> tuple:
    return (
        clean_text(event.get("date")),
        clean_text(event.get("id")),
    )


def main() -> int:
    print("Starting CIR incident update...")
    print(f"Source: {LAYER_URL}")

    total_count = get_record_count()
    print(f"ArcGIS record count: {total_count}")

    events: List[Dict[str, Any]] = []
    skipped = 0

    for feature in iter_features(total_count):
        event = normalize_feature(feature)

        if event is None:
            skipped += 1
            continue

        events.append(event)

    events = deduplicate(events)
    events.sort(key=sort_key, reverse=True)

    category_counts: Dict[str, int] = {}
    location_counts: Dict[str, int] = {}

    for event in events:
        category = event.get("main_category") or event.get("category") or "Unknown"
        location = event.get("location_zone") or event.get("location") or "Unknown"

        category_counts[category] = category_counts.get(category, 0) + 1
        location_counts[location] = location_counts.get(location, 0) + 1

    output = {
        "generated_at": now_utc(),
        "status": "ok",
        "source": {
            "name": "Centre for Information Resilience",
            "short_name": "CIR",
            "layer_name": "Indigo_Incidents_Layer",
            "feature_server": LAYER_URL,
            "source_page": (
                "https://www.info-res.org/israel-gaza-war/maps/"
                "israel-gaza-conflict-map/"
            ),
        },
        "data_policy": {
            "technical_note": (
                "Downloaded from a publicly queryable ArcGIS FeatureServer."
            ),
            "reuse_note": (
                "Technical accessibility does not itself grant republication "
                "rights. Confirm CIR attribution and reuse terms before public "
                "redistribution."
            ),
        },
        "statistics": {
            "arcgis_record_count": total_count,
            "normalized_event_count": len(events),
            "skipped_feature_count": skipped,
            "category_counts": dict(
                sorted(
                    category_counts.items(),
                    key=lambda item: item[1],
                    reverse=True,
                )
            ),
            "location_counts": dict(
                sorted(
                    location_counts.items(),
                    key=lambda item: item[1],
                    reverse=True,
                )[:30]
            ),
        },
        "events": events,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("CIR incident update completed.")
    print(f"Normalized events: {len(events)}")
    print(f"Skipped features: {skipped}")
    print(f"Output: {OUTPUT_PATH}")

    if not events:
        raise RuntimeError("No CIR incidents were written.")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
