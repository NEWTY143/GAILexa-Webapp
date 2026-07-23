"""
GAILexa Whisper service — speech-to-text with automatic language detection.

POST /transcribe  (multipart form, field "audio": webm/ogg/wav clip)
  → { "text": "...", "language": "hi" | "en" | ..., "probability": 0.98 }

The model is loaded lazily on the first request so /health responds
immediately after deploy while the model downloads in the background
of the first transcription.
"""

import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

# Whisper model source — works both on the air-gapped GAIL server and on a
# cloud host such as Render:
#
#   * If a sideloaded model folder is present (GAIL server), it is used and
#     HuggingFace access is disabled so no network call is ever attempted.
#   * Otherwise the model name is used and faster-whisper downloads it on
#     first use (Render, or any host with internet).
#
# Override the folder explicitly with WHISPER_MODEL_PATH if needed.
_HERE = Path(__file__).parent
MODEL_SIZE = os.getenv("WHISPER_MODEL", "tiny")
_LOCAL_MODEL = Path(
    os.getenv("WHISPER_MODEL_PATH", str(_HERE / "models" / f"faster-whisper-{MODEL_SIZE}"))
)
_HAS_LOCAL_MODEL = (_LOCAL_MODEL / "model.bin").exists()

if _HAS_LOCAL_MODEL:
    # Offline deployment — never reach out to HuggingFace.
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    MODEL_PATH = str(_LOCAL_MODEL)
else:
    # Cloud deployment — let faster-whisper fetch the model by name.
    MODEL_PATH = MODEL_SIZE

app = FastAPI(title="GAILexa Whisper")

