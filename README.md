# Poker Backend

REST + SSE бэкенд для Техасского Холдема на Яндекс.Игры. Замена Firebase Realtime
Database на свой сервис, чтобы не зависеть от чужих облаков и держать данные у себя.

- **Node 22+** (использует встроенный `node:sqlite` — никакой нативной компиляции)
- **Express 4** для REST
- **Server-Sent Events** для реалтайма (легче, чем WebSocket; работает через любой HTTP-прокси)
- **SQLite** на Render Persistent Disk — данные переживают редеплой

## Структура

```
poker-backend/
├── package.json
├── render.yaml              # Render Blueprint (Web Service + Disk)
├── .env.example             # переменные окружения для локального запуска
├── src/
│   ├── server.js            # Express + CORS + graceful shutdown
│   ├── lib/
│   │   ├── db.js            # SQLite-обёртка (kv-таблица)
│   │   ├── sse.js           # шина событий для SSE
│   │   └── normalize.js     # нормализация стола (зеркало клиента)
│   └── routes/
│       ├── tables.js        # /tables/* REST + /sse/tables/*
│       └── leaderboard.js   # /leaderboard/* REST + /sse/leaderboard
└── client/
    ├── index.html           # готовая HTML-страница для Яндекс.Игр
    ├── poker-engine.js      # без изменений (тот, что прислал)
    ├── game.js              # модифицированный: FirebaseDB → ApiClient
    ├── game-api.js          # НОВЫЙ: REST+SSE клиент (замена FirebaseDB)
    └── game.original.js     # копия твоего оригинального game.js (на всякий)
```

## Локальный запуск

```bash
cd poker-backend
npm install
npm run dev
# → http://localhost:10000
```

Проверка:

```bash
curl localhost:10000/healthz
curl localhost:10000/tables
curl localhost:10000/tables/table_1
```

Переменные окружения (см. `.env.example`):

| Переменная           | Назначение                                       | По умолчанию              |
| -------------------- | ------------------------------------------------ | ------------------------- |
| `PORT`               | HTTP-порт                                        | `10000`                   |
| `DB_PATH`            | Путь к SQLite-файлу                              | `./data/poker.db`         |
| `ALLOWED_ORIGINS`    | CORS: `*` или список origin через запятую        | `*`                       |
| `SSE_HEARTBEAT_MS`   | Интервал пинга SSE (мс)                          | `15000`                   |
| `NODE_ENV`           | `production` отключает цветные логи              | `development`             |

## Деплой на Render

### Вариант A — Blueprint (рекомендую)

1. Залей `poker-backend/` в Git-репозиторий (GitHub/GitLab).
2. На Render: **New → Blueprint**.
3. Подключи репо — Render подхватит `render.yaml` и сам создаст:
   - Web Service на Node 22
   - Persistent Disk 1 ГБ, смонтированный в `/var/data`
4. После деплоя Render даст URL вида `https://poker-backend-xxxx.onrender.com`.

> **План**: по умолчанию в `render.yaml` стоит `starter`. Если хочешь сэкономить
> и не против, что сервис засыпает через 15 мин без активности — поменяй на `free`.
> Для активного мультиплеера `starter` или выше.

### Вариант B — вручную

1. **New → Web Service → Connect repo** с этим кодом.
2. **Environment**:
   - `Runtime`: Node
   - `Build Command`: `npm install --omit=dev`
   - **Start Command**: `npm start`
   - **Instance Type**: Starter или выше
3. **Environment Variables**:
   - `NODE_VERSION=22.17.0`
   - `DB_PATH=/var/data/poker.db`
   - `ALLOWED_ORIGINS=*`
4. **Disks** → **Add Disk**:
   - Name: `poker-data`
   - Mount Path: `/var/data`
   - Size: `1` GB
5. **Health Check Path**: `/healthz`
6. Deploy.

## Подключение фронта

В `client/game-api.js` есть встроенный fallback на `https://poker-backend.onrender.com`.
Чтобы переопределить, есть три способа (в порядке приоритета):

1. **URL-параметр** `?api=...` — самый быстрый для отладки:

   ```
   https://yandex.ru/games/play/...?api=https://poker-backend-xxxx.onrender.com
   ```

