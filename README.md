# Remined Launcher

Tauri + React лаунчер в духе официального Minecraft Launcher: тёмный UI, зелёный Play, встроенный Rust-рантайм.

**Текущая версия:** `0.5.2`

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

- **Home** — обои, логотип, превью скина; вкладки Friends / Network
- **Remined Vanilla** (beta) — Fabric + скины Remined, версионный opti-стек (Sodium/Iris и др.), Resourcify где есть на Modrinth
- **Vanilla** / **Java packs** — чистый ваниль и паки из Supabase
- **Скины** — ник, PNG-скин, 3D-превью; синк в облако; SkinShuffle / CustomSkinLoader перед стартом
- **Friends** — Remined id, заявки, presence; Join к хосту через Network Play
- **Network Play** — туннель через free Steam-приложение [Porthole](docs/PORTHOLE.md); статусы Steam / Porthole в UI
- **Installations / Settings** — удаления, тема, Java, проверка апдейтов лаунчера
- **Офлайн** — кэш аккаунта и паков после первого онлайна

## Релиз

Куда поднимать версию и как тегать — в [`docs/RELEASE.md`](docs/RELEASE.md).

Апдейтер: Settings → Check for updates  
(`latest.json` с GitHub Releases).

## Docs

| Файл | О чём |
|---|---|
| [`docs/RELEASE.md`](docs/RELEASE.md) | bump версии, тег, CI |
| [`docs/PORTHOLE.md`](docs/PORTHOLE.md) | Network Play / Steam |
| [`docs/PACK_ASSETS.md`](docs/PACK_ASSETS.md) | ассеты паков |
| [`docs/PREP.md`](docs/PREP.md) | GitHub / Supabase / prep notes |
