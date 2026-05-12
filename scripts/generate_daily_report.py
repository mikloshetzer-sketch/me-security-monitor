import json
import re
from pathlib import Path
from datetime import datetime
from collections import Counter
from html import escape
from urllib.parse import urlparse


BASE_DIR = Path(__file__).resolve().parents[1]

SIGNAL_FILE = BASE_DIR / "security-signal.json"
EVENTS_FILE = BASE_DIR / "events.json"

OPTIONAL_FIRMS_FILES = [
    BASE_DIR / "firms.json",
    BASE_DIR / "firms-hotspots.json",
    BASE_DIR / "firms_hotspots.json",
    BASE_DIR / "data" / "firms.json",
    BASE_DIR / "data" / "firms-hotspots.json",
]

OPTIONAL_SOCIAL_FILES = [
    BASE_DIR / "social-events.json",
    BASE_DIR / "social_media_events.json",
    BASE_DIR / "social.json",
    BASE_DIR / "data" / "social-events.json",
    BASE_DIR / "data" / "social_media_events.json",
]

REPORTS_DIR = BASE_DIR / "reports"
SHARECARDS_DIR = REPORTS_DIR / "sharecards"


FOCUS_AREAS = [
    "Iran",
    "Israel",
    "Lebanon",
    "Gaza",
    "Gaza Strip",
    "Syria",
    "Iraq",
    "Yemen",
]

DRONE_TERMS = ["drone", "uav", "uas", "shahed", "geran", "loitering munition", "fpv drone"]
WAR_TERMS = ["airstrike", "missile", "rocket", "shelling", "artillery", "mortar", "strike", "military", "combat", "battle", "offensive"]
TERROR_TERMS = ["terror", "terrorist", "isis", "hamas", "hezbollah", "suicide", "ied", "hostage"]
DIPLOMACY_TERMS = ["ceasefire", "negotiation", "deal", "diplomatic", "minister", "president"]


def load_json(path, default):
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_first_existing(paths, default):
    for path in paths:
        if path.exists():
            return load_json(path, default), path.name
    return default, ""


def clean_text(value):
    if value is None:
        return ""

    if isinstance(value, dict):
        for key in ["name", "title", "label", "location", "country", "text"]:
            if value.get(key):
                return clean_text(value.get(key))
        return ""

    if isinstance(value, list):
        return ", ".join([clean_text(v) for v in value if clean_text(v)])

    return re.sub(r"\s+", " ", str(value)).strip()


def parse_date(value):
    if not value:
        return None

    value = str(value)

    try:
        return datetime.fromisoformat(value[:10]).date()
    except ValueError:
        pass

    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except ValueError:
        pass

    return None


def safe_list(raw):
    if isinstance(raw, list):
        return raw

    if isinstance(raw, dict):
        for key in ["events", "items", "features", "data", "hotspots", "posts"]:
            if isinstance(raw.get(key), list):
                return raw[key]

    return []


def get_event_properties(event):
    if isinstance(event, dict) and isinstance(event.get("properties"), dict):
        props = dict(event["properties"])
        if event.get("geometry"):
            props["geometry"] = event.get("geometry")
        return props

    return event if isinstance(event, dict) else {}


def get_event_date(event):
    event = get_event_properties(event)

    return parse_date(
        event.get("date")
        or event.get("event_date")
        or event.get("published")
        or event.get("timestamp")
        or event.get("created_at")
        or event.get("seendate")
        or event.get("acq_date")
    )


def get_location(event):
    event = get_event_properties(event)

    location = (
        event.get("location")
        or event.get("place")
        or event.get("country")
        or event.get("area")
        or event.get("city")
        or event.get("admin")
    )

    location_text = clean_text(location)
    return location_text or "Nincs pontos helyszín"


def get_country(event):
    event = get_event_properties(event)

    for key in ["country", "country_name", "area", "region"]:
        value = clean_text(event.get(key))
        if value:
            return value

    location = get_location(event)

    for area in FOCUS_AREAS:
        if area.lower() in location.lower():
            return area

    if "," in location:
        return location.split(",")[-1].strip()

    return location


def get_title(event):
    event = get_event_properties(event)

    title = (
        event.get("title")
        or event.get("headline")
        or event.get("summary")
        or event.get("name")
        or event.get("text")
    )

    title_text = clean_text(title)
    return title_text or build_event_sentence(event)


