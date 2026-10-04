"""Live Slack adapter: plain Web API calls with a bot token (`SLACK_BOT_TOKEN`, xoxb-…). No SDK, no Socket Mode.

Auth: `Authorization: Bearer <bot token>` on every call. Bot scopes (see docs/slack-app-manifest.yaml):
  channels:read     conversations.list   channel name <-> id, and which channels the bot is in
  channels:history  conversations.history
  channels:join     conversations.join   join a public channel before posting
  chat:write        chat.postMessage
  users:read        users.info           user id -> display name
auth.test and chat.getPermalink need no scope. Only public channels are handled; a private channel would
also need groups:read and groups:history, and an explicit /invite.

A bot only reads channels it is a member of: invite it (/invite @Moss) or let post_message join for it.
Messages written by `moss.seed_live` are bot posts that start with the author's name in bold
("*Elena Petrova:* …"); `history` shows them under that name, `fetch_events` skips every bot post.
"""
import asyncio
import logging
import re

import httpx

from ..config import settings
from .live_common import local_iso

log = logging.getLogger("moss.connectors.slack")
TIMEOUT = httpx.Timeout(15.0, connect=10.0)
MAX_RETRY_AFTER = 30.0
_JSON = {"Content-Type": "application/json; charset=utf-8"}
_SEEDED = re.compile(r"^\*([^*\n]{2,60}?):?\*:?\s+")
_CHANNEL_ID = re.compile(r"^[CG][A-Z0-9]{8,}$")


class SlackError(RuntimeError):
    """A Slack API failure; `code` is Slack's own `error` string (e.g. not_in_channel)."""

    def __init__(self, method: str, code: str, detail: str = ""):
        super().__init__(f"Slack {method}: {code}{detail}")
        self.code = code


