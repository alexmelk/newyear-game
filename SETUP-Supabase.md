# Рейтинг и античит через Supabase — архитектура (проект уже настроен и задеплоен)

Этот файл — документация к уже работающей связке. Настройка выполнена,
всё задеплоено через Management API. Здесь описано, как это устроено
и как обновлять.

## Как защищён рейтинг (схема «раунд + реплей»)

1. **start-round** (Edge Function): при нажатии «Играть» клиент регистрирует раунд
   и получает `roundId` + серверный `seed`. Игра целиком детерминирована этим seed
   (mulberry32 PRNG для всех спавнов; физика шагами 1/60).
2. **Рекордер в клиенте** пишет: `seed`, ключевые кадры движения (~20 Гц, 2D: tx, 3D: полоса)
   и события очков/попаданий `ev` — этого хватает, чтобы воспроизвести и проверить раунд.
3. **submit-score** (Edge Function) при отправке результата проверяет:
   - раунд существует, не просрочен (15 мин) и **не использован** (одноразовый);
   - replay привязан к серверному seed (`seed mismatch` → 400);
   - сумма событий == заявленный score; попаданий ровно 3 (смерть);
   - длительность раунда ≤ реальному времени с момента start-round (+10с допуск);
   - потолок очков `score ≤ min(60000, time*60+200)` и анти-спам (6 записей/имя/10 мин).
   Аномальная плотность (>35 очков/сек) → флаг `suspicious` (не отказ, а очередь на модерацию).
4. **Прямая запись anon закрыта**: RLS insert-политики нет — вставку делает только
   функция от service-role. Anon может только SELECT.
5. **Реплеи хранятся в таблице** (`scores.replay`, `replay_bytes`). У топ-3 на борде
   кнопка ▶ — любой может посмотреть запись раунда (режим `?replay=<id>` в игре:
   она заново проигрывает симуляцию; при расхождении очков показывается красный
   «возможен чит»).

## Файлы

- `supabase/functions/start-round/index.ts` — выдача раунда + seed (env: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY — стандартные секреты проекта).
- `supabase/functions/submit-score/index.ts` — валидация и вставка результата.
- `supabase/functions/admin/index.ts` — модерация (list / replay / hide / show / verify / delete,
  и `dev` — подтверждение пароля для меню разработчика в игре),
  доступ по заголовку `x-admin-pass`, сверяется с env-секретом `ADMIN_PASSWORD`.
- `supabase/functions/report-replay/index.ts` — жалоба «🚨 Читер!» на запись из просмотра
  реплея: инкрементит `scores.reports` (service role, anon-права на UPDATE не нужны).
  `verify` в админке обнуляет счётчик жалоб; в списке жалобщие записи идут первыми.
- `supabase/functions/ping/index.ts` — heartbeat «игрок онлайн»: upsert строки в таблицу
  `presence` по client_id браузера (случайный id в localStorage `xmasCid`, попадает в
  `scores.client_id` при submit-score). Борд читает `presence` анонимно (RLS select) и рисует
  зелёную точку у имён, чей heartbeat моложе ~70с. Старые записи без client_id — без точки.
- Меню разработчика (F2 / ?debug=1) открывается только после ввода пароля администратора
  (проверка экшеном `dev` функции admin; успех запоминается в sessionStorage, не в URL).
- `admin.html` — мини-админка (тот же пароль).
- `scripts/deploy-function.js` — передеплой одной функции.
- `scripts/publish.js` — публикация index.html/admin.html на GitHub Pages (Contents API).

## Схема БД

```sql
-- таблицы уже созданы, здесь для справки
create table public.scores (
  id bigint primary key, name text, score bigint, date text, created_at timestamptz,
  replay text, replay_bytes int default 0,
  hidden boolean not null default false, suspicious boolean not null default false,
  reports integer not null default 0,   -- жалобы «Читер!» из просмотра реплеев
  client_id text,                        -- для зелёной точки «онлайн»
  round_id uuid
);
create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  seed bigint not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used boolean not null default false
);
-- RLS: select для всех; вставки — только из Edge Functions (service role)
-- presence: select для всех (борд), upsert только из функции ping
create table public.presence (client_id text primary key, seen_at timestamptz not null default now());
```

Обслуживание: просроченные раунды чистятся автоматически при вызове start-round.

## Обновление / redeploy

```bash
node scripts/deploy-function.js <sbp_токен>                 # submit-score
# все три функции + секреты + миграции: см. server-setup в scripts (история)
node scripts/publish.js <ghp_токен> index.html admin.html   # (легаси single-file, больше неосновной)
```

Секреты проекта (ADMIN_PASSWORD) задаются через Management API `POST /v1/projects/{ref}/secrets`.
⚠ Пароль админки не хранится в репозитории — только в секретах Supabase.

## v2.0.0 — переписано на Angular (основной клиент теперь angular-app/)

Структура (Angular 16, standalone-компоненты, hash-роутинг — из-за GitHub Pages без SPA-fallback):

| Файл | Роль |
|---|---|
| `angular-app/src/app/core/engine.ts` | игровой движок: порт single-file симуляции **один-в-один** (те же константы/порядок вызовов → старые реплеи воспроизводятся; проверено тестом на живом replay id=17). Движок создаётся вне зоны NgZone (rAF не дёргает CD), с UI общается через hooks-колбэки |
| `angular-app/src/app/core/supabase.service.ts` | рейтинг/античит/присутствие/модерация: старт-раунд, submit-score (roundId+replay+cid), борд+presence, ping, report-replay, dev-гейт, admin-экшены |
| `angular-app/src/app/core/config.ts` | `VERSION` (отображается в углу игры и на админке) + URL/anon-ключ |
| `game/game.component.ts` | канвас, меню, финал+сохранение, реплей-вьювер (`?replay=<id>` — прежний контракт ссылок!), dev-панель (F2, гейт паролем через сервер), errBar, verTag |
| `board/board.component.ts` | таблица рекордов: топ-10, «моя» строка, зелёная точка онлайн, ▶ у топ-3 |
| `admin/admin.component.ts` | мини-админка — прежняя functional-логика, тот же пароль |
| маршруты | `#/` игра, `#/admin` админка; `admin.html` — редирект-заглушка на `#/admin` |

Сборка и публикация (артефакты идут в корень репо Pages):

```bash
cd angular-app && npx ng build --configuration production --base-href /newyear-game/
node scripts/publish-dist.js <ghp_токен> angular-app/dist/angular-app admin-redirect.html:admin.html
```

Версия приложения: `VERSION` в `core/config.ts` (и `package.json`) — чинить по правилам:
фича → минор, фикс → патч; отображается слева-сверху в игре и в заголовке админки.
