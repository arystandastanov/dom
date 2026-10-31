#!/usr/bin/env bash
# Автообновление «Дома»: раз в 2 минуты сервер проверяет GitHub (ветка main)
# и, если есть новая версия, ставит её через deploy/update.sh (перед этим — копия базы).
# Работает отдельно от автообновления портала (свой таймер, своя блокировка).
# Включить один раз:   sudo bash deploy/autodeploy.sh
# Выключить:           sudo systemctl disable --now dom-autodeploy.timer
# Журнал:              journalctl -u dom-autodeploy -n 30
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "Запустите через sudo"; exit 1; fi
REPO="$(cd "$(dirname "$0")/.." && pwd)"
git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || { echo "$REPO — не git-репозиторий"; exit 1; }

cat > /usr/local/sbin/dom-autodeploy <<SCRIPT
#!/usr/bin/env bash
set -euo pipefail
cd "$REPO"
exec 9>/run/dom-autodeploy.lock
flock -n 9 || exit 0
timeout 60 git fetch -q origin main
if [ "\$(git rev-parse HEAD)" != "\$(git rev-parse origin/main)" ]; then
  git merge --ff-only -q origin/main
  echo "Новая версия: \$(git log --oneline -1)"
  bash deploy/update.sh
fi
SCRIPT
chmod 700 /usr/local/sbin/dom-autodeploy

cat > /etc/systemd/system/dom-autodeploy.service <<UNIT
[Unit]
Description=Дом: обновление из GitHub
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/dom-autodeploy
Nice=10
UNIT

cat > /etc/systemd/system/dom-autodeploy.timer <<UNIT
[Unit]
Description=Дом: проверять обновления каждые 2 минуты
[Timer]
OnBootSec=90s
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now dom-autodeploy.timer >/dev/null
echo "Автообновление «Дома» включено: сервер проверяет GitHub каждые 2 минуты."
