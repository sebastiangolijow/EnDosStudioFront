# =============================================================================
# Make targets for shipping StickerApp to production.
#
# Lives in the frontend repo by convention — single source of deploy targets
# for both repos. Backend rsync uses an absolute path to the sibling backend
# repo so `make back-deploy` works from this directory regardless of where
# you are.
#
# Targets:
#   make front-deploy         Build + rsync + restart nginx (canonical FE ship)
#   make front-deploy-quick   rsync + restart only (skip build)
#   make back-deploy          rsync backend source + build + recreate web (canonical BE ship)
#   make back-deploy-norebuild rsync + recreate web (skip image rebuild — env-only changes)
#   make back-env             Show how to update .env.production on the VPS
#   make help                 List all targets
#
# Conventions:
#   - SSH key auth (no password prompts; set up day 1 — see DEPLOYMENT.md §4.4).
#   - .env.production is NEVER pushed by these targets. Edit it on the VPS
#     via `ssh deploy@... nano /opt/stickerapp/.env.production` and then
#     run `make back-deploy-norebuild` so the container picks up the change.
#   - Backend deploy follows LabControl's rebuild-then-recreate pattern:
#     image COPYs source at build time → restart-only would run stale code.
#     `up -d --force-recreate web` after `build web` is what guarantees the
#     running container has the new code.
#
# Add new targets here (env-update, full deploy) as we need them; keep them
# lockstep with DEPLOYMENT.md so docs and reality match.
# =============================================================================

# --- VPS config (override at the CLI if you ever change hosts) -------------
VPS_USER  ?= deploy
VPS_HOST  ?= 187.124.29.215
APP_ROOT  ?= /opt/stickerapp
DIST_PATH ?= $(APP_ROOT)/frontend/dist/
BACKEND_LOCAL ?= /Users/cevichesmac/Desktop/yeko_studio/endosstudio_project/endossutdio_backend
BACKEND_REMOTE ?= $(APP_ROOT)/backend

# =============================================================================
# Frontend
# =============================================================================

.PHONY: front-build front-rsync front-restart front-deploy front-deploy-quick

## front-deploy: Build + rsync dist/ + restart nginx. The canonical FE ship command.
front-deploy: front-build front-rsync front-restart
	@echo ""
	@echo "✅ Frontend deployed to https://endosestudio.com"
	@echo "   Hard-refresh the browser (⌘ Shift R) to bust local cache."

## front-deploy-quick: Skip the build (use the existing dist/). For "I forgot to restart nginx" scenarios.
front-deploy-quick: front-rsync front-restart
	@echo ""
	@echo "✅ Frontend re-rsynced (no rebuild) to https://endosestudio.com"

front-build:
	@echo "==> Building Vue dist/ (vue-tsc + vite build)..."
	npm run build

front-rsync:
	@echo "==> Rsyncing dist/ → $(VPS_USER)@$(VPS_HOST):$(DIST_PATH) ..."
	rsync -avz --delete dist/ $(VPS_USER)@$(VPS_HOST):$(DIST_PATH)

front-restart:
	@echo "==> Restarting nginx on $(VPS_HOST) ..."
	ssh $(VPS_USER)@$(VPS_HOST) "cd $(APP_ROOT) && docker compose -f docker-compose.prod.yml restart nginx"

# =============================================================================
# Backend
# =============================================================================
#
# The backend rsync uses `-c` (checksum compare, NOT default size+mtime) so a
# file that the local edited but kept the same size still ships. This is the
# LabControl-tested fix for the silent "rsync skipped my file" trap.
#
# `--exclude '.env*'` is non-negotiable — overwriting the VPS's
# .env.production with our local empty/stale one is the #1 way to break prod
# on YeKo projects. Don't remove it without thinking very hard.
#
# Source dirs are passed WITHOUT trailing slashes. With a trailing slash rsync
# copies the contents (not the dir itself) into the destination root, so a
# Python module at apps/orders/foo.py would land at /opt/stickerapp/backend/
# orders/foo.py instead of .../apps/orders/foo.py, the build would COPY both
# the stale and new copies, and imports would silently use the stale one.
# Pass `apps`, not `apps/`. (See DEPLOYMENT_PRACTICES.md §4b for the full
# postmortem.)

.PHONY: back-rsync back-build back-recreate back-deploy back-deploy-norebuild back-logs back-shell back-env

## back-deploy: rsync backend source + build web image + recreate web container. Canonical BE ship.
back-deploy: back-rsync back-build back-recreate
	@echo ""
	@echo "✅ Backend deployed to https://endosestudio.com/api/v1/"
	@echo "   Verify with: make back-logs"
	@echo "   New code marker check: ssh $(VPS_USER)@$(VPS_HOST) 'docker exec stickerapp_web grep <distinctive-string> /app/apps/'"

