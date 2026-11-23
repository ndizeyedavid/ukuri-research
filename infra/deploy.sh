#!/usr/bin/env bash
set -euo pipefail

SERVER_NAME="${1:-}"
REPO_URL="${2:-}"
APP_DIR="/var/www/ukuri-research-auditor"
APP_USER="${SUDO_USER:-ubuntu}"

if [[ -z "$SERVER_NAME" ]]; then
  echo "usage: sudo bash infra/deploy.sh <web01|web02> [repo-url]" >&2
  exit 1
fi

log() { printf '\n[deploy] %s\n' "$*"; }

log "Installing system packages (nginx, Node.js 20, git)"
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE '^v(2[0-9])\.'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y nginx git
command -v pm2 >/dev/null 2>&1 || npm install -g pm2

log "Fetching code into $APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" pull --ff-only
elif [[ -n "$REPO_URL" ]]; then
  mkdir -p "$(dirname "$APP_DIR")"
  git clone "$REPO_URL" "$APP_DIR"
else
  echo "No checkout at $APP_DIR and no repo URL given." >&2
  exit 1
fi
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

log "Installing production dependencies"
sudo -u "$APP_USER" npm --prefix "$APP_DIR" ci --omit=dev

log "Preparing .env"
if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  sed -i "s/^SERVER_NAME=.*/SERVER_NAME=$SERVER_NAME/" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"
  echo "Created $APP_DIR/.env. Add OPENALEX_API_KEY and MAILTO, then re-run this script."
else
  echo ".env already present, leaving it untouched."
fi

log "Configuring nginx"
cp "$APP_DIR/infra/nginx-ukuri.conf" /etc/nginx/sites-available/ukuri
ln -sf /etc/nginx/sites-available/ukuri /etc/nginx/sites-enabled/ukuri
rm -f /etc/nginx/sites-enabled/default
nginx -t
service nginx reload

log "Installing the ukuri init script"
install -m 0755 "$APP_DIR/infra/ukuri.init" /etc/init.d/ukuri
cat > /etc/default/ukuri <<EOF
APP_DIR="$APP_DIR"
APP_USER="$APP_USER"
EOF
update-rc.d ukuri defaults >/dev/null
service ukuri start

log "Smoke test"
sleep 2
curl -fsS http://127.0.0.1/healthz && echo
curl -fsS -o /dev/null -w 'GET / -> %{http_code}\n' http://127.0.0.1/

log "Done. $SERVER_NAME is serving Ukuri on port 80."
