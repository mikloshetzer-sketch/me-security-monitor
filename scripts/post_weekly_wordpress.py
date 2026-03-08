import os
import re
from pathlib import Path
from datetime import datetime, timezone

import requests
import markdown

ARCHIVE_DIR = Path("archive")
BRIEF_FALLBACK = Path("brief.md")

WP_API_BASE = "https://public-api.wordpress.com/rest/v1.1"


def pick_latest_archive() -> Path | None:
    if not ARCHIVE_DIR.exists():
        return None
    files = sorted(ARCHIVE_DIR.glob("brief_*.md"))
    if not files:
        return None
    return files[-1]


def strip_x_thread(markdown_text: str) -> str:
    patterns = [
        r"\n##\s*X THREAD VERSION.*\Z",
        r"\nX THREAD VERSION.*\Z",
    ]
    out = markdown_text
    for pat in patterns:
        out = re.sub(pat, "", out, flags=re.IGNORECASE | re.DOTALL)
    return out.strip() + "\n"


def build_title_from_archive(path: Path) -> str:
    m = re.search(r"brief_(\d{4}-\d{2}-\d{2})\.md$", path.name)
    if m:
        return f"Middle East Security Monitor - Weekly Brief ({m.group(1)})"
    dt = datetime.now(timezone.utc).date().isoformat()
    return f"Middle East Security Monitor - Weekly Brief ({dt})"


def split_sections(md: str):
    parts = re.split(r'(?m)^##\s+', md)
    sections = []

    for i, part in enumerate(parts):
        part = part.strip()
        if not part:
            continue

        if i == 0 and not md.lstrip().startswith("## "):
            sections.append((None, part))
        else:
            lines = part.splitlines()
            section_title = lines[0].strip()
            section_body = "\n".join(lines[1:]).strip()
            sections.append((section_title, section_body))

    return sections


def render_markdown(md: str) -> str:
    return markdown.markdown(
        md,
        extensions=["extra", "tables", "fenced_code", "nl2br"]
    )


def style_html(html: str) -> str:
    html = re.sub(
        r"<h1>(.*?)</h1>",
        r'<h1 style="font-size:26px;line-height:1.25;margin:0 0 14px 0;color:#f8fafc;">\1</h1>',
        html,
        flags=re.DOTALL,
    )
    html = re.sub(
        r"<h2>(.*?)</h2>",
        r'<h2 style="font-size:24px;line-height:1.3;margin:0 0 10px 0;color:#f8fafc;">\1</h2>',
        html,
        flags=re.DOTALL,
    )
    html = re.sub(
        r"<h3>(.*?)</h3>",
        r'<h3 style="font-size:18px;line-height:1.35;margin:20px 0 10px 0;color:#e2e8f0;">\1</h3>',
        html,
        flags=re.DOTALL,
    )
    html = re.sub(
        r"<p>(.*?)</p>",
        r'<p style="margin:0 0 16px 0;font-size:16px;line-height:1.8;color:#f1f5f9;text-align:justify;">\1</p>',
        html,
        flags=re.DOTALL,
    )
    html = re.sub(
        r"<ul>",
        r'<ul style="margin:0 0 18px 22px;padding:0;color:#f1f5f9;line-height:1.8;">',
        html,
        flags=re.DOTALL,
    )
    html = re.sub(
        r"<ol>",
        r'<ol style="margin:0 0 18px 22px;padding:0;color:#f1f5f9;line-height:1.8;">',
        html,
        flags=re.DOTALL,
    )
    html = re.sub(
        r"<li>(.*?)</li>",
        r'<li style="margin:0 0 10px 0;text-align:justify;">\1</li>',
        html,
        flags=re.DOTALL,
    )
    html = re.sub(
        r"<blockquote>(.*?)</blockquote>",
        r'<blockquote style="margin:22px 0;padding:16px 18px;border-left:4px solid #94a3b8;background:#475569;color:#f8fafc;border-radius:10px;">\1</blockquote>',
        html,
        flags=re.DOTALL,
    )
    html = re.sub(
        r"<table>",
        r'<table style="width:100%;border-collapse:collapse;margin:24px 0;background:#f8fafc;border-radius:14px;overflow:hidden;box-shadow:0 8px 20px rgba(0,0,0,0.18);">',
        html,
        flags=re.DOTALL,
    )
    html = re.sub(
        r"<th>(.*?)</th>",
        r'<th style="text-align:left;padding:12px 14px;background:#334155;color:#f8fafc;border:1px solid #64748b;font-size:15px;">\1</th>',
        html,
        flags=re.DOTALL,
    )

    def td_repl(match):
        text_original = match.group(1)
        text = text_original.strip().lower()
        style = 'padding:12px 14px;border:1px solid #cbd5e1;color:#1e293b;font-size:15px;background:#ffffff;'

        if text in {"magas", "high"}:
            style = 'padding:12px 14px;border:1px solid #cbd5e1;color:#7f1d1d;font-size:15px;background:#fee2e2;font-weight:700;'
        elif text in {"közepes", "medium"}:
            style = 'padding:12px 14px;border:1px solid #cbd5e1;color:#92400e;font-size:15px;background:#fef3c7;font-weight:700;'
        elif text in {"alacsony", "low"}:
            style = 'padding:12px 14px;border:1px solid #cbd5e1;color:#166534;font-size:15px;background:#dcfce7;font-weight:700;'

        return f'<td style="{style}">{text_original}</td>'

    html = re.sub(r"<td>(.*?)</td>", td_repl, html, flags=re.DOTALL)

    html = re.sub(
        r"<code>(.*?)</code>",
        r'<code style="background:#475569;color:#f8fafc;padding:2px 6px;border-radius:6px;font-size:14px;">\1</code>',
        html,
        flags=re.DOTALL,
    )
    html = re.sub(
        r"<pre>(.*?)</pre>",
        r'<pre style="background:#0f172a;color:#e2e8f0;padding:18px;border-radius:12px;overflow-x:auto;margin:22px 0;"><code>\1</code></pre>',
        html,
        flags=re.DOTALL,
    )
    return html


