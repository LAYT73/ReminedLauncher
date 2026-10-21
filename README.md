# Remined Launcher

Кастомный лаунчер Minecraft: Java Edition на Tauri 2 (Rust) + React 19. Ставит и запускает ваниль, **Remined Vanilla** (Fabric + оптимизационный стек и скины Remined) и сборки Remine из облака, сам ставит нужную Java. Поверх — аккаунт с облачным профилем и скином, друзья с presence, игра по сети через Steam-приложение Porthole (без проброса портов и VPN) и голосовые комнаты, которые поднимаются на ПК хоста.

**Текущая версия:** `0.9.2`

## Запуск (dev)

Нужны: Node.js, Rust (`rustup`), Java 25 (`brew install openjdk@25`).

```bash
cd app
npm install
npm run tauri dev
```

Если Rust старый (< 1.90), обнови:

```bash
rustup update stable
```

## Что умеет

- **Home** — обои, логотип, превью скина; вкладки Friends / Network / Voice
- **Remined Vanilla** (beta) — Fabric + скины Remined, версионный opti-стек (Sodium/Iris и др.), Resourcify где есть на Modrinth
- **Vanilla** / **Java packs** — чистый ваниль и паки из Supabase
- **Скины** — ник, PNG-скин, 3D-превью; синк в облако; SkinShuffle / CustomSkinLoader перед стартом
- **Friends** — Remined id, заявки, presence; Join к хосту через Network Play
- **Network Play** — туннель через free Steam-приложение [Porthole](docs/PORTHOLE.md)
- **Voice** — локальный LiveKit + Porthole + чат/инвайты в Supabase ([VOICE.md](docs/VOICE.md))
- **Installations / Settings** — удаления, тема, Java, апдейты лаунчера
- **Офлайн** — кэш аккаунта и паков после первого онлайна

## Релиз

Куда поднимать версию и как тегать — в [`docs/RELEASE.md`](docs/RELEASE.md).

Апдейтер: Settings → Check for updates  
(`latest.json` с GitHub Releases).

## Проверка

```bash
npm run typecheck                # типы
npm run check:fsd                # правила слоёв FSD
npm run build                    # tsc -b + vite build
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo run --manifest-path src-tauri/Cargo.toml --bin remined-cli -- smoke-rv   # смоук Remined Vanilla
```

## Структура

Фронт (`src/`) — Feature-Sliced Design: `app` (роутер, провайдеры) → `pages` → `widgets` → `features` → `entities` → `shared` (константы, api, ui). Импорты только вниз, проверяется `npm run check:fsd`. Бэкенд — `src-tauri/src/`. Подробно — [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Docs

| Файл | О чём |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Структура фронта / Rust / Supabase, индекс доков |
| [`docs/SETUP.md`](docs/SETUP.md) | Репозитории, Supabase, гигиена репо паков |
| [`docs/RELEASE.md`](docs/RELEASE.md) | Версия, тег, CI, апдейтер |
| [`docs/PACK_ASSETS.md`](docs/PACK_ASSETS.md) | Ассеты паков |
| [`docs/PORTHOLE.md`](docs/PORTHOLE.md) | Network Play / Steam |
| [`docs/VOICE.md`](docs/VOICE.md) | Voice rooms (LiveKit + Porthole) |
| [`docs/REMINED_VANILLA.md`](docs/REMINED_VANILLA.md) | Opti-стеки, совместимость, смоук-матрица |
| [`docs/ROADMAP_IMMERSIVE.md`](docs/ROADMAP_IMMERSIVE.md) | Что уже сделано и бэклог идей |
| [`supabase/migrations/012_pack_playtime.sql`](supabase/migrations/012_pack_playtime.sql) | Часы / last played **на каждую сборку** (SQL Editor) |