def get_category(event):
    event = get_event_properties(event)

    raw = clean_text(
        event.get("category")
        or event.get("type")
        or event.get("event_type")
        or "other"
    ).lower()

    mapping = {
        "military": "Katonai / háborús",
        "security": "Biztonsági",
        "political": "Politikai",
        "other": "Egyéb",
        "social": "Social media",
        "firms": "FIRMS hőpont",
    }

    return mapping.get(raw, raw.capitalize() if raw else "Egyéb")


def get_url(event):
    event = get_event_properties(event)

    for key in ["url", "link", "source_url", "sourceurl"]:
        value = event.get(key)
        if value and str(value).startswith("http"):
            return str(value)

    return ""


def get_source_label(event):
    event = get_event_properties(event)
    source = event.get("source")

    if isinstance(source, dict):
        for key in ["name", "title", "domain", "publisher"]:
            label = clean_text(source.get(key))
            if label:
                return label

    for key in ["source_name", "publisher", "source_type", "source"]:
        label = clean_text(event.get(key))
        if label and not label.startswith("http"):
            return label

    url = get_url(event)

    if url:
        domain = urlparse(url).netloc.replace("www.", "")
        if "news.google.com" in domain:
            return "Google News"
        return domain

    return "Ismeretlen forrás"


def contains_any(text, terms):
    return any(term in text for term in terms)


def event_text(event):
    return f"{get_title(event)} {get_location(event)} {get_category(event)}".lower()


def classify_event_nature(event):
    text = event_text(event)

    if contains_any(text, DRONE_TERMS):
        return "Drón / UAV aktivitás"

    if contains_any(text, TERROR_TERMS):
        return "Terrorjellegű / milíciaaktivitás"

    if contains_any(text, WAR_TERMS):
        return "Katonai / háborús cselekmény"

    if contains_any(text, DIPLOMACY_TERMS):
        return "Politikai / diplomáciai fejlemény"

    if contains_any(text, ["protest", "riot", "unrest", "demonstration"]):
        return "Tüntetés / instabilitás"

    return "Egyéb biztonsági esemény"


def build_event_sentence(event):
    location = get_location(event)
    nature = classify_event_nature(event)
    text = event_text(event)

    if nature == "Drón / UAV aktivitás":
        return f"Drón- vagy UAV-aktivitás: {location}"

    if "missile" in text or "rocket" in text:
        return f"Rakétatámadáshoz kapcsolódó esemény: {location}"

    if "airstrike" in text:
        return f"Légicsapás: {location}"

    if "shelling" in text or "artillery" in text:
        return f"Tüzérségi támadás: {location}"

    if nature == "Terrorjellegű / milíciaaktivitás":
        return f"Terrorjellegű vagy milíciaaktivitás: {location}"

    if nature == "Katonai / háborús cselekmény":
        return f"Katonai esemény: {location}"

    if nature == "Politikai / diplomáciai fejlemény":
        return f"Diplomáciai vagy politikai fejlemény: {location}"

    return f"Biztonsági esemény: {location}"


def collect_daily_items(items, target_day):
    daily = []

    for item in items:
        item_day = get_event_date(item)
        if item_day == target_day:
            daily.append(get_event_properties(item))

    return daily


def get_actors(event):
    event = get_event_properties(event)
    actors = []

    for key in ["actors", "actor", "actor1", "actor2", "participants", "entities"]:
        value = event.get(key)

        if isinstance(value, list):
            actors.extend([clean_text(v) for v in value if clean_text(v)])
        elif isinstance(value, str):
            actors.append(clean_text(value))
        elif isinstance(value, dict):
            actors.append(clean_text(value))

    cleaned = []
    for actor in actors:
        if actor and actor not in cleaned:
            cleaned.append(actor)

    return cleaned


def summarize_events(events):
    location_counter = Counter()
    country_risk_counter = Counter()
    category_counter = Counter()
    nature_counter = Counter()
    source_counter = Counter()
    actor_counter = Counter()

    for event in events:
        location_counter[get_location(event)] += 1
        country = get_country(event)
        country_risk_counter[country] += max(score_event(event), 1)
        category_counter[get_category(event)] += 1
        nature_counter[classify_event_nature(event)] += 1
        source_counter[get_source_label(event)] += 1

        for actor in get_actors(event):
            actor_counter[actor] += 1

    return location_counter, country_risk_counter, category_counter, nature_counter, source_counter, actor_counter