def build_styled_content(md_text: str, title: str) -> str:
    sections = split_sections(md_text)
    blocks = []

    for section_title, section_body in sections:
        if section_title is None:
            body_html = style_html(render_markdown(section_body))
            blocks.append(f"""
            <div style="padding:4px 4px 10px 4px;">
              {body_html}
            </div>
            """)
            continue

        title_html = f"""
        <div style="
            background:#e5e7eb;
            color:#0f172a;
            padding:18px 22px;
            border-radius:16px;
            box-shadow:0 6px 18px rgba(0,0,0,0.16);
            margin:0 0 14px 0;
        ">
          <div style="font-size:22px;font-weight:700;line-height:1.3;">
            {section_title}
          </div>
        </div>
        """

        body_html = style_html(render_markdown(section_body))

        blocks.append(f"""
        <section style="margin:0 0 26px 0;">
          {title_html}
          <div style="padding:2px 8px 0 8px;">
            {body_html}
          </div>
        </section>
        """)

    return f"""
    <div style="background:#4b5563;padding:40px 20px;">
      <div style="max-width:1000px;margin:0 auto;display:flex;flex-direction:column;gap:18px;">

        <div style="
            background:linear-gradient(135deg,#475569,#334155);
            padding:26px 28px;
            border-radius:22px;
            color:#f8fafc;
            box-shadow:0 12px 30px rgba(0,0,0,0.22);
            margin-bottom:8px;
        ">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:1.4px;color:#cbd5e1;">
            Middle East Security Monitor
          </div>
          <div style="font-size:30px;font-weight:700;line-height:1.2;margin-top:8px;">
            {title}
          </div>
        </div>

        {''.join(blocks)}

      </div>
    </div>
    """


def main():
    token = os.environ.get("WPCOM_ACCESS_TOKEN", "").strip()
    site = os.environ.get("WPCOM_SITE", "").strip()
    status = os.environ.get("WPCOM_STATUS", "publish").strip().lower()
    source = os.environ.get("WPCOM_SOURCE", "archive").strip().lower()

    if not token:
        raise SystemExit("Missing WPCOM_ACCESS_TOKEN secret.")
    if not site:
        raise SystemExit("Missing WPCOM_SITE secret.")

    src_path = None
    if source == "archive":
        src_path = pick_latest_archive()
    if src_path is None:
        src_path = BRIEF_FALLBACK if BRIEF_FALLBACK.exists() else None
    if src_path is None:
        raise SystemExit("No input found (no archive brief_*.md and no brief.md).")

    raw = src_path.read_text(encoding="utf-8")
    cleaned_md = strip_x_thread(raw)
    title = build_title_from_archive(src_path)
    styled_content = build_styled_content(cleaned_md, title)

    url = f"{WP_API_BASE}/sites/{site}/posts/new"
    headers = {"Authorization": f"Bearer {token}"}

    payload = {
        "title": title,
        "content": styled_content,
        "status": status,
        "format": "standard",
    }

    resp = requests.post(url, headers=headers, data=payload, timeout=60)
    if resp.status_code >= 300:
        raise SystemExit(f"WP post failed ({resp.status_code}): {resp.text}")

    data = resp.json()
    post_url = data.get("URL") or data.get("url") or ""
    post_id = data.get("ID") or data.get("id") or ""

    print(f"Posted weekly brief from: {src_path}")
    print(f"Status: {status}, Post ID: {post_id}")
    if post_url:
        print(f"URL: {post_url}")


if __name__ == "__main__":
    main()
