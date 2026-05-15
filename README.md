# SyncPlay — Synchronized Music Listening

Полный стек:
- **Backend**: Spring Boot 3.4 + Spring Data JPA + Spring Security (sessions) + WebSocket + Liquibase
- **Frontend**: Next.js 15 + React 19 + TypeScript + Tailwind CSS + PWA (Service Worker)
- **Storage**: MinIO (S3-совместимое объектное хранилище), Apache Tika для метаданных и обложек
- **DB**: PostgreSQL 16 + Liquibase миграции
- **Monitoring**: Prometheus + Grafana

## Архитектура

```
┌──────────────────────┐
│ Browser (Next.js)    │
│  PWA, Service Worker │
└────────┬─────────────┘
         │ HTTP (cookies) + WS
         ▼
┌──────────────────────┐    ┌──────────────────┐
│ Spring Boot          │───▶│ Prometheus :9090 │
│ /actuator/prometheus │    │ ↓                │
└────┬─────────────┬───┘    │ Grafana :3001    │
     │             │        └──────────────────┘
┌────▼────┐  ┌─────▼──────┐
│  MinIO  │  │ PostgreSQL │
└─────────┘  └────────────┘
```

## Возможности

### Auth
- Регистрация / логин (BCrypt + Spring Security cookie sessions)

### Треки
- Загрузка с автоматическим извлечением метаданных через Apache Tika (title, artist, album, genre, duration)
- **Обложки автоматически извлекаются** из ID3-тегов и сохраняются в MinIO
- Streaming с поддержкой Range Request (перемотка на лету)
- Presigned URLs для прямой загрузки из MinIO

### Социальное
- Лайки треков и плейлистов
- Друзья: заявки, accept/reject, поиск пользователей
- **Now Playing** статус друзей в реальном времени
- **Join Session** — мгновенное подключение к комнате друга

### Открытие нового
- **Рекомендации**: гибридный алгоритм
  1. Топ жанры из истории прослушиваний
  2. Если истории мало — топ жанры из лайков
  3. Collaborative filtering: треки которые лайкнули друзья
  4. Случайные если ничего не подходит
- **История прослушивания** — недавно слушали в Center column
- **Статистика пользователя** — топ жанры, артисты (`/api/recommendations/stats`)

### Real-time комнаты
- Создание комнат, host-only управление (PLAY/PAUSE/SKIP/SEEK)
- Очередь треков
- Синхронизация: PING/PONG, clock offset, drift correction
- Чат через WebSocket

### Offline-режим (PWA)
- Service Worker кеширует статику, API ответы и **аудио**
- Установка как нативное приложение через `Add to Home Screen`
- Manifest с иконками и темой

### Адаптивность
- 3 колонки на десктопе со скрытием
- Single-column на мобильных
- Tailwind CSS

## Запуск (3 варианта)

### Вариант 1: Всё через Docker (production-like)

```bash
cd syncplay-stack
docker compose up -d
```

Это поднимет:
- PostgreSQL :5432
- MinIO :9000 (console :9001)
- Spring Boot :8080
- Next.js :3000
- Prometheus :9090
- Grafana :3001

Открой http://localhost:3000

### Вариант 2: Только инфраструктура в Docker, dev-режим разработки

```bash
cd syncplay-stack
# Только зависимости
docker compose up -d postgres minio prometheus grafana

# Spring Boot в dev-режиме
cd syncplay-spring && mvn spring-boot:run

# В другом терминале — Next.js
cd ../syncplay-next && npm install && npm run dev
```

### Вариант 3: Без Docker (нужны postgres + minio локально)

См. документацию PostgreSQL и MinIO для локальной установки.

## URLs

| URL | Что |
|-----|-----|
| http://localhost:3000 | Frontend |
| http://localhost:3000/login | Логин |
| http://localhost:3000/rooms/{id} | Комната |
| http://localhost:8080/api/* | REST API |
| http://localhost:8080/ws/room/{id} | WebSocket |
| http://localhost:8080/actuator/prometheus | Prometheus метрики |
| http://localhost:9001 | MinIO Console (minioadmin/minioadmin) |
| http://localhost:9090 | Prometheus UI |
| http://localhost:3001 | Grafana (admin/admin) |

## API endpoints

