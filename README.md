# Дом — семейный планировщик

Задачи, встречи (с подпиской в «Календарь» iPhone), личные бюджеты, общие обязательные платежи
с подтверждением оплаты и общие накопления. Голосовой ввод — диктовка iPhone + разбор текста через Claude (Anthropic).

Без внешних зависимостей: только Node.js 18+. Данные — один файл `db.json` + ежедневные копии (30 дней).

## Установка на сервер, где уже работает другой сайт на Node.js + Caddy (один раз)

```bash
sudo git clone https://github.com/arystandastanov/dom /opt/dom-src
sudo bash /opt/dom-src/deploy/install-ubuntu.sh dom.example.kz   # DNS-запись A должна указывать на сервер
sudo bash /opt/dom-src/deploy/autodeploy.sh                     # автообновление из GitHub раз в 2 минуты
```

Скрипты не обновляют систему, не ставят пакеты, не трогают файрвол и другие сайты.

## Изоляция

- отдельный системный пользователь `dom` (без входа и без sudo);
- код в `/opt/dom` (только чтение для службы), данные в `/var/lib/dom` (права 700);
- служба `dom` слушает только `127.0.0.1:3101`; в `/opt` и `/var/lib` она видит только свои папки,
  домашние папки и настройки Caddy ей недоступны; лимит 200 МБ памяти, пониженный приоритет процессора;
- в Caddyfile добавляется отдельный блок между метками `# >>> dom` и `# <<< dom`, остальное не меняется;
- своё автообновление `dom-autodeploy.timer`.

## Обслуживание

- Журнал: `journalctl -u dom -n 50`, обновления: `journalctl -u dom-autodeploy -n 30`
- Сброс пароля администратора: `sudo -u dom env DATA_DIR=/var/lib/dom node /opt/dom/server.js --reset-admin`
- Выключить автообновление: `sudo systemctl disable --now dom-autodeploy.timer`
- Удалить сайт: `sudo bash /opt/dom-src/deploy/uninstall.sh` (данные останутся) или `… --purge` (всё)
  → затем удалить DNS-запись и папку `/opt/dom-src`.

## Локальный запуск

```bash
node server.js   # http://127.0.0.1:3101, данные в ./data, пароль первого входа — в консоли
```