def score_event(event):
    event = get_event_properties(event)
    score = float(event.get("score") or event.get("risk") or 0)

    nature = classify_event_nature(event)
    title = get_title(event).lower()
    location = get_location(event)

    if nature == "Drón / UAV aktivitás":
        score += 3
    elif nature == "Katonai / háborús cselekmény":
        score += 2.5
    elif nature == "Terrorjellegű / milíciaaktivitás":
        score += 3
    elif nature == "Politikai / diplomáciai fejlemény":
        score += 1

    if any(area.lower() in location.lower() for area in FOCUS_AREAS):
        score += 1.5

    if any(word in title for word in ["attack", "strike", "war", "missile", "drone", "killed"]):
        score += 1.5

    return round(score, 2)


def top_events(events, limit=8):
    scored = [(score_event(event), event) for event in events]
    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[:limit]


def risk_color(level):
    level = clean_text(level).upper()

    if level == "HIGH":
        return "#ef4444"
    if level == "MEDIUM":
        return "#f97316"
    if level == "LOW":
        return "#22c55e"

    return "#94a3b8"


def hu_risk(level):
    level = clean_text(level).upper()

    if level == "HIGH":
        return "MAGAS"
    if level == "MEDIUM":
        return "KÖZEPES"
    if level == "LOW":
        return "ALACSONY"

    return level or "NINCS ADAT"


def build_counter_list(counter):
    if not counter:
        return "<li><span>Nincs adat</span><strong>–</strong></li>"

    html = ""

    for key, value in counter.most_common(8):
        display_value = round(value, 1) if isinstance(value, float) else value
        html += f"""
        <li>
          <span>{escape(str(key))}</span>
          <strong>{display_value}</strong>
        </li>
        """

    return html


def build_top_events_rows(events):
    rows = ""

    for index, (score, event) in enumerate(top_events(events, limit=10), start=1):
        title = get_title(event)
        human = build_event_sentence(event)
        url = get_url(event)
        location = get_location(event)
        category = get_category(event)
        nature = classify_event_nature(event)
        source = get_source_label(event)

        if url:
            title_html = f'<a href="{escape(url)}" target="_blank" rel="noopener">{escape(title)}</a>'
            source_html = f'<a href="{escape(url)}" target="_blank" rel="noopener">{escape(source)}</a>'
        else:
            title_html = escape(title)
            source_html = escape(source)

        rows += f"""
        <tr>
            <td>{index}</td>
            <td>
              <div class="event-main">{escape(human)}</div>
              <div class="event-sub">{title_html}</div>
            </td>
            <td>{escape(location)}</td>
            <td>{escape(category)}</td>
            <td>{escape(nature)}</td>
            <td class="score">{score}</td>
            <td class="source-cell">{source_html}</td>
        </tr>
        """

    if not rows:
        rows = '<tr><td colspan="7">Nincs elérhető napi esemény.</td></tr>'

    return rows


def extract_signal_country_risk(signal, fallback_counter):
    result = Counter()

    for key in ["country_risk", "country_risks", "risk_by_country", "location_risk"]:
        data = signal.get(key)

        if isinstance(data, dict):
            for name, value in data.items():
                try:
                    result[clean_text(name)] += float(value)
                except (TypeError, ValueError):
                    pass

    top_locations = signal.get("top_locations", [])
    if isinstance(top_locations, list):
        for item in top_locations:
            if isinstance(item, dict):
                name = clean_text(item.get("name") or item.get("location") or item.get("country"))
                value = item.get("risk") or item.get("score") or item.get("value") or item.get("count")
                if name:
                    try:
                        result[name] += float(value)
                    except (TypeError, ValueError):
                        result[name] += 1

    if not result:
        result.update(fallback_counter)

    return result


