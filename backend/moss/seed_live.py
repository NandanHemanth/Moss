"""Push the demo company into the live accounts, so Jira, Slack and Confluence tell the same story as Moss.

    python -m moss.seed_live [--jira] [--slack] [--confluence] [--dry-run]

Reads backend/data/seed/events.json. With no tool flag, every configured tool is seeded. A tool without
credentials is skipped. Safe to re-run: Jira issues and Confluence pages whose summary/title already
exists are skipped, and so are Slack messages already present in the channel. (Jira's search index lags
a few seconds, so an immediate re-run can still duplicate an issue.)

Gmail and Calendar are not seeded: received mail cannot be fabricated, see docs/03-setup.md.
`--dry-run` only reads (to report what already exists) and writes nothing.
"""
import argparse
import asyncio
import json
import re

from .config import settings
from .connectors.live_atlassian import LiveConfluence, LiveJira
from .connectors.live_slack import LiveSlack


def seed_events(source: str) -> list[dict]:
    events = json.loads((settings.seed_dir / "events.json").read_text(encoding="utf-8"))
    return sorted((e for e in events if e["source"] == source), key=lambda e: -e.get("days_ago", 0))  # oldest first


def jira_summary(title: str) -> str:
    """Seed titles carry a made-up key ("PLAT-138 Rate-limit handling…"); the real key is assigned by Jira."""
    return re.sub(r"^[A-Z][A-Z0-9]+-\d+\s+", "", title).strip()


def slack_text(event: dict) -> str:
    """The bot posts on behalf of the seeded author, so the author's name leads the message in bold."""
    author = (event.get("participants") or ["Someone"])[0]
    return f"*{author}:* {event['body']}"


def _squash(text: str) -> str:
    return " ".join(text.split())


async def seed_jira(dry: bool) -> None:
    jira = LiveJira()
    try:
        existing = {row["summary"].casefold() for row in await jira.search("", 100)}
        for ev in seed_events("jira"):
            summary = jira_summary(ev["title"])
            if summary.casefold() in existing:
                print(f"  jira        skip    {summary} (already exists)")
            elif dry:
                print(f"  jira        would create issue: {summary}")
            else:
                made = await jira.create_issue(summary, ev["body"], (ev.get("meta") or {}).get("assignee"))
                print(f"  jira        created {made['text']}  {made['url']}")
    finally:
        await jira.aclose()


async def seed_slack(dry: bool) -> None:
    slack = LiveSlack()
    try:
        seen: dict[str, str] = {}
        for ev in seed_events("slack"):
            channel = (ev.get("meta") or {}).get("channel") or settings.slack_channel
            if channel not in seen:
                try:
                    seen[channel] = _squash("\n".join(m["text"] for m in await slack.history(channel, 200)))
                except Exception as e:  # the bot is not in the channel yet: posting will join it
                    print(f"  slack       note    cannot read {channel} yet ({e})")
                    seen[channel] = ""
            title = ev["title"]
            if _squash(ev["body"]) in seen[channel]:
                print(f"  slack       skip    {title} (already posted)")
            elif dry:
                print(f"  slack       would post in {channel}: {title}")
            else:
                made = await slack.post_message(channel, slack_text(ev))
                print(f"  slack       posted  {title}  {made['url']}")
    finally:
        await slack.aclose()


async def seed_confluence(dry: bool) -> None:
    confluence = LiveConfluence()
    try:
        for ev in seed_events("confluence"):
            if await confluence.find_page(ev["title"]):
                print(f"  confluence  skip    {ev['title']} (already exists)")
            elif dry:
                print(f"  confluence  would create page: {ev['title']}")
            else:
                made = await confluence.create_page(ev["title"], ev["body"])
                print(f"  confluence  created {ev['title']}  {made['url']}")
    finally:
        await confluence.aclose()


TOOLS = {  # name -> (seeder, is it configured?, what is missing)
    "jira": (seed_jira, LiveJira.is_configured, "ATLASSIAN_SITE, ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN"),
    "slack": (seed_slack, LiveSlack.is_configured, "SLACK_BOT_TOKEN"),
    "confluence": (seed_confluence, LiveConfluence.is_configured, "ATLASSIAN_SITE, ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN"),
}


async def run(tools: list[str], dry: bool) -> int:
    """Seed each tool in turn; one failing tool does not stop the others. Returns the number of failures."""
    failures = 0
    for name in tools:
        seeder, configured, needs = TOOLS[name]
        if not configured():
            print(f"{name}: skipped, not configured (set {needs} in backend/.env)")
            continue
        print(f"{name}:" + (" (dry run, nothing is written)" if dry else ""))
        try:
            await seeder(dry)
        except Exception as e:
            failures += 1
            print(f"  {name} failed: {e}")
    print("gmail, calendar: not seeded. Send yourself two or three emails using the gmail bodies in "
          "data/seed/events.json (see docs/03-setup.md).")
    return failures


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Create the Moss demo issues, messages and pages in the live accounts.")
    for tool in TOOLS:
        ap.add_argument(f"--{tool}", action="store_true", help=f"seed {tool} (default: all configured tools)")
    ap.add_argument("--dry-run", action="store_true", help="show what would be created; write nothing")
    args = ap.parse_args()
    chosen = [t for t in TOOLS if getattr(args, t)] or list(TOOLS)
    raise SystemExit(1 if asyncio.run(run(chosen, args.dry_run)) else 0)
