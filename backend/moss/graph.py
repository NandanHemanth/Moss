"""Memory layer 2 — the knowledge graph.

Two stores, written together:
* LocalGraph: typed, dated facts in SQLite. Deterministic, instant, always on. Feeds the UI graph
  and gives every answer a source link.
* Graphiti (optional): temporal graph on Neo4j, used when NEO4J_PASSWORD and GEMINI_API_KEY are set.
  Ingestion runs in the background because each episode costs several LLM calls.
"""
import asyncio
import logging
import re
from datetime import datetime, timezone

from . import cache, db
from .config import settings
from .schemas import Extraction

log = logging.getLogger("moss.graph")
STOP = set("the a an and or of to in on for with about what did we do does is are was were show me all this that "
           "last from at by it its our us you i who when where which how have has had any".split())
graphiti_state = {"enabled": False, "ok": 0, "failed": 0, "queued": 0, "last_error": None}
_graphiti = None
_graphiti_lock = asyncio.Lock()
_sem = asyncio.Semaphore(1)


def _tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9][a-z0-9\-]+", text.lower()) if t not in STOP]


# ---------------------------------------------------------------- local graph
def add_local(event: dict, ex: Extraction) -> None:
    def fact(subject, st, predicate, obj, ot, text):
        db.insert("facts", {"id": db.new_id("f"), "subject": subject, "subject_type": st, "predicate": predicate,
                            "object": obj, "object_type": ot, "fact": text, "event_id": event["id"],
                            "valid_at": event["occurred_at"], "account": ex.account or event.get("account")})

    title, account = event["title"], ex.account or event.get("account")
    db.x("DELETE FROM facts WHERE event_id=?", (event["id"],))
    if account:
        fact(title, event["source"], "about", account, "account", f"{title} is about {account}: {ex.summary}")
    for p in event.get("participants") or []:
        fact(p, "person", "took part in", title, event["source"], f"{p} took part in {title}")
    for ent in ex.entities:
        if ent.type != "person":
            fact(title, event["source"], "mentions", ent.name, ent.type, f"{title} mentions {ent.type} {ent.name}")
    for ins in ex.insights:
        who = ins.owner or account or title
        due = f" (due {ins.due})" if ins.due else ""
        if ins.kind == "decision":
            fact(account or title, "account" if account else event["source"], "decided", ins.text, "decision",
                 f"Decision in {title}: {ins.text}")
        elif ins.kind == "commitment":
            fact(who, "person" if ins.owner else "account", "committed to", ins.text, "commitment",
                 f"{who} committed in {title}: {ins.text}{due}")
        else:
            fact(account or title, "account" if account else event["source"], "has risk", ins.text, "risk",
                 f"Risk raised in {title}: {ins.text}")


def add_link(event_id: str | None, subject: str, predicate: str, obj: str, obj_type: str, account: str | None) -> None:
    """Record an outcome (e.g. an approved action) so later suggestions can see it."""
    db.insert("facts", {"id": db.new_id("f"), "subject": subject, "subject_type": "event", "predicate": predicate,
                        "object": obj, "object_type": obj_type, "fact": f"{subject} {predicate} {obj}",
                        "event_id": event_id, "valid_at": db.now(), "account": account})
    cache.invalidate("graph")


def search_local(query: str, account: str | None = None, since: str | None = None, until: str | None = None,
                 limit: int = 12, event_ids: set[str] | None = None) -> list[dict]:
    toks = _tokens(query)
    sql, params = "SELECT f.*, e.title AS event_title, e.source AS event_source, e.url AS event_url FROM facts f " \
                  "LEFT JOIN events e ON e.id=f.event_id WHERE 1=1", []
    if account:
        sql += " AND lower(f.account)=lower(?)"; params.append(account)
    if since:
        sql += " AND f.valid_at>=?"; params.append(since)
    if until:
        sql += " AND f.valid_at<=?"; params.append(until)
    scored = []
    for r in db.q(sql, params):
        if event_ids is not None and r["event_id"] not in event_ids:
            continue
        hay = f"{r['fact']} {r['subject']} {r['object']} {r['account'] or ''}".lower()
        score = sum(2 if t in (r["account"] or "").lower() else 1 for t in toks if t in hay)
        if r["object_type"] in ("decision", "commitment", "risk"):
            score *= 1.5
        if score > 0 or not toks:
            scored.append((score, r["valid_at"] or "", r))
    scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
    return [s[2] for s in scored[:limit]]


def export(event_ids: set[str] | None = None, limit: int = 220) -> dict:
    nodes, edges = {}, []
    for r in db.q("SELECT * FROM facts ORDER BY valid_at DESC LIMIT ?", (limit,)):
        if event_ids is not None and r["event_id"] not in event_ids:
            continue
        for name, typ in ((r["subject"], r["subject_type"]), (r["object"], r["object_type"])):
            nodes.setdefault(name, {"id": name, "label": name if len(name) < 60 else name[:57] + "…", "type": typ})
        edges.append({"source": r["subject"], "target": r["object"], "label": r["predicate"],
                      "event_id": r["event_id"], "valid_at": r["valid_at"]})
    return {"nodes": list(nodes.values()), "edges": edges}


