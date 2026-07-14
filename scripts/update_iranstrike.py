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

The dashboard keeps every normalized event. The map may use only records with
map_visualizable=true. Coordinates are accepted only when the source provides a
valid non-zero pair or when an explicit city/object alias matches the whitelist.
The original source record is preserved in raw_source for auditability.
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
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


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


def is_valid_coordinate_pair(
    lat: Optional[float],
    lon: Optional[float],
) -> bool:
    """Return True only for usable geographic coordinates.

    IranStrike currently publishes [0, 0] placeholders. Those values are valid
    numerically but are not real event locations, therefore they must never be
    treated as map coordinates.
    """
    if lat is None or lon is None:
        return False
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return False
    if abs(lat) < 0.000001 and abs(lon) < 0.000001:
        return False
    return True


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

    if is_valid_coordinate_pair(lat, lon):
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
            # GeoJSON and IranStrike arrays are interpreted as [lon, lat].
            candidate_lat = second
            candidate_lon = first
            if is_valid_coordinate_pair(candidate_lat, candidate_lon):
                return candidate_lat, candidate_lon

    return None, None


# Conservative whitelist. Add a place only when its name identifies one clear
# city, installation, island, airport, port or other fixed object in this
# conflict context. Country names and broad regions are intentionally excluded.
GEOCODE_PLACES: Sequence[Dict[str, Any]] = [
    {"name": "Tehran", "country": "Iran", "lat": 35.6892, "lon": 51.3890, "aliases": ["tehran"]},
    {"name": "Isfahan", "country": "Iran", "lat": 32.6546, "lon": 51.6680, "aliases": ["isfahan", "esfahan"]},
    {"name": "Mashhad", "country": "Iran", "lat": 36.2605, "lon": 59.6168, "aliases": ["mashhad"]},
    {"name": "Tabriz", "country": "Iran", "lat": 38.0800, "lon": 46.2919, "aliases": ["tabriz"]},
    {"name": "Shiraz", "country": "Iran", "lat": 29.5918, "lon": 52.5837, "aliases": ["shiraz"]},
    {"name": "Bushehr", "country": "Iran", "lat": 28.9234, "lon": 50.8203, "aliases": ["bushehr", "boushehr"]},
    {"name": "Bandar Abbas", "country": "Iran", "lat": 27.1832, "lon": 56.2666, "aliases": ["bandar abbas"]},
    {"name": "Chabahar", "country": "Iran", "lat": 25.2919, "lon": 60.6430, "aliases": ["chabahar"]},
    {"name": "Ahvaz", "country": "Iran", "lat": 31.3183, "lon": 48.6706, "aliases": ["ahvaz"]},
    {"name": "Kermanshah", "country": "Iran", "lat": 34.3142, "lon": 47.0650, "aliases": ["kermanshah"]},
    {"name": "Natanz nuclear facility", "country": "Iran", "lat": 33.7247, "lon": 51.7275, "aliases": ["natanz nuclear", "natanz facility", "natanz site", "natanz"]},
    {"name": "Fordow nuclear facility", "country": "Iran", "lat": 34.8846, "lon": 50.9950, "aliases": ["fordow nuclear", "fordo nuclear", "fordow facility", "fordo facility", "fordow", "fordo"]},
    {"name": "Arak", "country": "Iran", "lat": 34.0954, "lon": 49.7013, "aliases": ["arak"]},
    {"name": "Qom", "country": "Iran", "lat": 34.6416, "lon": 50.8746, "aliases": ["qom"]},
    {"name": "Karaj", "country": "Iran", "lat": 35.8400, "lon": 50.9391, "aliases": ["karaj"]},
    {"name": "Rasht", "country": "Iran", "lat": 37.2808, "lon": 49.5832, "aliases": ["rasht"]},
    {"name": "Zahedan", "country": "Iran", "lat": 29.4963, "lon": 60.8629, "aliases": ["zahedan"]},
    {"name": "Kerman", "country": "Iran", "lat": 30.2839, "lon": 57.0834, "aliases": ["kerman"]},
    {"name": "Yazd", "country": "Iran", "lat": 31.8974, "lon": 54.3569, "aliases": ["yazd"]},
    {"name": "Semnan", "country": "Iran", "lat": 35.5769, "lon": 53.3921, "aliases": ["semnan"]},
    {"name": "Khorramabad", "country": "Iran", "lat": 33.4878, "lon": 48.3558, "aliases": ["khorramabad"]},
    {"name": "Dezful", "country": "Iran", "lat": 32.3831, "lon": 48.4236, "aliases": ["dezful"]},
    {"name": "Abadan", "country": "Iran", "lat": 30.3473, "lon": 48.2934, "aliases": ["abadan"]},
    {"name": "Kharg Island", "country": "Iran", "lat": 29.2447, "lon": 50.3129, "aliases": ["kharg island", "khark island"]},
    {"name": "Beirut", "country": "Lebanon", "lat": 33.8938, "lon": 35.5018, "aliases": ["beirut"]},
    {"name": "Tyre", "country": "Lebanon", "lat": 33.2705, "lon": 35.2038, "aliases": ["tyre, lebanon", "tyre city", "sur, lebanon"]},
    {"name": "Sidon", "country": "Lebanon", "lat": 33.5606, "lon": 35.3758, "aliases": ["sidon", "saida"]},
    {"name": "Nabatieh", "country": "Lebanon", "lat": 33.3772, "lon": 35.4838, "aliases": ["nabatieh", "nabatiyeh"]},
    {"name": "Naqoura", "country": "Lebanon", "lat": 33.1181, "lon": 35.1396, "aliases": ["naqoura", "naquora"]},
    {"name": "Damascus", "country": "Syria", "lat": 33.5138, "lon": 36.2765, "aliases": ["damascus"]},
    {"name": "Aleppo", "country": "Syria", "lat": 36.2021, "lon": 37.1343, "aliases": ["aleppo"]},
    {"name": "Homs", "country": "Syria", "lat": 34.7324, "lon": 36.7137, "aliases": ["homs"]},
    {"name": "Latakia", "country": "Syria", "lat": 35.5317, "lon": 35.7901, "aliases": ["latakia"]},
    {"name": "Baghdad", "country": "Iraq", "lat": 33.3152, "lon": 44.3661, "aliases": ["baghdad"]},
    {"name": "Erbil", "country": "Iraq", "lat": 36.1911, "lon": 44.0092, "aliases": ["erbil", "arbil"]},
    {"name": "Basra", "country": "Iraq", "lat": 30.5085, "lon": 47.7804, "aliases": ["basra", "basrah"]},
    {"name": "Amman", "country": "Jordan", "lat": 31.9539, "lon": 35.9106, "aliases": ["amman"]},
    {"name": "Aqaba", "country": "Jordan", "lat": 29.5321, "lon": 35.0063, "aliases": ["aqaba"]},
    {"name": "Tel Aviv", "country": "Israel", "lat": 32.0853, "lon": 34.7818, "aliases": ["tel aviv", "tel-aviv"]},
    {"name": "Haifa", "country": "Israel", "lat": 32.7940, "lon": 34.9896, "aliases": ["haifa"]},
    {"name": "Jerusalem", "country": "Israel", "lat": 31.7683, "lon": 35.2137, "aliases": ["jerusalem"]},
    {"name": "Eilat", "country": "Israel", "lat": 29.5577, "lon": 34.9519, "aliases": ["eilat"]},
    {"name": "Gaza City", "country": "Palestinian territories", "lat": 31.5017, "lon": 34.4668, "aliases": ["gaza city"]},
    {"name": "Rafah", "country": "Palestinian territories", "lat": 31.2969, "lon": 34.2435, "aliases": ["rafah"]},
    {"name": "Khan Younis", "country": "Palestinian territories", "lat": 31.3462, "lon": 34.3063, "aliases": ["khan younis", "khan yunis"]},
    {"name": "Nuseirat", "country": "Palestinian territories", "lat": 31.4470, "lon": 34.3925, "aliases": ["nuseirat", "nusairat"]},
]


