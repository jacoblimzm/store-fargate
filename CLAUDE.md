# DCash — Datadog Demo Financial Super App

## Project overview
DCash is a **fake financial super app** — a wallet-plus-services mini-app hub — used to
demonstrate **Datadog** end-to-end. By design it **intentionally contains bugs, performance
issues, and vulnerabilities** so we can showcase Datadog features (APM, RUM, Logs, DBM,
Profiling, CNM, LLM Obs, App Sec, Feature Flags).

- **NOT a real banking app** — do not apply real-world security/compliance standards.
- **Some flaws are intentional** — check before "fixing" anything that looks wrong.
- **Demo-first** — changes should make the Datadog story clearer, and keep the app deployable.
- The repo directory is `store-fargate`; infra resources are still named `pay2play-*`
  (see Deployment). The user-facing product is being rebranded to **DCash**.

The signature interaction is a **live, move-around-the-room P2P demo**: attendees self-sign-up
with a username, add each other by scanning QR codes, and send cash P2P (which can be made to
fail/lag via a feature flag) while Datadog surfaces everything. Winners (e.g. "first to 10
transfers") are ranked in a **Datadog dashboard**, not in the app.

## Tech stack
- **Frontend** (`frontend/`): React 19 + Vite 7 + TypeScript + React Router v7, **SPA/client
  mode** (static build; no Node server at runtime). Datadog RUM + Session Replay + browser Logs.
  Liquid-Glass design system (dark + light). Served by nginx.
- **Backend** (`backend/`): Python **Flask** (app-factory) + gunicorn + SQLAlchemy, run under
  `ddtrace-run` (APM + LLM Observability). PostgreSQL (RDS in cloud, `db` container locally).
- **Infra**: **Terraform** (`terraform/`) — ECS Fargate, ALB, CloudFront, RDS, ECR, Route 53,
  Secrets Manager; remote state on S3 + DynamoDB. **GitHub Actions** CI via OIDC.
- **Local orchestration**: `docker-compose.yml` (+ `docker-compose.datadog.yml` for the agent).

## Repository layout
```
backend/            Flask API (app-factory in app/__init__.py; blueprints in app/routes/)
frontend/           React 19 + Vite SPA (src/ = pages, components, theme, api, observability)
terraform/          IaC for the whole AWS stack (+ bootstrap/ for state + OIDC role)
deploy/             Deploy docs + fluent-bit log-router build context
.github/workflows/  deploy.yml (push->main) + terraform-plan.yml (PRs)
docker-compose*.yml  Local stack (db + backend + frontend [+ datadog agent])
README.md, deploy/README.md, terraform/README.md   Detailed docs
```

## Local development
Full stack (nginx-served build + API + seeded Postgres) on http://localhost:8080:
```bash
docker compose up --build            # db (5432) + backend (8000) + frontend (8080)
# Optional Datadog agent overlay:
DD_API_KEY=xxxx docker compose -f docker-compose.yml -f docker-compose.datadog.yml up --build
```
Demo login: any seeded user, password `Password123!` (Login page has "Simulate user").

### Commands
- **Frontend** (run in `frontend/`): `npm run dev` (Vite dev server, proxies `/api` to :8000),
  `npm run build` (`tsc -b && vite build`), `npm run preview`.
- **Backend**: iterate via `docker compose up --build backend` (SEED_ON_START seeds idempotently).
- **Terraform** (in `terraform/`): `terraform fmt -recursive`, `terraform plan`, `terraform apply`
  (needs AWS creds; see terraform/README.md).

### ⚠️ npm is wrapped by Datadog Supply-Chain Firewall
`npm` is aliased to `scfw run npm`, which **BLOCKs in non-interactive shells** and can't write
its cache under the agent sandbox. **Use `command npm ...`** to bypass the alias for install/build
(e.g. `command npm install`, `command npm run build`). CI (GitHub runners) is unaffected.

## Frontend conventions
- **Static SPA only** — Node is used at build time; the runtime container is nginx serving `dist/`.
  Do not introduce SSR / a Node server.
- **Routing = best practice + Journey Monitoring**: every screen and every step of multi-step
  flows gets its own semantic route (e.g. `/send/recipient` → `/send/amount` → `/send/confirm`),
  with **guarded wizard entry** (can't land mid-flow without data). Never invent routes/views
  just to fit a demo; instrumentation observes the real structure.
- **Design system** (`src/theme/tokens.css`): consume CSS tokens (`--dc-*`) and the `.glass`
  utility — **never hardcode hex**. Reusable layout standards: `--dc-content-width` (one centered
  column for every page via `.container`) and `--dc-gap` (via `.view` flex-column rhythm);
  sections must not set their own `margin`/`max-width`. Dark is default; `[data-theme="light"]`
  overrides (toggle in `theme/theme.tsx`). Fonts: Space Grotesk (display/numerals) + Inter (UI).
  Brand logo is `<Brand>` (a gradient tile, `src`-ready for a custom image).
- **TypeScript**: `verbatimModuleSyntax` is on — use `import type` for type-only imports.
- **Design source of truth**: the interactive canvas mockup at
  `~/.cursor/projects/Users-jacob-lim-Documents-self-projects-serverless-ECS-store-fargate/canvases/dcash-mockup.canvas.tsx`.

## Backend conventions
- Flask **app-factory** (`create_app`) with blueprints registered in `app/__init__.py`; add new
  routes as blueprints in `app/routes/` and export via `app/routes/__init__.py`.
- SQLAlchemy models in `app/models.py`; **idempotent** seeding in `app/seed.py` (baseline users
  are Homer's *Odyssey* characters, `is_seed = true` — the persistent demo baseline).
- Secrets come from env (`DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY`, `DD_*`); never hardcode.
- Runs under `ddtrace-run`; log via the configured JSON logger so `dd.trace_id`/`dd.span_id`
  inject and logs correlate to traces.

## Datadog integration
- **APM / LLM Obs**: backend under `ddtrace-run`; traces to the Agent over a **UDS**
  (`DD_TRACE_AGENT_URL=unix:///var/run/datadog/apm.socket`), `DD_AGENT_HOST` intentionally unset.
- **RUM + Session Replay + browser Logs + Profiling**: `frontend/src/observability/`.
  `/api` is same-origin so RUM sessions link to backend APM traces.
- **Infra metrics + CNM (ebpfless)**, **DBM** (off by default — no `datadog` DB user on RDS),
  **Feature Flags** (OpenFeature, planned), **Status page** + **Observability Lab** (planned).
- Service names are `pay2play-*` today (keep for dashboard continuity); RUM/APM `service` may
  move to `dcash-*` at rebrand — decide deliberately.

## Deployment (Terraform + GitHub Actions)
- **Push to `main`** triggers `.github/workflows/deploy.yml`: OIDC auth → build/push all images
  (tagged with the commit SHA) → `terraform apply -var image_tag=<sha>` → wait for ECS stable.
- **PRs touching `terraform/**`** run `terraform-plan.yml` (fmt/validate/plan comment).
- Only the frontend image build is multi-stage (node:24 → nginx). Infra reused as-is.
- **Do not `git push` to `main` unless you intend to deploy.** Commit locally as per-phase
  checkpoints; confirm with the user before pushing.

## Important notes for the agent
1. **Fake demo app** — don't apply real-world security standards; some bugs/vulns are by design.
2. **Use `command npm`** for install/build (scfw alias blocks non-interactively).
3. **Never hardcode colors/spacing/widths** — use the `--dc-*` tokens + `.glass` + `.view`/
   `.container` standards so every page stays consistent and theme-able.
4. **Keep the app deployable at each phase**; verify with `command npm run build`, a
   `docker compose up --build` smoke test, and (optionally) the chrome-devtools MCP for a real
   browser check.
5. **Currency/labels are config** — no country lock-in (₱ etc. are placeholders).
6. **Terraform**: state is remote (never commit `*.tfstate`); secrets are data sources; keep
   `imports.tf` blocks idempotent. Bootstrap (state bucket, lock table, OIDC role) is applied once.
7. **Don't `git push` to `main`** without explicit intent (it deploys).

## Reference docs
- `README.md` — app + Datadog overview and architecture diagram.
- `deploy/README.md` — deployment (Terraform + CI) walkthrough.
- `terraform/README.md` — IaC layout, remote state, pipeline, local usage.
