# Backend рядом с Dnevnik

Отдельный сервис `portal38-api`, порт 3002, отдельный volume `portal38-data`, существующая сеть `dnevnik-proxy`. Настройки и данные Dnevnik не меняются.

## Подготовка

На сервере клонируйте репозиторий в `/home/kinjo/portal38`, затем из корня проекта:

```bash
cp server/.env.example server/.env
chmod 600 server/.env
docker compose -p portal38 -f server/compose.yaml build
docker compose -p portal38 -f server/compose.yaml run --rm --no-deps --user "$(id -u):$(id -g)" -v "$PWD/server:/settings" portal38-api node server/keys.mjs /settings/.env
nano server/.env
```

Генератор заполняет пустые ключи и сохраняет ранее настроенные. Задайте:

```text
ALLOWED_ORIGINS=https://gangabass.github.io
APP_URL=https://gangabass.github.io/portal38/
VAPID_SUBJECT=mailto:ВАШ_EMAIL
```

`FAMILY_ACCESS_KEY` — общий ключ входа в приложение, храните его в семье. `ENCRYPTION_KEY` и VAPID-ключи должны сохраняться при обновлениях. Без ключа шифрования восстановить данные невозможно. `PORTAL_TEST_LOGIN` и `PORTAL_TEST_PASSWORD` на production не нужны: аккаунты добавляются через интерфейс.

```bash
docker compose -p portal38 -f server/compose.yaml up -d
docker compose -p portal38 -f server/compose.yaml ps
docker compose -p portal38 -f server/compose.yaml exec portal38-api node -e "fetch('http://127.0.0.1:3002/api/health').then(r=>r.json()).then(console.log)"
```

Контейнер работает без root; порт не публикуется на хосте. Сеть `dnevnik-proxy` должна уже существовать и быть подключена к Nginx Proxy Manager, как в Dnevnik.

## Nginx Proxy Manager

В Advanced существующего Proxy Host `gangabass.duckdns.org`, сохраняя блок Dnevnik и остальные настройки, добавьте:

```nginx
location ^~ /portal38-api/ {
    resolver 127.0.0.11 valid=30s ipv6=off;
    set $portal38_upstream http://portal38-api:3002;
    rewrite ^/portal38-api/(.*)$ /$1 break;
    proxy_pass $portal38_upstream;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 5s;
    proxy_read_timeout 180s;
    client_max_body_size 64k;
    proxy_cache off;
}
```

Проверьте `nginx -t` в контейнере NPM и адрес:

```text
https://gangabass.duckdns.org/portal38-api/api/health
```

Не меняйте основной маршрут Home Assistant. Backend должен иметь исходящий HTTPS-доступ к portal38.is-mis.ru и push-серверам Apple/Google/Mozilla.

## GitHub Pages

В репозитории Settings → Pages выберите GitHub Actions. В Settings → Secrets and variables → Actions → Variables добавьте публичную переменную:

```text
VITE_API_BASE_URL=https://gangabass.duckdns.org/portal38-api
```

Запустите вручную `Deploy PWA to GitHub Pages`. Ожидаемый адрес PWA: https://gangabass.github.io/portal38/ . Workflow публикует только `dist`, backend и `.env` в него не входят.

Проверьте с телефона через мобильную сеть: подключение семейным ключом, вход на портал, картотеку, другую поликлинику, создание правила **без автозаписи**, появление слотов. На iPhone добавьте PWA через Safari на экран «Домой», откройте с иконки, включите push, нажмите «Проверить» и проверьте доставку при закрытой PWA. На Android установите PWA из браузера и повторите проверку.

Следующий живой тест — ручная запись на действительно нужный талон. Она создаёт настоящую запись. Во время разработки этот тест не выполнялся.

## Обновление и backup

```bash
docker compose -p portal38 -f server/compose.yaml up -d --build
```

Для согласованной резервной копии остановите сервис, скопируйте `/data`, затем снова запустите его:

```bash
docker compose -p portal38 -f server/compose.yaml stop portal38-api
docker compose -p portal38 -f server/compose.yaml cp portal38-api:/data ./private-backup
docker compose -p portal38 -f server/compose.yaml start portal38-api
```

Храните `server/.env` вместе с резервной копией приватно. Не используйте `down -v`: он удалит базу. Уведомления и правила восстанавливаются вместе с базой и исходными ключами; неподтверждённые попытки записи после перезапуска требуют проверки человеком.


## Текущее размещение

Установлено 12 ноября 2026 года:

- Сервер: `/home/kinjo/portal38`, Docker Compose project `portal38`.
- API: `https://gangabass.duckdns.org/portal38-api`.
- Проверка состояния: `https://gangabass.duckdns.org/portal38-api/api/health`.
- В Nginx Proxy Manager маршрут сохранён в Advanced существующего Proxy Host; исходная конфигурация сохранена в `/data/portal38-route-backup-*.json` контейнера NPM.
- Серверный `FAMILY_ACCESS_KEY` совпадает с локальным `server/.env`. Это общий пароль приложения. Его вводят в поле «Семейный ключ доступа»; пароль портала вводится отдельно при добавлении аккаунта.
- Ключи и база не публикуются. Тестовые credentials на сервер не переносились. При установке аккаунтов и правил в серверной базе нет.
