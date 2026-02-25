import json
import re
import hashlib
import base64
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse

import feedparser
import requests
from bs4 import BeautifulSoup
from dateutil import parser as dtparser


# -------- CONFIG --------
OUT_PATH = "events.json"

# NEWS FEEDS
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

# ISW (SCRAPE) – stable entry points
ISW_SOURCES = [
    {
        "name": "ISW",
        "type": "isw",
        "index_url": "https://understandingwar.org/analysis/middle-east/iran-update/",
        "post_url_must_contain": "/research/middle-east/iran-update-",
        "default_location_hint": "iran",
        "default_category": "security",
        "confidence": 0.78,
        "max_posts": 25,  # keep Actions runtime safe
    }
]

UA_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ME-Security-Monitor/1.0)"}

# Middle East relevance filter list
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
SECURITY_KW  = ["police", "security", "arrest", "court", "terror", "militant", "border", "checkpoint", "hostage"]


# -------- HELPERS --------
def strip_html(text: str) -> str:
    if not text:
        return ""
    soup = BeautifulSoup(text, "html.parser")
    return re.sub(r"\s+", " ", soup.get_text(" ", strip=True)).strip()

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
    t = normalize_text(f"{title} {summary}")
    tags = []
    if loc_name and loc_name != "Middle East":
        tags.append(loc_name)
    for kw in ["ceasefire", "hostage", "airstrike", "drone", "missile", "election", "talks", "sanctions", "protest"]:
        if kw in t:
            tags.append(kw)
    out, seen = [], set()
    for x in tags:
        k = x.strip().lower()
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(x.strip())
    return out[:10]

def make_id(url: str, title: str, date_ymd: str) -> str:
    base = (url or "") + "|" + (title or "") + "|" + (date_ymd or "")
    h = hashlib.sha1(base.encode("utf-8")).hexdigest()[:12]
    return f"{date_ymd}-{h}"

def safe_date(entry):
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


# -------- GOOGLE NEWS URL RESOLUTION --------
def _extract_gnews_token(url: str) -> str | None:
    if not url:
        return None
    try:
        path = urlparse(url).path
    except Exception:
        return None
    m = re.search(r"/(rss/)?articles/([^/?#]+)", path)
    return m.group(2) if m else None

def _decode_token_to_urls(token: str) -> list[str]:
    if not token:
        return []
    t = token.replace("-", "+").replace("_", "/")
    t += "=" * ((4 - len(t) % 4) % 4)

    candidates = []
    for decoder in (base64.b64decode, base64.urlsafe_b64decode):
        try:
            raw = decoder(t)
            s = raw.decode("utf-8", errors="ignore")
            candidates.extend(re.findall(r"https?://[^\s\"<>\]]+", s))
        except Exception:
            continue

    out, seen = [], set()
    for u in candidates:
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out

def _follow_redirects(url: str) -> str | None:
    if not url:
        return None
    try:
        resp = requests.get(url, headers=UA_HEADERS, timeout=12, allow_redirects=True)
        final = resp.url
        if resp.text:
            m = re.search(r'rel=["\']canonical["\']\s+href=["\']([^"\']+)["\']', resp.text, re.I)
            if m:
                return m.group(1)
        return final or None
    except Exception:
        return None

def resolve_google_news_link(link: str) -> str:
    if not link:
        return link
    host = (urlparse(link).netloc or "").lower()
    if "news.google.com" not in host:
        return link

    token = _extract_gnews_token(link)
    decoded_urls = _decode_token_to_urls(token) if token else []
    for u in decoded_urls:
        h = (urlparse(u).netloc or "").lower()
        if h and "google" not in h:
            return u

    final = _follow_redirects(link)
    return final or link


# -------- ISW SCRAPER --------
def fetch_html(url: str) -> str:
    r = requests.get(url, headers=UA_HEADERS, timeout=20)
    r.raise_for_status()
    return r.text

def absolutize(base: str, href: str) -> str:
    if not href:
        return ""
    if href.startswith("http://") or href.startswith("https://"):
        return href
    # understandingwar uses absolute paths
    if href.startswith("/"):
        return "https://understandingwar.org" + href
    # fallback
    return base.rstrip("/") + "/" + href.lstrip("/")

def scrape_isw_index(index_url: str, must_contain: str, max_posts: int) -> list[str]:
    html = fetch_html(index_url)
    soup = BeautifulSoup(html, "html.parser")

    urls = []
    for a in soup.select("a[href]"):
        href = a.get("href", "")
        full = absolutize(index_url, href)
        if must_contain in full:
            urls.append(full)

    # de-dup keep order
    out, seen = [], set()
    for u in urls:
        if u in seen:
            continue
        seen.add(u)
        out.append(u)

    return out[:max_posts]