IRAN_LOCATION_ALIASES = [
    (place["name"], place["aliases"])
    for place in GEOCODE_PLACES
    if place["country"] == "Iran"
]

REGIONAL_LOCATION_ALIASES = [
    ("Gaza Strip", ["gaza strip"]),
    ("Lebanon", ["lebanon"]),
    ("Syria", ["syria"]),
    ("Jordan", ["jordan"]),
    ("Iraq", ["iraq"]),
    ("Israel", ["israel"]),
    ("Persian Gulf", ["persian gulf", "strait of hormuz", "hormuz"]),
    ("Red Sea", ["red sea", "bab el-mandeb", "bab al-mandab"]),
]


def recursive_text_values(value: Any, depth: int = 0) -> List[str]:
    if depth > 4:
        return []

    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []

    if isinstance(value, dict):
        output: List[str] = []
        for key, item in value.items():
            key_lower = str(key).lower()
            if any(token in key_lower for token in [
                "location", "place", "city", "region", "province",
                "governorate", "area", "target", "site", "country",
                "title", "summary", "description", "text", "message",
            ]):
                output.extend(recursive_text_values(item, depth + 1))
        return output

    if isinstance(value, list):
        output: List[str] = []
        for item in value[:30]:
            output.extend(recursive_text_values(item, depth + 1))
        return output

    return []


