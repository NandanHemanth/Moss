"""Connection check. `python -m moss.doctor` tests every configured service and says what to fix.

Read-only except for one short ElevenLabs synthesis (about 20 credits) when a key is set.
"""
import asyncio

import httpx

from . import llm
from .config import settings

SLACK_SCOPES = {"channels:read", "channels:history", "channels:join", "chat:write", "users:read"}


def show(state: str, name: str, message: str, hint: str = "") -> None:
    print(f"[{state:^4}] {name:<12} {message}")
    if hint:
        print(f"{'':7}{'':<12} → {hint}")


def env_has_gemini_name() -> bool:
    import os
    return bool(os.getenv("GEMINI_API_KEY", "").strip())


def short(e: Exception) -> str:
    return " ".join(str(e).split())[:200]


async def check_python() -> None:
    import sys
    from importlib.util import find_spec
    need = {"cachetools": "cachetools", "google.genai": "google-genai", "google.adk": "google-adk", "googleapiclient": "google-api-python-client",
            "google_auth_oauthlib": "google-auth-oauthlib", "neo4j": "neo4j", "graphiti_core": "graphiti-core[google-genai]"}
    missing = []
    for module, package in need.items():
        try:
            if not find_spec(module):
                missing.append(package)
        except (ImportError, ValueError):
            missing.append(package)
    if missing:
        show("FAIL", "Python", f"{sys.executable} is missing: {', '.join(missing)}",
             f'Run exactly: "{sys.executable}" -m pip install -r requirements.txt   (same Python that starts uvicorn)')
    else:
        show("OK", "Python", f"{sys.version.split()[0]} at {sys.executable}; all packages present")


async def check_llm() -> None:
    if not settings.gemini_key:
        show("SKIP", "Gemini", "GEMINI_API_KEY not set; Moss runs offline (stored extractions, rule-based proposals)")
    else:
        if not env_has_gemini_name():
            print(f"{'':20} note: using GOOGLE_API_KEY because GEMINI_API_KEY is not set")
        working = []
        for label, chain in (("chat", llm.model_chain()), ("fast", llm.model_chain(fast=True))):
            for i, model in enumerate(chain):
                try:
                    out = await llm._gemini_call("Reply with the single word: ok", "", model, None)
                    note = "" if i == 0 else "  (fallback; the configured model failed)"
                    show("OK", "Gemini", f"{label} model {model} answered: {out.strip()[:20]!r}{note}")
                    working.append(model)
                    break
                except Exception as e:
                    busy = any(code in str(e) for code in ("503", "429", "UNAVAILABLE", "RESOURCE_EXHAUSTED"))
                    hint = ("Temporary overload or quota. Moss tries the next model in GEMINI_FALLBACK_MODELS automatically."
                            if busy else "Unknown model? Set it in .env to one of the models listed below.")
                    show("FAIL", "Gemini", f"{label} model {model}: {short(e)[:120]}", hint)
        if not working:
            try:
                names = [m.name.split("/")[-1] async for m in await llm._gemini().aio.models.list()]
                flash = [n for n in names if "flash" in n and not any(x in n for x in ("image", "tts", "omni", "live", "audio"))]
                print(f"{'':20} text models your key can use: {', '.join(flash)}")
            except Exception as e2:
                print(f"{'':20} could not list models: {short(e2)}")
    if llm.has_fallback():
        try:
            async with httpx.AsyncClient(timeout=10) as http:
                r = await http.get(f"{settings.fallback_base_url.rstrip('/')}/models",
                                   headers={"Authorization": f"Bearer {settings.fallback_key}"})
                r.raise_for_status()
                ids = [m.get("id") for m in r.json().get("data", [])]
            ok = settings.fallback_model in ids
            show("OK" if ok else "FAIL", "Fallback LLM", f"{len(ids)} models at {settings.fallback_base_url}",
                 "" if ok else f"FALLBACK_MODEL={settings.fallback_model!r} is not in the list; first few: {ids[:6]}")
        except Exception as e:
            show("FAIL", "Fallback LLM", short(e), "Is freellmapi running? Check FALLBACK_BASE_URL.")
    else:
        show("SKIP", "Fallback LLM", "FALLBACK_BASE_URL / FALLBACK_MODEL not set")


async def check_graph() -> None:
    if settings.graph_backend == "local" or not settings.neo4j_password:
        show("SKIP", "Neo4j", "Graphiti off (GRAPH_BACKEND=local or NEO4J_PASSWORD empty); using the SQLite fact graph")
        return
    try:
        from neo4j import AsyncGraphDatabase
        driver = AsyncGraphDatabase.driver(settings.neo4j_uri, auth=(settings.neo4j_user, settings.neo4j_password))
        await driver.verify_connectivity()
        await driver.close()
        note = "" if settings.gemini_key else " (Graphiti also needs GEMINI_API_KEY)"
        show("OK", "Neo4j", f"connected to {settings.neo4j_uri}{note}")
    except Exception as e:
        show("FAIL", "Neo4j", short(e), "Start the database in Neo4j Desktop and check NEO4J_URI / NEO4J_PASSWORD.")


