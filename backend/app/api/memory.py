import asyncio

from fastapi import APIRouter, HTTPException
from google.genai import errors as genai_errors

from .. import db, insights
from ..config import CONNECTOR_MODE, MODEL
from ..memory import graph

router = APIRouter(prefix="/api/system")


@router.get("/status")
def status() -> dict:
    return {"model": MODEL, "connectors": CONNECTOR_MODE, "graph": graph.stats()}


@router.get("/graph")
def graph_neighbors(q: str) -> dict:
    return graph.neighbors(q)


@router.post("/graph/rebuild")
async def graph_rebuild() -> dict:
    """Re-runs Graphify extraction over all source documents (uses Gemini)."""
    result = await asyncio.to_thread(graph.build_semantic)
    if not result["ok"]:
        raise HTTPException(502, result["log"])
    return {k: v for k, v in result.items() if k != "log"}


@router.get("/documents")
def documents(source: str | None = None) -> list[dict]:
    return db.documents(source=source)


@router.post("/meetings/{document_id}/extract")
async def extract_meeting(document_id: int) -> dict:
    try:
        return await insights.extract(document_id)
    except KeyError:
        raise HTTPException(404, f"No meeting transcript with document id {document_id}")
    except genai_errors.APIError as e:
        raise HTTPException(429 if e.code == 429 else 502, f"The model is unavailable right now ({e.code}).")


@router.get("/audit")
def audit(limit: int = 50) -> list[dict]:
    return db.audit_entries(limit)


@router.post("/reset")
def reset() -> dict:
    from .. import seed

    seed.run(force=True)
    graph.invalidate()
    return {"ok": True}
