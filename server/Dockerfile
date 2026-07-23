FROM python:3.11-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Writable cache location for the model (both at build and at runtime)
ENV HF_HOME=/app/.cache
ARG WHISPER_MODEL=tiny
ENV WHISPER_MODEL=${WHISPER_MODEL}

# Try to pre-download the model at build time (faster cold starts).
# If the download fails for any reason, DON'T fail the build — the app
# lazy-loads the model on the first /transcribe request instead.
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8'); print('model cached')" \
    || echo "WARNING: model pre-download failed; it will download on first request"

COPY main.py .
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