def normalized_search_text(record: Dict[str, Any]) -> str:
    values = recursive_text_values(record)
    return " ".join(values).lower()


def alias_matches(text: str, alias: str) -> bool:
    """Match complete aliases, avoiding accidental substring hits."""
    pattern = r"(?<![a-z0-9])" + re.escape(alias.lower()) + r"(?![a-z0-9])"
    return re.search(pattern, text) is not None


def geocode_from_text(
    record: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    text = normalized_search_text(record)
    if not text:
        return None

    matches: List[Tuple[int, Dict[str, Any], str]] = []
    for place in GEOCODE_PLACES:
        for alias in place["aliases"]:
            if alias_matches(text, alias):
                # Prefer the most specific/longest matching alias.
                matches.append((len(alias), place, alias))

    if not matches:
        return None

    matches.sort(key=lambda item: item[0], reverse=True)
    _, place, matched_alias = matches[0]
    return {
        "location": place["name"],
        "country": place["country"],
        "latitude": float(place["lat"]),
        "longitude": float(place["lon"]),
        "geocode_method": "whitelist_text_match",
        "geocode_match": matched_alias,
        "geocode_confidence": "high",
    }


def infer_location_from_text(record: Dict[str, Any]) -> Tuple[str, str]:
    """Infer display labels without automatically making an event mappable."""
    text = normalized_search_text(record)

    geocoded = geocode_from_text(record)
    if geocoded:
        return geocoded["location"], geocoded["country"]

    for location, aliases in REGIONAL_LOCATION_ALIASES:
        if any(alias_matches(text, alias) for alias in aliases):
            if location in {"Persian Gulf", "Red Sea"}:
                return location, location
            return location, location

    if any(alias_matches(text, token) for token in ["iran", "iranian", "irgc"]):
        return "Iran", "Iran"

    return "", ""


def infer_country_from_coordinates(
    lat: Optional[float],
    lon: Optional[float],
) -> str:
    if not is_valid_coordinate_pair(lat, lon):
        return ""

    # Broad regional bounding boxes. These are intentionally conservative
    # and are only used when the API supplies real coordinates but no country.
    boxes = [
        ("Iran", 24.0, 40.2, 43.0, 63.5),
        ("Iraq", 28.5, 37.5, 38.5, 49.0),
        ("Syria", 32.0, 37.5, 35.5, 42.5),
        ("Jordan", 29.0, 33.6, 34.7, 39.4),
        ("Israel", 29.0, 33.5, 34.0, 36.0),
        ("Lebanon", 33.0, 34.8, 35.0, 36.8),
        ("Saudi Arabia", 16.0, 32.5, 34.0, 56.0),
        ("United Arab Emirates", 22.4, 26.5, 51.0, 56.5),
        ("Qatar", 24.3, 26.3, 50.5, 52.0),
        ("Bahrain", 25.5, 26.5, 50.2, 50.9),
        ("Kuwait", 28.4, 30.2, 46.4, 48.7),
        ("Oman", 16.5, 26.5, 51.8, 60.2),
        ("Yemen", 12.0, 19.5, 42.0, 54.8),
    ]

    for country, min_lat, max_lat, min_lon, max_lon in boxes:
        if min_lat <= lat <= max_lat and min_lon <= lon <= max_lon:
            return country

    return ""



ATTACKER_METADATA = {
    "usa": {
        "label": "United States",
        "color": "#2563eb",
    },
    "iran": {
        "label": "Iran",
        "color": "#16a34a",
    },
    "israel": {
        "label": "Israel",
        "color": "#dc2626",
    },
    "other": {
        "label": "Other actor",
        "color": "#7c3aed",
    },
    "unknown": {
        "label": "Unknown actor",
        "color": "#64748b",
    },
}

ATTACKER_STRUCTURED_PATHS = [
    "attacker",
    "actor",
    "responsibleActor",
    "responsible_actor",
    "perpetrator",
    "launchedBy",
    "launched_by",
    "firedBy",
    "fired_by",
    "originActor",
    "origin_actor",
    "military",
    "forces",
]

ATTACKER_ALIASES = {
    "usa": [
        "united states",
        "u.s.",
        "u.s",
        "us forces",
        "us military",
        "american forces",
        "american military",
        "centcom",
        "u.s. central command",
    ],
    "iran": [
        "iran",
        "iranian",
        "irgc",
        "islamic revolutionary guard corps",
        "revolutionary guards",
        "iranian armed forces",
    ],
    "israel": [
        "israel",
        "israeli",
        "idf",
        "israel defense forces",
        "israeli defense forces",
        "iaf",
        "israeli air force",
    ],
}

ATTACK_ACTION_TERMS = [
    "attack",
    "attacked",
    "attacking",
    "strike",
    "strikes",
    "struck",
    "airstrike",
    "airstrikes",
    "bomb",
    "bombed",
    "bombing",
    "launch",
    "launched",
    "launches",
    "fire",
    "fired",
    "fires",
    "target",
    "targeted",
    "targets",
    "hit",
    "hits",
    "raid",
    "raided",
    "conducted",
    "carried out",
    "intercepted",
    "destroyed",
]

NON_EXECUTED_TERMS = [
    "threat",
    "threatens",
    "threatened",
    "warning",
    "warns",
    "warned",
    "may attack",
    "might attack",
    "could attack",
    "would attack",
    "plans to attack",
    "plan to attack",
    "preparing to attack",
    "ready to attack",
    "vows to attack",
    "promises to attack",
    "calls for an attack",
    "reports claim",
    "allegedly",
    "unconfirmed",
]

PASSIVE_PATTERNS = {
    "usa": [
        r"\b(?:strike|attack|airstrike|bombing|raid)s?\s+(?:carried out|conducted|launched)?\s*by\s+(?:the\s+)?(?:u\.?s\.?|united states|american|centcom)\b",
        r"\b(?:missiles?|drones?|aircraft)\s+(?:were\s+)?(?:launched|fired|sent)\s+by\s+(?:the\s+)?(?:u\.?s\.?|united states|american forces|centcom)\b",
        r"\b(?:launched|fired)\s+from\s+(?:a\s+)?u\.?s\.?\s+(?:base|ship|aircraft|position)\b",
    ],
    "iran": [
        r"\b(?:strike|attack|airstrike|bombing|raid)s?\s+(?:carried out|conducted|launched)?\s*by\s+(?:the\s+)?(?:iran|iranian|irgc)\b",
        r"\b(?:missiles?|rockets?|drones?|uavs?)\s+(?:were\s+)?(?:launched|fired|sent)\s+(?:by|from)\s+(?:the\s+)?(?:iran|iranian|irgc)\b",
        r"\b(?:launched|fired)\s+from\s+iran\b",
        r"\biran-origin(?:ated)?\s+(?:missile|drone|attack|strike)s?\b",
    ],
    "israel": [
        r"\b(?:strike|attack|airstrike|bombing|raid)s?\s+(?:carried out|conducted|launched)?\s*by\s+(?:the\s+)?(?:israel|israeli|idf|iaf)\b",
        r"\b(?:missiles?|drones?|aircraft)\s+(?:were\s+)?(?:launched|fired|sent)\s+by\s+(?:the\s+)?(?:israel|israeli|idf|iaf)\b",
        r"\b(?:launched|fired)\s+from\s+israel\b",
        r"\bisraeli-origin(?:ated)?\s+(?:missile|drone|attack|strike)s?\b",
    ],
}


def normalize_actor_name(value: Any) -> str:
    text = clean(value).lower()
    if not text:
        return ""

    for actor, aliases in ATTACKER_ALIASES.items():
        if any(alias_matches(text, alias) for alias in aliases):
            return actor

    return ""


def attacker_sentences(record: Dict[str, Any]) -> List[str]:
    values = recursive_text_values(record)
    joined = " ".join(values)
    return [
        sentence.strip().lower()
        for sentence in re.split(r"(?<=[.!?;])\s+|\n+", joined)
        if sentence.strip()
    ]


def sentence_is_non_executed(sentence: str) -> bool:
    return any(term in sentence for term in NON_EXECUTED_TERMS)


def active_actor_score(sentence: str, actor: str) -> Tuple[int, str]:
    aliases = ATTACKER_ALIASES[actor]
    best_score = 0
    best_evidence = ""

    for alias in aliases:
        for actor_match in re.finditer(
            rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])",
            sentence,
        ):
            actor_start = actor_match.start()
            actor_end = actor_match.end()

            for action in ATTACK_ACTION_TERMS:
                for action_match in re.finditer(
                    rf"(?<![a-z0-9]){re.escape(action)}(?![a-z0-9])",
                    sentence,
                ):
                    # The actor should normally precede the action. A short
                    # reverse distance is accepted for forms such as
                    # "strikes by Israel".
                    forward_distance = action_match.start() - actor_end
                    reverse_distance = actor_start - action_match.end()

                    if 0 <= forward_distance <= 70:
                        score = 5 if forward_distance <= 35 else 4
                    elif 0 <= reverse_distance <= 35:
                        score = 3
                    else:
                        continue

                    if sentence_is_non_executed(sentence):
                        score -= 3

                    if score > best_score:
                        best_score = score
                        start = max(0, min(actor_start, action_match.start()) - 30)
                        end = min(
                            len(sentence),
                            max(actor_end, action_match.end()) + 50,
                        )
                        best_evidence = sentence[start:end].strip()

    return best_score, best_evidence


