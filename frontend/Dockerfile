FROM nginx:alpine

# Default backend target; overridden per environment.
#   docker-compose:  BACKEND_HOST=backend
#   ECS Fargate:     BACKEND_HOST=127.0.0.1 (shared task network)
ENV BACKEND_HOST=backend \
    BACKEND_PORT=8000

# The official nginx image runs envsubst over /etc/nginx/templates/*.template
# at startup, substituting only defined env vars (nginx's own $vars are safe).
COPY nginx.conf /etc/nginx/templates/default.conf.template

COPY index.html /usr/share/nginx/html/index.html
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/

EXPOSE 80