# ---------------------------------------------------------------- graphiti
async def _get_graphiti():
    global _graphiti
    async with _graphiti_lock:
        if _graphiti is None:
            from graphiti_core import Graphiti
            from graphiti_core.cross_encoder.gemini_reranker_client import GeminiRerankerClient
            from graphiti_core.embedder.gemini import GeminiEmbedder, GeminiEmbedderConfig
            from graphiti_core.llm_client.gemini_client import GeminiClient, LLMConfig
            key = settings.gemini_key
            g = Graphiti(settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password,
                         llm_client=GeminiClient(config=LLMConfig(api_key=key, model=settings.gemini_fast_model)),
                         embedder=GeminiEmbedder(config=GeminiEmbedderConfig(api_key=key, embedding_model="gemini-embedding-2")),
                         cross_encoder=GeminiRerankerClient(config=LLMConfig(api_key=key, model=settings.gemini_fast_model)),
                         max_coroutines=2)
            await g.build_indices_and_constraints()
            _graphiti = g
            graphiti_state["enabled"] = True
    return _graphiti


def _entity_types() -> dict:
    from pydantic import BaseModel, Field

    class Person(BaseModel):
        role: str | None = Field(default=None, description="Job title or role")

    class Customer(BaseModel):
        industry: str | None = Field(default=None, description="Industry of the customer")

    class Project(BaseModel):
        goal: str | None = Field(default=None, description="What the project is for")

    class Decision(BaseModel):
        rationale: str | None = Field(default=None, description="Why it was decided")

    class Commitment(BaseModel):
        due: str | None = Field(default=None, description="Due date if stated")

    class Risk(BaseModel):
        severity: str | None = Field(default=None, description="low, medium or high")

    class Ticket(BaseModel):
        key: str | None = Field(default=None, description="Issue key such as PLAT-142")

    return {"Person": Person, "Customer": Customer, "Project": Project, "Decision": Decision,
            "Commitment": Commitment, "Risk": Risk, "Ticket": Ticket}


async def _add_graphiti(event: dict) -> None:
    from graphiti_core.nodes import EpisodeType
    async with _sem:
        try:
            g = await _get_graphiti()
            when = datetime.fromisoformat(event["occurred_at"])
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            src = EpisodeType.message if event["source"] in ("meeting", "slack") else EpisodeType.text
            await g.add_episode(name=event["id"], episode_body=f"{event['title']}\n{event['body']}"[:12000],
                                source_description=f"{event['source']} via Moss", reference_time=when, source=src,
                                group_id="moss", entity_types=_entity_types())
            graphiti_state["ok"] += 1
        except Exception as e:
            graphiti_state["failed"] += 1
            graphiti_state["last_error"] = str(e)[:300]
            log.warning("Graphiti ingest failed for %s: %s", event["id"], e)
        finally:
            graphiti_state["queued"] -= 1


async def _search_graphiti(query: str, limit: int) -> list[dict]:
    g = await _get_graphiti()
    edges = await asyncio.wait_for(g.search(query, group_ids=["moss"], num_results=limit), timeout=20)
    return [{"fact": e.fact, "valid_at": e.valid_at.isoformat() if e.valid_at else None, "predicate": e.name,
             "event_id": None, "event_title": None, "event_source": "graphiti", "event_url": None,
             "subject": "", "object": "", "object_type": "fact", "account": None} for e in edges]


# ---------------------------------------------------------------- public API
_tasks: set = set()


async def add_episode(event: dict, ex: Extraction, wait: bool = False) -> None:
    add_local(event, ex)
    cache.invalidate("graph")
    if settings.use_graphiti:
        graphiti_state["queued"] += 1
        task = asyncio.create_task(_add_graphiti(event))
        _tasks.add(task); task.add_done_callback(_tasks.discard)
        if wait:
            await task


async def search(query: str, account: str | None = None, since: str | None = None, until: str | None = None,
                 limit: int = 12, event_ids: set[str] | None = None) -> list[dict]:
    async def run():
        local = search_local(query, account, since, until, limit, event_ids)
        # Graphiti facts carry no per-user scope, so they are only added for unrestricted (manager) queries.
        if settings.use_graphiti and event_ids is None and not graphiti_state["last_error"]:
            try:
                return (await _search_graphiti(query, 6)) + local
            except Exception as e:
                graphiti_state["last_error"] = str(e)[:300]
        return local

    key = cache.key_of(query, account, since, until, limit, sorted(event_ids) if event_ids is not None else None)
    return await cache.get_or_set("graph", key, 120, run)


def snapshot() -> dict:
    return {"backend": "graphiti+local" if settings.use_graphiti else "local",
            "facts": db.one("SELECT count(*) AS n FROM facts")["n"], "graphiti": graphiti_state}
