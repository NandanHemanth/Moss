"""Knowledge graph memory.

Two sources are merged into one networkx graph:
- a structured graph built from SQLite records (accounts, people, topics, issues, sources), always available;
- a semantic graph extracted by Graphify from the raw documents, loaded when `graph.json` exists.

Graphify extracts from files, so every document is written to a markdown corpus first and
`graphify extract` runs over that folder (see `build_semantic`).
"""

import json
import os
import re
import subprocess
import sys
import threading
from typing import Any

import networkx as nx

from .. import db
from ..config import GRAPH_DIR, MODEL

CORPUS_DIR = GRAPH_DIR / "corpus"
GRAPHIFY_JSON = GRAPH_DIR / "graphify-out" / "graph.json"
SOURCE_LABEL = {"gmail": "Gmail", "slack": "Slack", "jira": "Jira", "zoom": "Zoom", "confluence": "Confluence", "calendar": "Calendar"}

_lock = threading.Lock()
_graph: nx.Graph | None = None


def _norm(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", text.lower()))


def _person(name: str) -> str:
    return re.sub(r"\s*\(.*\)$", "", name).strip()


def _structured() -> nx.Graph:
    g = nx.Graph()
    accounts = {a["id"]: a for a in db.all_rows("accounts")}
    for a in accounts.values():
        acc = f"account:{a['name']}"
        g.add_node(acc, kind="account", label=a["name"], accountId=a["id"])
        g.add_node(f"person:{a['owner']}", kind="person", label=a["owner"])
        g.add_edge(acc, f"person:{a['owner']}", relation="owned by")
        for topic in a["topics"]:
            g.add_node(f"topic:{topic}", kind="topic", label=topic)
            g.add_edge(acc, f"topic:{topic}", relation="interested in")
    for d in db.documents():
        doc = f"doc:{d['id']}"
        g.add_node(doc, kind="source", label=f"{SOURCE_LABEL.get(d['source'], d['source'])} · {d['title']}", source=d["source"])
        if d["accountId"] in accounts:
            g.add_edge(doc, f"account:{accounts[d['accountId']]['name']}", relation="mentions")
        people = d["meta"].get("participants", [])
        if key := d["meta"].get("key"):
            g.add_node(f"issue:{key}", kind="issue", label=f"{key} · {d['title'].split('·')[-1].strip()}")
            g.add_edge(doc, f"issue:{key}", relation="describes")
            if d["meta"].get("assignee"):
                people = [*people, d["meta"]["assignee"]]
        for person in people:
            p = f"person:{_person(person)}"
            g.add_node(p, kind="person", label=_person(person))
            g.add_edge(doc, p, relation="involves")
            if d["accountId"] in accounts and "(" in person:
                g.add_edge(p, f"account:{accounts[d['accountId']]['name']}", relation="works at")
    for c in db.all_rows("commitments"):
        node = f"commitment:{c['id']}"
        g.add_node(node, kind="commitment", label=c["title"], status=c["status"])
        g.add_edge(node, f"person:{c['owner']}", relation="owned by")
        if c.get("accountId") in accounts:
            g.add_edge(node, f"account:{accounts[c['accountId']]['name']}", relation="for")
    return g


def _semantic() -> nx.Graph:
    """Loads Graphify's node-link graph.json, if extraction has been run.

    Graphify nodes extracted from a corpus file map onto that document's structured node, so its
    cross-document links (e.g. a call referencing a FAQ) connect directly into the structured graph.
    """
    if not GRAPHIFY_JSON.exists():
        return nx.Graph()
    data = json.loads(GRAPHIFY_JSON.read_text(encoding="utf-8"))
    g = nx.Graph()
    node_ids: dict[str, str] = {}
    for n in data.get("nodes", []):
        match = re.fullmatch(r"[a-z]+-(\d+)\.md", n.get("source_file") or "")
        if match and n.get("file_type") in ("document", "code"):
            node_ids[n["id"]] = f"doc:{match.group(1)}"
        else:
            node_ids[n["id"]] = f"g:{n['id']}"
            g.add_node(node_ids[n["id"]], kind="concept", label=n.get("label") or str(n["id"]))
    for e in data.get("links", data.get("edges", [])):
        if e["source"] in node_ids and e["target"] in node_ids:
            g.add_edge(
                node_ids[e["source"]],
                node_ids[e["target"]],
                relation=e.get("relation", "related"),
                confidence=e.get("confidence_score"),
                graphify=True,
            )
    return g


def graph() -> nx.Graph:
    global _graph
    with _lock:
        if _graph is None:
            _graph = nx.compose(_structured(), _semantic())
        return _graph


def invalidate() -> None:
    global _graph
    with _lock:
        _graph = None


def find(query: str, kinds: tuple[str, ...] = ()) -> list[str]:
    """Nodes whose label matches the query, best matches first."""
    q = _norm(query)
    if not q:
        return []
    hits = []
    for node, attrs in graph().nodes(data=True):
        if kinds and attrs.get("kind") not in kinds:
            continue
        label = _norm(attrs.get("label", ""))
        if q == label:
            hits.append((0, node))
        elif q in label or (label and label in q):
            hits.append((1, node))
    return [n for _, n in sorted(hits)]


def neighbors(query: str, limit: int = 15) -> dict[str, Any]:
    """The entity matching `query` and everything one hop away from it, grouped by kind."""
    g = graph()
    matches = find(query)
    if not matches:
        return {"entity": None, "related": {}}
    node = matches[0]
    related: dict[str, list[str]] = {}
    direct = list(g.neighbors(node))[:limit]
    for other in direct:
        attrs = g.nodes[other]
        related.setdefault(attrs.get("kind", "other"), []).append(attrs.get("label", other))
    linked = []
    for other in direct:
        for far in g.neighbors(other):
            edge = g.edges[other, far]
            if edge.get("graphify") and far != node and far not in direct:
                linked.append(f"{g.nodes[other].get('label')} → {edge.get('relation', 'related')} → {g.nodes[far].get('label')}")
    return {
        "entity": g.nodes[node].get("label", node),
        "kind": g.nodes[node].get("kind"),
        "related": related,
        "linkedSources": linked[:limit],
    }


def accounts_for_topic(topic: str) -> list[str]:
    g = graph()
    names: list[str] = []
    for node in find(topic, kinds=("topic", "concept")):
        for other in g.neighbors(node):
            if g.nodes[other].get("kind") == "account":
                label = g.nodes[other]["label"]
                if label not in names:
                    names.append(label)
    return names


def stats() -> dict[str, Any]:
    g = graph()
    kinds: dict[str, int] = {}
    for _, attrs in g.nodes(data=True):
        kinds[attrs.get("kind", "other")] = kinds.get(attrs.get("kind", "other"), 0) + 1
    return {"nodes": g.number_of_nodes(), "edges": g.number_of_edges(), "byKind": kinds, "graphify": GRAPHIFY_JSON.exists()}


def export_corpus() -> int:
    """Writes each source document as markdown so Graphify can extract from it."""
    CORPUS_DIR.mkdir(parents=True, exist_ok=True)
    accounts = {a["id"]: a["name"] for a in db.all_rows("accounts")}
    docs = db.documents()
    for d in docs:
        header = [f"# {d['title']}", "", f"- Source: {SOURCE_LABEL.get(d['source'], d['source'])}", f"- Date: {d['occurredAt'][:10]}"]
        if d["accountId"] in accounts:
            header.append(f"- Customer account: {accounts[d['accountId']]}")
        for k, v in d["meta"].items():
            if isinstance(v, str) and k != "uuid":
                header.append(f"- {k}: {v}")
            elif isinstance(v, list) and all(isinstance(x, str) for x in v):
                header.append(f"- {k}: {', '.join(v)}")
        (CORPUS_DIR / f"{d['source']}-{d['id']}.md").write_text("\n".join(header) + "\n\n" + d["body"] + "\n", encoding="utf-8")
    return len(docs)


def build_semantic(timeout: int = 900) -> dict[str, Any]:
    """Runs Graphify's headless extraction over the corpus with Gemini."""
    export_corpus()
    env = {**os.environ, "GRAPHIFY_GEMINI_MODEL": MODEL, "GRAPHIFY_NO_AUTO_REFRESH": "1", "GRAPHIFY_QUERY_LOG_DISABLE": "1"}
    proc = subprocess.run(
        [sys.executable, "-m", "graphify", "extract", str(CORPUS_DIR), "--backend", "gemini", "--model", MODEL, "--out", str(GRAPH_DIR)],
        capture_output=True,
        text=True,
        env=env,
        timeout=timeout,
    )
    invalidate()
    return {"ok": proc.returncode == 0, "returncode": proc.returncode, "log": (proc.stdout + proc.stderr)[-2000:], **stats()}