### Auth
- `POST /api/auth/register` `{username, email, password}` → auto-login
- `POST /api/auth/login` `{username, password}`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Треки
- `GET /api/tracks?q=поиск`
- `GET /api/tracks/liked`
- `POST /api/tracks` (multipart: file, title?, artist?, album?, genre?, durationMs?)
- `POST/DELETE /api/tracks/{id}/like`
- `GET /api/stream/{id}` — стрим с Range
- `GET /api/stream/{id}/cover` — обложка
- `GET /api/stream/{id}/presigned`

### Плейлисты
- `GET /api/playlists` мои
- `GET /api/playlists/public` публичные
- `POST /api/playlists` создать
- `GET /api/playlists/{id}/tracks`
- `POST /api/playlists/{id}/tracks` `{trackId}`
- `DELETE /api/playlists/{id}/tracks/{trackId}`
- `POST/DELETE /api/playlists/{id}/like`

### Комнаты
- `GET /api/rooms`
- `POST /api/rooms` `{name, playlistId?}` (preload до 6 треков из плейлиста)
- `POST /api/rooms/{id}/join` `/leave`
- `GET /api/rooms/{id}/queue`
- `POST /api/rooms/{id}/queue/{trackId}`

### Друзья
- `GET /api/friends`
- `GET /api/friends/requests`
- `POST /api/friends/requests` `{username}`
- `POST /api/friends/requests/{id}/accept` `/reject`
- `DELETE /api/friends/{friendId}`
- `GET /api/friends/search?q=`
- `GET /api/friends/{friendId}/session` — подключение к комнате друга

### Рекомендации
- `GET /api/recommendations?limit=20`
- `GET /api/recommendations/stats`

### История
- `GET /api/history?limit=30`
- `POST /api/history` `{trackId, durationMs, roomId?}`

## Структура

```
syncplay-stack/
├── README.md
├── docker-compose.yml                        # все сервисы
├── monitoring/
│   ├── prometheus/prometheus.yml
│   └── grafana/provisioning/                 # datasource + дашборд
├── syncplay-spring/
│   ├── pom.xml                               # Boot 3.4 + JPA + Liquibase + Actuator
│   ├── Dockerfile                            # multi-stage
│   └── src/main/
│       ├── java/com/syncplay/
│       │   ├── model/                        # 17 JPA entities (включая ListenHistory)
│       │   ├── repo/                         # 13 Spring Data репозиториев
│       │   ├── service/                      # Auth, Track (с Tika cover), Playlist, Room, Friend, Recommendation, History
│       │   ├── controller/                   # REST + Recommendation + History
│       │   ├── security/                     # Spring Security
│       │   ├── storage/MinioStorage.java
│       │   └── websocket/                    # WebSocketHandler
│       └── resources/
│           ├── application.yml               # с Actuator/Prometheus
│           └── db/changelog/                 # Liquibase
└── syncplay-next/
    ├── package.json                          # Next 15 + Tailwind
    ├── tailwind.config.ts
    ├── postcss.config.js
    ├── next.config.js                        # standalone build
    ├── Dockerfile                            # multi-stage
    ├── public/                               # PWA manifest, icons, sw.js
    ├── app/
    │   ├── layout.tsx                        # PWA manifest + ServiceWorkerRegister
    │   ├── globals.css                       # Tailwind + CSS-переменные
    │   ├── page.tsx                          # 3 колонки + история прослушивания
    │   ├── login/page.tsx
    │   └── rooms/[id]/page.tsx
    ├── components/
    │   ├── Icons.tsx                         # + Sparkles, History + Cover компонент
    │   ├── LeftColumn.tsx                    # Tailwind
    │   ├── CenterColumn.tsx                  # + рекомендации, история, обложки
    │   ├── RightColumn.tsx                   # + Join Session
    │   ├── Player.tsx                        # + обложка из API
    │   └── ServiceWorkerRegister.tsx
    └── lib/
        ├── api.ts
        └── sync.ts
```

## Метрики в Grafana

После запуска зайди в Grafana http://localhost:3001 (admin/admin). Дашборд "SyncPlay Overview" провижится автоматически:
- JVM CPU
- JVM Memory Heap
- HTTP requests/sec по endpoint
- HTTP p95 latency
- Active DB connections
- JVM threads count

Метрики собираются с http://localhost:8080/actuator/prometheus каждые 10 секунд.

## Что нужно установить

| Tool | Version |
|------|---------|
| Docker Desktop | latest |
| Java JDK | 21+ (если не используешь Docker для Spring) |
| Maven | 3.9+ (если не используешь Docker) |
| Node.js | 20+ (если не используешь Docker) |

С Docker всё что нужно — это Docker Desktop. Один `docker compose up` поднимает всё.