def infer_attacker(record: Dict[str, Any]) -> Dict[str, str]:
    structured = value_by_paths(record, ATTACKER_STRUCTURED_PATHS)
    structured_actor = normalize_actor_name(structured)

    if structured_actor:
        metadata = ATTACKER_METADATA[structured_actor]
        return {
            "attacker": structured_actor,
            "attacker_label": metadata["label"],
            "attacker_color": metadata["color"],
            "attacker_confidence": "high",
            "attacker_method": "structured_actor_field",
            "attacker_evidence": clean(structured),
        }

    scores: Counter = Counter()
    evidence: Dict[str, str] = {}
    methods: Dict[str, str] = {}

    for sentence in attacker_sentences(record):
        for actor, patterns in PASSIVE_PATTERNS.items():
            for pattern in patterns:
                match = re.search(pattern, sentence, flags=re.IGNORECASE)
                if match:
                    score = 5
                    if sentence_is_non_executed(sentence):
                        score -= 3
                    if score > scores[actor]:
                        scores[actor] = score
                        evidence[actor] = match.group(0)
                        methods[actor] = "passive_attack_pattern"

        for actor in ATTACKER_ALIASES:
            score, actor_evidence = active_actor_score(sentence, actor)
            if score > scores[actor]:
                scores[actor] = score
                evidence[actor] = actor_evidence
                methods[actor] = "actor_action_proximity"

    if not scores:
        metadata = ATTACKER_METADATA["unknown"]
        return {
            "attacker": "unknown",
            "attacker_label": metadata["label"],
            "attacker_color": metadata["color"],
            "attacker_confidence": "none",
            "attacker_method": "none",
            "attacker_evidence": "",
        }

    ranked = scores.most_common()
    best_actor, best_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else 0

    # Conflicting actor signals remain unknown unless one actor is clearly
    # stronger. This protects reports describing retaliation by both sides.
    if best_score < 3 or best_score - second_score < 2:
        metadata = ATTACKER_METADATA["unknown"]
        return {
            "attacker": "unknown",
            "attacker_label": metadata["label"],
            "attacker_color": metadata["color"],
            "attacker_confidence": "low",
            "attacker_method": "conflicting_or_weak_signal",
            "attacker_evidence": "",
        }

    confidence = "high" if best_score >= 5 else "medium"
    metadata = ATTACKER_METADATA[best_actor]

    return {
        "attacker": best_actor,
        "attacker_label": metadata["label"],
        "attacker_color": metadata["color"],
        "attacker_confidence": confidence,
        "attacker_method": methods.get(best_actor, "text_pattern"),
        "attacker_evidence": evidence.get(best_actor, ""),
    }



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
    source_lat, source_lon = extract_coordinates(record)
    text_geocode = geocode_from_text(record)

    if is_valid_coordinate_pair(source_lat, source_lon):
        lat, lon = source_lat, source_lon
        map_visualizable = True
        geocode_method = "source_coordinates"
        geocode_match = ""
        geocode_confidence = "source"
    elif text_geocode:
        lat = text_geocode["latitude"]
        lon = text_geocode["longitude"]
        map_visualizable = True
        geocode_method = text_geocode["geocode_method"]
        geocode_match = text_geocode["geocode_match"]
        geocode_confidence = text_geocode["geocode_confidence"]
    else:
        lat, lon = None, None
        map_visualizable = False
        geocode_method = "none"
        geocode_match = ""
        geocode_confidence = "none"

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
                "location.label",
                "location.city",
                "location.region",
                "location.province",
                "locationName",
                "location_name",
                "place",
                "city",
                "region",
                "province",
                "governorate",
                "area",
                "target",
                "targetName",
                "target_name",
                "site",
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
                "location.countryName",
                "countryName",
                "country_name",
            ],
        )
    )

    inferred_location, inferred_country = infer_location_from_text(record)

    if text_geocode:
        # A high-confidence whitelist match is more useful than source values
        # such as IRN, ISR or other country-level placeholders.
        location = text_geocode["location"]
        country = text_geocode["country"]
    else:
        if not location:
            location = inferred_location
        if not country:
            country = inferred_country

    if not country:
        country = infer_country_from_coordinates(lat, lon)

    if not location and country:
        location = country

    attacker_data = infer_attacker(record)

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
        "attacker": attacker_data["attacker"],
        "attacker_label": attacker_data["attacker_label"],
        "attacker_color": attacker_data["attacker_color"],
        "attacker_confidence": attacker_data["attacker_confidence"],
        "attacker_method": attacker_data["attacker_method"],
        "attacker_evidence": attacker_data["attacker_evidence"],
        "location": location,
        "country": country,
        "latitude": lat,
        "longitude": lon,
        "map_visualizable": map_visualizable,
        "geocode_method": geocode_method,
        "geocode_match": geocode_match,
        "geocode_confidence": geocode_confidence,
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
    attacker_counter = Counter(
        event.get("attacker") or "unknown"
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
        if event.get("map_visualizable") is True
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
        "attacker_counts": dict(
            attacker_counter.most_common()
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

    map_events = [
        event for event in normalized_events
        if event.get("map_visualizable") is True
    ]

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
            "map_visualizable_events": len(map_events),
            "non_mappable_events": len(normalized_events) - len(map_events),
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
        # Dashboard source: every normalized event.
        "events": normalized_events,
        # Map source: only high-confidence, explicitly mappable events.
        "map_events": map_events,
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
        f"Wrote {len(normalized_events)} dashboard events and "
        f"{len(map_events)} map events to {OUTPUT_PATH}"
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
