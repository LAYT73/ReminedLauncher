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

- Список паков из Supabase + локальные установки
- Ник + скин (PNG)
- Play → встроенный Rust runtime (Java + Fabric libs/assets)
- Скин кладётся в SkinShuffle перед стартом

Сервер / CDN / апдейты паков — ещё нет.