2. **Глобальная переменная** `window.POKER_API_BASE` — задай в HTML перед подключением
   `game-api.js`, если у тебя есть шаблонизатор или бандлер.

3. **Same-origin** — если бэкенд доступен по тому же origin, что и фронт
   (например, через reverse-proxy), `game-api.js` подхватит `location.origin`
   автоматически.

## API

### REST

| Метод  | Путь                            | Описание                                  |
| ------ | ------------------------------- | ----------------------------------------- |
| GET    | `/healthz`                      | health-check                              |
| GET    | `/tables`                       | все три стола (для лобби)                 |
| GET    | `/tables/:tableId`              | один стол                                 |
| PUT    | `/tables/:tableId`              | перезаписать стол целиком                 |
| PATCH  | `/tables/:tableId`              | частичное обновление                      |
| PUT    | `/tables/:tableId/seats/:idx`   | записать одно место (Firebase-style)      |
| GET    | `/leaderboard/top?n=10`         | глобальный топ                            |
| POST   | `/leaderboard/submit`           | `{playerId,name,score,won}` → +1 запись   |
| GET    | `/leaderboard`                  | все записи (для отладки)                  |

### SSE (Server-Sent Events)

| Путь                              | Что пушит                                |
| --------------------------------- | ---------------------------------------- |
| `/sse/tables`                     | все столы (для лобби)                    |
| `/sse/tables/:tableId`            | один стол                                |
| `/sse/leaderboard`                | весь лидерборд                           |

Каждое событие — это `event: put\ndata: {path, data}\n\n`. Клиент сравнивает
с кэшем и рендерит изменения.

## Как залить фронт на Яндекс.Игры

1. Скопируй файлы из `client/` (`index.html`, `style.css`, `game.js`, `game-api.js`,
   `poker-engine.js`) — это и есть твой билд. `style.css` — это твой `e9c4bfda__....css`.
2. Собери из них ZIP и загрузи в **Яндекс.Игры → Игра → Файлы**.
3. В настройках игры укажи **Backend URL** (если требуется) — свой Render-URL.
4. В `index.html` ссылка на `poker-engine.js` и `game.js` остаётся как была,
   `game-api.js` подключай **между** ними.
5. Проверь превью: открой стол в двух разных вкладках — карты, ставки и ходы
   должны синхронизироваться в реальном времени.

## Заметки

- **CORS**: по умолчанию `ALLOWED_ORIGINS=*`, потому что фронт живёт в
  iframe на `yandex.ru`. Если хочешь закрыть — укажи свой origin.
- **SSE через Render**: у них нет жёсткого таймаута на чтение (есть idle на TCP,
  но наш `keepAliveTimeout: 70s` длиннее), плюс мы шлём heartbeat каждые 15 с,
  чтобы соединение точно не «уснуло».
- **Persistent Disk 1 ГБ** хватит на тысячи раздач с десятками тысяч записей в
  лидерборде. Если понадобится больше — увеличь `sizeGB` в `render.yaml`.
- **Бекапы**: можно зайти на Render Dashboard → Disks → и снять snapshot.
- **Лидерборд Яндекс SDK** остался в коде как опциональный fallback. Если ты
  выкладываешь игру не в Яндекс.Игры — он просто молча не сработает, ничего не сломает.

## Что точно работает

```
✅ REST CRUD по столам
✅ SSE-пуши при изменениях (reconnect + heartbeat)
✅ Глобальный лидерборд
✅ SQLite-персистентность через Render Disk
✅ CORS для iframe Яндекс.Игр
✅ Graceful shutdown на SIGTERM (Render это шлёт при редеплое)
✅ Экспресс-валидация тел запросов
```

## Что НЕ реализовано (out of scope)

- ❌ Авторизация / антифрод — `playerId` генерится в браузере. Для production
  стоит добавить JWT или хотя бы HMAC-подпись сессии.
- ❌ Миграции БД — пока схема простая (одна таблица `kv`), миграции не нужны.
- ❌ Метрики (Prometheus и т. п.) — для покерного проекта избыточно.