## back-deploy-norebuild: rsync + recreate web ONLY (skip image build). Use when ONLY .env or compose changed.
back-deploy-norebuild: back-rsync back-recreate
	@echo ""
	@echo "✅ Backend re-rsynced + recreated (no image rebuild)."

back-rsync:
	@echo "==> Rsyncing backend source ($(BACKEND_LOCAL) → $(VPS_USER)@$(VPS_HOST):$(BACKEND_REMOTE)/) ..."
	@if [ ! -d "$(BACKEND_LOCAL)" ]; then \
		echo "ERROR: BACKEND_LOCAL ($(BACKEND_LOCAL)) does not exist. Set it via 'make back-deploy BACKEND_LOCAL=/your/path'."; \
		exit 1; \
	fi
	rsync -avzc \
		--exclude '__pycache__' \
		--exclude '*.pyc' \
		--exclude '.pytest_cache' \
		--exclude '.git' \
		--exclude '.env*' \
		--exclude '.cache' \
		--exclude '.u2net' \
		--exclude 'media' \
		--exclude 'htmlcov' \
		--exclude '.coverage' \
		--exclude '.venv' --exclude 'venv' \
		$(BACKEND_LOCAL)/apps \
		$(BACKEND_LOCAL)/config \
		$(BACKEND_LOCAL)/requirements \
		$(BACKEND_LOCAL)/manage.py \
		$(BACKEND_LOCAL)/Dockerfile \
		$(BACKEND_LOCAL)/entrypoint.sh \
		$(BACKEND_LOCAL)/docker-compose.prod.yml \
		$(VPS_USER)@$(VPS_HOST):$(BACKEND_REMOTE)/

back-build:
	@echo "==> Building stickerapp-web image on $(VPS_HOST) ..."
	ssh $(VPS_USER)@$(VPS_HOST) "cd $(APP_ROOT) && docker compose -f docker-compose.prod.yml build web"

back-recreate:
	@echo "==> Recreating web container (stop → rm → up — NOT restart) ..."
	ssh $(VPS_USER)@$(VPS_HOST) "cd $(APP_ROOT) && \
		docker compose -f docker-compose.prod.yml stop web && \
		docker compose -f docker-compose.prod.yml rm -f web && \
		docker compose -f docker-compose.prod.yml up -d web"

## back-logs: Tail the live web container logs.
back-logs:
	ssh $(VPS_USER)@$(VPS_HOST) "docker compose -f $(APP_ROOT)/docker-compose.prod.yml logs -f web"

## back-shell: Open a Django shell inside the running web container.
back-shell:
	ssh -t $(VPS_USER)@$(VPS_HOST) "docker compose -f $(APP_ROOT)/docker-compose.prod.yml exec web python manage.py shell"

## back-env: Print the recipe for updating .env.production on the VPS.
back-env:
	@echo "To update env vars on the VPS (e.g. swap Stripe keys, change FRONTEND_URL):"
	@echo ""
	@echo "  ssh $(VPS_USER)@$(VPS_HOST)"
	@echo "  nano $(APP_ROOT)/.env.production"
	@echo "  exit"
	@echo ""
	@echo "Then from your laptop:"
	@echo ""
	@echo "  make back-deploy-norebuild"
	@echo ""
	@echo "(stop → rm → up. NOT restart — restart keeps the old env.)"

# =============================================================================
# Help
# =============================================================================

.PHONY: help

help:
	@echo "Frontend:"
	@echo "  make front-deploy         Build + rsync + restart nginx (canonical FE ship)"
	@echo "  make front-deploy-quick   rsync + restart only (skip build)"
	@echo "  make front-build          Vite production build"
	@echo "  make front-rsync          rsync existing dist/ to VPS"
	@echo "  make front-restart        Restart nginx on the VPS"
	@echo ""
	@echo "Backend:"
	@echo "  make back-deploy            rsync + build + recreate web (canonical BE ship)"
	@echo "  make back-deploy-norebuild  rsync + recreate web (skip image rebuild)"
	@echo "  make back-rsync             rsync backend source only"
	@echo "  make back-build             Build stickerapp-web image on the VPS"
	@echo "  make back-recreate          Recreate web container (stop → rm → up)"
	@echo "  make back-logs              Tail live web container logs"
	@echo "  make back-shell             Open Django shell inside the web container"
	@echo "  make back-env               Print the .env.production update recipe"