def extract_isw_post_summary(post_url: str) -> str:
    """Light summary: first 1-2 paragraphs from main content, max 340 chars."""
    try:
        html = fetch_html(post_url)
        soup = BeautifulSoup(html, "html.parser")

        # Try common Drupal-ish content containers
        candidates = soup.select("div.field--name-body p, article p, .node__content p")
        parts = []
        for p in candidates:
            txt = strip_html(str(p))
            if txt:
                parts.append(txt)
            if len(" ".join(parts)) > 450:
                break

        s = " ".join(parts).strip()
        s = re.sub(r"\s+", " ", s)
        if len(s) > 340:
            s = s[:337].rstrip() + "..."
        return s
    except Exception:
        return ""

def parse_date_from_title(title: str) -> str | None:
    # Example: "Iran Update, February 6, 2026"
    try:
        dt = dtparser.parse(title, fuzzy=True)
        return dt.date().isoformat()
    except Exception:
        return None


def main():
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=365)

    collected = []

    # ---- NEWS via RSS ----
    for f in FEEDS:
        feed = feedparser.parse(f["url"])
        for e in feed.entries:
            dt = safe_date(e)
            if not dt or dt < cutoff:
                continue

            date_ymd = dt.strftime("%Y-%m-%d")
            title = (getattr(e, "title", "") or "").strip()

            raw_link = (getattr(e, "link", "") or "").strip()
            link = resolve_google_news_link(raw_link) if "Google News" in f["name"] else raw_link

            summary_raw = getattr(e, "summary", "") or getattr(e, "description", "")
            summary = strip_html(summary_raw)
            if len(summary) > 320:
                summary = summary[:317].rstrip() + "..."

            if not title or not link:
                continue
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
                "source": {"name": f["name"], "type": f["type"], "url": link},
                "location": loc,
            }
            collected.append(ev)

    # ---- ISW via SCRAPE ----
    for s in ISW_SOURCES:
        try:
            post_urls = scrape_isw_index(
                s["index_url"],
                must_contain=s["post_url_must_contain"],
                max_posts=s["max_posts"],
            )
        except Exception as ex:
            print(f"ISW scrape failed for {s['index_url']}: {ex}")
            post_urls = []

        for url in post_urls:
            # Title: try from URL slug fallback, but better: fetch page <title>
            title = ""
            try:
                html = fetch_html(url)
                soup = BeautifulSoup(html, "html.parser")
                h1 = soup.select_one("h1")
                if h1:
                    title = strip_html(str(h1))
                if not title and soup.title:
                    title = strip_html(str(soup.title))
                title = title.replace(" | ISW", "").strip()
            except Exception:
                title = url.split("/")[-2].replace("-", " ").strip().title()

            date_ymd = parse_date_from_title(title) or now.date().isoformat()

            # cutoff
            try:
                dt = dtparser.parse(date_ymd).replace(tzinfo=timezone.utc)
                if dt < cutoff:
                    continue
            except Exception:
                pass

            summary = extract_isw_post_summary(url)
            if not summary:
                summary = "ISW Middle East daily update (auto-ingested)."

            # enforce ME relevance (usually true here)
            if not is_middle_east_related(title, summary):
                # still keep Iran Update even if keyword miss
                if s.get("default_location_hint", "") not in normalize_text(title + " " + summary):
                    continue

            # location/category
            loc = pick_location(title, summary)
            cat = pick_category(title, summary)
            if s.get("default_category") and cat == "other":
                cat = s["default_category"]

            ev = {
                "id": make_id(url, title, date_ymd),
                "date": date_ymd,
                "title": title,
                "summary": summary,
                "category": cat,
                "tags": extract_tags(title, summary, loc["name"]),
                "confidence": float(s.get("confidence", 0.75)),
                "source": {"name": s["name"], "type": s["type"], "url": url},
                "location": loc,
            }
            collected.append(ev)

    # ---- De-dup ----
    by_url = {}
    for ev in sorted(collected, key=lambda x: x["date"], reverse=True):
        url = ev["source"]["url"]
        if url and url not in by_url:
            by_url[url] = ev

    by_title_date = {}
    for ev in by_url.values():
        key = (ev["date"], normalize_text(ev["title"]))
        by_title_date.setdefault(key, ev)

    final_events = list(by_title_date.values())
    final_events.sort(key=lambda x: (x["date"], x["source"]["type"], x["source"]["name"]), reverse=True)
    final_events = final_events[:900]

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(final_events, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(final_events)} events to {OUT_PATH}")


if __name__ == "__main__":
    main()
