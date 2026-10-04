import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

MODEL = os.getenv("MOSS_MODEL", "gemini-3.5-flash")
DATA_DIR = Path(os.getenv("MOSS_DATA_DIR", BACKEND_DIR / "data"))
DB_PATH = DATA_DIR / "moss.sqlite3"
GRAPH_DIR = DATA_DIR / "graph"
CACHE_TTL_SECONDS = int(os.getenv("MOSS_CACHE_TTL", "900"))

# "demo" serves seeded data; "live" will call the real service once credentials are configured.
CONNECTOR_MODE = {
    service: os.getenv(f"MOSS_{service.upper()}_MODE", "demo")
    for service in ("gmail", "calendar", "slack", "jira", "zoom", "confluence")
}

DATA_DIR.mkdir(parents=True, exist_ok=True)
