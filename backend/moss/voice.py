"""Spoken notifications through ElevenLabs text-to-speech.

`synthesize` returns MP3 bytes, or None when `ELEVENLABS_API_KEY` is unset or anything goes wrong; the
frontend then falls back to the browser's built-in speech synthesis. It never raises.

API: POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128
     header `xi-api-key: <key>`, JSON body {"text", "model_id"}; the response body is the audio.
`mp3_44100_128` is the default output format and is available on the free plan. Each character costs
credits, so the text is capped and the API layer caches audio per notification.
"""
import logging

import httpx

from .config import settings

log = logging.getLogger("moss.voice")
API = "https://api.elevenlabs.io"
DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"   # "George", the voice used in ElevenLabs' own API reference example
OUTPUT_FORMAT = "mp3_44100_128"
MAX_CHARS = 1000
TIMEOUT = 20.0

_http: httpx.AsyncClient | None = None


def _client() -> httpx.AsyncClient:
    """One shared client. Tests replace `voice._http` with a client on an httpx.MockTransport."""
    global _http
    if _http is None:
        _http = httpx.AsyncClient(base_url=API, timeout=TIMEOUT)
    return _http


async def synthesize(text: str) -> bytes | None:
    text = (text or "").strip()
    if not settings.elevenlabs_key or not text:
        return None
    voice = settings.elevenlabs_voice or DEFAULT_VOICE_ID
    try:
        r = await _client().post(f"/v1/text-to-speech/{voice}", params={"output_format": OUTPUT_FORMAT},
                                 headers={"xi-api-key": settings.elevenlabs_key, "Accept": "audio/mpeg"},
                                 json={"text": text[:MAX_CHARS], "model_id": settings.elevenlabs_model or "eleven_flash_v2_5"},
                                 timeout=TIMEOUT)
        if r.status_code != 200 or not r.content:
            detail = r.text[:200] if "json" in r.headers.get("content-type", "") else ""
            log.warning("ElevenLabs returned %s; using browser speech. %s", r.status_code, detail)
            return None
        return r.content
    except Exception as e:  # network errors, timeouts, bad voice id: speech is optional, never fatal
        log.warning("ElevenLabs call failed; using browser speech: %s", type(e).__name__)
        return None
