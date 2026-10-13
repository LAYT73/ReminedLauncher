# Remined Launcher

Tauri + React лаунчер в стиле официального Minecraft Launcher (Noto Sans, тёмный UI, зелёный Play).

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

и в `src-tauri/Cargo.toml` можно вернуть версии `tauri = "2"` без пина.

## Что умеет сейчас

- Список локальных сборок (VanillaPro)
- Ник + скин (PNG)
- Play → вызывает `scripts/launch_vanillapro.py`
- Скин кладётся в SkinShuffle перед стартом

Сервер / CDN / апдейты паков — ещё нет.
