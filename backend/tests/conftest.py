import os
import tempfile

# Tests always run offline: no LLM key, mock connectors, throwaway database.
os.environ["MOSS_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["MOSS_FORCE_MOCK"] = "1"
for k in ("GEMINI_API_KEY", "FALLBACK_BASE_URL", "NEO4J_PASSWORD", "ELEVENLABS_API_KEY"):
    os.environ[k] = ""
