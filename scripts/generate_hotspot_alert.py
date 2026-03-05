import json
from datetime import datetime, timedelta, timezone
from collections import defaultdict

EVENTS_PATH = "events.json"
OUT_PATH = "hotspot_alert.md"

CAT_W = {"military": 3.0, "security": 2.0, "political": 1.0, "other": 0.5}
ISW_MULT = 1.3

MAP_URL = "https://mikloshetzer-sketch.github.io/me-security-monitor"

def norm_cat(c: str) -> str:
    c = (c or "other").strip().lower()
    return c if c in CAT_W else "other"

def source_type(ev) -> str:
    t = (((ev.get("source") or {}).get("type")) or "news").strip().lower()
    return "isw" if t == "isw" else "news"

def safe(s):
    return (s or "").replace("\n", " ").strip()

def parse_event_dt(d):
    """
    Supports:
    - YYYY-MM-DD
    - ISO datetime e.g. YYYY-MM-DDTHH:MM:SSZ
    If only date exists, we treat it as 00:00 UTC (coarser, but consistent).
    """
    if not d:
        return None
    try:
        if "T" in d:
            return datetime.fromisoformat(d.replace("Z", "+00:00"))
        dt = datetime.strptime(d, "%Y-%m-%d")
        return dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None

def recency_weight(now: datetime, ev_dt: datetime, window_hours: int) -> float:
    # newest=1.0 .. oldest=0.6 (within the 24h window)
    age_h = max(0.0, (now - ev_dt).total_seconds() / 3600.0)
    if window_hours <= 1:
        return 1.0
    t = min(1.0, age_h / window_hours)
    return 1.0 - 0.4 * t

def risk_score(now: datetime, ev, window_hours: int) -> float:
    cat = norm_cat(ev.get("category"))
    w_cat = CAT_W[cat]
    w_src = ISW_MULT if source_type(ev) == "isw" else 1.0
    ev_dt = parse_event_dt(ev.get("date"))
    if not ev_dt:
        return 0.0
    w_rec = recency_weight(now, ev_dt, window_hours)
    return w_cat * w_src * w_rec

def dominant_category(events):
    counts = defaultdict(int)
    for ev in events:
        counts[norm_cat(ev.get("category"))] += 1
    if not counts:
        return "none"
    return max(counts.items(), key=lambda kv: kv[1])[0]

def top_titles(events, now, n=3):
    scored = []
    for ev in events:
        s = risk_score(now, ev, 24)
        title = safe(ev.get("title") or "Untitled")
        url = safe(((ev.get("source") or {}).get("url")) or "")
        scored.append((s, title, url))
    scored.sort(key=lambda x: x[0], reverse=True)
    out = []
    for s, title, url in scored[:n]:
        if url:
            out.append(f"- {title} ({url})")
        else:
            out.append(f"- {title}")
    return out