async def check_atlassian() -> None:
    from .connectors.live_atlassian import LiveConfluence, LiveJira
    if not LiveJira.is_configured():
        show("SKIP", "Jira", "ATLASSIAN_SITE / ATLASSIAN_EMAIL / ATLASSIAN_API_TOKEN not all set")
        show("SKIP", "Confluence", "same settings as Jira")
        return
    jira = LiveJira()
    try:
        me = await jira._call("GET", "/rest/api/3/myself")
        found = (await jira._call("GET", "/rest/api/3/project/search")).get("values", [])
        keys = {p.get("key"): p.get("name") for p in found}
        if settings.jira_project in keys:
            show("OK", "Jira", f"signed in as {me.get('displayName')}; project {settings.jira_project} “{keys[settings.jira_project]}” found")
        else:
            listing = ", ".join(f"{k} (“{n}”)" for k, n in keys.items()) or "none"
            show("FAIL", "Jira", f"signed in as {me.get('displayName')}, but there is no project with key {settings.jira_project!r}; projects: {listing}",
                 f"Either create a Jira project with key {settings.jira_project}, or set JIRA_PROJECT in .env to one of those keys.")
    except Exception as e:
        show("FAIL", "Jira", short(e), "Check ATLASSIAN_SITE, ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN.")
    conf = LiveConfluence()
    try:
        data = await conf._call("GET", "/wiki/api/v2/spaces", params={"limit": 50})
        keys = [s.get("key") for s in data.get("results", [])]
        keys = [k for k in keys if not str(k).startswith("~")]  # hide personal spaces
        match = next((k for k in keys if str(k).casefold() == settings.confluence_space.casefold()), None)
        if match:
            show("OK", "Confluence", f"space {match} found (all keys: {', '.join(keys)})")
        else:
            show("FAIL", "Confluence", f"space key {settings.confluence_space!r} not found; keys you can see: {', '.join(keys) or 'none'}",
                 "Set CONFLUENCE_SPACE in .env to one of those keys (create a space first if the list is empty).")
    except Exception as e:
        show("FAIL", "Confluence", short(e),
             f"Open {settings.atlassian_site}/wiki in a browser signed in as {settings.atlassian_email}. If Confluence is not "
             "on the site, add it (free) at admin.atlassian.com → Products.")


async def check_slack() -> None:
    if not settings.slack_bot_token:
        show("SKIP", "Slack", "SLACK_BOT_TOKEN not set")
        return
    try:
        async with httpx.AsyncClient(timeout=10, headers={"Authorization": f"Bearer {settings.slack_bot_token}"}) as http:
            r = await http.get("https://slack.com/api/auth.test")
            data = r.json()
            if not data.get("ok"):
                show("FAIL", "Slack", f"auth.test: {data.get('error')}", "Copy the Bot User OAuth Token (xoxb-…) into SLACK_BOT_TOKEN.")
                return
            scopes = {s.strip() for s in r.headers.get("x-oauth-scopes", "").split(",") if s.strip()}
            missing = SLACK_SCOPES - scopes
            if missing:
                show("FAIL", "Slack", f"workspace {data.get('team')}; missing scopes: {', '.join(sorted(missing))}",
                     "api.slack.com/apps → your app → OAuth & Permissions → add them under Bot Token Scopes → Reinstall to Workspace "
                     "→ update SLACK_BOT_TOKEN if it changed.")
                return
            ch = (await http.get("https://slack.com/api/conversations.list",
                                 params={"types": "public_channel", "exclude_archived": "true", "limit": 200})).json()
            names = [c["name"] for c in ch.get("channels", [])]
            joined = [c["name"] for c in ch.get("channels", []) if c.get("is_member")]
            want = settings.slack_channel.lstrip("#")
            ok = want in names
            show("OK" if ok else "FAIL", "Slack", f"workspace {data.get('team')} as {data.get('user')}; bot is in: {', '.join(joined) or 'no channels'}",
                 "" if ok else f"Channel #{want} (SLACK_DEFAULT_CHANNEL) does not exist. Create a public channel named {want} in Slack "
                               f"(and one named accounts), or set SLACK_DEFAULT_CHANNEL to one of: {', '.join(names[:12])}")
    except Exception as e:
        show("FAIL", "Slack", short(e))


async def check_google() -> None:
    from .connectors.live_google import LiveCalendar, LiveGmail
    if not LiveGmail.is_configured():
        from pathlib import Path
        have = Path(settings.google_credentials).is_file()
        show("FAIL", "Gmail", f"not connected: {settings.google_token} does not exist, so incoming email cannot trigger anything",
             "Run: python -m moss.connectors.google_auth" if have else
             f"Copy credentials.json and token.json from the machine where Gmail works into {Path(settings.google_token).parent}, "
             "or copy only credentials.json and run: python -m moss.connectors.google_auth")
        show("FAIL", "Calendar", "same Google sign-in as Gmail")
        return
    for name, call in (("Gmail", lambda: LiveGmail().search("", 1)), ("Calendar", lambda: LiveCalendar().list_events(7))):
        try:
            rows = await call()
            show("OK", name, f"reachable ({len(rows)} item{'s' * (len(rows) != 1)} returned)")
        except Exception as e:
            show("FAIL", name, short(e), "Token expired or revoked? Run: python -m moss.connectors.google_auth")


async def check_voice() -> None:
    if not settings.elevenlabs_key:
        show("SKIP", "ElevenLabs", "ELEVENLABS_API_KEY not set; the browser's own voice is used")
        return
    from . import voice
    audio = await voice.synthesize("Moss voice check.")
    if audio and voice.state["note"]:
        show("FAIL", "ElevenLabs", "speech works, but only with the default voice", voice.state["note"])
    elif audio:
        show("OK", "ElevenLabs", f"returned {len(audio):,} bytes of audio (voice: {voice.state['voice']})")
    else:
        show("FAIL", "ElevenLabs", "no audio returned", "See the warning printed above; try setting ELEVENLABS_VOICE_ID to a voice from your account.")


async def main() -> None:
    print("Moss connection check\n")
    for check in (check_python, check_llm, check_graph, check_atlassian, check_slack, check_google, check_voice):
        try:
            await check()
        except Exception as e:  # a broken check must not hide the others
            show("FAIL", check.__name__[6:], f"check crashed: {short(e)}")
    print("\nFAIL lines include the fix. Restart the backend after changing .env.")


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    asyncio.run(main())
