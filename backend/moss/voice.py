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


state = {"voice": None, "note": None}   # what the last call used, for /api/status


async def _tts(voice: str, text: str) -> httpx.Response:
    return await _client().post(f"/v1/text-to-speech/{voice}", params={"output_format": OUTPUT_FORMAT},
                                headers={"xi-api-key": settings.elevenlabs_key, "Accept": "audio/mpeg"},
                                json={"text": text[:MAX_CHARS], "model_id": settings.elevenlabs_model or "eleven_flash_v2_5"},
                                timeout=TIMEOUT)


async def synthesize(text: str) -> bytes | None:
    text = (text or "").strip()
    if not settings.elevenlabs_key or not text:
        return None
    voice = settings.elevenlabs_voice or DEFAULT_VOICE_ID
    try:
        r = await _tts(voice, text)
        if r.status_code in (402, 404) and voice != DEFAULT_VOICE_ID:
            # The configured voice is not in this ElevenLabs account (or not usable on its plan): use the default voice.
            state["note"] = (f"ELEVENLABS_VOICE_ID {voice} is not available to this API key, so the default voice is used. "
                             "Add the voice to My Voices in ElevenLabs (library voices need a paid plan for API use).")
            log.warning(state["note"])
            voice = DEFAULT_VOICE_ID
            r = await _tts(voice, text)
        if r.status_code != 200 or not r.content:
            detail = r.text[:200] if "json" in r.headers.get("content-type", "") else ""
            state.update(voice=None, note=f"ElevenLabs returned {r.status_code}. {detail}"[:240])
            log.warning("ElevenLabs returned %s; using browser speech. %s", r.status_code, detail)
            return None
        state["voice"] = "default" if voice == DEFAULT_VOICE_ID else voice
        if voice == (settings.elevenlabs_voice or DEFAULT_VOICE_ID):
            state["note"] = None
        return r.content
    except Exception as e:  # network errors, timeouts: speech is optional, never fatal
        state.update(voice=None, note=f"ElevenLabs call failed: {type(e).__name__}")
        log.warning("ElevenLabs call failed; using browser speech: %s", type(e).__name__)
        return None


# ---------------------------------------------------------------- sound effects for the grove
# Generated once with ElevenLabs sound generation and kept on disk, so each sound costs credits only the first time.
SFX = {
    "stag": "A gentle magical deer call echoing softly in a misty forest, with a faint shimmering chime",
    "fox": "A small playful fox yip in a quiet forest at night, soft and close, with a light sparkle",
    "owl": "A soft owl hoot, two notes, in a quiet forest at night",
    "raven": "A single distant raven caw in a forest, gentle, with a soft flutter of wings",
    "tortoise": "A slow low wooden creak and a gentle mossy rustle, calm and earthy",
    "firefly": "Delicate fairy-like twinkling chimes, a soft magical shimmer, very gentle",
}
SFX_SECONDS = 2.5


def sfx_path(name: str):
    return settings.db_path.parent / "sfx" / f"{name}.mp3"


async def sound_effect(name: str) -> bytes | None:
    """MP3 bytes for a grove creature. Returns None for an unknown name, no key, or when ElevenLabs refuses."""
    if name not in SFX:
        return None
    path = sfx_path(name)
    if path.is_file() and path.stat().st_size > 0:
        return path.read_bytes()
    if not settings.elevenlabs_key:
        return None
    try:
        r = await _client().post("/v1/sound-generation", headers={"xi-api-key": settings.elevenlabs_key},
                                 json={"text": SFX[name], "duration_seconds": SFX_SECONDS, "prompt_influence": 0.45}, timeout=60)
        if r.status_code != 200 or not r.content:
            log.warning("ElevenLabs sound generation returned %s for %s", r.status_code, name)
            return None
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(r.content)
        return r.content
    except Exception as e:
        log.warning("ElevenLabs sound generation failed for %s: %s", name, type(e).__name__)
        return None
