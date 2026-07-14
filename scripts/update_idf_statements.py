#!/usr/bin/env python3
"""
Build the Israel Military Activity dataset from official IDF Telegram posts.

Primary source:
    https://t.me/s/idfofficial

Output:
    data/israel-military-activity.json
    data/israel-military-activity-history.json

Supported regions:
    - Gaza Strip
    - South Lebanon

Supported activity types:
    - airstrike
    - ground_activity
    - artillery
    - cross_border_fire
    - drone_activity
    - evacuation_warning
    - humanitarian_zone

Important:
    These records are official statements by a belligerent party and are
    not treated as independently verified events.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import logging
import re
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_SOURCE_URL = "https://t.me/s/idfofficial"
DEFAULT_OUTPUT = Path("data/israel-military-activity.json")
DEFAULT_HISTORY = Path("data/israel-military-activity-history.json")
DEFAULT_TIMEOUT = 30
DEFAULT_MAX_POSTS = 120
DEFAULT_RETENTION_DAYS = 730

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0 Safari/537.36 "
    "ME-Security-Monitor-IDF-Statements/1.0"
)

SOURCE_CLASSIFICATION = (
    "Official belligerent statement; not independently verified."
)

REGION_GAZA = "Gaza Strip"
REGION_LEBANON = "South Lebanon"

ACTIVITY_TYPES = {
    "airstrike",
    "ground_activity",
    "artillery",
    "cross_border_fire",
    "drone_activity",
    "evacuation_warning",
    "humanitarian_zone",
}

REGION_PATTERNS: dict[str, tuple[str, ...]] = {
    REGION_GAZA: (
        "gaza",
        "gaza strip",
        "rafah",
        "khan younis",
        "khan yunis",
        "jabalia",
        "jabalya",
        "beit hanoun",
        "beit lahia",
        "deir al-balah",
        "deir el-balah",
        "nuseirat",
        "bureij",
        "maghazi",
        "zaytun",
        "zeitoun",
        "shuja",
        "mawasi",
    ),
    REGION_LEBANON: (
        "lebanon",
        "southern lebanon",
        "south lebanon",
        "hezbollah",
        "tyre",
        "sour",
        "nabatieh",
        "bint jbeil",
        "marjayoun",
        "khiam",
        "naqoura",
        "naqqoura",
        "litani",
    ),
}

TYPE_PATTERNS: dict[str, tuple[str, ...]] = {
    "evacuation_warning": (
        "evacuate",
        "evacuation",
        "warning to residents",
        "warning issued",
        "move immediately",
        "must leave",
        "leave the area",
    ),
    "humanitarian_zone": (
        "humanitarian zone",
        "humanitarian area",
        "humanitarian corridor",
        "humanitarian route",
        "humanitarian aid",
        "aid route",
        "safe zone",
    ),
    "airstrike": (
        "airstrike",
        "air strike",
        "fighter jets struck",
        "fighter jet struck",
        "air force struck",
        "aerial strike",
        "struck from the air",
        "aircraft struck",
        "idf struck",
    ),
    "ground_activity": (
        "ground troops",
        "ground forces",
        "ground operation",
        "troops are operating",
        "soldiers are operating",
        "conducted a raid",
        "raided",
        "close-quarters combat",
        "dismantled a tunnel",
        "located a tunnel",
    ),
    "artillery": (
        "artillery fire",
        "artillery strike",
        "artillery strikes",
        "shelling",
        "tank fire",
        "mortar fire",
        "fired artillery",
    ),
    "cross_border_fire": (
        "projectiles were launched",
        "rocket fire",
        "rockets were launched",
        "missiles were launched",
        "anti-tank missile",
        "cross-border fire",
        "launches from lebanon",
        "launched from lebanon",
        "fire from lebanon",
    ),
    "drone_activity": (
        "drone",
        "uav",
        "unmanned aerial vehicle",
        "unmanned aircraft",
        "aerial target",
    ),
}

KNOWN_LOCATIONS: dict[str, dict[str, Any]] = {
    # Gaza Strip
    "gaza city": {
        "name": "Gaza City",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.5017,
        "longitude": 34.4668,
    },
    "khan younis": {
        "name": "Khan Yunis",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.3462,
        "longitude": 34.3030,
    },
    "khan yunis": {
        "name": "Khan Yunis",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.3462,
        "longitude": 34.3030,
    },
    "rafah": {
        "name": "Rafah",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.2969,
        "longitude": 34.2436,
    },
    "jabalia": {
        "name": "Jabalia",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.5280,
        "longitude": 34.4831,
    },
    "jabalya": {
        "name": "Jabalia",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.5280,
        "longitude": 34.4831,
    },
    "beit hanoun": {
        "name": "Beit Hanoun",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.5386,
        "longitude": 34.5365,
    },
    "beit lahia": {
        "name": "Beit Lahia",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.5464,
        "longitude": 34.4951,
    },
    "deir al-balah": {
        "name": "Deir al-Balah",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.4189,
        "longitude": 34.3511,
    },
    "deir el-balah": {
        "name": "Deir al-Balah",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.4189,
        "longitude": 34.3511,
    },
    "nuseirat": {
        "name": "Nuseirat",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.4480,
        "longitude": 34.3925,
    },
    "bureij": {
        "name": "Bureij",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.4394,
        "longitude": 34.4031,
    },
    "maghazi": {
        "name": "Maghazi",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.4210,
        "longitude": 34.3850,
    },
    "zaytun": {
        "name": "Zaytun",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.4864,
        "longitude": 34.4551,
    },
    "zeitoun": {
        "name": "Zaytun",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.4864,
        "longitude": 34.4551,
    },
    "shuja'iyya": {
        "name": "Shuja'iyya",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.5000,
        "longitude": 34.4800,
    },
    "shuja'iya": {
        "name": "Shuja'iyya",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.5000,
        "longitude": 34.4800,
    },
    "al-mawasi": {
        "name": "Al-Mawasi",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.3360,
        "longitude": 34.2510,
    },
    "mawasi": {
        "name": "Al-Mawasi",
        "region": REGION_GAZA,
        "country": "Palestinian Territories",
        "latitude": 31.3360,
        "longitude": 34.2510,
    },

    # South Lebanon
    "tyre": {
        "name": "Tyre",
        "region": REGION_LEBANON,
        "country": "Lebanon",
        "latitude": 33.2705,
        "longitude": 35.2038,
    },
    "sour": {
        "name": "Tyre",
        "region": REGION_LEBANON,
        "country": "Lebanon",
        "latitude": 33.2705,
        "longitude": 35.2038,
    },
    "nabatieh": {
        "name": "Nabatieh",
        "region": REGION_LEBANON,
        "country": "Lebanon",
        "latitude": 33.3772,
        "longitude": 35.4839,
    },
    "bint jbeil": {
        "name": "Bint Jbeil",
        "region": REGION_LEBANON,
        "country": "Lebanon",
        "latitude": 33.1194,
        "longitude": 35.4333,
    },
    "marjayoun": {
        "name": "Marjayoun",
        "region": REGION_LEBANON,
        "country": "Lebanon",
        "latitude": 33.3603,
        "longitude": 35.5911,
    },
    "khiam": {
        "name": "Khiam",
        "region": REGION_LEBANON,
        "country": "Lebanon",
        "latitude": 33.3294,
        "longitude": 35.6114,
    },
    "naqqoura": {
        "name": "Naqoura",
        "region": REGION_LEBANON,
        "country": "Lebanon",
        "latitude": 33.1181,
        "longitude": 35.1397,
    },
    "naqoura": {
        "name": "Naqoura",
        "region": REGION_LEBANON,
        "country": "Lebanon",
        "latitude": 33.1181,
        "longitude": 35.1397,
    },
    "aita al-shaab": {
        "name": "Aita al-Shaab",
        "region": REGION_LEBANON,
        "country": "Lebanon",
        "latitude": 33.0967,
        "longitude": 35.3358,
    },
    "mais al-jabal": {
        "name": "Mais al-Jabal",
        "region": REGION_LEBANON,
        "country": "Lebanon",
        "latitude": 33.1694,
        "longitude": 35.5606,
    },
    "houla": {
        "name": "Houla",
        "region": REGION_LEBANON,
        "country": "Lebanon",
        "latitude": 33.2044,
        "longitude": 35.5186,
    },
    "kafr kila": {
        "name": "Kafr Kila",
        "region": REGION_LEBANON,
        "country": "Lebanon",
        "latitude": 33.2850,
        "longitude": 35.5533,
    },
    "kfar kila": {
        "name": "Kafr Kila",
        "region": REGION_LEBANON,
        "country": "Lebanon",
        "latitude": 33.2850,
        "longitude": 35.5533,
    },
    "odaisseh": {
        "name": "Odaisseh",
        "region": REGION_LEBANON,
        "country": "Lebanon",
        "latitude": 33.2786,
        "longitude": 35.5594,
    },
    "yaroun": {
        "name": "Yaroun",
        "region": REGION_LEBANON,
        "country": "Lebanon",
        "latitude": 33.0786,
        "longitude": 35.4200,
    },
    "ramyah": {
        "name": "Ramyah",
        "region": REGION_LEBANON,
        "country": "Lebanon",
        "latitude": 33.1058,
        "longitude": 35.3067,
    },
    "maroun al-ras": {
        "name": "Maroun al-Ras",
        "region": REGION_LEBANON,
        "country": "Lebanon",
        "latitude": 33.1011,
        "longitude": 35.4458,
    },
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def clean_text(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_text(value: Any) -> str:
    text = clean_text(value).casefold()
    text = text.replace("’", "'").replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", text)


def normalize_datetime(value: Any) -> str:
    text = clean_text(value)
    if not text:
        return ""

    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return (
        parsed.astimezone(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def parse_datetime(value: Any) -> datetime | None:
    text = normalize_datetime(value)
    if not text:
        return None

    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


class TelegramPreviewParser(HTMLParser):
    """Parse Telegram public channel preview HTML."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.posts: list[dict[str, str]] = []
        self._current: dict[str, str] | None = None
        self._capture_text = False
        self._text_depth = 0
        self._text_parts: list[str] = []

    @staticmethod
    def _classes(attrs: dict[str, str]) -> set[str]:
        return set(attrs.get("class", "").split())

    def handle_starttag(
        self,
        tag: str,
        attrs_list: list[tuple[str, str | None]],
    ) -> None:
        attrs = {key: value or "" for key, value in attrs_list}
        classes = self._classes(attrs)

        if tag == "div" and "tgme_widget_message_wrap" in classes:
            self._finalize_current()
            self._current = {
                "post_id": "",
                "source_url": "",
                "date": "",
            }
            self._text_parts = []

        if self._current is None:
            return

        if tag == "div" and "tgme_widget_message" in classes:
            data_post = attrs.get("data-post", "")
            if data_post:
                self._current["post_id"] = data_post
                self._current["source_url"] = f"https://t.me/{data_post}"

        if tag == "div" and "tgme_widget_message_text" in classes:
            self._capture_text = True
            self._text_depth = 1
            return

        if self._capture_text:
            self._text_depth += 1
            if tag in {"br", "p", "div"}:
                self._text_parts.append("\n")

        if tag == "time" and attrs.get("datetime"):
            self._current["date"] = attrs["datetime"]

    def handle_startendtag(
        self,
        tag: str,
        attrs_list: list[tuple[str, str | None]],
    ) -> None:
        if self._capture_text and tag == "br":
            self._text_parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._current is not None and self._capture_text:
            self._text_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self._capture_text:
            self._text_depth -= 1
            if self._text_depth <= 0:
                self._capture_text = False
                self._text_depth = 0

    def close(self) -> None:
        super().close()
        self._finalize_current()

    def _finalize_current(self) -> None:
        if self._current is None:
            return

        text = clean_text(" ".join(self._text_parts))
        post_id = clean_text(self._current.get("post_id"))
        source_url = clean_text(self._current.get("source_url"))
        date = normalize_datetime(self._current.get("date"))

        if post_id and text:
            self.posts.append(
                {
                    "post_id": post_id,
                    "source_url": source_url,
                    "date": date,
                    "text": text,
                }
            )

        self._current = None
        self._text_parts = []
        self._capture_text = False
        self._text_depth = 0


