#!/usr/bin/env bash
# Обновление «Дома» новой версией из этой папки. Данные не трогаются, портал не затрагивается.
#   sudo bash deploy/update.sh
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "Запустите через sudo: sudo bash deploy/update.sh"; exit 1; fi
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/dom
DATA=/var/lib/dom
if [ ! -f /etc/systemd/system/dom.service ]; then echo "Сайт ещё не установлен. Сначала: sudo bash deploy/install-ubuntu.sh <адрес>"; exit 1; fi
if [ ! -f "$SRC/server.js" ] || [ ! -d "$SRC/public" ]; then echo "Не найдены server.js и public/ в $SRC"; exit 1; fi
# Проверяем синтаксис до замены файлов — сломанная версия не заменит рабочую
node --check "$SRC/server.js"
node --check "$SRC/public/app.js"

stamp="$(date +%Y-%m-%d_%H-%M)"
if [ -f "$DATA/db.json" ]; then
  install -o dom -g dom -m 600 -D "$DATA/db.json" "$DATA/backups/before-update-$stamp.json"
  # храним только 20 последних копий «перед обновлением»
  ls -1t "$DATA"/backups/before-update-*.json 2>/dev/null | tail -n +21 | xargs -r rm -f
fi

rm -rf "$APP/public.new"
cp -r "$SRC/public" "$APP/public.new"
cp "$SRC/server.js" "$APP/server.js.new"
mv "$APP/server.js.new" "$APP/server.js"
rm -rf "$APP/public"
mv "$APP/public.new" "$APP/public"
chown -R root:root "$APP"
chmod -R u=rwX,go=rX "$APP"

systemctl restart dom
sleep 2
if systemctl is-active --quiet dom; then echo "«Дом» обновлён и работает."; else journalctl -u dom -n 30 --no-pager; exit 1; fi
