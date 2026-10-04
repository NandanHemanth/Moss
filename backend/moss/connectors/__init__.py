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


def modes() -> dict:
    return {tool: get(tool).mode for tool in _SPECS} | {"meeting": "seeded"}


def reset() -> None:
    _instances.clear()
