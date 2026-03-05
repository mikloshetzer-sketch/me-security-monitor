import os
import json
import requests

TOKEN_URL = "https://public-api.wordpress.com/oauth2/token"

def must(name: str) -> str:
    v = (os.getenv(name) or "").strip()
    if not v:
        raise SystemExit(f"Missing env var: {name}")
    return v

def main():
    client_id = must("WP_CLIENT_ID")
    client_secret = must("WP_CLIENT_SECRET")
    redirect_uri = must("WP_REDIRECT_URI")
    code = must("WP_CODE")

    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    }

    r = requests.post(TOKEN_URL, data=data, timeout=60)
    if r.status_code >= 300:
        raise SystemExit(f"Token exchange failed ({r.status_code}): {r.text}")

    payload = r.json()

    # Save bundle as artifact
    out = {
        "access_token": payload.get("access_token"),
        "token_type": payload.get("token_type"),
        "blog_id": payload.get("blog_id"),
        "blog_url": payload.get("blog_url"),
        "scope": payload.get("scope"),
        "expires_in": payload.get("expires_in"),
        # keep refresh_token if WP returns it (sometimes not)
        "refresh_token": payload.get("refresh_token"),
        "generated_at_utc": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "redirect_uri": redirect_uri,
        "client_id": client_id,
    }

    if not out["access_token"]:
        raise SystemExit(f"No access_token in response: {payload}")

    with open("wp_token_bundle.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print("Wrote wp_token_bundle.json (artifact).")
    print("access_token_len =", len(out["access_token"]))

if __name__ == "__main__":
    main()
