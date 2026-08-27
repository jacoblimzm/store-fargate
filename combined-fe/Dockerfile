# Combined nginx + python (gunicorn) in a single container, mirroring the
# customer's nginx + php-fpm "octane-fe" container. Both processes log to the
# container's stdout/stderr, so a single FireLens logConfiguration receives two
# different log formats -- the scenario we want to split by source in Fluent Bit.
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx supervisor curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py gunicorn.conf.py ./
COPY nginx.conf /etc/nginx/nginx.conf
COPY supervisord.conf /etc/supervisor/conf.d/combined.conf

EXPOSE 8080

CMD ["supervisord", "-c", "/etc/supervisor/conf.d/combined.conf"]
