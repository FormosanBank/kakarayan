FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    KAKARAYAN_DB_PATH=/data/formosanbank.sqlite

RUN groupadd --gid 10001 kakarayan \
    && useradd --uid 10001 --gid kakarayan --no-create-home kakarayan \
    && mkdir -p /app /data \
    && chown -R kakarayan:kakarayan /app /data

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --requirement requirements.txt
COPY . /app/api

USER kakarayan
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7860/healthz', timeout=3)"]

CMD ["uvicorn", "api.app:app", "--host", "0.0.0.0", "--port", "7860", "--no-access-log", "--proxy-headers", "--forwarded-allow-ips=*"]