def fetch_text(
    url: str,
    *,
    timeout: int,
    retries: int = 3,
) -> str:
    last_error: Exception | None = None

    for attempt in range(retries + 1):
        request = Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": (
                    "text/html,application/xhtml+xml,"
                    "application/xml;q=0.9,*/*;q=0.6"
                ),
                "Accept-Language": "en-US,en;q=0.9",
                "DNT": "1",
            },
        )

        try:
            with urlopen(request, timeout=timeout) as response:
                charset = response.headers.get_content_charset() or "utf-8"
                return response.read().decode(charset, errors="replace")

        except HTTPError as exc:
            last_error = exc
            if exc.code not in {429, 500, 502, 503, 504}:
                raise

        except (URLError, TimeoutError, OSError) as exc:
            last_error = exc

        if attempt < retries:
            delay = min(60, 5 * (2 ** attempt))
            logging.warning(
                "Source request failed (%s). Retrying in %s seconds.",
                last_error,
                delay,
            )
            time.sleep(delay)

    raise RuntimeError(f"Unable to fetch source: {last_error}")


def load_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logging.warning("Unable to read %s: %s", path, exc)
        return fallback


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")

    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def infer_regions(text: str) -> list[str]:
    normalized = normalize_text(text)
    return [
        region
        for region, patterns in REGION_PATTERNS.items()
        if any(pattern in normalized for pattern in patterns)
    ]