app.add_middleware(
    CORSMiddleware,
    # Sites allowed to call this service. Extend with ALLOWED_ORIGINS
    # (comma-separated) without editing the code — useful on Render.
    allow_origins=[
        o.strip()
        for o in (
            os.getenv(
                "ALLOWED_ORIGINS",
                "https://gailexa.gail.co.in,"
                "http://gailexa.gail.co.in,"
                "https://gailexa-web-vmyi.onrender.com,"
                "http://localhost:5173",
            )
        ).split(",")
        if o.strip()
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

_model = None


def get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        _model = WhisperModel(MODEL_PATH, device="cpu", compute_type="int8")
    return _model


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": MODEL_SIZE,
        "model_path": MODEL_PATH,
        "model_source": "local" if _HAS_LOCAL_MODEL else "downloaded",
        "azure_speech": bool(os.getenv("AZURE_SPEECH_KEY", "")),
        "azure_region": os.getenv("AZURE_SPEECH_REGION", "centralindia"),
    }


# ---------------------------------------------------------------------------
# Text-to-speech — ONE consistent, natural female voice character.
#   English → en-IN "Neerja"   |   Hindi → hi-IN "Swara"
# Microsoft Edge neural voices via edge-tts: free, no API key, and they
# sound like a person reading the text — never a robotic or male voice.
# ---------------------------------------------------------------------------

from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field

TTS_VOICES = {
    "en": "en-IN-NeerjaNeural",
    "hi": "hi-IN-SwaraNeural",
}
TTS_MAX_CHARS = 3000  # safety cap; the app already summarizes long answers


class TtsRequest(BaseModel):
    text: str
    lang: str | None = "en"  # "en" | "hi"


@app.post("/tts")
async def tts(req: TtsRequest):
    import edge_tts

    text = (req.text or "").strip()[:TTS_MAX_CHARS]
    if not text:
        return {"error": "empty text"}

    voice = TTS_VOICES.get((req.lang or "en").lower()[:2], TTS_VOICES["en"])
    # Slightly unhurried pace for a warm, human read-aloud feel
    communicate = edge_tts.Communicate(text, voice, rate="-5%")

    async def stream():
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                yield chunk["data"]

    return StreamingResponse(stream(), media_type="audio/mpeg")


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    suffix = os.path.splitext(audio.filename or "clip.webm")[1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        f.write(await audio.read())
        path = f.name

    try:
        segments, info = get_model().transcribe(
            path,
            beam_size=1,  # greedy decoding — ~3-4x less CPU than beam_size=5
            best_of=1,
            condition_on_previous_text=False,  # skips context re-processing
            vad_filter=True,  # trims silence so less audio is processed
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        return {
            "text": text,
            "language": info.language,
            "probability": round(info.language_probability, 3),
        }
    finally:
        os.unlink(path)

# ---------------------------------------------------------------------------
# Azure AI Speech + Translator
#
# The Azure key stays HERE, on the server — it is never sent to the browser.
# The web app calls:
#   POST /speech/token   -> a short-lived (10 min) token for the Speech SDK
#   POST /translate      -> proxied translation, so the key is not exposed
#
# Configure with environment variables (set on the Windows service via NSSM):
#   AZURE_SPEECH_KEY     the KEY 1 value from the Azure resource
#   AZURE_SPEECH_REGION  centralindia
# ---------------------------------------------------------------------------

import urllib.request
import urllib.error
import json as _json

AZURE_SPEECH_KEY = os.getenv("AZURE_SPEECH_KEY", "")
AZURE_SPEECH_REGION = os.getenv("AZURE_SPEECH_REGION", "centralindia")
TRANSLATOR_ENDPOINT = os.getenv(
    "AZURE_TRANSLATOR_ENDPOINT", "https://api.cognitive.microsofttranslator.com"
)
TRANSLATE_MAX_CHARS = 5000


def _azure_configured() -> bool:
    return bool(AZURE_SPEECH_KEY)


@app.post("/speech/token")
def speech_token():
    """Issue a short-lived Azure Speech token for the browser SDK."""
    if not _azure_configured():
        return JSONResponse(
            {"error": "AZURE_SPEECH_KEY is not configured on the server"},
            status_code=503,
        )
    url = (
        f"https://{AZURE_SPEECH_REGION}.api.cognitive.microsoft.com"
        "/sts/v1.0/issueToken"
    )
    req = urllib.request.Request(
        url,
        data=b"",
        method="POST",
        headers={
            "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
            "Content-Length": "0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            token = resp.read().decode("utf-8")
        return {"token": token, "region": AZURE_SPEECH_REGION}
    except urllib.error.HTTPError as e:
        return JSONResponse(
            {"error": f"Azure token request failed: {e.code}"}, status_code=502
        )
    except Exception as e:  # network unreachable, timeout, etc.
        return JSONResponse({"error": f"Azure token request failed: {e}"}, status_code=502)


class TranslateRequest(BaseModel):
    """`from` is a Python keyword, so it is accepted under the alias."""

    model_config = ConfigDict(populate_by_name=True)

    text: str
    to: str  # target language code, e.g. "en", "hi", "te"
    from_: str | None = Field(default=None, alias="from")


@app.post("/translate")
def translate(req: TranslateRequest):
    """Translate text via Azure Translator, keeping the key server-side."""
    if not _azure_configured():
        return JSONResponse(
            {"error": "AZURE_SPEECH_KEY is not configured on the server"},
            status_code=503,
        )
    text = (req.text or "").strip()[:TRANSLATE_MAX_CHARS]
    if not text:
        return {"text": "", "detected": None}

    params = f"?api-version=3.0&to={req.to}"
    if req.from_:
        params += f"&from={req.from_}"
    url = f"{TRANSLATOR_ENDPOINT.rstrip('/')}/translate{params}"

    body = _json.dumps([{"text": text}]).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
            "Ocp-Apim-Subscription-Region": AZURE_SPEECH_REGION,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as resp:
            data = _json.loads(resp.read().decode("utf-8"))
        first = data[0] if data else {}
        return {
            "text": (first.get("translations") or [{}])[0].get("text", ""),
            "detected": (first.get("detectedLanguage") or {}).get("language"),
        }
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")[:300]
        return JSONResponse(
            {"error": f"Translation failed ({e.code}): {detail}"}, status_code=502
        )
    except Exception as e:
        return JSONResponse({"error": f"Translation failed: {e}"}, status_code=502)
