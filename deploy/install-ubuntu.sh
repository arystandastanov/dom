#!/usr/bin/env bash
# Установка «Дома» на сервер, где УЖЕ работает портал w7desk (Node.js и Caddy там уже стоят).
#
#   sudo bash deploy/install-ubuntu.sh dom.w7desk.kz
#
# Что делает (и только это):
#   1. создаёт системного пользователя dom (без входа и без sudo);
#   2. копирует сайт в /opt/dom, данные — в /var/lib/dom (доступ только у службы dom);
#   3. создаёт службу dom: слушает только 127.0.0.1:3101, не видит папки портала,
#      ограничена 200 МБ памяти и пониженным приоритетом процессора;
#   4. ДОБАВЛЯЕТ в конец /etc/caddy/Caddyfile отдельный блок для нового адреса
#      (блок портала не трогается; перед правкой — копия файла; при ошибке — откат)
#      и мягко перечитывает настройки Caddy без перерыва в работе портала.
# Что НЕ делает: не обновляет систему, не ставит и не обновляет пакеты, не трогает файрвол,
# портал, его службу, папки и автообновление.
set -euo pipefail

DOMAIN="${1:-}"
APP=/opt/dom
DATA=/var/lib/dom
PORT=3101
CADDYFILE=/etc/caddy/Caddyfile
BEGIN_MARK='# >>> dom: семейный сайт (блок добавлен deploy/install-ubuntu.sh, удаляется deploy/uninstall.sh)'
END_MARK='# <<< dom'

if [ "$(id -u)" -ne 0 ]; then echo "Запустите через sudo: sudo bash deploy/install-ubuntu.sh <адрес>"; exit 1; fi
if [ -z "$DOMAIN" ]; then echo "Укажите адрес сайта: sudo bash deploy/install-ubuntu.sh dom.w7desk.kz"; exit 1; fi
if ! printf '%s' "$DOMAIN" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'; then
  echo "Адрес выглядит неверно: $DOMAIN (пример: dom.w7desk.kz)"; exit 1
fi
SRC="$(cd "$(dirname "$0")/.." && pwd)"
if [ ! -f "$SRC/server.js" ] || [ ! -d "$SRC/public" ]; then echo "Не найдены server.js и public/ в $SRC"; exit 1; fi

step() { printf '\n== %s\n' "$1"; }

step "1/6 Проверка сервера (только чтение)"
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then echo "Node.js не найден — этот скрипт рассчитан на сервер, где уже работает портал."; exit 1; fi
if [ "$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then echo "Нужен Node.js 18+, а стоит $("$NODE_BIN" -v)"; exit 1; fi
if ! command -v caddy >/dev/null 2>&1 || [ ! -f "$CADDYFILE" ]; then echo "Caddy или $CADDYFILE не найдены."; exit 1; fi
if grep -Eq "^[[:space:]]*$(printf '%s' "$DOMAIN" | sed 's/\./\\./g')([[:space:]]|,|\{|$)" "$CADDYFILE" && ! grep -qF "$BEGIN_MARK" "$CADDYFILE"; then
  echo "Адрес $DOMAIN уже используется в $CADDYFILE другим блоком — ничего не меняю."; exit 1
fi
if ss -ltnH "sport = :$PORT" | grep -q . && ! systemctl is-active --quiet dom; then
  echo "Порт $PORT уже занят другой программой — ничего не меняю."; ss -ltnp "sport = :$PORT"; exit 1
fi
echo "Node.js $("$NODE_BIN" -v), Caddy $(caddy version | awk '{print $1}'), порт $PORT свободен"
free -m | awk 'NR<=2'

step "2/6 Пользователь и папки"
id dom >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --no-create-home --shell /usr/sbin/nologin dom
mkdir -p "$APP" "$DATA"
chown dom:dom "$DATA"
chmod 700 "$DATA"
echo "Пользователь dom, код: $APP (только чтение для службы), данные: $DATA (доступ только у dom)"

step "3/6 Файлы сайта"
rm -rf "$APP/public.new" && cp -r "$SRC/public" "$APP/public.new"
cp "$SRC/server.js" "$APP/server.js.new" && mv "$APP/server.js.new" "$APP/server.js"
rm -rf "$APP/public" && mv "$APP/public.new" "$APP/public"
chown -R root:root "$APP"
chmod -R u=rwX,go=rX "$APP"

step "4/6 Служба dom"
cat > /etc/systemd/system/dom.service <<EOF
[Unit]
Description=Дом — семейный планировщик ($DOMAIN)
After=network-online.target
Wants=network-online.target

[Service]
User=dom
Group=dom
WorkingDirectory=$APP
Environment=HOST=127.0.0.1 PORT=$PORT DATA_DIR=$DATA TRUST_PROXY=1 NODE_ENV=production TZ_OFFSET_MIN=300
ExecStart=$NODE_BIN --max-old-space-size=96 $APP/server.js
Restart=on-failure
RestartSec=3
UMask=0077
# Ресурсы: сайт не может «съесть» память и процессор портала и Check It
MemoryHigh=160M
MemoryMax=200M
CPUWeight=50
Nice=5
TasksMax=64
# Изоляция: служба видит только свою папку данных и физически не видит папки портала
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DATA
InaccessiblePaths=-/opt/shtab -/var/lib/shtab -/opt/shtab-browser -/etc/caddy -/root
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
ProtectProc=invisible
RestrictSUIDSGID=true
RestrictNamespaces=true
RestrictRealtime=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable dom >/dev/null
systemctl restart dom
ok=0
for _ in $(seq 1 20); do
  if curl -fs -o /dev/null "http://127.0.0.1:$PORT/healthz"; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != 1 ]; then echo "Сайт не ответил. Журнал службы:"; journalctl -u dom -n 30 --no-pager; exit 1; fi