def bar_svg(label, value, max_value, x, y, width, color):
    if max_value <= 0:
        max_value = 1

    bar_width = int((float(value) / float(max_value)) * width)
    display_value = round(value, 1) if isinstance(value, float) else value

    return f"""
    <text x="{x}" y="{y}" font-size="18" font-weight="700" fill="#334155">{escape(str(label)[:34])}</text>
    <rect x="{x}" y="{y + 12}" width="{width}" height="18" rx="9" fill="#e2e8f0"/>
    <rect x="{x}" y="{y + 12}" width="{bar_width}" height="18" rx="9" fill="{color}"/>
    <text x="{x + width + 18}" y="{y + 28}" font-size="18" font-weight="900" fill="#0f172a">{display_value}</text>
    """


def generate_sharecard(report_day, signal, daily_events, daily_firms, daily_social):
    SHARECARDS_DIR.mkdir(parents=True, exist_ok=True)

    summary = signal.get("summary", {})
    risk_level = summary.get("risk_level", "UNKNOWN")
    risk_score = summary.get("normalized_risk_score", 0)
    total_events = summary.get("total_events", len(daily_events))

    (
        location_counter,
        country_risk_counter,
        category_counter,
        nature_counter,
        source_counter,
        actor_counter,
    ) = summarize_events(daily_events)

    signal_country_risk = extract_signal_country_risk(signal, country_risk_counter)

    top_nature = nature_counter.most_common(1)[0][0] if nature_counter else "Nincs adat"
    top_country = signal_country_risk.most_common(1)[0][0] if signal_country_risk else "Nincs adat"
    color = risk_color(risk_level)

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2100" viewBox="0 0 1600 2100">
<defs>
  <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
    <stop offset="0%" stop-color="#0f172a"/>
    <stop offset="60%" stop-color="#07111f"/>
    <stop offset="100%" stop-color="#020617"/>
  </linearGradient>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="14" stdDeviation="12" flood-color="#000000" flood-opacity="0.38"/>
  </filter>
</defs>

<rect width="1600" height="2100" fill="url(#bg)"/>

<text x="70" y="95" font-size="52" font-weight="900" fill="#ffffff">KÖZEL-KELET BIZTONSÁGI JELENTÉS</text>
<text x="70" y="145" font-size="25" fill="#cbd5e1">Automatikus OSINT napi összefoglaló – {report_day.isoformat()}</text>
<text x="70" y="190" font-size="21" fill="#93c5fd">Események • országkockázat • szereplők • FIRMS • social media</text>

<rect x="1120" y="62" width="400" height="160" rx="24" fill="#111827" stroke="#334155"/>
<text x="1160" y="105" font-size="20" fill="#94a3b8">Kockázati szint</text>
<text x="1160" y="168" font-size="48" font-weight="900" fill="{color}">{escape(hu_risk(risk_level))}</text>
<text x="1160" y="205" font-size="20" fill="#e5e7eb">Index: {risk_score}</text>

<rect x="70" y="270" width="350" height="220" rx="28" fill="#f8fafc" filter="url(#shadow)"/>
<text x="105" y="330" font-size="22" font-weight="900" fill="#0f172a">Napi események</text>
<text x="105" y="420" font-size="76" font-weight="900" fill="#2563eb">{len(daily_events)}</text>

<rect x="450" y="270" width="350" height="220" rx="28" fill="#f8fafc" filter="url(#shadow)"/>
<text x="485" y="330" font-size="22" font-weight="900" fill="#0f172a">FIRMS hőpont</text>
<text x="485" y="420" font-size="76" font-weight="900" fill="#f97316">{len(daily_firms)}</text>

<rect x="830" y="270" width="350" height="220" rx="28" fill="#f8fafc" filter="url(#shadow)"/>
<text x="865" y="330" font-size="22" font-weight="900" fill="#0f172a">Social media</text>
<text x="865" y="420" font-size="76" font-weight="900" fill="#16a34a">{len(daily_social)}</text>

<rect x="1210" y="270" width="310" height="220" rx="28" fill="#f8fafc" filter="url(#shadow)"/>
<text x="1245" y="330" font-size="22" font-weight="900" fill="#0f172a">Fő ország</text>
<text x="1245" y="395" font-size="32" font-weight="900" fill="#dc2626">{escape(top_country[:18])}</text>

<rect x="70" y="560" width="700" height="520" rx="28" fill="#f8fafc" filter="url(#shadow)"/>
<text x="110" y="620" font-size="30" font-weight="900" fill="#0f172a">Országonkénti rizikó</text>
"""

    y = 690
    max_country = max(signal_country_risk.values(), default=1)
    for name, value in signal_country_risk.most_common(7):
        svg += bar_svg(name, value, max_country, 110, y, 420, "#dc2626")
        y += 58

    svg += f"""
