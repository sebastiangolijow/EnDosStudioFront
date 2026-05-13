# StickerApp — Deployment Runbook

> **Live URL**: `https://endosestudio.com`
> **First deployed**: 2026-05-13.
> **Infra**: Hostinger KVM VPS (Ubuntu 24.04, 2 vCPU, 8 GB RAM, 100 GB NVMe, Frankfurt DE, IP `187.124.29.215`). Docker compose, nginx, Let's Encrypt.
> **WordPress co-tenant**: served from a DreamHost VPS (`vps70246`) at `wp.endosestudio.com`, reverse-proxied behind a hidden path (`/k7p2x9/`) by our nginx.
> **Reference recipe**: `/Users/cevichesmac/Desktop/labcontrol/DEPLOYMENT.md` — LabControl is the original; same shape, fewer co-tenants.

**Source-of-truth files in this repo**:
- `deploy/docker-compose.prod.yml` — VPS-side compose
- `deploy/nginx/conf.d/stickerapp.conf` — nginx config (3 server blocks: HTTP→HTTPS redirect, app at apex, WP via `/k7p2x9/`)
- `deploy/.env.production.template` — secrets template
- `deploy/backup-db.sh` — daily backup script (Postgres dump + media rsync)
- `endossutdio_backend/entrypoint.sh` — migrate + collectstatic on container boot
- `endossutdio_backend/.env.production.template` — backend-only env reference

---

## 1. Architecture as deployed

```
Customer browser
      |
      v
endosestudio.com  ──→  Hostinger VPS (187.124.29.215)
                       └── nginx (TLS terminate, 80/443)
                            ├── /                       → static Vue dist (frontend/dist/)
                            ├── /api/                   → Django web container (:8000)
                            ├── /django-admin/          → Django admin
                            ├── /static/, /media/       → Django volumes
                            └── /k7p2x9/                → proxy_pass https://wp.endosestudio.com/
                                                          (DH-hosted WordPress at vps70246)

wp.endosestudio.com  ──→ DreamHost VPS (vps70246.dreamhostps.com)
                          └── Apache + WP at /home/dh_8smr6w/endosestudio.com/
```

Stack on Hostinger:
- `db` — postgres:15-alpine, named volume, internal only
- `web` — built from `./backend/` (Python 3.11 + Django + gunicorn 3 workers + rembg model baked into image, ~170 MB cache layer)
- `nginx` — nginx:alpine, claims host 80/443

`web` and `db` are healthchecked. The `web` healthcheck hits `/api/v1/health/` (added in `apps/core/views.py`). The `nginx` healthcheck path is wrong by design (returns "unhealthy" cosmetically — service responds to real traffic fine).

---

## 2. Phase 0 — what to do BEFORE provisioning a new VPS

### 2.1 Don't bother with DreamHost VPS

DH "VPS Business" is a managed product running in an LXC-like container with **no sudo** for customer users — confirmed by the `/dev/sda1 = overlay` filesystem and the empty `Groups:` line on the SFTP user. **You cannot install docker on a DH VPS.** Use it only for the WordPress co-tenancy (which is what we did).

Real VPS options that work: Hetzner CX22 (~€4.50/mo, full root), Hostinger KVM 2 (~€7/mo, what we used), DigitalOcean Basic ($6+/mo). All ship clean Ubuntu with full root.

### 2.2 Customer asks (collect before starting)

