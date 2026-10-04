"""Connector registry. A tool is live when its adapter imports and reports itself configured."""
import importlib
import logging

from ..config import settings
from . import mock

log = logging.getLogger("moss.connectors")
_SPECS = {  # tool -> (module, class, mock class)
    "jira": ("live_atlassian", "LiveJira", mock.MockJira),
    "confluence": ("live_atlassian", "LiveConfluence", mock.MockConfluence),
    "slack": ("live_slack", "LiveSlack", mock.MockSlack),
    "gmail": ("live_google", "LiveGmail", mock.MockGmail),
    "calendar": ("live_google", "LiveCalendar", mock.MockCalendar),
}
_instances: dict = {}


def get(tool: str):
    if tool not in _instances:
        module, cls, mock_cls = _SPECS[tool]
        inst = None
        if not settings.force_mock:
            try:
                live = getattr(importlib.import_module(f"{__name__}.{module}"), cls)
                if live.is_configured():
                    inst = live()
            except Exception as e:  # missing module, missing dependency, bad credentials file
                log.warning("%s live adapter unavailable, using mock: %s", tool, e)
        _instances[tool] = inst or mock_cls()
    return _instances[tool]


def jira(): return get("jira")
def confluence(): return get("confluence")
def slack(): return get("slack")
def gmail(): return get("gmail")
def calendar(): return get("calendar")


def reason(tool: str) -> str | None:
    """Plain-language reason a tool is on its mock adapter, with the fix. None when it is live."""
    if get(tool).mode == "live":
        return None
    if settings.force_mock:
        return "MOSS_FORCE_MOCK=1 is set in backend/.env."
    if tool in ("gmail", "calendar"):
        from importlib.util import find_spec
        from pathlib import Path
        if not Path(settings.google_token).is_file():
            have = Path(settings.google_credentials).is_file()
            return ("No Google sign-in on this machine. " + ("Run: python -m moss.connectors.google_auth" if have else
                    "Copy credentials.json and token.json into the backend folder (or copy credentials.json and run: "
                    "python -m moss.connectors.google_auth), then restart the backend."))
        if not (find_spec("googleapiclient") and find_spec("google_auth_oauthlib")):
            return "Google libraries are missing. Run: python -m pip install google-auth-oauthlib google-api-python-client"
        return "Google sign-in failed to load; run python -m moss.doctor for details."
    if tool in ("jira", "confluence"):
        return "Set ATLASSIAN_SITE, ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN in backend/.env, then restart."
    if tool == "slack":
        return "Set SLACK_BOT_TOKEN in backend/.env, then restart."
    return None


def modes() -> dict:
    return {tool: get(tool).mode for tool in _SPECS} | {"meeting": "seeded"}


def reset() -> None:
    _instances.clear()
