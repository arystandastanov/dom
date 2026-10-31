# Дом — семейный планировщик

Задачи, встречи (с подпиской в «Календарь» iPhone), личные бюджеты, общие обязательные платежи
с подтверждением оплаты и общие накопления. Голосовой ввод — диктовка iPhone + разбор текста через Claude (Anthropic).

Без внешних зависимостей: только Node.js 18+. Данные — один файл `db.json` + ежедневные копии (30 дней).

## Установка рядом с порталом w7desk (один раз)

Все команды — на сервере. Ни одна из них не трогает портал, его службу, данные и файрвол.

```bash
# 1. Ключ только для чтения этого репозитория (секретная часть остаётся на сервере)
sudo ssh-keygen -t ed25519 -N "" -C "dom-deploy@$(hostname)" -f /root/.ssh/dom_deploy
sudo tee -a /root/.ssh/config >/dev/null <<'EOF'

Host github-dom
  HostName github.com
  User git
  IdentityFile /root/.ssh/dom_deploy
  IdentitiesOnly yes
EOF
sudo cat /root/.ssh/dom_deploy.pub
#    → GitHub: репозиторий → Settings → Deploy keys → Add deploy key, «Allow write access» НЕ отмечать

# 2. Исходники
sudo git clone git@github-dom:OWNER/REPO.git /opt/dom-src

# 3. Установка (DNS-запись A для адреса должна указывать на сервер)
sudo bash /opt/dom-src/deploy/install-ubuntu.sh dom.w7desk.kz

# 4. Автообновление из GitHub раз в 2 минуты
sudo bash /opt/dom-src/deploy/autodeploy.sh
```

## Как устроена изоляция

| | Портал | Дом |
|---|---|---|
| Пользователь | shtab | dom (без входа, без sudo) |
| Код | /opt/shtab | /opt/dom (только чтение для службы) |
| Данные | /var/lib/shtab | /var/lib/dom (права 700) |
| Служба | shtab, :8080 | dom, 127.0.0.1:3101 |
| Автообновление | w7desk-autodeploy.timer | dom-autodeploy.timer |

Служба `dom` не видит `/opt/shtab`, `/var/lib/shtab`, `/opt/shtab-browser`, `/etc/caddy`, `/root`, `/home`,
может писать только в `/var/lib/dom`, ограничена 200 МБ памяти и пониженным приоритетом процессора.
В Caddyfile добавляется отдельный блок между метками `# >>> dom` и `# <<< dom`.

## Обслуживание

- Журнал: `journalctl -u dom -n 50`, обновления: `journalctl -u dom-autodeploy -n 30`
- Сброс пароля администратора: `sudo -u dom env DATA_DIR=/var/lib/dom node /opt/dom/server.js --reset-admin`
- Выключить автообновление: `sudo systemctl disable --now dom-autodeploy.timer`
- Удалить сайт: `sudo bash /opt/dom-src/deploy/uninstall.sh` (данные останутся) или `… --purge` (всё)
  → затем удалить DNS-запись, `/opt/dom-src`, `/root/.ssh/dom_deploy*` и блок `github-dom` в `/root/.ssh/config`.

## Локальный запуск

```bash
node server.js   # http://127.0.0.1:3101, данные в ./data, пароль первого входа — в консоли
```
