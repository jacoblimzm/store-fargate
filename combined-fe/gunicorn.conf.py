# Gunicorn binds to loopback only; nginx is the front door and reverse-proxies
# to it, mirroring the customer's nginx + php-fpm topology in one container.
# NOTE: In Fargate awsvpc mode all containers in the task SHARE one network
# namespace (one ENI, shared localhost), so this must not collide with the
# backend container's gunicorn on 8000. Use 8001 here.
bind = "127.0.0.1:8001"
workers = 2
# Error/startup logs to stdout. No access log here: HTTP access is captured by
# nginx (source:nginx) and by the Flask after_request JSON line (source:python).
errorlog = "-"
accesslog = None
loglevel = "info"
