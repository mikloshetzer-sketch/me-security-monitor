import json
import re
import hashlib
from datetime import datetime, timezone, timedelta

import feedparser
from bs4 import BeautifulSoup
from dateutil import parser as dtparser


# -------- CONFIG --------
OUT_PATH = "events.json"

FEEDS = [
    {
        "name": "BBC",
        "type": "news",
        "url": "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml",
    },
    {
        "name": "Reuters (via Google News)",
        "type": "news",
        "url": "https://news.google.com/rss/search?q=site%3Areuters.com%20(middle%20east%20OR%20Israel%20OR%20Gaza%20OR%20Lebanon%20OR%20Syria%20OR%20Iraq%20OR%20Iran%20OR%20Yemen)&hl=en-US&gl=US&ceid=US:en",
    },
    {
        "name": "Al Jazeera (via Google News)",
        "type": "news",
        "url": "https://news.google.com/rss/search?q=site%3Aaljazeera.com%20(middle%20east%20OR%20Israel%20OR%20Gaza%20OR%20Lebanon%20OR%20Syria%20OR%20Iraq%20OR%20Iran%20OR%20Yemen)&hl=en-US&gl=US&ceid=US:en",
    },
]

# Middle East filter list (broad, practical)
ME_KEYWORDS = [
    "israel", "gaza", "west bank", "palestine", "jerusalem",
    "lebanon", "beirut",
    "syria", "damascus",
    "iraq", "baghdad",
    "iran", "tehran",
    "yemen", "sana'a", "sanaa",
    "jordan", "amman",
    "egypt", "cairo",
    "saudi", "riyadh",
    "uae", "united arab emirates", "dubai", "abu dhabi",
    "qatar", "doha",
    "kuwait",
    "bahrain",
    "oman", "muscat",
    "turkey", "ankara", "istanbul",
    "middle east"
]

# very lightweight location lookup
PLACE_COORDS = [
    ("gaza", ("Gaza Strip", 31.5, 34.47)),
    ("west bank", ("West Bank", 31.9, 35.2)),
    ("jerusalem", ("Jerusalem", 31.7683, 35.2137)),
    ("israel", ("Israel", 31.0461, 34.8516)),

    ("beirut", ("Beirut", 33.8938, 35.5018)),
    ("lebanon", ("Lebanon", 33.8547, 35.8623)),

    ("damascus", ("Damascus", 33.5138, 36.2765)),
    ("syria", ("Syria", 34.8021, 38.9968)),

    ("baghdad", ("Baghdad", 33.3152, 44.3661)),
    ("iraq", ("Iraq", 33.2232, 43.6793)),

    ("tehran", ("Tehran", 35.6892, 51.3890)),
    ("iran", ("Iran", 32.4279, 53.6880)),

    ("sanaa", ("Sana'a", 15.3694, 44.1910)),
    ("sana'a", ("Sana'a", 15.3694, 44.1910)),
    ("yemen", ("Yemen", 15.5527, 48.5164)),

    ("amman", ("Amman", 31.9539, 35.9106)),
    ("jordan", ("Jordan", 30.5852, 36.2384)),

    ("cairo", ("Cairo", 30.0444, 31.2357)),
    ("egypt", ("Egypt", 26.8206, 30.8025)),

    ("riyadh", ("Riyadh", 24.7136, 46.6753)),
    ("saudi", ("Saudi Arabia", 23.8859, 45.0792)),

    ("abu dhabi", ("Abu Dhabi", 24.4539, 54.3773)),
    ("dubai", ("Dubai", 25.2048, 55.2708)),
    ("uae", ("United Arab Emirates", 23.4241, 53.8478)),
    ("united arab emirates", ("United Arab Emirates", 23.4241, 53.8478)),

    ("doha", ("Doha", 25.2854, 51.5310)),
    ("qatar", ("Qatar", 25.3548, 51.1839)),

    ("kuwait", ("Kuwait", 29.3117, 47.4818)),
    ("bahrain", ("Bahrain", 26.0667, 50.5577)),
    ("oman", ("Oman", 21.4735, 55.9754)),
    ("muscat", ("Muscat", 23.5880, 58.3829)),

    ("istanbul", ("Istanbul", 41.0082, 28.9784)),
    ("ankara", ("Ankara", 39.9334, 32.8597)),
    ("turkey", ("Turkey", 38.9637, 35.2433)),
]

REGION_FALLBACK = ("Middle East", 33.5, 44.0)

MILITARY_KW = ["strike", "airstrike", "attack", "drone", "missile", "rocket", "shell", "bomb", "raid", "killed", "clash", "incursion"]
POLITICAL_KW = ["election", "parliament", "government", "minister", "president", "talks", "deal", "ceasefire", "negotiation", "vote", "cabinet"]
SECURITY_KW  = ["police", "security", "arrest", "court", "terror", "militant", "border", "checkpoint", "raid", "hostage"]


