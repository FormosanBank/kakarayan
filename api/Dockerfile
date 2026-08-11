FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    KAKARAYAN_DB_PATH=/data/formosanbank.sqlite \
    KAKARAYAN_RELEASE_MANIFEST_PATH=/data/active-release.json

RUN groupadd --gid 10001 kakarayan \
    && useradd --uid 10001 --gid kakarayan --no-create-home kakarayan \
    && mkdir -p /app /data \
    && chown -R kakarayan:kakarayan /app /data

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install --no-cache-dir uv==0.11.31 \
    && uv sync --locked --no-dev --no-group publisher --no-install-project
COPY api /app/api

# Production builds prepare and validate the immutable database in the image.
# A blank argument is allowed only so CI can verify the generic image shape.
ARG KAKARAYAN_RELEASE_MANIFEST_URL=""
RUN if [ -n "$KAKARAYAN_RELEASE_MANIFEST_URL" ]; then \
      .venv/bin/python -m api.prepare_release \
        --manifest "$KAKARAYAN_RELEASE_MANIFEST_URL" \
        --database "$KAKARAYAN_DB_PATH" \
        --activate "$KAKARAYAN_RELEASE_MANIFEST_PATH"; \
    fi \
    && chown -R kakarayan:kakarayan /data

USER kakarayan
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD [".venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7860/readyz', timeout=3)"]

CMD [".venv/bin/uvicorn", "api.app:app", "--host", "0.0.0.0", "--port", "7860", "--no-access-log", "--proxy-headers", "--forwarded-allow-ips=*"]
