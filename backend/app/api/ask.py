import logging
from typing import Literal

from fastapi import APIRouter, HTTPException
from google.genai import errors as genai_errors
from pydantic import BaseModel

from ..agents import runner

router = APIRouter(prefix="/api")
log = logging.getLogger("uvicorn.error")


class AskRequest(BaseModel):
    question: str
    role: Literal["manager", "employee"] = "manager"
    agent: str = "orchestrator"
    user: str = "Dana Kim"
    sessionId: str | None = None


@router.post("/ask")
async def ask(req: AskRequest) -> dict:
    try:
        return await runner.ask(req.question, req.role, req.agent, req.user, req.sessionId)
    except runner.AccessDenied as e:
        raise HTTPException(403, str(e))
    except KeyError:
        raise HTTPException(404, f"Unknown agent: {req.agent}")
    except genai_errors.APIError as e:
        log.warning("Gemini error %s: %s", e.code, e.message)
        status = 429 if e.code == 429 else 502
        raise HTTPException(status, f"The model is unavailable right now ({e.code}). Try again shortly.")
