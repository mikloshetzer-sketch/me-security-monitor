import json
import re
from pathlib import Path
from datetime import datetime, date
from collections import Counter, defaultdict
from html import escape


BASE_DIR = Path(__file__).resolve().parents[1]

SIGNAL_FILE = BASE_DIR / "security-signal.json"
EVENTS_FILE = BASE_DIR / "events.json"

REPORTS_DIR = BASE_DIR / "reports"
SHARECARDS_DIR = REPORTS_DIR / "sharecards"


FOCUS_AREAS = [
    "Iran",
    "Israel",
    "Lebanon",
    "Gaza Strip",
    "Syria",
    "Iraq",
    "Yemen",
]


def load_json(path, default):
    if not path.exists():
        return default

    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def clean_text(value):
    if value is None:
        return ""
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


def today_utc_date():
    return datetime.utcnow().date()


def get_event_date(event):
    return parse_date(
        event.get("date")
        or event.get("published")
        or event.get("timestamp")
        or event.get("created_at")
    )


def get_title(event):
    return clean_text(
        event.get("title")
        or event.get("headline")
        or event.get("summary")
        or "Cím nélküli esemény"
    )


def get_location(event):
    return clean_text(
        event.get("location")
        or event.get("place")
        or event.get("country")
        or "Nincs pontos helyszín"
    )


def get_category(event):
    raw = clean_text(event.get("category") or event.get("type") or "other").lower()

    mapping = {
        "military": "Katonai / háborús",
        "security": "Biztonsági",
        "political": "Politikai",
        "other": "Egyéb",
    }

    return mapping.get(raw, raw.capitalize())


def get_source_type(event):
    return clean_text(event.get("source_type") or event.get("source") or "ismeretlen")


def get_url(event):
    url = event.get("url") or event.get("link") or event.get("source_url") or ""
    return str(url) if str(url).startswith("http") else ""


def event_text(event):
    return f"{get_title(event)} {get_location(event)} {get_category(event)}".lower()


def classify_event_nature(event):
    text = event_text(event)

    drone_terms = [
        "drone", "drones", "uav", "uas", "shahed", "geran",
        "loitering munition", "fpv drone", "unmanned aerial",
    ]

    war_terms = [
        "airstrike", "air strike", "missile", "rocket", "shelling",
        "artillery", "mortar", "strike", "military", "troops",
        "combat", "battle", "frontline", "war", "offensive",
    ]

    terror_terms = [
        "terror", "terrorist", "isis", "islamic state", "al-qaeda",
        "hamas", "hezbollah", "suicide", "car bomb", "ied",
        "hostage", "mass shooting",
    ]

    diplomacy_terms = [
        "talks", "ceasefire", "negotiation", "deal", "sanction",
        "diplomatic", "minister", "president", "law", "parliament",
    ]

    if any(term in text for term in drone_terms):
        return "Drón / UAV aktivitás"

    if any(term in text for term in terror_terms):
        return "Terrorjellegű / milíciaaktivitás"

    if any(term in text for term in war_terms):
        return "Katonai / háborús cselekmény"

    if any(term in text for term in diplomacy_terms):
        return "Politikai / diplomáciai fejlemény"

    if "protest" in text or "riot" in text or "unrest" in text:
        return "Tüntetés / belső instabilitás"

    return "Egyéb biztonsági esemény"


def collect_daily_events(events, target_day):
    daily = []

    for event in events:
        event_day = get_event_date(event)
        if event_day == target_day:
            daily.append(event)

    return daily


def safe_events(events_raw):
    if isinstance(events_raw, list):
        return events_raw

    if isinstance(events_raw, dict):
        if isinstance(events_raw.get("events"), list):
            return events_raw["events"]
        if isinstance(events_raw.get("items"), list):
            return events_raw["items"]

    return []


def summarize_events(events):
    location_counter = Counter()
    category_counter = Counter()
    nature_counter = Counter()
    source_counter = Counter()

    for event in events:
        location_counter[get_location(event)] += 1
        category_counter[get_category(event)] += 1
        nature_counter[classify_event_nature(event)] += 1
        source_counter[get_source_type(event)] += 1

    return location_counter, category_counter, nature_counter, source_counter


