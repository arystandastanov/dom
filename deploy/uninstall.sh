#!/usr/bin/env bash
# Полное удаление «Дома» с сервера. Другие сайты, их службы, данные и автообновление не затрагиваются.
#
#   sudo bash deploy/uninstall.sh            — удалить сайт, ДАННЫЕ ОСТАВИТЬ в /var/lib/dom
#   sudo bash deploy/uninstall.sh --purge    — удалить всё, включая данные и пользователя dom
#
# После этого останется только удалить DNS-запись поддомена у регистратора
# и, если нужно, папку с исходниками (/opt/dom-src).
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "Запустите через sudo"; exit 1; fi
PURGE=0; [ "${1:-}" = "--purge" ] && PURGE=1
CADDYFILE=/etc/caddy/Caddyfile
BEGIN_MARK='# >>> dom: семейный сайт (блок добавлен deploy/install-ubuntu.sh, удаляется deploy/uninstall.sh)'
END_MARK='# <<< dom'

echo "== Автообновление и служба"
systemctl disable --now dom-autodeploy.timer 2>/dev/null || true
systemctl disable --now dom 2>/dev/null || true
rm -f /etc/systemd/system/dom.service /etc/systemd/system/dom-autodeploy.service /etc/systemd/system/dom-autodeploy.timer /usr/local/sbin/dom-autodeploy
systemctl daemon-reload

echo "== Caddy: убираю только блок dom"
if [ -f "$CADDYFILE" ] && grep -qF "$BEGIN_MARK" "$CADDYFILE"; then
  stamp="$(date +%Y-%m-%d_%H-%M-%S)"
  cp -a "$CADDYFILE" "$CADDYFILE.bak-dom-$stamp"
  tmp="$CADDYFILE.dom-new"
  awk -v b="$BEGIN_MARK" -v e="$END_MARK" '$0==b{skip=1;next} skip&&$0==e{skip=0;next} !skip{print}' "$CADDYFILE" > "$tmp"
  sed -i -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$tmp"
  if caddy validate --config "$tmp" --adapter caddyfile >/dev/null 2>&1; then
    cat "$tmp" > "$CADDYFILE"; rm -f "$tmp"
    systemctl reload caddy && echo "Блок убран, Caddy перечитал настройки (копия: $CADDYFILE.bak-dom-$stamp)"
  else
    rm -f "$tmp"; echo "Проверка Caddy не прошла — Caddyfile не изменён, уберите блок dom вручную"; caddy validate --config "$CADDYFILE" --adapter caddyfile || true
  fi
else
  echo "Блока dom в Caddyfile нет"
fi

echo "== Файлы"
rm -rf /opt/dom
if [ "$PURGE" = 1 ]; then
  rm -rf /var/lib/dom
  id dom >/dev/null 2>&1 && userdel dom || true
  echo "Сайт, данные и пользователь dom удалены."
else
  echo "Сайт удалён. Данные оставлены в /var/lib/dom (удалить: sudo bash deploy/uninstall.sh --purge)."
fi