echo "Служба dom работает на 127.0.0.1:$PORT"

step "5/6 Caddy: отдельный блок для $DOMAIN"
stamp="$(date +%Y-%m-%d_%H-%M-%S)"
cp -a "$CADDYFILE" "$CADDYFILE.bak-dom-$stamp"
echo "Копия Caddyfile: $CADDYFILE.bak-dom-$stamp"
tmp="$CADDYFILE.dom-new"   # рядом с Caddyfile, чтобы import с относительными путями проверялся так же
# Убираем прежний блок dom (если ставим повторно), всё остальное оставляем как есть
awk -v b="$BEGIN_MARK" -v e="$END_MARK" '$0==b{skip=1;next} skip&&$0==e{skip=0;next} !skip{print}' "$CADDYFILE" > "$tmp"
sed -i -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$tmp"
cat >> "$tmp" <<EOF

$BEGIN_MARK
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT {
		header_up X-Real-IP {remote_host}
	}
}
$END_MARK
EOF
if ! caddy validate --config "$tmp" --adapter caddyfile >/dev/null 2>&1; then
  echo "Новая настройка Caddy не прошла проверку — Caddyfile НЕ изменён:"; caddy validate --config "$tmp" --adapter caddyfile || true; rm -f "$tmp"; exit 1
fi
cat "$tmp" > "$CADDYFILE"; rm -f "$tmp"
if ! systemctl reload caddy; then
  echo "Caddy не принял настройку — возвращаю прежний Caddyfile"; cp -a "$CADDYFILE.bak-dom-$stamp" "$CADDYFILE"; systemctl reload caddy || true; exit 1
fi
echo "Caddy перечитал настройки (без перезапуска, портал не прерывался)"

step "6/6 Готово"
echo "================================================================"
if [ -f "$DATA/ПЕРВЫЙ_ВХОД.txt" ]; then cat "$DATA/ПЕРВЫЙ_ВХОД.txt"; echo; fi
echo "Адрес:  https://$DOMAIN"
echo
echo "Если страница не открывается по HTTPS — проверьте DNS-запись $DOMAIN (тип A → IP сервера)."
echo "Caddy получит сертификат сам в течение пары минут после этого."
echo "Резервные копии базы: $DATA/backups (ежедневно, 30 дней)."
echo "Удалить сайт полностью: sudo bash deploy/uninstall.sh"
echo "================================================================"
