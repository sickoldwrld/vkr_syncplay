# E2E (Playwright)

Запуск:

```bash
# 1. Поднять полный стек (фронт, спринг, sync, postgres, minio).
./restart.sh
# или
docker compose up -d

# 2. (Один раз) Установить браузеры Playwright.
cd syncplay-next
npx playwright install --with-deps chromium

# 3. Запустить E2E.
npm run test:e2e
```

E2E **не запускает** Spring/MinIO самостоятельно — для этого есть `./restart.sh`.
Тесты используют seeded demo-пользователя (`demo` / `demo123`), который создаётся
`DemoUserSeeder` при первом запуске пустой БД.

## Что покрыто

| Suite | Сценарии |
|---|---|
| `auth.spec.ts` | Логин, неверные креды, redirect без сессии. |
| `room.spec.ts` | Создание комнаты, появление drift bar и transport. |
| `voteSkip.spec.ts` | Появление VoteSkipBar, нажатие кнопки, обновление счётчиков. |

## Чего нет

Двухклиентного «host + второй слушатель → vote-skip достигает порога» тут нет —
для этого нужна фикстура треков и второй зарегистрированный аккаунт. Сценарий
описан в `docs/testing.md` и легко собирается из двух браузерных контекстов
через `browser.newContext()`.
