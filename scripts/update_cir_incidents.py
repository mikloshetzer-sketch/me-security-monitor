#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

LAYER_URL = (
    "https://services-eu1.arcgis.com/06WOSMGHsCnaFyMp/arcgis/rest/services/"
    "Indigo_Incidents_Layer_view/FeatureServer/0"
)
SOURCE_PAGE = (
    "https://www.info-res.org/israel-gaza-war/maps/"
    "israel-gaza-conflict-map/"
)
OUTPUT_PATH = Path("data/cir-incidents.json")
PAGE_SIZE = 1000
REQUEST_TIMEOUT = 45
MAX_RETRIES = 3
DAILY_TREND_DAYS = 180
WEEKLY_TREND_WEEKS = 104
TOP_LIMIT = 15


def now_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fetch_json(url: str, params: Optional[Dict[str, Any]] = None, timeout: int = REQUEST_TIMEOUT) -> Dict[str, Any]:
    if params:
        query = urllib.parse.urlencode(params, doseq=True)
        url = f"{url}{'&' if '?' in url else '?'}{query}"

    last_error: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "ME-Security-Monitor/1.0 (non-commercial OSINT research)",
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8", errors="replace"))

            if isinstance(payload, dict) and payload.get("error"):
                raise RuntimeError(f"ArcGIS error response: {payload.get('error')}")
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
    return datetime.fromtimestamp(milliseconds / 1000, tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def clean_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def first_nonempty(*values: Any) -> str:
    for value in values:
        text = clean_text(value)
        if text:
            return text
    return ""


def valid_url(value: Any) -> str:
    text = clean_text(value)
    return text if text.startswith(("http://", "https://")) else ""


def collect_links(attributes: Dict[str, Any]) -> List[str]:
    candidates = [attributes.get(f"Link_{i}") for i in range(1, 8)]
    candidates += [attributes.get(f"ip{i}") for i in range(1, 8)]
    candidates.append(attributes.get("Links"))

    links: List[str] = []
    for candidate in candidates:
        text = clean_text(candidate)
        if not text:
            continue
        for part in re.split(r"[\s,;|]+", text):
            url = valid_url(part.strip())
            if url and url not in links:
                links.append(url)
    return links


def normalize_feature(feature: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    attributes = feature.get("attributes") or {}
    geometry = feature.get("geometry") or {}
    if not isinstance(attributes, dict) or not isinstance(geometry, dict):
        return None

    try:
        longitude = float(geometry.get("x"))
        latitude = float(geometry.get("y"))
    except (TypeError, ValueError):
        return None

    event_id = first_nonempty(
        attributes.get("Incident_Number"),
        attributes.get("OBJECTID1"),
        attributes.get("OBJECTID"),
    ) or f"CIR-{latitude:.6f}-{longitude:.6f}"

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
        "date": arcgis_ms_to_iso(attributes.get("Date")),
        "incident_date_text": clean_text(attributes.get("Incident_Date")),
        "location": location,
        "location_zone": clean_text(attributes.get("Location_Zone")),
        "coordinates_text": clean_text(attributes.get("Coordinates")),
        "latitude": latitude,
        "longitude": longitude,
        "main_category": main_category,
        "sub_category": sub_category,
        "category": first_nonempty(attributes.get("Category"), main_category),
        "violence": clean_text(attributes.get("Violence")),
        "description": clean_text(attributes.get("Description")),
        "casualties": casualties,
        "minor_casualties": clean_text(attributes.get("Minor_Casualties")),
        "graphic_warning": clean_text(attributes.get("graphic_warning")),
        "ceasefire_monitoring": clean_text(attributes.get("Ceasefire_Monitoring")),
        "links": collect_links(attributes),
        "object_id": attributes.get("OBJECTID1") or attributes.get("OBJECTID"),
    }


def get_record_count() -> int:
    payload = fetch_json(
        f"{LAYER_URL}/query",
        {"f": "json", "where": "1=1", "returnCountOnly": "true"},
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
            raise RuntimeError(f"Unexpected ArcGIS response at offset {offset}.")
        if not features:
            break

        yield from (feature for feature in features if isinstance(feature, dict))
        offset += len(features)
        print(f"Downloaded {min(offset, total_count)} / {total_count} records")

        if len(features) < PAGE_SIZE:
            break
        time.sleep(0.25)


def deduplicate(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    output = []
    for event in events:
        key = (event.get("id"), event.get("latitude"), event.get("longitude"), event.get("date"))
        if key not in seen:
            seen.add(key)
            output.append(event)
    return output


def parse_event_datetime(event: Dict[str, Any]) -> Optional[datetime]:
    value = clean_text(event.get("date"))
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def event_date(event: Dict[str, Any]) -> Optional[date]:
    parsed = parse_event_datetime(event)
    return parsed.date() if parsed else None


def normalize_label(value: Any, fallback: str = "Unknown") -> str:
    return clean_text(value) or fallback


def category_name(event: Dict[str, Any]) -> str:
    return normalize_label(event.get("main_category") or event.get("category") or event.get("sub_category"))


def location_name(event: Dict[str, Any]) -> str:
    return normalize_label(event.get("location") or event.get("location_zone"))


def zone_name(event: Dict[str, Any]) -> str:
    return normalize_label(event.get("location_zone") or event.get("location"))


def has_casualty_signal(event: Dict[str, Any]) -> bool:
    text = " ".join([
        clean_text(event.get("casualties")),
        clean_text(event.get("minor_casualties")),
    ]).strip().lower()
    return bool(text) and text not in {"0", "none", "no", "false", "n/a", "na", "unknown"}


def is_ceasefire_event(event: Dict[str, Any]) -> bool:
    text = clean_text(event.get("ceasefire_monitoring")).lower()
    return bool(text) and text not in {"0", "none", "no", "false", "n/a", "na"}


def counter_rows(counter: Counter, limit: int = TOP_LIMIT) -> List[Dict[str, Any]]:
    return [{"name": name, "count": count} for name, count in counter.most_common(limit)]


def filter_events_between(events: List[Dict[str, Any]], start_day: date, end_day: date) -> List[Dict[str, Any]]:
    return [
        event for event in events
        if event_date(event) is not None and start_day <= event_date(event) <= end_day
    ]


def period_metrics(events: List[Dict[str, Any]], start_day: date, end_day: date) -> Dict[str, Any]:
    selected = filter_events_between(events, start_day, end_day)
    categories = Counter(category_name(event) for event in selected)
    locations = Counter(location_name(event) for event in selected)
    zones = Counter(zone_name(event) for event in selected)

    return {
        "start_date": start_day.isoformat(),
        "end_date": end_day.isoformat(),
        "days": (end_day - start_day).days + 1,
        "incident_count": len(selected),
        "casualty_related_count": sum(has_casualty_signal(event) for event in selected),
        "ceasefire_monitoring_count": sum(is_ceasefire_event(event) for event in selected),
        "top_category": categories.most_common(1)[0][0] if categories else "Unknown",
        "top_location": locations.most_common(1)[0][0] if locations else "Unknown",
        "category_counts": dict(categories.most_common()),
        "top_locations": counter_rows(locations),
        "top_zones": counter_rows(zones),
    }


def compare_periods(current: Dict[str, Any], previous: Dict[str, Any]) -> Dict[str, Any]:
    current_count = int(current.get("incident_count", 0))
    previous_count = int(previous.get("incident_count", 0))
    delta = current_count - previous_count
    percent_change = round((delta / previous_count) * 100, 1) if previous_count else (None if current_count else 0.0)

    if previous_count == 0 and current_count > 0:
        direction = "increase"
    elif percent_change is None or percent_change >= 15:
        direction = "increase"
    elif percent_change <= -15:
        direction = "decrease"
    else:
        direction = "stable"

    return {
        "current_count": current_count,
        "previous_count": previous_count,
        "absolute_change": delta,
        "percent_change": percent_change,
        "direction": direction,
    }


def build_daily_trend(events: List[Dict[str, Any]], latest_day: date, days: int = DAILY_TREND_DAYS) -> List[Dict[str, Any]]:
    start_day = latest_day - timedelta(days=days - 1)
    counts = Counter(event_date(event) for event in events if event_date(event) is not None)
    rows = []
    current = start_day
    while current <= latest_day:
        rows.append({"date": current.isoformat(), "count": counts.get(current, 0)})
        current += timedelta(days=1)
    return rows


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def build_weekly_trend(events: List[Dict[str, Any]], latest_day: date, weeks: int = WEEKLY_TREND_WEEKS) -> List[Dict[str, Any]]:
    latest_week = week_start(latest_day)
    first_week = latest_week - timedelta(weeks=weeks - 1)
    counts: Counter = Counter()

    for event in events:
        day = event_date(event)
        if day is None:
            continue
        start = week_start(day)
        if first_week <= start <= latest_week:
            counts[start] += 1

    rows = []
    current = first_week
    while current <= latest_week:
        rows.append({"week_start": current.isoformat(), "count": counts.get(current, 0)})
        current += timedelta(weeks=1)
    return rows


def build_category_trend(events: List[Dict[str, Any]], latest_day: date, days: int = 90, top_categories: int = 6) -> Dict[str, Any]:
    start_day = latest_day - timedelta(days=days - 1)
    selected = filter_events_between(events, start_day, latest_day)
    categories = [name for name, _ in Counter(category_name(event) for event in selected).most_common(top_categories)]
    daily: Dict[date, Counter] = defaultdict(Counter)

    for event in selected:
        day = event_date(event)
        category = category_name(event)
        if day is not None and category in categories:
            daily[day][category] += 1

    series = []
    current = start_day
    while current <= latest_day:
        row: Dict[str, Any] = {"date": current.isoformat()}
        for category in categories:
            row[category] = daily[current].get(category, 0)
        series.append(row)
        current += timedelta(days=1)

    return {
        "start_date": start_day.isoformat(),
        "end_date": latest_day.isoformat(),
        "categories": categories,
        "series": series,
    }


def build_hotspots(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    locations = Counter(location_name(event) for event in events)
    zones = Counter(zone_name(event) for event in events)
    bins: Dict[Tuple[float, float], Dict[str, Any]] = {}

    for event in events:
        try:
            lat = float(event.get("latitude"))
            lon = float(event.get("longitude"))
        except (TypeError, ValueError):
            continue

        key = (round(lat, 2), round(lon, 2))
        item = bins.setdefault(
            key,
            {
                "latitude": key[0],
                "longitude": key[1],
                "count": 0,
                "locations": Counter(),
                "categories": Counter(),
            },
        )
        item["count"] += 1
        item["locations"][location_name(event)] += 1
        item["categories"][category_name(event)] += 1

    coordinate_clusters = []
    for item in sorted(bins.values(), key=lambda x: x["count"], reverse=True)[:TOP_LIMIT]:
        coordinate_clusters.append({
            "latitude": item["latitude"],
            "longitude": item["longitude"],
            "count": item["count"],
            "top_location": item["locations"].most_common(1)[0][0] if item["locations"] else "Unknown",
            "top_category": item["categories"].most_common(1)[0][0] if item["categories"] else "Unknown",
        })

    return {
        "top_locations": counter_rows(locations),
        "top_zones": counter_rows(zones),
        "coordinate_clusters": coordinate_clusters,
    }


def percent_text(value: Optional[float]) -> str:
    if value is None:
        return "not calculable"
    return f"{'+' if value > 0 else ''}{value:.1f}%"


def build_assessment(overview: Dict[str, Any], period_7d: Dict[str, Any], previous_7d: Dict[str, Any], comparison_7d: Dict[str, Any], period_30d: Dict[str, Any], hotspots: Dict[str, Any]) -> Dict[str, Any]:
    latest_date = overview.get("latest_event_date", "unknown date")
    direction = comparison_7d.get("direction", "stable")
    change = comparison_7d.get("percent_change")
    current_count = period_7d.get("incident_count", 0)
    previous_count = previous_7d.get("incident_count", 0)
    top_category = period_30d.get("top_category", "Unknown")
    top_location = period_30d.get("top_location", "Unknown")
    casualty_count = period_30d.get("casualty_related_count", 0)
    ceasefire_count = period_30d.get("ceasefire_monitoring_count", 0)

    if direction == "increase":
        trend_sentence = f"Verified incident activity increased in the latest seven-day period. The dataset records {current_count} incidents, compared with {previous_count} in the preceding seven days ({percent_text(change)})."
    elif direction == "decrease":
        trend_sentence = f"Verified incident activity decreased in the latest seven-day period. The dataset records {current_count} incidents, compared with {previous_count} in the preceding seven days ({percent_text(change)})."
    else:
        trend_sentence = f"Verified incident activity remained broadly stable in the latest seven-day period. The dataset records {current_count} incidents, compared with {previous_count} in the preceding seven days ({percent_text(change)})."

    paragraphs = [
        trend_sentence,
        f"Across the latest 30-day analytical window, {top_category} was the most frequently recorded category.",
        f"Recorded activity was most concentrated around {top_location} during the same period.",
        f"The 30-day window contains {casualty_count} incidents with a casualty-related signal and {ceasefire_count} incidents marked for ceasefire monitoring.",
        f"The latest event in the source dataset is dated {latest_date}. This assessment describes the CIR dataset and should not be interpreted as a complete or real-time record of all conflict activity.",
    ]

    return {
        "language": "en",
        "method": "rule_based",
        "headline": f"CIR activity trend: {direction}",
        "summary": " ".join(paragraphs),
        "paragraphs": paragraphs,
        "key_findings": [
            {"label": "Seven-day trend", "value": direction},
            {"label": "Seven-day change", "value": percent_text(change)},
            {"label": "Top 30-day category", "value": top_category},
            {"label": "Top 30-day location", "value": top_location},
            {"label": "Casualty-related incidents", "value": casualty_count},
            {"label": "Ceasefire monitoring incidents", "value": ceasefire_count},
        ],
        "top_hotspots": hotspots.get("top_locations", [])[:5],
    }


def build_analytics(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    dated_events = [event for event in events if event_date(event) is not None]
    if not dated_events:
        return {
            "status": "no_dated_events",
            "overview": {},
            "periods": {},
            "daily_trend": [],
            "weekly_trend": [],
            "category_trend": {},
            "hotspots": {},
            "assessment": {},
        }

    dates = [event_date(event) for event in dated_events]
    earliest_day = min(day for day in dates if day is not None)
    latest_day = max(day for day in dates if day is not None)

    categories = Counter(category_name(event) for event in dated_events)
    locations = Counter(location_name(event) for event in dated_events)

    overview = {
        "total_incidents": len(dated_events),
        "earliest_event_date": earliest_day.isoformat(),
        "latest_event_date": latest_day.isoformat(),
        "coverage_days": (latest_day - earliest_day).days + 1,
        "top_category": categories.most_common(1)[0][0] if categories else "Unknown",
        "top_location": locations.most_common(1)[0][0] if locations else "Unknown",
        "casualty_related_count": sum(has_casualty_signal(event) for event in dated_events),
        "ceasefire_monitoring_count": sum(is_ceasefire_event(event) for event in dated_events),
        "category_counts": dict(categories.most_common()),
    }

    latest_day_metrics = period_metrics(dated_events, latest_day, latest_day)
    latest_7 = period_metrics(dated_events, latest_day - timedelta(days=6), latest_day)
    previous_7 = period_metrics(dated_events, latest_day - timedelta(days=13), latest_day - timedelta(days=7))
    latest_30 = period_metrics(dated_events, latest_day - timedelta(days=29), latest_day)
    previous_30 = period_metrics(dated_events, latest_day - timedelta(days=59), latest_day - timedelta(days=30))
    latest_90 = period_metrics(dated_events, latest_day - timedelta(days=89), latest_day)
    comparison_7 = compare_periods(latest_7, previous_7)
    comparison_30 = compare_periods(latest_30, previous_30)
    hotspots = build_hotspots(dated_events)

    return {
        "status": "ok",
        "reference_basis": "All rolling periods are calculated relative to the latest event date in the CIR dataset, not the current date.",
        "overview": overview,
        "periods": {
            "latest_day": latest_day_metrics,
            "latest_7_days": latest_7,
            "previous_7_days": previous_7,
            "latest_30_days": latest_30,
            "previous_30_days": previous_30,
            "latest_90_days": latest_90,
            "comparison_7_days": comparison_7,
            "comparison_30_days": comparison_30,
        },
        "daily_trend": build_daily_trend(dated_events, latest_day),
        "weekly_trend": build_weekly_trend(dated_events, latest_day),
        "category_trend": build_category_trend(dated_events, latest_day),
        "hotspots": hotspots,
        "assessment": build_assessment(overview, latest_7, previous_7, comparison_7, latest_30, hotspots),
    }


def main() -> int:
    print("Starting CIR incident update...")
    total_count = get_record_count()
    print(f"ArcGIS record count: {total_count}")

    events: List[Dict[str, Any]] = []
    skipped = 0

    for feature in iter_features(total_count):
        event = normalize_feature(feature)
        if event is None:
            skipped += 1
        else:
            events.append(event)

    events = deduplicate(events)
    events.sort(key=lambda event: (clean_text(event.get("date")), clean_text(event.get("id"))), reverse=True)

    category_counts = Counter(
        event.get("main_category") or event.get("category") or "Unknown"
        for event in events
    )
    location_counts = Counter(
        event.get("location_zone") or event.get("location") or "Unknown"
        for event in events
    )
    analytics = build_analytics(events)

    output = {
        "generated_at": now_utc(),
        "status": "ok",
        "source": {
            "name": "Centre for Information Resilience",
            "short_name": "CIR",
            "layer_name": "Indigo_Incidents_Layer",
            "feature_server": LAYER_URL,
            "source_page": SOURCE_PAGE,
        },
        "data_policy": {
            "technical_note": "Downloaded from a publicly queryable ArcGIS FeatureServer.",
            "reuse_note": "Technical accessibility does not itself grant republication rights. Confirm CIR attribution and reuse terms before public redistribution.",
            "analytical_note": "Rolling analytics use the latest event date in the dataset as the reference date.",
        },
        "statistics": {
            "arcgis_record_count": total_count,
            "normalized_event_count": len(events),
            "skipped_feature_count": skipped,
            "category_counts": dict(category_counts.most_common()),
            "location_counts": dict(location_counts.most_common(30)),
        },
        "analytics": analytics,
        "events": events,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

    print("CIR incident update completed.")
    print(f"Normalized events: {len(events)}")
    print(f"Skipped features: {skipped}")
    print(f"Analytics status: {analytics.get('status')}")
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
