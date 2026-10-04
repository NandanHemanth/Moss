"""Google OAuth for a personal account (installed-app flow).

    python -m moss.connectors.google_auth

opens a browser, asks for consent and writes the token file (`GOOGLE_TOKEN`, default backend/token.json)
using the OAuth client in `GOOGLE_CREDENTIALS` (default backend/credentials.json, a "Desktop app" client).

Scopes, the minimum for what Moss does:
  gmail.readonly    search and read mail
  gmail.compose     create drafts (Moss never sends mail)
  calendar.events   read and create events (the calendar's time zone comes back with events.list)

While the OAuth app is in "Testing", Google expires the refresh token after 7 days: run this module again.
Access tokens are refreshed automatically and written back to the token file. Both files are secrets.
"""
import logging
import sys
from pathlib import Path

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

from ..config import settings

log = logging.getLogger("moss.connectors.google")
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.compose",
          "https://www.googleapis.com/auth/calendar.events"]
REAUTH = "run `python -m moss.connectors.google_auth` again (tokens last 7 days while the OAuth app is in Testing)"


def token_path() -> Path:
    return Path(settings.google_token)


def save(creds: Credentials) -> None:
    token_path().write_text(creds.to_json(), encoding="utf-8")


def ensure_fresh(creds: Credentials) -> Credentials:
    """Refresh an expired access token and write it back. Raises RuntimeError when re-consent is needed."""
    if creds.valid:
        return creds
    if not creds.refresh_token:
        raise RuntimeError(f"Google token has no refresh token; {REAUTH}")
    try:
        creds.refresh(Request())
    except RefreshError as e:
        raise RuntimeError(f"Google authorisation expired or was revoked; {REAUTH}") from e
    save(creds)
    log.info("Google access token refreshed")
    return creds


def load_credentials() -> Credentials:
    """Credentials from the token file, refreshed if needed."""
    if not token_path().is_file():
        raise RuntimeError(f"Google token file not found at {token_path()}; {REAUTH}")
    return ensure_fresh(Credentials.from_authorized_user_file(str(token_path()), SCOPES))


def main() -> int:
    from google_auth_oauthlib.flow import InstalledAppFlow

    client = Path(settings.google_credentials)
    if not client.is_file():
        print(f"OAuth client file not found: {client}\n"
              "Download the Desktop-app client JSON from Google Cloud console (Google Auth platform > Clients) "
              "and save it there, or set GOOGLE_CREDENTIALS.")
        return 1
    flow = InstalledAppFlow.from_client_secrets_file(str(client), SCOPES)
    # port=0 picks a free local port; prompt=consent makes Google return a refresh token on every run.
    creds = flow.run_local_server(port=0, prompt="consent")
    save(creds)
    print(f"Saved {token_path()}. Gmail and Calendar are live the next time the backend starts.")
    if not creds.refresh_token:
        print("Warning: Google returned no refresh token; the token will stop working in about an hour.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