def infer_activity_types(text: str) -> list[str]:
    normalized = normalize_text(text)
    matches: list[tuple[int, str]] = []

    for activity_type, patterns in TYPE_PATTERNS.items():
        positions = [
            normalized.find(pattern)
            for pattern in patterns
            if pattern in normalized
        ]

        if positions:
            matches.append((min(positions), activity_type))

    return [
        activity_type
        for _, activity_type in sorted(matches)
        if activity_type in ACTIVITY_TYPES
    ]


def infer_location(
    text: str,
    regions: list[str],
) -> dict[str, Any] | None:
    normalized = normalize_text(text)
    matches: list[tuple[int, int, dict[str, Any]]] = []

    for alias, location in KNOWN_LOCATIONS.items():
        normalized_alias = normalize_text(alias)
        match = re.search(
            rf"(?<![a-z0-9]){re.escape(normalized_alias)}(?![a-z0-9])",
            normalized,
        )

        if match:
            matches.append(
                (
                    match.start(),
                    -len(normalized_alias),
                    location,
                )
            )

    if not matches:
        return None

    _, _, location = sorted(matches)[0]

    if location["region"] not in regions:
        return None

    return dict(location)


def stable_event_id(post: dict[str, str]) -> str:
    post_id = clean_text(post.get("post_id"))

    if post_id:
        return f"idf-{post_id.replace('/', '-')}"

    digest = hashlib.sha256(
        (
            f"{post.get('date', '')}|"
            f"{post.get('text', '')}"
        ).encode("utf-8")
    ).hexdigest()[:18]

    return f"idf-{digest}"