<rect x="820" y="560" width="700" height="520" rx="28" fill="#f8fafc" filter="url(#shadow)"/>
<text x="860" y="620" font-size="30" font-weight="900" fill="#0f172a">Eseményjelleg</text>
"""

    y = 690
    max_nature = max(nature_counter.values(), default=1)
    for name, value in nature_counter.most_common(7):
        svg += bar_svg(name, value, max_nature, 860, y, 420, "#f97316")
        y += 58

    svg += f"""
<rect x="70" y="1150" width="700" height="430" rx="28" fill="#f8fafc" filter="url(#shadow)"/>
<text x="110" y="1210" font-size="30" font-weight="900" fill="#0f172a">Top szereplők</text>
"""

    y = 1280
    if actor_counter:
        max_actor = max(actor_counter.values(), default=1)
        for name, value in actor_counter.most_common(6):
            svg += bar_svg(name, value, max_actor, 110, y, 420, "#16a34a")
            y += 58
    else:
        svg += '<text x="110" y="1300" font-size="24" fill="#64748b">Nincs azonosított szereplő a napi adatokban.</text>'

    svg += f"""
<rect x="820" y="1150" width="700" height="430" rx="28" fill="#f8fafc" filter="url(#shadow)"/>
<text x="860" y="1210" font-size="30" font-weight="900" fill="#0f172a">Top események</text>
"""

    y = 1280
    for score, event in top_events(daily_events, limit=4):
        human = build_event_sentence(event)[:86]
        loc = get_location(event)[:28]
        nature = classify_event_nature(event)[:30]

        svg += f"""
<circle cx="870" cy="{y - 8}" r="8" fill="{color}"/>
<text x="895" y="{y}" font-size="20" font-weight="900" fill="#0f172a">{escape(loc)}</text>
<text x="1160" y="{y}" font-size="18" fill="#334155">{escape(nature)}</text>
<text x="895" y="{y + 32}" font-size="17" fill="#475569">{escape(human)}</text>
"""
        y += 82

    svg += f"""
<rect x="70" y="1650" width="1450" height="210" rx="28" fill="#111827" stroke="#334155"/>
<text x="110" y="1710" font-size="22" font-weight="900" fill="#e5e7eb">Kulcsmegállapítás</text>
<text x="110" y="1760" font-size="24" fill="#cbd5e1">Domináns eseményjelleg: {escape(top_nature)}. Fő kockázati ország/térség: {escape(top_country)}.</text>
<text x="110" y="1810" font-size="22" fill="#cbd5e1">FIRMS hőpontok: {len(daily_firms)} • Social media jelzések: {len(daily_social)} • Napi OSINT események: {len(daily_events)}</text>