def score_event(event):
    score = float(event.get("score") or 0)

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

    if location in ["Iran", "Israel", "Lebanon", "Gaza Strip", "Syria", "Yemen"]:
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


def bar_svg(label, value, max_value, x, y, width, color):
    if max_value <= 0:
        max_value = 1

    bar_width = int((value / max_value) * width)

    return f"""
    <text x="{x}" y="{y}" font-size="18" font-weight="700" fill="#334155">{escape(label[:34])}</text>
    <rect x="{x}" y="{y + 12}" width="{width}" height="18" rx="9" fill="#e2e8f0"/>
    <rect x="{x}" y="{y + 12}" width="{bar_width}" height="18" rx="9" fill="{color}"/>
    <text x="{x + width + 18}" y="{y + 28}" font-size="18" font-weight="900" fill="#0f172a">{value}</text>
    """


def generate_sharecard(report_day, signal, daily_events):
    SHARECARDS_DIR.mkdir(parents=True, exist_ok=True)

    summary = signal.get("summary", {})
    risk_level = summary.get("risk_level", "UNKNOWN")
    risk_score = summary.get("normalized_risk_score", 0)
    total_events = summary.get("total_events", len(daily_events))

    location_counter, category_counter, nature_counter, source_counter = summarize_events(daily_events)

    focus_counts = Counter()
    for event in daily_events:
        loc = get_location(event)
        for area in FOCUS_AREAS:
            if area.lower() in loc.lower():
                focus_counts[area] += 1

    if not focus_counts:
        for item in signal.get("top_locations", []):
            name = item.get("name")
            if name:
                focus_counts[name] = int(round(float(item.get("risk", 0))))

    max_focus = max(focus_counts.values(), default=1)
    max_nature = max(nature_counter.values(), default=1)

    width = 1600
    height = 2100
    color = risk_color(risk_level)

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
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

<text x="70" y="95" font-size="50" font-weight="900" fill="#ffffff">KÖZEL-KELET BIZTONSÁGI JELENTÉS</text>
<text x="70" y="145" font-size="25" fill="#cbd5e1">Automatikus OSINT napi összefoglaló – {report_day.isoformat()}</text>
<text x="70" y="190" font-size="21" fill="#93c5fd">Irán • Izrael • Libanon • Gáza • Szíria • Irak • Jemen</text>

<rect x="1110" y="62" width="410" height="150" rx="24" fill="#111827" stroke="#334155"/>
<text x="1150" y="105" font-size="20" fill="#94a3b8">Aktuális kockázati szint</text>
<text x="1150" y="165" font-size="46" font-weight="900" fill="{color}">{escape(hu_risk(risk_level))}</text>
<text x="1150" y="198" font-size="20" fill="#e5e7eb">Index: {risk_score}</text>

<rect x="70" y="270" width="460" height="250" rx="28" fill="#f8fafc" filter="url(#shadow)"/>
<text x="110" y="330" font-size="24" font-weight="900" fill="#0f172a">Összes esemény</text>
<text x="110" y="420" font-size="88" font-weight="900" fill="#2563eb">{total_events}</text>
<text x="110" y="470" font-size="22" fill="#475569">7 napos ablak alapján</text>

<rect x="570" y="270" width="460" height="250" rx="28" fill="#f8fafc" filter="url(#shadow)"/>
<text x="610" y="330" font-size="24" font-weight="900" fill="#0f172a">Napi találatok</text>
<text x="610" y="420" font-size="88" font-weight="900" fill="#16a34a">{len(daily_events)}</text>
<text x="610" y="470" font-size="22" fill="#475569">jelentéshez használt esemény</text>

<rect x="1070" y="270" width="450" height="250" rx="28" fill="#f8fafc" filter="url(#shadow)"/>
<text x="1110" y="330" font-size="24" font-weight="900" fill="#0f172a">Domináns jelleg</text>
<text x="1110" y="395" font-size="30" font-weight="900" fill="#f97316">{escape(nature_counter.most_common(1)[0][0] if nature_counter else "Nincs adat")}</text>