class LiveSlack:
    mode = "live"

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None):
        self._http = httpx.AsyncClient(base_url="https://slack.com/api/", timeout=TIMEOUT, transport=transport,
                                       headers={"Authorization": f"Bearer {settings.slack_bot_token}"})
        self._channels: dict[str, dict] | None = None   # lower-case name -> {id, name, is_member}
        self._users: dict[str, str] = {}                # user id -> display name
        self._workspace: str | None = None              # https://team.slack.com/

    @staticmethod
    def is_configured() -> bool:
        return bool(settings.slack_bot_token)

    async def aclose(self) -> None:
        await self._http.aclose()

    # ------------------------------------------------------------------ transport
    async def _call(self, method: str, *, post: bool = False, **params) -> dict:
        """One Web API call. Reads go as GET query strings, writes as JSON. A 429 is retried once after Retry-After."""
        params = {k: v for k, v in params.items() if v is not None}
        for attempt in (0, 1):
            try:
                r = await (self._http.post(method, json=params, headers=_JSON) if post
                           else self._http.get(method, params=params))
            except httpx.HTTPError as e:
                raise SlackError(method, "request_failed", f" ({type(e).__name__}: {e})") from e
            if r.status_code == 429 and attempt == 0:
                try:
                    wait = float(r.headers.get("Retry-After", "1"))
                except ValueError:
                    wait = 1.0
                await asyncio.sleep(min(max(wait, 0.0), MAX_RETRY_AFTER))
                continue
            break
        if r.status_code == 429:
            raise SlackError(method, "ratelimited")
        try:
            data = r.json()
        except ValueError:
            raise SlackError(method, f"http_{r.status_code}") from None
        if not data.get("ok"):
            code = data.get("error") or f"http_{r.status_code}"
            detail = f" (needs scope {data['needed']})" if data.get("needed") else ""
            if code in ("invalid_auth", "not_authed", "token_revoked", "account_inactive"):
                detail += " (check SLACK_BOT_TOKEN)"
            raise SlackError(method, code, detail)
        return data

    # ------------------------------------------------------------------ lookups (cached)
    async def _channel_map(self, refresh: bool = False) -> dict[str, dict]:
        if self._channels is None or refresh:
            found, cursor = {}, None
            for _ in range(10):  # 10 pages x 200 channels is far beyond a demo workspace
                data = await self._call("conversations.list", types="public_channel", exclude_archived="true",
                                        limit=200, cursor=cursor)
                for c in data.get("channels") or []:
                    found[c["name"].lower()] = {"id": c["id"], "name": c["name"], "is_member": bool(c.get("is_member"))}
                cursor = (data.get("response_metadata") or {}).get("next_cursor")
                if not cursor:
                    break
            self._channels = found
        return self._channels

    async def _resolve(self, channel: str) -> dict:
        """Channel name (with or without #) or id -> {id, name, is_member}."""
        name = (channel or "").strip().lstrip("#")
        if not name:
            raise SlackError("resolve", "channel_not_found", " (no channel given)")
        channels = await self._channel_map()
        if _CHANNEL_ID.match(name):
            return next((c for c in channels.values() if c["id"] == name), {"id": name, "name": name, "is_member": True})
        hit = channels.get(name.lower()) or (await self._channel_map(refresh=True)).get(name.lower())
        if not hit:
            raise SlackError("resolve", "channel_not_found", f" (no public channel named #{name})")
        return hit

    async def _user(self, user_id: str | None) -> str:
        if not user_id:
            return "unknown"
        if user_id not in self._users:
            try:
                u = (await self._call("users.info", user=user_id)).get("user") or {}
                profile = u.get("profile") or {}
                self._users[user_id] = (profile.get("display_name") or profile.get("real_name") or u.get("real_name")
                                        or u.get("name") or user_id)
            except SlackError as e:
                log.info("user lookup failed: %s", e)
                return user_id
        return self._users[user_id]

    async def _permalink(self, channel_id: str, ts: str) -> str | None:
        """Permalink built from the workspace URL (one cached auth.test) instead of one API call per message."""
        if self._workspace is None:
            try:
                self._workspace = (await self._call("auth.test", post=True)).get("url") or ""
            except SlackError:
                self._workspace = ""
        return f"{self._workspace.rstrip('/')}/archives/{channel_id}/p{ts.replace('.', '')}" if self._workspace else None

    async def _text(self, text: str) -> str:
        """Slack markup -> readable text: <@U123> -> @Name, <#C1|name> -> #name, <url|label> -> label."""
        for uid in set(re.findall(r"<@([UW][A-Z0-9]+)>", text)):
            text = text.replace(f"<@{uid}>", "@" + await self._user(uid))
        text = re.sub(r"<#[CG][A-Z0-9]+\|([^>]*)>", r"#\1", text)
        text = re.sub(r"<(?:https?|mailto):[^|>]+\|([^>]+)>", r"\1", text)
        text = re.sub(r"<((?:https?|mailto):[^>]+)>", r"\1", text)
        return text.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")

    async def _messages(self, channel: dict, limit: int, humans_only: bool) -> list[dict]:
        data = await self._call("conversations.history", channel=channel["id"], limit=max(1, min(limit, 200)))
        out = []
        for m in data.get("messages") or []:
            is_bot = bool(m.get("bot_id")) or m.get("subtype") == "bot_message"
            if m.get("type", "message") != "message" or not (m.get("text") or "").strip():
                continue
            if (m.get("subtype") and not is_bot) or (is_bot and humans_only):
                continue  # joins, renames and other system messages; bot posts when only people are wanted
            text = await self._text(m["text"])
            seeded = _SEEDED.match(text) if is_bot else None
            if seeded:
                user, text = seeded.group(1), text[seeded.end():]
            elif is_bot:
                user = m.get("username") or (m.get("bot_profile") or {}).get("name") or "bot"
            else:
                user = await self._user(m.get("user"))
            out.append({"channel": f"#{channel['name']}", "channel_id": channel["id"], "user": user, "text": text,
                        "raw_ts": m["ts"], "ts": local_iso(float(m["ts"])),
                        "url": await self._permalink(channel["id"], m["ts"])})
        return out

    async def _joined(self) -> list[dict]:
        return [c for c in (await self._channel_map(refresh=True)).values() if c["is_member"]]

    # ------------------------------------------------------------------ contract
    async def history(self, channel: str | None = None, limit: int = 30) -> list[dict]:
        targets = [await self._resolve(channel)] if channel else await self._joined()
        rows = []
        for c in targets:
            try:
                rows += await self._messages(c, limit, humans_only=False)
            except SlackError as e:
                if channel:
                    hint = f" (invite the bot: /invite @… in #{c['name']})" if e.code == "not_in_channel" else ""
                    raise SlackError("conversations.history", e.code, hint) from e
                log.warning("skipping #%s: %s", c["name"], e)
        rows.sort(key=lambda r: float(r["raw_ts"]), reverse=True)
        return [{k: r[k] for k in ("channel", "user", "text", "ts", "url")} for r in rows[:limit]]

    async def post_message(self, channel: str, text: str) -> dict:
        if not (text or "").strip():
            raise SlackError("chat.postMessage", "no_text")
        target = await self._resolve(channel or settings.slack_channel)
        if not target["is_member"]:
            await self._join(target)
        try:
            sent = await self._call("chat.postMessage", post=True, channel=target["id"], text=text)
        except SlackError as e:
            if e.code != "not_in_channel":
                raise
            await self._join(target)  # the cached membership was stale
            sent = await self._call("chat.postMessage", post=True, channel=target["id"], text=text)
        ts, channel_id = sent["ts"], sent.get("channel") or target["id"]
        try:
            url = (await self._call("chat.getPermalink", channel=channel_id, message_ts=ts)).get("permalink")
        except SlackError as e:  # the message is already posted; a missing link must not fail the action
            log.info("permalink lookup failed: %s", e)
            url = await self._permalink(channel_id, ts)
        return {"id": ts, "url": url or "", "text": f"Posted in #{target['name']}"}

    async def _join(self, target: dict) -> None:
        try:
            await self._call("conversations.join", post=True, channel=target["id"])
        except SlackError as e:
            hint = f" (could not join #{target['name']}; invite the bot to it or add the channels:join scope)"
            raise SlackError("conversations.join", e.code, hint) from e
        target["is_member"] = True

    async def fetch_events(self, limit: int = 30) -> list[dict]:
        rows = []
        for c in await self._joined():
            try:
                rows += await self._messages(c, limit, humans_only=True)
            except SlackError as e:
                log.warning("skipping #%s: %s", c["name"], e)
        rows.sort(key=lambda r: float(r["raw_ts"]), reverse=True)
        return [{"id": f"slack:{r['channel_id']}:{r['raw_ts']}", "source": "slack",
                 "title": f"{r['channel']} · {' '.join(r['text'].split()[:6])}", "body": r["text"], "occurred_at": r["ts"],
                 "account": None, "participants": [r["user"]], "url": r["url"], "meta": {"channel": r["channel"]}}
                for r in rows[:limit]]