<rect x="70" y="1930" width="1450" height="110" rx="24" fill="#0f172a"/>
<text x="110" y="1985" font-size="18" fill="#cbd5e1">Automatikus OSINT-alapú napi összefoglaló • Nem hivatalos konfliktus- vagy veszteségstatisztika</text>
<text x="1180" y="1985" font-size="20" font-weight="900" fill="#93c5fd">ME Security Monitor</text>
</svg>
"""

    filename = f"{report_day.isoformat()}-middle-east-summary.svg"
    path = SHARECARDS_DIR / filename
    path.write_text(svg, encoding="utf-8")

    return f"sharecards/{filename}"


def build_optional_table(title, items, kind):
    if not items:
        return f"""
        <section class="section">
          <h2>{escape(title)}</h2>
          <p>Nincs elérhető napi adat.</p>
        </section>
        """

    rows = ""
    for i, item in enumerate(items[:10], start=1):
        props = get_event_properties(item)
        loc = get_location(props)
        date = get_event_date(props)
        source = get_source_label(props)
        url = get_url(props)

        if kind == "firms":
            detail = clean_text(
                props.get("brightness")
                or props.get("bright_ti4")
                or props.get("confidence")
                or props.get("frp")
                or "hőpont"
            )
        else:
            detail = get_title(props)

        if url:
            source_html = f'<a href="{escape(url)}" target="_blank" rel="noopener">{escape(source)}</a>'
        else:
            source_html = escape(source)

        rows += f"""
        <tr>
          <td>{i}</td>
          <td>{escape(loc)}</td>
          <td>{escape(str(date or "-"))}</td>
          <td>{escape(detail)}</td>
          <td>{source_html}</td>
        </tr>
        """

    return f"""
    <section class="section">
      <h2>{escape(title)}</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Helyszín</th>
            <th>Dátum</th>
            <th>Részlet</th>
            <th>Forrás</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </section>
    """


def build_html(report_day, signal, daily_events, daily_firms, daily_social, sharecard_path):
    summary = signal.get("summary", {})
    meta = signal.get("meta", {})

    total_events = summary.get("total_events", len(daily_events))
    risk_score = summary.get("normalized_risk_score", 0)
    risk_level = summary.get("risk_level", "UNKNOWN")
    confidence = summary.get("confidence", "N/A")
    updated = meta.get("updated", "Nincs adat")

    (
        location_counter,
        country_risk_counter,
        category_counter,
        nature_counter,
        source_counter,
        actor_counter,
    ) = summarize_events(daily_events)

    signal_country_risk = extract_signal_country_risk(signal, country_risk_counter)

    top_location = location_counter.most_common(1)[0][0] if location_counter else "Nincs adat"
    top_nature = nature_counter.most_common(1)[0][0] if nature_counter else "Nincs adat"
    top_country = signal_country_risk.most_common(1)[0][0] if signal_country_risk else "Nincs adat"

    rows = build_top_events_rows(daily_events)

    country_risk_list = build_counter_list(signal_country_risk)
    location_list = build_counter_list(location_counter)
    category_list = build_counter_list(category_counter)
    nature_list = build_counter_list(nature_counter)
    source_list = build_counter_list(source_counter)
    actor_list = build_counter_list(actor_counter)

    firms_block = build_optional_table("FIRMS hőpontok", daily_firms, "firms")
    social_block = build_optional_table("Social media események", daily_social, "social")

    return f"""<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<title>Közel-Kelet napi biztonsági jelentés – {report_day.isoformat()}</title>

<style>
* {{ box-sizing: border-box; }}

body {{
  margin: 0;
  background: #e5e7eb;
  font-family: Arial, Helvetica, sans-serif;
  color: #111827;
}}

.page {{
  max-width: 1240px;
  margin: 0 auto;
  background: #f8fafc;
  min-height: 100vh;
}}