<rect x="70" y="590" width="700" height="520" rx="28" fill="#f8fafc" filter="url(#shadow)"/>
<text x="110" y="650" font-size="30" font-weight="900" fill="#0f172a">Fő térségek</text>
"""

    y = 720
    for label, value in focus_counts.most_common(7):
        svg += bar_svg(label, value, max_focus, 110, y, 470, "#2563eb")
        y += 62

    svg += f"""
<rect x="820" y="590" width="700" height="520" rx="28" fill="#f8fafc" filter="url(#shadow)"/>
<text x="860" y="650" font-size="30" font-weight="900" fill="#0f172a">Eseményjelleg</text>
"""

    y = 720
    for label, value in nature_counter.most_common(7):
        svg += bar_svg(label, value, max_nature, 860, y, 470, "#f97316")
        y += 62

    svg += f"""
<rect x="70" y="1180" width="1450" height="600" rx="28" fill="#f8fafc" filter="url(#shadow)"/>
<text x="110" y="1245" font-size="32" font-weight="900" fill="#0f172a">Top események</text>
"""

    y = 1305
    for score, event in top_events(daily_events, limit=6):
        title = get_title(event)[:95]
        loc = get_location(event)
        nature = classify_event_nature(event)

        svg += f"""
<circle cx="118" cy="{y - 8}" r="8" fill="{color}"/>
<text x="145" y="{y}" font-size="21" font-weight="900" fill="#0f172a">{escape(loc)}</text>
<text x="330" y="{y}" font-size="19" fill="#334155">{escape(nature)}</text>
<text x="145" y="{y + 34}" font-size="18" fill="#475569">{escape(title)}</text>
"""
        y += 78

    svg += f"""
