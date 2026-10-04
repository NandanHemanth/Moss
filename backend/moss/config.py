"""Settings, read once from backend/.env or the process environment."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


def env(key: str, default: str = "") -> str:
    return os.getenv(key, default).strip()


class Settings:
    # LLM
    gemini_key = env("GEMINI_API_KEY")
    gemini_model = env("GEMINI_MODEL", "gemini-3.8-flash")            # chat + proposals
    gemini_fast_model = env("GEMINI_FAST_MODEL", "gemini-3.5-flash-lite")  # extraction
    fallback_base_url = env("FALLBACK_BASE_URL")                      # e.g. http://localhost:3001/v1 (freellmapi)
    fallback_key = env("FALLBACK_API_KEY", "none")
    fallback_model = env("FALLBACK_MODEL")

    # Memory
    db_path = Path(env("MOSS_DB", str(ROOT / "data" / "moss.db")))
    graph_backend = env("GRAPH_BACKEND", "auto")                      # auto | graphiti | local
    neo4j_uri = env("NEO4J_URI", "bolt://localhost:7687")
    neo4j_user = env("NEO4J_USER", "neo4j")
    neo4j_password = env("NEO4J_PASSWORD")

    # Connectors (a connector is live only when its credentials are present)
    force_mock = env("MOSS_FORCE_MOCK") == "1"
    atlassian_site = env("ATLASSIAN_SITE").rstrip("/")                # https://yoursite.atlassian.net
    atlassian_email = env("ATLASSIAN_EMAIL")
    atlassian_token = env("ATLASSIAN_API_TOKEN")
    jira_project = env("JIRA_PROJECT", "PLAT")
    confluence_space = env("CONFLUENCE_SPACE", "ENG")
    slack_bot_token = env("SLACK_BOT_TOKEN")
    slack_channel = env("SLACK_DEFAULT_CHANNEL", "platform")
    google_credentials = env("GOOGLE_CREDENTIALS", str(ROOT / "credentials.json"))
    google_token = env("GOOGLE_TOKEN", str(ROOT / "token.json"))
    calendar_send_updates = env("CALENDAR_SEND_UPDATES", "all")       # all | externalOnly | none: email invited guests?

    # Voice
    elevenlabs_key = env("ELEVENLABS_API_KEY")
    elevenlabs_voice = env("ELEVENLABS_VOICE_ID")
    elevenlabs_model = env("ELEVENLABS_MODEL", "eleven_flash_v2_5")

    seed_dir = ROOT / "data" / "seed"
    cors_origins = [o for o in env("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o]

    @property
    def use_graphiti(self) -> bool:
        if self.graph_backend == "local":
            return False
        return bool(self.neo4j_password and self.gemini_key)


settings = Settings()

# The grove. Names live here only; rename freely.
AGENTS = {
    "stag": {"name": "Stag", "epithet": "The White Stag", "tool": "Orchestrator", "manager_only": True,
             "description": "Guardian of the grove. Plans across every agent and proposes next steps."},
    "raven": {"name": "Raven", "epithet": "The Message Raven", "tool": "Gmail + Calendar", "manager_only": False,
              "description": "Carries email and keeps the calendar."},
    "firefly": {"name": "Firefly", "epithet": "The Lantern Firefly", "tool": "Slack", "manager_only": False,
                "description": "Follows the flicker of channel chatter."},
    "fox": {"name": "Fox", "epithet": "The Ember Fox", "tool": "Jira", "manager_only": False,
            "description": "Tracks every ticket down its trail."},
    "owl": {"name": "Owl", "epithet": "The Moon Owl", "tool": "Zoom meetings", "manager_only": False,
            "description": "Listens to meetings and remembers what was decided."},
    "tortoise": {"name": "Tortoise", "epithet": "The Moss Tortoise", "tool": "Confluence", "manager_only": False,
                 "description": "Ancient keeper of the written lore."},
}
SOURCE_AGENT = {"gmail": "raven", "calendar": "raven", "slack": "firefly", "jira": "fox",
                "meeting": "owl", "confluence": "tortoise"}