# -------- HELPERS --------
def strip_html(text: str) -> str:
    if not text:
        return ""
    soup = BeautifulSoup(text, "html.parser")
    return re.sub(r"\s+", " ", soup.get_text(" ", strip=True)).strip()

def safe_date(entry) -> datetime | None:
    for key in ("published", "updated", "created"):
        val = getattr(entry, key, None)
        if not val:
            continue
        try:
            dt = dtparser.parse(val)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            pass
    return None

def normalize_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip().lower()

def is_middle_east_related(title: str, summary: str) -> bool:
    t = normalize_text(f"{title} {summary}")
    return any(k in t for k in ME_KEYWORDS)

def pick_location(title: str, summary: str):
    t = normalize_text(f"{title} {summary}")
    for needle, (name, lat, lng) in PLACE_COORDS:
        if needle in t:
            return {"name": name, "lat": lat, "lng": lng}
    name, lat, lng = REGION_FALLBACK
    return {"name": name, "lat": lat, "lng": lng}

def pick_category(title: str, summary: str) -> str:
    t = normalize_text(f"{title} {summary}")
    if any(k in t for k in MILITARY_KW):
        return "military"
    if any(k in t for k in SECURITY_KW):
        return "security"
    if any(k in t for k in POLITICAL_KW):
        return "political"
    return "other"

def extract_tags(title: str, summary: str, loc_name: str) -> list[str]:
    """Very light tags: location name + a few keywords found."""
    t = normalize_text(f"{title} {summary}")
    tags = []

    if loc_name and loc_name != "Middle East":
        tags.append(loc_name)

    # simple keyword tags (extend later)
    for kw in ["ceasefire", "hostage", "airstrike", "drone", "missile", "election", "talks", "sanctions", "protest"]:
        if kw in t:
            tags.append(kw)

    # de-dup, keep order
    out = []
    seen = set()
    for x in tags:
        x = x.strip()
        if not x:
            continue
        if x.lower() in seen:
            continue
        seen.add(x.lower())
        out.append(x)
    return out[:10]

def make_id(url: str, title: str, date_ymd: str) -> str:
    base = (url or "") + "|" + (title or "") + "|" + (date_ymd or "")
    h = hashlib.sha1(base.encode("utf-8")).hexdigest()[:12]
    return f"{date_ymd}-{h}"

def clean_google_news_link(link: str) -> str:
    """
    Google News RSS often points to news.google.com/articles/...
    Keep as-is for now (still opens), but you can later resolve to the real publisher link.
    """
    return (link or "").strip()


def main():
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=365)

    collected = []

    for f in FEEDS:
        feed = feedparser.parse(f["url"])
        for e in feed.entries:
            dt = safe_date(e)
            if not dt or dt < cutoff:
                continue

            date_ymd = dt.strftime("%Y-%m-%d")
            title = (getattr(e, "title", "") or "").strip()
            link = clean_google_news_link(getattr(e, "link", "") or "")

            summary_raw = getattr(e, "summary", "") or getattr(e, "description", "")
            summary = strip_html(summary_raw)
            if len(summary) > 320:
                summary = summary[:317].rstrip() + "..."

            if not title or not link:
                continue

            # Middle East relevance filter
            if not is_middle_east_related(title, summary):
                continue

            loc = pick_location(title, summary)
            cat = pick_category(title, summary)

            ev = {
                "id": make_id(link, title, date_ymd),
                "date": date_ymd,
                "title": title,
                "summary": summary,
                "category": cat,
                "tags": extract_tags(title, summary, loc["name"]),
                "confidence": 0.55,
                "source": {
                    "name": f["name"],
                    "type": f["type"],
                    "url": link
                },
                "location": loc
            }

            collected.append(ev)

    # ---- De-dup ----
    # 1) by source url (best)
    # 2) fallback by title+date (common duplicates)
    by_url = {}
    for ev in sorted(collected, key=lambda x: x["date"], reverse=True):
        url = ev["source"]["url"]
        if url and url not in by_url:
            by_url[url] = ev

    # also dedup by title/date
    by_title_date = {}
    for ev in by_url.values():
        key = (ev["date"], normalize_text(ev["title"]))
        by_title_date.setdefault(key, ev)

    final_events = list(by_title_date.values())
    final_events.sort(key=lambda x: (x["date"], x["source"]["name"]), reverse=True)

    # cap size
    final_events = final_events[:700]

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(final_events, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(final_events)} events to {OUT_PATH}")


if __name__ == "__main__":
    main()