def main():
    now = datetime.now(timezone.utc)
    w = timedelta(hours=24)
    start_curr = now - w
    start_prev = now - 2*w

    with open(EVENTS_PATH, "r", encoding="utf-8") as f:
        events = json.load(f)

    curr = []
    prev = []

    for ev in events:
        ev_dt = parse_event_dt(ev.get("date"))
        if not ev_dt:
            continue
        if start_curr <= ev_dt <= now:
            curr.append(ev)
        elif start_prev <= ev_dt < start_curr:
            prev.append(ev)

    # Risk by location in each window
    risk_curr = defaultdict(float)
    risk_prev = defaultdict(float)

    events_curr_by_loc = defaultdict(list)

    for ev in curr:
        loc = safe(((ev.get("location") or {}).get("name")) or "Unknown") or "Unknown"
        s = risk_score(now, ev, 24)
        risk_curr[loc] += s
        events_curr_by_loc[loc].append(ev)

    # For previous window, use a "now_prev" anchor so recency is comparable within that window
    now_prev = start_curr
    for ev in prev:
        loc = safe(((ev.get("location") or {}).get("name")) or "Unknown") or "Unknown"
        s = risk_score(now_prev, ev, 24)
        risk_prev[loc] += s

    if not risk_curr:
        # Write a stable "no alert" file (prevents confusion; git commit won't change if identical)
        out = [
            "# Hotspot Alert",
            "",
            f"**Generated:** {now.isoformat()}",
            "",
            "No alert: no events detected in the last 24 hours.",
            "",
            "## X POST VERSION",
            "",
            "No hotspot alert in the last 24 hours.",
            f"Map + sources: {MAP_URL}",
            "",
        ]
        with open(OUT_PATH, "w", encoding="utf-8") as f:
            f.write("\n".join(out))
        print("Hotspot alert: no events.")
        return

    # Top location in current window
    top_loc, top_r = max(risk_curr.items(), key=lambda kv: kv[1])

    # Baseline in previous window for same location
    prev_r = risk_prev.get(top_loc, 0.0)

    total_curr = sum(risk_curr.values())
    share = (top_r / total_curr) if total_curr > 0 else 0.0

    # Spike rule (tunable, conservative)
    # - meaningful current risk
    # - at least 2x vs previous (or previous ~0 and current strong)
    # - and concentrated enough to call it a hotspot
    MIN_RISK = 25.0
    MULT = 2.0
    MIN_SHARE = 0.35

    spike = False
    if top_r >= MIN_RISK and share >= MIN_SHARE:
        if prev_r <= 1.0 and top_r >= (MIN_RISK * 1.2):
            spike = True
        elif prev_r > 0 and (top_r / prev_r) >= MULT:
            spike = True

    dom_cat = dominant_category(events_curr_by_loc.get(top_loc, []))
    evidence = top_titles(events_curr_by_loc.get(top_loc, []), now, n=3)

    if spike:
        out = []
        out.append("# Hotspot Alert")
        out.append("")
        out.append(f"**Generated:** {now.isoformat()}")
        out.append("")
        out.append(f"## Alert: Risk spike detected — **{top_loc}**")
        out.append(f"- Current 24h risk (approx.): **{top_r:.1f}**")
        out.append(f"- Previous 24h risk (approx.): **{prev_r:.1f}**")
        out.append(f"- Current share of window risk: **{share*100:.0f}%**")
        out.append(f"- Dominant category (top location): **{dom_cat}**")
        out.append("")
        out.append("### Top supporting items (from last 24h)")
        out.extend(evidence if evidence else ["- No titles available."])
        out.append("")
        out.append("## X POST VERSION")
        out.append("")
        out.append("🚨 Hotspot Alert (last 24h)")
        out.append("")
        out.append(f"Risk spike detected in **{top_loc}**.")
        out.append(f"Current risk: {top_r:.1f} vs previous 24h: {prev_r:.1f} (share: {share*100:.0f}%).")
        out.append(f"Dominant category: {dom_cat}.")
        out.append("")
        out.append(f"Map + sources: {MAP_URL}")
        out.append("")
        with open(OUT_PATH, "w", encoding="utf-8") as f:
            f.write("\n".join(out))
        print(f"Hotspot alert: spike detected in {top_loc}.")
    else:
        # Stable "no alert" message (still useful for transparency)
        out = [
            "# Hotspot Alert",
            "",
            f"**Generated:** {now.isoformat()}",
            "",
            "No hotspot alert: no location met the spike thresholds in the last 24 hours.",
            "",
            f"Top current hotspot (by risk): {top_loc} ({top_r:.1f}), prev 24h: {prev_r:.1f}, share: {share*100:.0f}%.",
            "",
            "## X POST VERSION",
            "",
            "No hotspot alert in the last 24 hours (no spike thresholds met).",
            f"Map + sources: {MAP_URL}",
            "",
        ]
        with open(OUT_PATH, "w", encoding="utf-8") as f:
            f.write("\n".join(out))
        print("Hotspot alert: no spike thresholds met.")

if __name__ == "__main__":
    main()
