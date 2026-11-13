# ХЕНДОФФ — игра «Дед Мороз» (newyear-game)

Срез состояния: **v2.9.3**, 13.11.2026. Цель файла — продолжить работу с чистого листа на другом компьютере.

---

## 1. Что это за проект

Браузерная новогодняя игра-скролл-шутер на GitHub Pages:

- **Геймплей**: Дед Мороз (canvas, персонаж собран из эмодзи) ловит 🎁, уворачивается от ❄/🌲; сердечки ❤️ дают +1 жизнь (макс 5). Зоны меняются каждые 60 с: 2D → Зумба (3D-перспектива) → Зумба-спираль и т.д.
- **Анти-чит**: сервер выдаёт `round(seed)` → клиент играет и шлёт результат + **реплей** (входной таймлайн + события). Edge-функция `submit-score` проверяет инварианты; рейтинг в Supabase. Топ-3 имеют кнопку ▶ (просмотр реплея, симуляция движком один-в-один) и жалобу 🚨 (модерация через #/admin).
- **Музыка**: 3 MP3-трека (`angular-app/src/assets/music/`), автоплей по первому жесту, кнопка переключения трека; при MP3 синтеж-мелодия движка выключается, SFX остаются.
- **Live**: https://alexmelk.github.io/newyear-game/ · админка: `#/` → #/admin, пароль `Deg-Moroz-yvw2sc`
- UI без слов «(Supabase)» и «пароль» в заголовках; версия (v2.9.3) показывается в левом верхнем углу (индикатор актуальности сборки).

## 2. Ключи и доступы

**Токены в репозиторий не коммитятся** (secret-scanning GitHub блокирует push). Полные значения — в файле `SECRETS-newyear-game.md`, он лежит ВНЕ репо (рядом с папкой newyear-game; на этой машине: `C:\Users\Alexmelk\Documents\Default Project\SECRETS-newyear-game.md`). На новой машине берём оттуда и задаём как `<GH_TOKEN>`/`<SBP_TOKEN>` в командах ниже.

| Что | Значение / где |
|---|---|
| GitHub token (push/Pages Contents API) | `<GH_TOKEN>` — в SECRETS-файле (`ghp_…`) |
| Supabase URL/KEY (anon) | в `angular-app/src/app/core/config.ts` (публичные) |
| Supabase project ref | `txysdosoenhgzhjsmffm` |
| Supabase Management token (деплой edge-функций) | `<SBP_TOKEN>` — в SECRETS-файле (`sbp_…`), не отзывать |
| Пароль админки игры | `Deg-Moroz-yvw2sc` (всё равно в клиентском бандле) |
| Репозиторий | `alexmelk/newyear-game`, ветка `main`, GitHub Pages из корня |

**Структура репозитория**: корень = сайт Pages (`index.html`, `main.*.js`, `styles.*.css`, `assets/…`, `admin-redirect.html`) + исходники в подпапках (`angular-app/`, `supabase/functions/`, `scripts/`). Осиротевшие бандлы после релиза удаляются `scripts/tools/delorphan.js main.<hash>.js`.

## 3. Исходники (главное здесь)

```
angular-app/
  package.json, angular.json — Angular ~17, standalone-компоненты
  src/app/core/config.ts        — VERSION (! менять при каждом релизе), SUPABASE_URL/KEY
  src/app/core/engine.ts        — ВЕСЬ движок (~1180 строк): canvas, зоны, зумба, сердечки,
                                  запись/симуляция реплеев, HUD, звук. Движок живёт ВНЕ NgZone.
  src/app/core/supabase.service.ts — REST: loadBoard, fetchReplay, startRound (3 попытки/8с),
                                  submitScore (честные отказы + reason), ensureCid (try/catch), ping
  src/app/game/game.component.ts — UI-обвязка: save() c REASONS-подписями, MP3-плеер
                                  (tryStartMp3/nextTrack/syncMp3Volume), replay-хуки, openReplay
  src/app/board/board.component.ts — топ-10, ▶ у топ-3
  src/app/admin/…               — пароль, жалоб, модерация
  src/styles.css                — #sndBtn top:84px, #trkBtn top:130px, right:12px;
                                  @media(max-width:600px){#trkBtn{display:none}}
supabase/functions/submit-score/index.ts — серверная валидация (ДЕПЛОЙНУТА и совпадает)
scripts/publish-dist.js  — загрузить dist на Pages (node scripts/publish-dist.js <token> angular-app\dist\angular-app)
scripts/push-sources.js  — исходники репо одним коммитом (git trees API)
scripts/deploy-function.js — перезалить edge-функцию (management token)
scripts/tests/run.js     — 32 unit/roundtrip-теста движка (нужен engine.cjs, см. заголовок run.js)
scripts/tests/replays.js — симуляция ЖИВЫХ реплеев из БД через enterReplay (сверка с target)
scripts/tests/segmentdiag.js — диагностика расхождений реплея по сегментам/зонам (top-1 запись)
scripts/tools/livecheck.js   — live-верификация публикации (ждёт index→нужный бандл, сверяет иглы)
scripts/tools/delorphan.js   — удалить файл из репо (Pages)
scripts/tools/subtest.js     — живой тест submit-score (создаётround+replay и шлёт; НЕ для прод-данных)
SETUP-Supabase.md        — настройки БД/функций/RPC
```

## 4. Система версий реплеев (КРИТИЧНО знать)

Рекорд содержит `replay = { v, seed, dur, inputs, ev }`; вьюер ставит `simV = clamp(1..7, v)` (в `reset()`); живой ранг всегда `v:7`. **Все гейты в движке — вида `simV >= N`, поэтому v7 = v6 по физике.** Старые live-реплеи обязаны симулироваться как раньше — не «унифицировать» гейты.

- **v1** — legacy (S-тропка, без 3D/зумбы в ранних записях, вниз не стреляем).
- **v2** — S-тропка зумбы, скорость 30+8·diff.
- **v3** — цепочка 20+4·diff.
- **v4** — спираль (zPathSp/zLenSp), Дед в центре спирали, старт цепочки без групп 3+, 14+3·diff, 3D замедлен (run3 30+8·diff), выстрелы на 360°: код угла `-(10000+round((ang+π)·1000))`.
- **v5** — `zAutoCollapse()` (съехавшиеся группы 3+ лопаются сами = комбо), скорость 12+2.5·diff.
- **v6** — сердечки ❤️ во всех зонах: отдельный rng-поток `rngH = mulberry(seed0 ^ 0x5EEDBA7E)` (в минифицированном бандле игла `1592638078`); `nextHeartT = 10 + rngH()*10`; head start спирали `0.62·L` (укус успевает за 60-сек зону); в зумбе сердце ставится ВПЕРЕДИ головы (дострелимо, собирается цепочкой, ttl 22). **Сердечки очков не дают** — ev-инвариант рейтинга не трогать (`ev` содержит "h", которые дают 0).
- **v7 (v2.9.3)** — таймстемпы `inputs` = **целый номер шага симуляции 1/60 c** вместо секунд с квантованием 0.1 c; `recTs()` (внутри шага: steps−1), `recTsEvt()` (событие между шагами: steps), вьюер сравнивает через `vt()`; `enterReplay` пересаживает `rngH`/`nextHeartT` семенем записи. ⇒ реплей совпадает **точь-в-точь** (тесты «ТОЧНОЕ совпадение очков»). `ev`/`dur` остались в секундах (инвариант сервера не тронут).

Причина v7: квантование 0.1 c сдвигало инпуты ±3 шага и «сжимало» интервалы выстрелов ниже кулдауна 0.3 c → вьюер терял выстрелы → в хаотичной зумбе очки уезжали на −1000 (зафиксировано на iOS-записи id=24: target 2440, sim 1240). Также вьюер генерил сердца из `Math.random()` (rngH не пересаживался).

## 5. Правила submit-score (не ломать без перезалива функции)

Сумма ev == score ("g"=10, "b"=50, "h"=0); пики hits 3..5; `dur` 3..86400 и `|dur−elapsed| ≤ 2`; `elapsed > 1800` → отклонить (лимит подняли с 900 в v2.9.1 — функция перезалита, deploy 201); `inputs/ev ≤ 6000`; `score/dur > 35` → suspect на модерацию; roundId сверяется (start-round выдаёт `{roundId, seed}`, одноразовый). Любая правка `supabase/functions/submit-score/index.ts` требует `node scripts/deploy-function.js …` — live-версия должна совпадать с репо.

## 6. iOS/WebKit: установленные эмпирически пилюли

1. `ctx.shadowBlur`/`ctx.filter` на эмодзи → гигантские блобы; `fillText` эмодзи под `ctx.rotate/scale` → монохромный силуэт (заливка текущим fillStyle) — главная причина «мыла»; повторы одного эмодзи в одной строке → чёрные глифы (крюк VS16 — обходится).
   **Решение**: все игровые эмодзи рендерятся в офскрин-спрайт `emojiSprite` (fillText БЕЗ трансформаций, ручное центрирование measureText, размер px·scale·dpr) и накладываются `drawImage` — функция `drawEmoji` (11 вызовов). Серость после удара — серый круг-оверлей (никакого filter). Свечение: `glowOk` (UA-гейт) — на не-iOS shadowBlur, на iOS — градиентные ореолы.
2. Сохранение результата (v2.9.1): start-round 3 попытки/8 с; supabase-режим без round/replay → честный отказ `reason:"no-round"` (кнопка save печатает «⛔ …» по REASONS-маппингу: «долгая пауза 😴», «нет связи 📡» и т.п.); localStorage в try/catch (приватный режим Safari).
3. **Safari-кэш**: скриншоты часто приходят со СТАРЫМ бандлом — требовать полное закрытие вкладки; проверка актуальности — версия в HUD.
4. ▶-реплей грузится **без перезагрузки** (v2.9.2: `history.pushState("?replay=id") + loadReplay()`), т.к. WebKit иногда не перезагружает документ при query-only навигации со страницы `#/`. Deep-link `/?replay=<id>` по-прежнему работает (ngOnInit). `exitReplay()` чистит query.
5. На ≤600px скрывается кнопка трека (#trkBtn), кнопки звука/трека опущены (top 84/130), чтобы не наезжать на жизни.

## 7. Деплой-цикл (по шагам)

```bat
:: 1) тесты движка (если правился engine.ts):
cd angular-app
npx esbuild src/app/core/engine.ts --bundle --platform=node --format=cjs --outfile=../scripts/tests/engine.cjs
cd ..
node scripts/tests/run.js        :: ждать == PASS:32 FAIL:0 ==
node scripts/tests/replays.js    :: живые реплеи: старые в допуске, новые v7 точные

:: 2) версия: angular-app/src/app/core/config.ts VERSION + angular-app/package.json (например 2.9.4)

:: 3) сборка (из angular-app; в PowerShell пути с пробелами — в КАВЫЧКАХ, && не использовать, ;) :
cd angular-app
npx ng build --configuration production --base-href /newyear-game/   :: выход: dist\angular-app
cd ..

:: 4) публикация:
node scripts/publish-dist.js <GH_TOKEN> angular-app\dist\angular-app
node scripts/push-sources.js   <GH_TOKEN>
node scripts/tools/delorphan.js <GH_TOKEN> main.<OLD-hash>.js  :: удалить прежний бандл из корня
node scripts/tools/livecheck.js main.<NEW-hash>.js      :: ждёт 1-5 мин (Pages-пересборка)
```

`push-sources.js` берёт жёсткий список путей (angular-app, supabase/functions, scripts/*.js поимённо, SETUP-Supabase.md, server.js, admin-redirect.html) — **новые файлы scripts надо дописывать в его массив `paths`**, иначе они не уедут в репо.

## 8. Состояние БД (scores) — на момент v2.9.3

В таблице **2 записи**:

- **id=24, name «ios», score 2440, v6** — честная iOS-игра пользователя. Очки законны (ev-инвариант пройден), но реплей v6 **невозможно** воспроизвести точно: тайминги потеряны квантованием 0.1 c, поэтому вьюер даёт ~1240 и покажет ⚠. С v7 такое не повторится.
- **id=17, «Тест», 660, v1** — симулируется точно (660/660). Остальные старые (21/20/18) и тестовые (22/23) удалены.

Проверка содержимого таблицы: `node scripts/tools/topestop.js` (никто не удалён молча — сверяйтесь после админ-операций).

## 9. Текущий статус и следующий ход

**Статус**: v2.9.3 опубликована и live-проверена (бандл `main.eaa88b5d2eac4b80.js`: иглы 2.9.3 ×2, v:7, 1592638078 ×2 (reset + enterReplay), drawEmoji 11, no-round, ?replay=). Тесты 32/32. Исходники запушены.

**Ждём с iPhone**: HUD показывает v2.9.3 → отыграть честно раунд → сохранить → нажать ▶ на своей новой строке: replay должен совпасть **до очка** (нет баннера ⚠). Старый id=24 остаётся с ⚠ — это ожидаемо.

**Следующие шаги по результату фидбека**:
1. Сохранение не прошло → взять текст «⛔ …» с кнопки и дебаг-лог, чинить точечно.
2. Эмодзи всё ещё блобит → скрин именно v2.9.x; запасной план — спрайты с явным fillStyle и проверкой Apple Color Emoji растра.
3. Решить с пользователем про id=24 (оставить с ⚠ / скрыть ▶ / удалить через admin). Тестовые строки score 80 (id=22/23) уже удалены; id=17 «Тест» (660) — полезный compat-стенд для run.js, не трогать.
4. Баланс зумбы/сердечек по впечатлениям; при правке физики — помнить про версионные гейты (новая физика = новый v, старое не трогать).

## 10. Грабли окружения (было, не забыть)

- **Node 18**: не стабить глобальный `performance` (ломает fetch/undici); `fetch` печатает ExperimentalWarning — игнорировать.
- **PowerShell 5.1**: кириллица в `node -e "…"` ломается → писать скрипты в файлы; пути с пробелами — в кавычках; разделитель `;` (не `&&`); native-ошибки stderr дают exit 1 при живом результате — смотреть вывод, не код.
- **Минификатор**: `0x5EEDBA7E` → `1592638078`; эмодзи/кириллица в `\uXXXX`; иглы в бандле искать через node-скрипты (не Select-String).
- В харнесах тестов `drive(e, rp.dur)` — ровно по длительности, `+1` сек давала ложный «extra gift»; живые проверки вьюера собирать **только через `enterReplay`** (ручная сборка пропустила баг rngH); `replays.js` не должен включать `debug.inflives` (искажал вердикты); в roundtrip-тестах inflives ставится ЗЕРКАЛЬНО живому mk().
- mkz-хелперы: после ручной подмены `simV` переключать `zPath/zLen` на LUT нужной версии.
- Тесты обращаются к Supabase (id=17 compat, replays.js) — нужен сеть-доступ и read-ключ из config.ts.

## 11. Быстрый старт на новой машине

```bat
git clone https://<логин/токен>@github.com/alexmelk/newyear-game.git
cd newyear-game\angular-app
npm install
:: проверить тесты движка:
npx esbuild src/app/core/engine.ts --bundle --platform=node --format=cjs --outfile=../scripts/tests/engine.cjs
cd .. && node scripts/tests/run.js && node scripts/tests/replays.js
:: дев-сервер:
cd angular-app && npx ng serve
```

Всё остальное (публикация/livecheck/деплой функций) — разделы 5 и 7. Ключи — раздел 2. Если репо-файлы будут конфликтовать с локальными правками — источник истины: `main` на GitHub (там и сайт, и исходники, всё в одном).