def build_title(
    activity_types: list[str],
    location: dict[str, Any] | None,
) -> str:
    labels = {
        "airstrike": "IDF airstrike statement",
        "ground_activity": "IDF ground operation statement",
        "artillery": "IDF artillery activity statement",
        "cross_border_fire": "IDF cross-border fire statement",
        "drone_activity": "IDF drone activity statement",
        "evacuation_warning": "IDF evacuation warning",
        "humanitarian_zone": "IDF humanitarian zone update",
    }

    title = labels.get(
        activity_types[0] if activity_types else "",
        "IDF operational statement",
    )

    if location:
        return f"{title} – {location['name']}"

    return title


def normalize_post(
    post: dict[str, str],
) -> dict[str, Any] | None:
    text = clean_text(post.get("text"))
    regions = infer_regions(text)
    activity_types = infer_activity_types(text)

    if not regions or not activity_types:
        return None

    location = infer_location(text, regions)

    return {
        "id": stable_event_id(post),
        "source": "IDF official Telegram",
        "source_name": "IDF",
        "source_type": "official_idf_statement",
        "source_classification": SOURCE_CLASSIFICATION,
        "source_url": clean_text(post.get("source_url")),
        "date": normalize_datetime(post.get("date")),
        "title": build_title(activity_types, location),
        "description": text,
        "actor": "Israel",
        "attacker": "israel",
        "attacker_label": "Israel",
        "verified": False,
        "verification_status": "official_claim_only",
        "regions": regions,
        "region": regions[0],
        "activity_types": activity_types,
        "activity_type": activity_types[0],
        "location": location["name"] if location else "",
        "country": location["country"] if location else "",
        "latitude": location["latitude"] if location else None,
        "longitude": location["longitude"] if location else None,
        "map_visualizable": bool(location),
        "geocode_method": (
            "curated_exact_place_name"
            if location
            else "none"
        ),
        "geocode_confidence": "high" if location else "none",
        "raw_post_id": clean_text(post.get("post_id")),
    }


def merge_events(
    previous: list[dict[str, Any]],
    current: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}

    for event in previous + current:
        event_id = clean_text(event.get("id"))
        if event_id:
            merged[event_id] = event

    return sorted(
        merged.values(),
        key=lambda event: (
            parse_datetime(event.get("date"))
            or datetime.min.replace(tzinfo=timezone.utc)
        ),
        reverse=True,
    )


def prune_events(
    events: list[dict[str, Any]],
    retention_days: int,
) -> list[dict[str, Any]]:
    if retention_days <= 0:
        return events

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    retained: list[dict[str, Any]] = []

    for event in events:
        date = parse_datetime(event.get("date"))

        if date is None or date >= cutoff:
            retained.append(event)

    return retained


