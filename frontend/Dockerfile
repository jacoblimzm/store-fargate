# Multi-stage: build the Vite/React SPA with Node, serve the static output with
# nginx. No Node runtime in the final image — nginx serves /dist and reverse-
# proxies /api to the backend (BACKEND_HOST templated at container start).
FROM node:24-alpine AS build
WORKDIR /app

# Install deps first (better layer caching).
COPY package.json package-lock.json* ./
RUN npm ci

# Build. DD_GIT_* are baked into the bundle for Source Code Integration.
ARG DD_GIT_REPOSITORY_URL=""
ARG DD_GIT_COMMIT_SHA=""
ENV DD_GIT_REPOSITORY_URL=$DD_GIT_REPOSITORY_URL \
    DD_GIT_COMMIT_SHA=$DD_GIT_COMMIT_SHA
COPY . .
RUN npm run build

# --- runtime ---------------------------------------------------------------
FROM nginx:alpine

# Default backend target; overridden per environment.
#   docker-compose:  BACKEND_HOST=backend
#   ECS Fargate:     BACKEND_HOST=127.0.0.1 (shared task network)
ENV BACKEND_HOST=backend \
    BACKEND_PORT=8000

# nginx runs envsubst over /etc/nginx/templates/*.template at startup,
# substituting only defined env vars (nginx's own $vars are safe).
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
