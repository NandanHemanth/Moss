from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import seed
from .agents import team
from .agents.runner import APP_NAME
from .api import ask, memory, resources

seed.run()

app = FastAPI(title="Moss API")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


# Registered before the generic /api/{resource} routes so these paths are not captured as resources.
app.include_router(ask.router)
app.include_router(memory.router)
app.include_router(resources.router)

# AG-UI endpoint for the orchestrator, for CopilotKit clients.
add_adk_fastapi_endpoint(app, ADKAgent(adk_agent=team.orchestrator(), app_name=APP_NAME, user_id="Dana Kim"), path="/agui")