<rect x="70" y="1880" width="1450" height="120" rx="24" fill="#111827" stroke="#334155"/>
<text x="110" y="1930" font-size="20" font-weight="800" fill="#e5e7eb">Módszertani megjegyzés</text>
<text x="110" y="1970" font-size="18" fill="#cbd5e1">Automatikus OSINT-alapú napi összefoglaló. Nem hivatalos konfliktus- vagy veszteségstatisztika.</text>
<text x="1130" y="1970" font-size="20" font-weight="900" fill="#93c5fd">ME Security Monitor</text>
</svg>
"""

    filename = f"{report_day.isoformat()}-middle-east-summary.svg"
    path = SHARECARDS_DIR / filename
    path.write_text(svg, encoding="utf-8")

    return f"sharecards/{filename}"


def build_top_events_rows(events):
    rows = ""

    for index, (score, event) in enumerate(top_events(events, limit=10), start=1):
        title = get_title(event)
        url = get_url(event)
        location = get_location(event)
        category = get_category(event)
        nature = classify_event_nature(event)
        source = get_source_type(event)

        if url:
            title_html = f'<a href="{escape(url)}" target="_blank">{escape(title)}</a>'
        else:
            title_html = escape(title)

        rows += f"""
        <tr>
            <td>{index}</td>
            <td>{title_html}</td>
            <td>{escape(location)}</td>
            <td>{escape(category)}</td>
            <td>{escape(nature)}</td>
            <td class="score">{score}</td>
            <td>{escape(source)}</td>
        </tr>
        """

    if not rows:
        rows = '<tr><td colspan="7">Nincs elérhető napi esemény.</td></tr>'

    return rows


def build_counter_list(counter):
    if not counter:
        return "<li>Nincs adat.</li>"

    html = ""

    for key, value in counter.most_common(8):
        html += f"<li><span>{escape(str(key))}</span><strong>{value}</strong></li>"

    return html


def build_html(report_day, signal, daily_events, sharecard_path):
    summary = signal.get("summary", {})
    meta = signal.get("meta", {})

    total_events = summary.get("total_events", len(daily_events))
    risk_score = summary.get("normalized_risk_score", 0)
    risk_level = summary.get("risk_level", "UNKNOWN")
    confidence = summary.get("confidence", "N/A")
    updated = meta.get("updated", "Nincs adat")

    location_counter, category_counter, nature_counter, source_counter = summarize_events(daily_events)

    top_location = location_counter.most_common(1)[0][0] if location_counter else "Nincs adat"
    top_nature = nature_counter.most_common(1)[0][0] if nature_counter else "Nincs adat"

    rows = build_top_events_rows(daily_events)

    location_list = build_counter_list(location_counter)
    category_list = build_counter_list(category_counter)
    nature_list = build_counter_list(nature_counter)
    source_list = build_counter_list(source_counter)

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
  max-width: 1180px;
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

.content {{
  padding: 30px 40px;
}}

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

.btn.secondary {{
  background: #0f172a;
}}

.cards {{
  display: grid;
  grid-template-columns: repeat(4, 1fr);
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
  font-size: 32px;
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

.section h2 {{
  margin-top: 0;
}}

.grid4 {{
  display: grid;
  grid-template-columns: repeat(4, 1fr);
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

table {{
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
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
}}

.score {{
  color: #dc2626;
  font-weight: 900;
}}

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

@media print {{
  .actions {{ display: none; }}
  body {{ background: white; }}
  .card, .section {{ box-shadow: none; }}
}}

@media (max-width: 900px) {{
  .hero {{ flex-direction: column; align-items: flex-start; }}
  .cards, .grid4 {{ grid-template-columns: 1fr 1fr; }}
}}

@media (max-width: 600px) {{
  .cards, .grid4 {{ grid-template-columns: 1fr; }}
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
    <div class="label">Fő térség</div>
    <div class="big" style="font-size:22px;">{escape(top_location)}</div>
  </div>
  <div class="card">
    <div class="label">Domináns jelleg</div>
    <div class="big" style="font-size:21px;">{escape(top_nature)}</div>
  </div>
</section>

<section class="section">
  <h2>Rövid napi értékelés</h2>
  <p>
    A rendszer aktuális kockázati szintje <strong>{escape(hu_risk(risk_level))}</strong>,
    az összesített normalizált kockázati index <strong>{escape(str(risk_score))}</strong>.
    A napi események alapján a fő fókuszpont: <strong>{escape(top_location)}</strong>.
    A domináns eseményjelleg: <strong>{escape(top_nature)}</strong>.
  </p>
  <p>
    Az adatok automatizált OSINT-gyűjtésből származnak. A jelentés nem hivatalos
    konfliktus- vagy veszteségstatisztika, hanem korai figyelmeztető jellegű elemzési segédlet.
  </p>
</section>

<section class="section">
  <h2>Napi bontások</h2>
  <div class="grid4">
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
        <th>Cím</th>
        <th>Helyszín</th>
        <th>Kategória</th>
        <th>Eseményjelleg</th>
        <th>Súly</th>
        <th>Forrás</th>
      </tr>
    </thead>
    <tbody>
      {rows}
    </tbody>
  </table>
</section>

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
    Frissítés: {escape(updated)}. Bizalom: {escape(str(confidence))}.
    A drón-, háborús, terrorjellegű és politikai események besorolása kulcsszavas
    automatikus osztályozással történik.
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
        items += f'<li><a href="{escape(report.name)}">{escape(report.stem)}</a></li>'

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
<ul>
{items or "<li>Még nincs jelentés.</li>"}
</ul>
</div>
</body>
</html>
"""

    (REPORTS_DIR / "index.html").write_text(html, encoding="utf-8")


def generate_report():
    signal = load_json(SIGNAL_FILE, {})
    events_raw = load_json(EVENTS_FILE, [])
    events = safe_events(events_raw)

    report_day = today_utc_date()

    daily_events = collect_daily_events(events, report_day)

    if not daily_events:
        summary = signal.get("summary", {})
        period_end = parse_date(summary.get("period_end"))
        if period_end:
            report_day = period_end
            daily_events = collect_daily_events(events, report_day)

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    sharecard_path = generate_sharecard(report_day, signal, daily_events)

    html = build_html(
        report_day=report_day,
        signal=signal,
        daily_events=daily_events,
        sharecard_path=sharecard_path,
    )

    report_path = REPORTS_DIR / f"{report_day.isoformat()}.html"
    report_path.write_text(html, encoding="utf-8")

    update_index()

    print(f"Jelentés elkészült: {report_path}")
    print(f"Blogkép elkészült: {REPORTS_DIR / sharecard_path}")


if __name__ == "__main__":
    generate_report()
