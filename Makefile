# =============================================================================
# Make targets for shipping the frontend to production.
#
# This file lives in the frontend repo and assumes the VPS is at the IP/path
# from DEPLOYMENT.md (Hostinger 187.124.29.215, /opt/stickerapp/).
#
# Conventions:
#   - `make front-deploy` is the canonical "fix → ship" command for FE-only changes.
#   - SSH key auth is used (no password prompts; we set this up day 1 of the
#     deploy). If you re-key the laptop or lose the agent, see DEPLOYMENT.md §4.4.
#   - Nginx restart is required after rsync to bust the served-file cache; the
#     compiled dist/ is bind-mounted into nginx, so a soft `nginx -s reload`
#     would also work but `restart` is the LabControl-tested pattern.
#
# Add new targets here (env-update, full deploy, etc.) as we need them; keep
# them lockstep with DEPLOYMENT.md so docs and reality match.
# =============================================================================

# --- Deploy targets ---------------------------------------------------------
VPS_USER  ?= deploy
VPS_HOST  ?= 187.124.29.215
APP_ROOT  ?= /opt/stickerapp
DIST_PATH ?= $(APP_ROOT)/frontend/dist/

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

# --- Convenience ------------------------------------------------------------

.PHONY: help

help:
	@echo "Available targets:"
	@echo "  make front-deploy        Build + rsync + restart nginx (canonical FE deploy)"
	@echo "  make front-deploy-quick  rsync + restart only (skip build)"
	@echo "  make front-build         Vite production build"
	@echo "  make front-rsync         Rsync existing dist/ to VPS"
	@echo "  make front-restart       Restart nginx on the VPS"