- [ ] Domain name (we used `endosestudio.com`).
- [ ] WordPress destination path (we used a high-entropy `/k7p2x9/` for obscurity — customer's call).
- [ ] **WordPress admin credentials** — needed for the search-replace step (§7.4). Don't start unless you have these.
- [ ] Stripe test publishable + secret keys (Stripe Dashboard → Sandbox → Developers → API keys).
- [ ] Gmail App Password for SMTP (Google Account → Security → 2FA → App Passwords; **NOT** the regular Gmail password). Email: `endosestudio@gmail.com`.
- [ ] Confirmation that DreamHost DNS is editable.

---

## 3. Phase 1 — provision the Hostinger VPS

1. Hostinger panel → buy a **KVM 2** plan, **Germany**, **Ubuntu 24.04**.
2. **Set a strong root password** (save to password manager — only used for emergency console).
3. **Add SSH public key** at provisioning time. Pull yours with `cat ~/.ssh/id_rsa.pub` or `cat ~/.ssh/id_ed25519.pub`. Paste into Hostinger.
4. Add-ons: ✓ malware scanner (free), ✗ docker manager (we install ourselves), ✗ paid backups (we run our own pg_dump cron).

Wait 5-10 min for provisioning. Note the public IP.

---

## 4. Phase 2 — VPS hardening (~15 min on a fresh box)

### 4.1 First login + system updates

```sh
ssh root@<vps-ip>
```

Once at root prompt, paste this whole block:

```sh
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" upgrade

# Docker (official repo, NOT snap)
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Firewall + fail2ban + certbot
apt-get install -y ufw fail2ban certbot rsync
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'ssh'
ufw allow 80/tcp comment 'http'
ufw allow 443/tcp comment 'https'
ufw --force enable
systemctl enable --now fail2ban
```

### 4.2 Create the deploy user (we will operate as this user, not root)

```sh
adduser --disabled-password --gecos "" deploy
usermod -aG docker,sudo deploy
echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deploy
chmod 0440 /etc/sudoers.d/deploy
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

### 4.3 Stage the new sshd config (do not reload yet)

Use **one `echo` line per directive** — heredocs in this exact shape have a track record of capturing prose into the file:

```sh
echo 'PermitRootLogin no'              > /etc/ssh/sshd_config.d/99-stickerapp.conf
echo 'PasswordAuthentication no'      >> /etc/ssh/sshd_config.d/99-stickerapp.conf
echo 'PubkeyAuthentication yes'       >> /etc/ssh/sshd_config.d/99-stickerapp.conf
echo 'KbdInteractiveAuthentication no'>> /etc/ssh/sshd_config.d/99-stickerapp.conf
sshd -t   # MUST return silent (no errors)
```

### 4.4 Test deploy login in a NEW terminal tab on your laptop

**Do not reload sshd until this works**:

```sh
ssh deploy@<vps-ip>
sudo whoami   # must print 'root' with no prompt
```

If that fails — STOP. Debug from the still-open root session before doing anything else. Locking yourself out at this step is the only way to brick the deploy.

### 4.5 Reload sshd

Back in your root session:
```sh
systemctl reload ssh
```

Verify root is now refused (good):
```sh
# From your laptop:
ssh root@<vps-ip>   # expected: Permission denied (publickey)
```

Then close the root session forever.

### 4.6 fail2ban gotcha — whitelist your laptop IP during deploy

We will reconnect a LOT during the deploy. Default fail2ban (5 failures = ban) will lock your laptop out at the worst time. Add:

```sh
sudo mkdir -p /etc/fail2ban/jail.d
echo '[DEFAULT]' | sudo tee /etc/fail2ban/jail.d/whitelist-deploy.local
echo "ignoreip = 127.0.0.1/8 ::1 <YOUR_LAPTOP_IP>" | sudo tee -a /etc/fail2ban/jail.d/whitelist-deploy.local
sudo fail2ban-client reload
```

Use `curl -s ifconfig.me` from your laptop to find your IP. **Remove this whitelist after deploy is stable** (task tracking #14).

If you get accidentally banned while debugging: use the Hostinger browser console (out-of-band serial), log in as `root` with the password, run `fail2ban-client set sshd unbanip <your-ip>`.

---

## 5. Phase 3 — rsync artifacts from laptop

### 5.1 Create the VPS dir tree

In **deploy SSH session**:

```sh
sudo mkdir -p /opt/stickerapp/{backend,frontend/dist,nginx/conf.d,nginx/acme-challenge,backups/db,backups/media}
sudo chown -R deploy:deploy /opt/stickerapp
```

### 5.2 Push deploy/, backend, frontend dist

**From laptop** (in `endosstudio_frontend/`):

```sh
rsync -avz deploy/docker-compose.prod.yml deploy@<vps-ip>:/opt/stickerapp/
rsync -avz deploy/nginx/conf.d/stickerapp.conf deploy@<vps-ip>:/opt/stickerapp/nginx/conf.d/
rsync -avz deploy/.env.production.template deploy@<vps-ip>:/opt/stickerapp/
rsync -avz deploy/backup-db.sh deploy@<vps-ip>:/opt/stickerapp/
```

**From laptop** (in `endossutdio_backend/`):

```sh
rsync -avz \
  --exclude '__pycache__' --exclude '.venv' --exclude 'media' \
  --exclude 'htmlcov' --exclude '.pytest_cache' --exclude '.coverage' \
  --exclude '.git' --exclude '.env*' --exclude '.cache' --exclude '.u2net' \
  ./ deploy@<vps-ip>:/opt/stickerapp/backend/
```

Build + push the Vue dist. **Set `VITE_API_BASE_URL=/api/v1`** (relative) so the same build works under both `app.endosestudio.com` and `endosestudio.com`:

```sh
# Local edit endosstudio_frontend/.env.production:
# VITE_API_BASE_URL=/api/v1
# VITE_FRONTEND_URL=https://endosestudio.com
# VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
npm run build
rsync -avz --delete dist/ deploy@<vps-ip>:/opt/stickerapp/frontend/dist/
```

### 5.3 Populate the VPS `.env.production`

In **deploy SSH session**:

```sh
cd /opt/stickerapp
cp .env.production.template .env.production
chmod 600 .env.production
nano .env.production
```

Fill every `REPLACE_WITH_*`. Generate secrets:
- `DJANGO_SECRET_KEY`: `python3 -c "import secrets; print(secrets.token_urlsafe(64))"` on laptop.
- `POSTGRES_PASSWORD` AND `DATABASE_URL` password — must match: `python3 -c "import secrets; print(secrets.token_urlsafe(24))"`.
- `EMAIL_HOST_PASSWORD` = Gmail App Password.
- Stripe test pub + secret keys.
- Leave `STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME` until §7.5.
- `DJANGO_ALLOWED_HOSTS=endosestudio.com,www.endosestudio.com,localhost,127.0.0.1,<vps-ip>` (localhost needed for the web healthcheck).

### 5.4 Compose interpolation gotcha — symlink `.env` → `.env.production`

`docker compose` interpolates `${POSTGRES_*}` in the YAML from a file named `.env` next to the compose file, NOT from `env_file:` (that's runtime injection only). Without this symlink, db service comes up with empty `POSTGRES_USER`/`POSTGRES_PASSWORD` and crash-loops:

```sh
cd /opt/stickerapp
ln -sf .env.production .env
```

---

## 6. Phase 4 — TLS + first boot

### 6.1 Self-signed placeholder cert

Nginx won't start without cert files at the configured path. Plant a 1-day self-signed so the stack can boot before Let's Encrypt:

```sh
sudo mkdir -p /etc/letsencrypt/live/endosestudio.com
sudo openssl req -x509 -nodes -days 1 -newkey rsa:2048 \
  -keyout /etc/letsencrypt/live/endosestudio.com/privkey.pem \
  -out /etc/letsencrypt/live/endosestudio.com/fullchain.pem \
  -subj "/CN=endosestudio.com"
```

### 6.2 Fix the nginx config domain placeholder

```sh
sudo sed -i 's/stickerapp\.example\.com/endosestudio.com/g' /opt/stickerapp/nginx/conf.d/stickerapp.conf
```

### 6.3 Bring up the stack

```sh
cd /opt/stickerapp
docker compose -f docker-compose.prod.yml up -d --build
```

First build is **5-8 minutes** (Python deps + rembg ONNX model bake). Subsequent rebuilds are fast (cached layers).

### 6.4 Fix volume permissions (first-boot gotcha)

Docker creates the `static` and `media` named volumes owned by root. Web container runs as `app` (uid 999) → can't write. Symptom: `collectstatic` fails with `PermissionError: '/app/staticfiles/admin'`.

Fix once:

```sh
docker compose -f docker-compose.prod.yml stop web
docker run --rm -v stickerapp_static:/data alpine sh -c "chown -R 999:999 /data && chmod -R u+rwX /data"
docker run --rm -v stickerapp_media:/data alpine sh -c "chown -R 999:999 /data && chmod -R u+rwX /data"
docker compose -f docker-compose.prod.yml up -d web
```

If you renamed the project (compose project name was different), the volume names change accordingly — run `docker volume ls` to find them.

### 6.5 Real Let's Encrypt cert (DNS must already resolve to the VPS)

Stop nginx briefly so certbot can claim :80:

```sh
docker compose -f docker-compose.prod.yml stop nginx
sudo certbot certonly --standalone \
  -d endosestudio.com -d www.endosestudio.com -d app.endosestudio.com \
  --email sebastian.golijow@gmail.com \
  --agree-tos --no-eff-email --non-interactive
# Copy cert to the path nginx reads
sudo cp /etc/letsencrypt/live/endosestudio.com/fullchain.pem /etc/letsencrypt/live/endosestudio.com/fullchain.pem
sudo cp /etc/letsencrypt/live/endosestudio.com/privkey.pem  /etc/letsencrypt/live/endosestudio.com/privkey.pem
docker compose -f docker-compose.prod.yml start nginx
```

**Let's Encrypt rate limit**: 5 failed validations per hostname per hour. Don't retry blindly — confirm DNS at all public resolvers first:

```sh
dig +short endosestudio.com @8.8.8.8
dig +short endosestudio.com @1.1.1.1
```

Both must return the VPS IP before certbot will succeed.

certbot installs a systemd timer that auto-renews 30 days before expiry. No further action.

---

## 7. Phase 5 — DNS cutover

Order matters. WordPress goes briefly offline during this — schedule for low-traffic time.

### 7.1 Add CNAME pointing at the DH VPS (before cutover)

In DreamHost panel → DNS → Registros Personalizados, add:
- `wp` → CNAME → `vps70246.dreamhostps.com.` → TTL 300

This gives our nginx a stable upstream once the apex moves. Must be done BEFORE the apex cutover, otherwise the `/k7p2x9/` proxy has nothing to talk to.

### 7.2 Set the domain to "Solo DNS" in DH

DreamHost panel → Sitios web → click `endosestudio.com` → Configuraciones → "Opciones de no alojamiento" → **"Establecer como Solo DNS"**.

This severs the DH hosting binding. **WP at the apex stops responding immediately.** Then in DH "Registros Personalizados":
- `@` (or empty Name) → A → `<vps-ip>` → TTL 300
- `www` → A → `<vps-ip>` → TTL 300
- `app` → A → `<vps-ip>` → TTL 300 (test subdomain, can delete later)

### 7.3 Watch propagation

```sh
dig +short endosestudio.com @ns1.dreamhost.com   # DH's own NS first
dig +short endosestudio.com @8.8.8.8             # Then public resolvers
dig +short endosestudio.com @1.1.1.1
```

Typically 5-15 min. When all return the VPS IP, run certbot (§6.5).

### 7.4 Re-host WordPress on DH at `wp.endosestudio.com`

The Solo-DNS step also unbound WP from the dh_8smr6w user's vhost. Re-attach it:

DH panel → Sitios web → **+ Agregar Dominio** → "Configuración Personalizada":
- **Dominio**: `wp.endosestudio.com`
- **Servidor**: VPS Business (vps70246)
- **Usuario SFTP**: `dh_8smr6w` (the original WP owner — must pick exactly this user)
- **Configuraciones Avanzadas → Directorio**: `endosestudio.com` (the existing WP folder; DO NOT let it default to `wp.endosestudio.com` which would create a new empty folder)
- No new SSL needed (our nginx terminates TLS).

Wait 5 min for DH to provision the Apache vhost. Verify:
```sh
curl -k -s -o /dev/null -w "HTTP %{http_code}, Content-Length %{size_download}\n" https://wp.endosestudio.com/
```
Expected: `HTTP 200, Content-Length ~80000` (WordPress homepage). If "Site Not Found" / Content-Length ~870, the path is wrong — fix Directorio field.

### 7.5 WP search-replace for the subpath

WordPress's `wp_options.siteurl` and `wp_options.home` are stored as absolute URLs (`https://endosestudio.com`). Our nginx proxies WP via `/k7p2x9/`, so WP must regenerate URLs as `https://endosestudio.com/k7p2x9`. Otherwise the HTML loads but every CSS/JS/image URL points at the Vue app → broken styling.

Fix once via WP admin:
1. Open `https://wp.endosestudio.com/wp-admin/` (DH-hosted, bypasses our nginx).
2. Log in with the customer's WP admin credentials.
3. Plugins → Add New → install + activate **"Better Search Replace"**.
4. Settings → Better Search Replace:
   - Search: `https://endosestudio.com`
   - Replace: `https://endosestudio.com/k7p2x9`
   - Select all tables.
   - Dry-run first → expect 500-2000 row hits → then run live.
5. Visit `https://endosestudio.com/k7p2x9/` — should render styled.

### 7.6 Register Stripe webhook + update env

Stripe Dashboard (test mode) → Webhooks → Add destination:
- URL: `https://endosestudio.com/api/v1/payments/webhooks/stripe/`
- Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.succeeded`

Stripe returns the **webhook signing secret** (starts with `whsec_`). Paste it into `.env.production`, then recreate the web container (env-update flow §8.3).

### 7.7 Set `FRONTEND_URL` back to apex

The email-link FRONTEND_URL var must match the production URL or password-reset emails point at the wrong host:

```sh
sed -i 's|^FRONTEND_URL=.*|FRONTEND_URL=https://endosestudio.com|' /opt/stickerapp/.env.production
```

Then run the env-update flow (§8.3) to recreate web.

---

## 8. Day-2 deploy flows

The four flows are intentionally rigid. Each gotcha listed has bitten this project or LabControl.

### 8.1 Frontend deploy

```sh
# Laptop:
cd endosstudio_frontend
npm run build
rsync -avz --delete dist/ deploy@<vps-ip>:/opt/stickerapp/frontend/dist/
ssh deploy@<vps-ip> 'cd /opt/stickerapp && docker compose -f docker-compose.prod.yml restart nginx'
```

Hard-refresh browser (⌘ Shift R) — nginx cache holds onto old assets.

### 8.2 Backend deploy

```sh
# Laptop:
cd endossutdio_backend
rsync -avz \
  --exclude '__pycache__' --exclude '.venv' --exclude 'media' \
  --exclude '.env*' --exclude '.git' --exclude 'htmlcov' \
  ./ deploy@<vps-ip>:/opt/stickerapp/backend/

# VPS — REBUILD then UP (NOT restart):
ssh deploy@<vps-ip> '
cd /opt/stickerapp
docker compose -f docker-compose.prod.yml build web
docker compose -f docker-compose.prod.yml up -d web
'
```

**Gotcha**: Dockerfile `COPY` is build-time. `docker restart` reuses the old image → runs old code. Always `build` then `up -d`.

`entrypoint.sh` runs `migrate` + `collectstatic` on every web boot — no separate command needed.

### 8.3 Env-var update (e.g. swap Stripe test → live)

```sh
ssh deploy@<vps-ip>
nano /opt/stickerapp/.env.production
cd /opt/stickerapp
docker compose -f docker-compose.prod.yml stop web
docker compose -f docker-compose.prod.yml rm -f web
docker compose -f docker-compose.prod.yml up -d web
```

**Gotcha**: `docker restart` keeps the previous env. STOP → RM → UP forces a fresh container to re-read `.env.production`.

### 8.4 Nginx config update

```sh
# Laptop:
rsync deploy/nginx/conf.d/stickerapp.conf deploy@<vps-ip>:/opt/stickerapp/nginx/conf.d/

# VPS — validate FIRST:
ssh deploy@<vps-ip> '
docker compose -f /opt/stickerapp/docker-compose.prod.yml exec nginx nginx -t \
&& docker compose -f /opt/stickerapp/docker-compose.prod.yml exec nginx nginx -s reload
'
```

`nginx -t` first — a syntax error that takes the site offline is the easiest own-goal here.

### 8.5 Full redeploy (rare)

```sh
# Backup first:
ssh deploy@<vps-ip> 'sudo /etc/cron.daily/stickerapp-backup'

# Then push everything (§8.1 + §8.2) and:
ssh deploy@<vps-ip> '
cd /opt/stickerapp
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
'
```

**Always exclude `.env.production`** from any full-tree rsync. Use `--exclude '.env*'` to be safe.

---

## 9. Backups

### 9.1 Install the daily cron

```sh
sudo mv /opt/stickerapp/backup-db.sh /etc/cron.daily/stickerapp-backup
sudo chmod +x /etc/cron.daily/stickerapp-backup
sudo /etc/cron.daily/stickerapp-backup   # test once manually
ls /opt/stickerapp/backups/db/   # confirm gzip exists
```

Daily Postgres dump + media rsync, 14-day retention.

### 9.2 Offsite (deferred)

S3/B2 sync is the obvious next step. Not required to ship. Note: if the VPS dies, all data dies with it until offsite is set up.

---

## 10. Verification checklist (post-deploy)

- [x] `https://endosestudio.com/` — Vue SPA renders.
- [x] `https://endosestudio.com/api/v1/health/` returns `{"status":"ok"}`.
- [ ] `https://endosestudio.com/k7p2x9/` — WordPress renders with styling (BLOCKED on customer WP admin creds, see task #17).
- [x] Customer registration → activation email arrives → set-password → log in.
- [x] Forgot-password round-trip.
- [x] Editor → upload → auto-crop → smart-cut (rembg warmed).
- [x] Order placed → Stripe PaymentIntent created (test mode).
- [ ] Stripe Elements mount in CheckoutView (task #15 — code work, not deploy).
- [ ] Customer order-received + owner new-order emails after payment (blocked on Stripe Elements + webhook secret).
- [ ] Admin order management (status dropdown, shipped popup with carrier email).
- [x] SSL Labs A/A+.
- [x] `certbot renew --dry-run` succeeds.
- [x] Backup cron fires.
- [x] `sudo ufw status` shows only 22/80/443 open.

---

## 11. Known gaps / risks

1. **CheckoutView Stripe Elements not mounted yet** — backend wiring works (PaymentIntent gets minted), frontend shows a placeholder block. Customer can place orders but cannot pay until task #15 ships.
2. **Stripe webhook secret not registered yet** — orders won't auto-transition to `paid` until §7.6 is run.
3. **WP search-replace** — `/k7p2x9/` renders unstyled until §7.5 is run. Blocked on customer-side admin credentials.
4. **No staging environment** — first-deploy testing happens on prod with Stripe test keys. Acceptable risk for an SMB.
5. **Gmail SMTP deliverability** — sending from `endosestudio@gmail.com` to Gmail/Outlook recipients works but can hit spam without SPF/DKIM on a custom From domain. Revisit if customers complain.
6. **rembg cold-start** — first smart-cut after each web boot blocks ~25-40s. Subsequent calls are ~2.3s. nginx `proxy_read_timeout` set to 120s in `/api/`.
7. **No offsite backups day 1** — local only. Add B2/S3 sync once past the first month.

---

## 12. Where things live

| What | Where |
|---|---|
| Source-of-truth nginx + compose + envs | `endosstudio_frontend/deploy/` (this repo) |
| VPS-side runtime | `/opt/stickerapp/` on Hostinger VPS `187.124.29.215` |
| Backups | `/opt/stickerapp/backups/` (local, 14d retention), offsite TBD |
| TLS certs | `/etc/letsencrypt/live/endosestudio.com/` (host filesystem, bind-mounted into nginx container) |
| WordPress files | DreamHost VPS `vps70246` at `/home/dh_8smr6w/endosestudio.com/`. Served by DH Apache at `https://wp.endosestudio.com/`. Our nginx reverse-proxies it via `/k7p2x9/`. |
| Application logs | `docker compose -f /opt/stickerapp/docker-compose.prod.yml logs <service>` |
| Postgres data | named volume `stickerapp_postgres_data` on the VPS |
| Media uploads | named volume `stickerapp_media` |
| Django collected static | named volume `stickerapp_static` |
| Out-of-band emergency console | Hostinger panel → VPS → "Consola" (browser-based, bypasses SSH) |

SSH targets:
- App VPS: `ssh deploy@187.124.29.215` (Sebastian's RSA pubkey, no password fallback)
- WordPress VPS: `ssh endosapp@vps70246.dreamhostps.com` (password from DH panel, isolated user, no sudo)

---

## 13. Useful one-liners

```sh
# Tail web logs
ssh deploy@187.124.29.215 'docker compose -f /opt/stickerapp/docker-compose.prod.yml logs -f web'

# Restart web only
ssh deploy@187.124.29.215 'cd /opt/stickerapp && docker compose -f docker-compose.prod.yml stop web && docker compose -f docker-compose.prod.yml rm -f web && docker compose -f docker-compose.prod.yml up -d web'

# Force a manual backup
ssh deploy@187.124.29.215 'sudo /etc/cron.daily/stickerapp-backup'

# Open Django shell on the live VPS
ssh deploy@187.124.29.215 'docker compose -f /opt/stickerapp/docker-compose.prod.yml exec web python manage.py shell'

# Check fail2ban bans
ssh deploy@187.124.29.215 'sudo fail2ban-client status sshd'

# Unban your own IP after a fail2ban lockout (via Hostinger console, NOT ssh)
fail2ban-client set sshd unbanip <your-ip>
```

---

*Mirror project: `/Users/cevichesmac/Desktop/labcontrol/DEPLOYMENT.md`. When in doubt, that file is the original.*
