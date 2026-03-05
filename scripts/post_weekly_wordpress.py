import os
import re
from pathlib import Path
from datetime import datetime, timezone
import requests

ARCHIVE_DIR = Path("archive")
BRIEF_FALLBACK = Path("brief.md")

WP_API_BASE = "https://public-api.wordpress.com/rest/v1.1"


def pick_latest_archive() -> Path | None:
    if not ARCHIVE_DIR.exists():
        return None
    files = sorted(ARCHIVE_DIR.glob("brief_*.md"))
    if not files:
        return None
    # filenames like brief_YYYY-MM-DD.md sort correctly lexicographically
    return files[-1]


def strip_x_thread(markdown: str) -> str:
    """
    Remove the X THREAD section from the blog post.
    Matches either:
      - '## X THREAD VERSION ...' (md heading)
      - 'X THREAD VERSION ...' (plain)
    """
    patterns = [
        r"\n##\s*X THREAD VERSION.*\Z",
        r"\nX THREAD VERSION.*\Z",
    ]
    out = markdown
    for pat in patterns:
        out = re.sub(pat, "", out, flags=re.IGNORECASE | re.DOTALL)
    return out.strip() + "\n"


def build_title_from_archive(path: Path) -> str:
    m = re.search(r"brief_(\d{4}-\d{2}-\d{2})\.md$", path.name)
    if m:
        return f"Middle East Security Monitor — Weekly Brief ({m.group(1)})"
    # fallback
    dt = datetime.now(timezone.utc).date().isoformat()
    return f"Middle East Security Monitor — Weekly Brief ({dt})"


def main():
    token = os.environ.get("WPCOM_ACCESS_TOKEN", "").strip()
    site = os.environ.get("WPCOM_SITE", "").strip()  # site ID or domain (e.g. "example.wordpress.com")
    status = os.environ.get("WPCOM_STATUS", "publish").strip().lower()
    source = os.environ.get("WPCOM_SOURCE", "archive").strip().lower()

    if not token:
        raise SystemExit("Missing WPCOM_ACCESS_TOKEN secret.")
    if not site:
        raise SystemExit("Missing WPCOM_SITE secret.")

    # Choose source file
    src_path = None
    if source == "archive":
        src_path = pick_latest_archive()
    if src_path is None:
        src_path = BRIEF_FALLBACK if BRIEF_FALLBACK.exists() else None
    if src_path is None:
        raise SystemExit("No input found (no archive brief_*.md and no brief.md).")

    raw = src_path.read_text(encoding="utf-8")
    content = strip_x_thread(raw)
    title = build_title_from_archive(src_path)

    # WordPress.com REST endpoint: /sites/{site}/posts/new
    url = f"{WP_API_BASE}/sites/{site}/posts/new"
    headers = {"Authorization": f"Bearer {token}"}

    payload = {
        "title": title,
        "content": content,
        "status": status,  # "publish" or "draft"
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