.hero {{
  background: linear-gradient(90deg, #020617, #0f172a);
  color: white;
  padding: 36px 42px;
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: center;
}}

.hero h1 {{
  margin: 0;
  font-size: 38px;
  line-height: 1.1;
}}

.hero p {{
  color: #cbd5e1;
  font-size: 18px;
}}

.risk {{
  background: #111827;
  border: 1px solid #334155;
  border-radius: 18px;
  padding: 22px;
  min-width: 260px;
  text-align: center;
}}

.risk strong {{
  display: block;
  color: {risk_color(risk_level)};
  font-size: 40px;
}}

.content {{ padding: 30px 40px; }}

.actions {{
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-bottom: 18px;
}}

.btn {{
  background: #2563eb;
  color: white;
  padding: 10px 16px;
  border-radius: 10px;
  text-decoration: none;
  border: 0;
  font-weight: 700;
  cursor: pointer;
}}

.btn.secondary {{ background: #0f172a; }}

.cards {{
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 18px;
}}

.card {{
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
}}

.label {{
  font-size: 13px;
  text-transform: uppercase;
  color: #475569;
  font-weight: 800;
}}

.big {{
  font-size: 30px;
  font-weight: 900;
  color: #2563eb;
  margin-top: 8px;
}}

.section {{
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 22px;
  margin-top: 22px;
}}

.section h2 {{ margin-top: 0; }}

.grid6 {{
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 18px;
}}

.rank-list {{
  list-style: none;
  margin: 0;
  padding: 0;
}}

.rank-list li {{
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid #e2e8f0;
  padding: 8px 0;
  gap: 12px;
}}

.rank-list span {{ overflow-wrap: anywhere; }}

table {{
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  table-layout: fixed;
}}

th {{
  text-align: left;
  background: #f1f5f9;
  padding: 12px;
  font-size: 12px;
  text-transform: uppercase;
  color: #334155;
}}

td {{
  padding: 12px;
  border-bottom: 1px solid #e2e8f0;
  vertical-align: top;
  overflow-wrap: anywhere;
}}

.event-main {{
  font-weight: 800;
  color: #0f172a;
  line-height: 1.35;
}}

.event-sub {{
  margin-top: 6px;
  font-size: 12px;
  color: #64748b;
  line-height: 1.35;
}}

.score {{
  color: #dc2626;
  font-weight: 900;
}}

.source-cell {{ font-size: 12px; }}

a {{
  color: #2563eb;
  font-weight: 700;
  text-decoration: none;
}}

.sharecard {{
  background: #020617;
  padding: 18px;
  border-radius: 18px;
}}

.sharecard img {{
  width: 100%;
  border-radius: 14px;
  border: 1px solid #334155;
}}

.footer {{
  background: #0f172a;
  color: #cbd5e1;
  text-align: center;
  padding: 22px;
  margin-top: 28px;
}}

@media (max-width: 1100px) {{
  .grid6 {{ grid-template-columns: 1fr 1fr; }}
  .cards {{ grid-template-columns: 1fr 1fr; }}
}}

@media (max-width: 700px) {{
  .grid6, .cards {{ grid-template-columns: 1fr; }}
  .hero {{ flex-direction: column; align-items: flex-start; }}
  .content {{ padding: 20px; }}
}}
</style>
</head>

<body>
<div class="page">

<header class="hero">
  <div>
    <h1>Közel-Kelet napi<br>biztonsági jelentés</h1>
    <p>OSINT-alapú regionális biztonsági monitor</p>
  </div>

  <div class="risk">
    <div>Kockázati szint</div>
    <strong>{escape(hu_risk(risk_level))}</strong>
    <div>Index: {escape(str(risk_score))}</div>
  </div>
</header>

<main class="content">

<div class="actions">
  <button class="btn" onclick="window.print()">Letöltés PDF-ként</button>
  <a class="btn secondary" href="index.html">Riportarchívum</a>
</div>

<section class="cards">
  <div class="card">
    <div class="label">7 napos eseményszám</div>
    <div class="big">{escape(str(total_events))}</div>
  </div>

  <div class="card">
    <div class="label">Napi események</div>
    <div class="big">{len(daily_events)}</div>
  </div>

  <div class="card">
    <div class="label">FIRMS hőpont</div>
    <div class="big">{len(daily_firms)}</div>
  </div>

  <div class="card">
    <div class="label">Social media</div>
    <div class="big">{len(daily_social)}</div>
  </div>

  <div class="card">
    <div class="label">Fő kockázati térség</div>
    <div class="big" style="font-size:21px;">{escape(top_country)}</div>
  </div>
</section>

<section class="section">
  <h2>Rövid napi értékelés</h2>
  <p>
    A rendszer aktuális kockázati szintje <strong>{escape(hu_risk(risk_level))}</strong>,
    az összesített normalizált kockázati index <strong>{escape(str(risk_score))}</strong>.
  </p>
  <p>
    A napi aktivitás fő fókuszpontja: <strong>{escape(top_location)}</strong>.
    A legerősebb országkockázati jelzés: <strong>{escape(top_country)}</strong>.
    A domináns eseményjelleg: <strong>{escape(top_nature)}</strong>.
  </p>
</section>

<section class="section">
  <h2>Országkockázat, szereplők és adatforrások</h2>
  <div class="grid6">
    <div>
      <h3>Ország rizikó</h3>
      <ol class="rank-list">{country_risk_list}</ol>
    </div>

    <div>
      <h3>Helyszínek</h3>
      <ol class="rank-list">{location_list}</ol>
    </div>

    <div>
      <h3>Kategóriák</h3>
      <ol class="rank-list">{category_list}</ol>
    </div>

    <div>
      <h3>Eseményjelleg</h3>
      <ol class="rank-list">{nature_list}</ol>
    </div>

    <div>
      <h3>Szereplők</h3>
      <ol class="rank-list">{actor_list}</ol>
    </div>

    <div>
      <h3>Források</h3>
      <ol class="rank-list">{source_list}</ol>
    </div>
  </div>
</section>

<section class="section">
  <h2>Top események</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Esemény</th>
        <th>Helyszín</th>
        <th>Kategória</th>
        <th>Eseményjelleg</th>
        <th>Súly</th>
        <th>Forrás</th>
      </tr>
    </thead>
    <tbody>{rows}</tbody>
  </table>
</section>

{firms_block}

{social_block}

<section class="section">
  <h2>Blogra használható összefoglaló kép</h2>
  <p><a href="{escape(sharecard_path)}" target="_blank">Kép megnyitása külön oldalon</a></p>
  <div class="sharecard">
    <img src="{escape(sharecard_path)}" alt="Közel-Kelet napi OSINT összefoglaló">
  </div>
</section>

<section class="section">
  <h2>Módszertani megjegyzés</h2>
  <p>
    Frissítés: {escape(str(updated))}. Bizalom: {escape(str(confidence))}.
    A drón-, terrorjellegű és háborús események azonosítása kulcsszavas automatikus osztályozással történik.
  </p>
</section>

</main>

<footer class="footer">
  ME Security Monitor – automatikus napi OSINT jelentés
</footer>

</div>
</body>
</html>
"""


def update_index():
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    reports = sorted(REPORTS_DIR.glob("*.html"), reverse=True)

    items = ""

    for report in reports:
        if report.name == "index.html":
            continue

        items += f"""
        <li>
          <a href="{escape(report.name)}">{escape(report.stem)}</a>
        </li>
        """

    html = f"""<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<title>ME Security Monitor – napi jelentések</title>
<style>
body {{
  font-family: Arial, Helvetica, sans-serif;
  background: #e5e7eb;
  color: #111827;
}}

.container {{
  max-width: 900px;
  margin: 40px auto;
  background: white;
  padding: 32px;
  border-radius: 18px;
  box-shadow: 0 10px 24px rgba(15,23,42,0.1);
}}

a {{
  color: #2563eb;
  font-weight: 700;
  text-decoration: none;
}}

li {{
  margin: 8px 0;
}}
</style>
</head>
<body>
<div class="container">
  <h1>ME Security Monitor – napi jelentések</h1>
  <p>Automatikusan generált Közel-Kelet biztonsági OSINT-jelentések.</p>
  <ul>{items or "<li>Még nincs jelentés.</li>"}</ul>
</div>
</body>
</html>
"""

    (REPORTS_DIR / "index.html").write_text(html, encoding="utf-8")


def generate_report():
    signal = load_json(SIGNAL_FILE, {})
    events_raw = load_json(EVENTS_FILE, [])
    firms_raw, firms_file = load_first_existing(OPTIONAL_FIRMS_FILES, [])
    social_raw, social_file = load_first_existing(OPTIONAL_SOCIAL_FILES, [])

    events = safe_list(events_raw)
    firms = safe_list(firms_raw)
    social = safe_list(social_raw)

    report_day = datetime.utcnow().date()

    daily_events = collect_daily_items(events, report_day)
    daily_firms = collect_daily_items(firms, report_day)
    daily_social = collect_daily_items(social, report_day)

    if not daily_events:
        summary = signal.get("summary", {})
        period_end = parse_date(summary.get("period_end"))

        if period_end:
            report_day = period_end
            daily_events = collect_daily_items(events, report_day)
            daily_firms = collect_daily_items(firms, report_day)
            daily_social = collect_daily_items(social, report_day)

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    sharecard_path = generate_sharecard(
        report_day=report_day,
        signal=signal,
        daily_events=daily_events,
        daily_firms=daily_firms,
        daily_social=daily_social,
    )

    html = build_html(
        report_day=report_day,
        signal=signal,
        daily_events=daily_events,
        daily_firms=daily_firms,
        daily_social=daily_social,
        sharecard_path=sharecard_path,
    )

    report_path = REPORTS_DIR / f"{report_day.isoformat()}.html"
    report_path.write_text(html, encoding="utf-8")

    update_index()

    print(f"Jelentés elkészült: {report_path}")
    print(f"Blogkép elkészült: {REPORTS_DIR / sharecard_path}")
    if firms_file:
        print(f"FIRMS adatfájl: {firms_file}")
    if social_file:
        print(f"Social adatfájl: {social_file}")


if __name__ == "__main__":
    generate_report()