def build_analytics(
    events: list[dict[str, Any]],
) -> dict[str, Any]:
    region_counts: Counter[str] = Counter()
    type_counts: Counter[str] = Counter()
    location_counts: Counter[str] = Counter()

    for event in events:
        for region in event.get("regions") or []:
            region_counts[region] += 1

        for activity_type in event.get("activity_types") or []:
            type_counts[activity_type] += 1

        location = clean_text(event.get("location"))
        if location:
            location_counts[location] += 1

    dates = [
        date
        for date in (
            parse_datetime(event.get("date"))
            for event in events
        )
        if date is not None
    ]

    return {
        "overview": {
            "total_events": len(events),
            "map_visualizable_events": sum(
                event.get("map_visualizable") is True
                for event in events
            ),
            "earliest_event_date": (
                min(dates).isoformat().replace("+00:00", "Z")
                if dates
                else None
            ),
            "latest_event_date": (
                max(dates).isoformat().replace("+00:00", "Z")
                if dates
                else None
            ),
        },
        "region_counts": dict(region_counts.most_common()),
        "activity_type_counts": dict(type_counts.most_common()),
        "top_locations": dict(location_counts.most_common(20)),
    }


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build the Israel Military Activity dataset "
            "from official IDF Telegram posts."
        )
    )
    parser.add_argument(
        "--source-url",
        default=DEFAULT_SOURCE_URL,
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
    )
    parser.add_argument(
        "--history",
        type=Path,
        default=DEFAULT_HISTORY,
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT,
    )
    parser.add_argument(
        "--max-posts",
        type=int,
        default=DEFAULT_MAX_POSTS,
    )
    parser.add_argument(
        "--retention-days",
        type=int,
        default=DEFAULT_RETENTION_DAYS,
    )
    parser.add_argument(
        "--input-html",
        type=Path,
        help=(
            "Optional local Telegram HTML file for testing. "
            "When supplied, no network request is made."
        ),
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_arguments()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )

    if args.input_html:
        logging.info("Reading local HTML: %s", args.input_html)
        page_html = args.input_html.read_text(encoding="utf-8")
    else:
        logging.info(
            "Fetching official IDF statements: %s",
            args.source_url,
        )
        page_html = fetch_text(
            args.source_url,
            timeout=args.timeout,
        )

    parser = TelegramPreviewParser()
    parser.feed(page_html)
    parser.close()

    posts = parser.posts[: max(1, args.max_posts)]
    logging.info("Public Telegram posts parsed: %d", len(posts))

    current_events = [
        event
        for event in (
            normalize_post(post)
            for post in posts
        )
        if event is not None
    ]

    logging.info(
        "Accepted Gaza/Lebanon operational statements: %d",
        len(current_events),
    )

    current_payload = load_json(args.output, {})
    current_existing = (
        current_payload.get("events", [])
        if isinstance(current_payload, dict)
        else []
    )

    history_payload = load_json(args.history, {})
    historical_existing = (
        history_payload.get("events", [])
        if isinstance(history_payload, dict)
        else []
    )

    merged = merge_events(
        merge_events(current_existing, historical_existing),
        current_events,
    )
    merged = prune_events(merged, args.retention_days)

    map_events = [
        event
        for event in merged
        if event.get("map_visualizable") is True
    ]

    generated_at = utc_now_iso()

    output_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "source": {
            "name": "Israel Defense Forces official Telegram",
            "url": args.source_url,
            "classification": SOURCE_CLASSIFICATION,
            "independently_verified": False,
        },
        "methodology": {
            "scope": [
                REGION_GAZA,
                REGION_LEBANON,
            ],
            "supported_activity_types": sorted(ACTIVITY_TYPES),
            "geocoding": (
                "Only curated, explicitly named locations receive "
                "coordinates. Regional-only statements remain in events "
                "but are excluded from map_events."
            ),
            "limitations": [
                "Official IDF statements represent a belligerent source.",
                "Absence of a statement does not indicate absence of activity.",
                "One statement may contain multiple regions or activity types.",
                "Coordinates identify the named locality, not the exact strike point.",
            ],
        },
        "analytics": build_analytics(merged),
        "events": merged,
        "map_events": map_events,
    }

    history_output = {
        "schema_version": 1,
        "generated_at": generated_at,
        "source_url": args.source_url,
        "events": merged,
    }

    write_json(args.output, output_payload)
    write_json(args.history, history_output)

    logging.info("Output: %s", args.output)
    logging.info("History: %s", args.history)
    logging.info("Total retained events: %d", len(merged))
    logging.info("Map visualizable events: %d", len(map_events))

    if not posts:
        logging.error(
            "No Telegram posts were parsed. "
            "The public page layout may have changed."
        )
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
