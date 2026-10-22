//! UI-language strings for user-facing messages produced by the Rust side.
//!
//! The frontend calls `set_ui_locale` at startup and whenever the language
//! changes. Until then (and in the CLI) everything is English.
//! Logs, crash reports, frp configs and anything parsed by code stay English.
//! Add a string: one `match` arm below -> `tr("group.key")` / `trf("group.key", &[("name", v)])`.

use std::sync::atomic::{AtomicU8, Ordering};

/// 0 = en, 1 = ru
static LOCALE: AtomicU8 = AtomicU8::new(0);

pub fn set_locale(code: &str) {
    let v = if code.trim().to_ascii_lowercase().starts_with("ru") { 1 } else { 0 };
    LOCALE.store(v, Ordering::Relaxed);
}

pub fn is_ru() -> bool {
    LOCALE.load(Ordering::Relaxed) == 1
}

/// Translate `key` into the current UI language. Unknown keys return the key.
pub fn tr(key: &'static str) -> &'static str {
    match entry(key) {
        Some((en, ru)) => {
            if is_ru() {
                ru
            } else {
                en
            }
        }
        None => key,
    }
}

/// Like [`tr`] but substitutes `{name}` placeholders.
pub fn trf(key: &'static str, args: &[(&str, &str)]) -> String {
    let mut out = tr(key).to_string();
    for (name, value) in args {
        out = out.replace(&format!("{{{name}}}"), value);
    }
    out
}

fn entry(key: &str) -> Option<(&'static str, &'static str)> {
    Some(match key {
        // ---- progress.* : remined-progress `message` text (phase codes stay machine ids)
        "progress.cancelled" => ("Cancelled", "Отменено"),
        "progress.checking_java" => ("Checking Java…", "Проверка Java…"),
        "progress.java_ready" => ("Java ready", "Java готова"),
        "progress.downloading_pack" => ("Downloading pack…", "Скачивание сборки…"),
        "progress.checking_fabric_runtime" => ("Checking Fabric runtime…", "Проверка Fabric…"),
        "progress.ready_to_play" => ("Ready to play", "Можно играть"),
        "progress.checking_libraries" => ("Checking libraries…", "Проверка библиотек…"),
        "progress.vanilla_ready" => ("Vanilla ready", "Vanilla готова"),
        "progress.looking_up" => ("Looking up {version}…", "Поиск {version}…"),
        "progress.dl_version_meta" => ("Downloading version metadata…", "Скачивание данных версии…"),
        "progress.dl_client" => ("Downloading client…", "Скачивание клиента…"),
        "progress.client_ready" => ("Client ready", "Клиент готов"),

        // ---- launch.* : launch_pack results
        "launch.already_running" => ("Already running", "Уже запущено"),
        "launch.no_pack" => ("No pack selected", "Сборка не выбрана"),
        "launch.name_length" => ("3–16 characters", "От 3 до 16 символов"),
        "launch.pack_not_installed" => (
            "Pack `{pack}` is not installed — run setup or Update pack",
            "Сборка `{pack}` не установлена — запусти установку или обнови сборку",
        ),
        "launch.java_downloading" => (
            "Java {major} required — downloading…",
            "Нужна Java {major} — скачиваю…",
        ),
        "launch.java_failed" => (
            "Java {major} required — could not install runtime",
            "Нужна Java {major} — не удалось установить",
        ),
        "launch.exit_status" => ("Exit {status}", "Игра завершилась: {status}"),
        "launch.exited_immediately" => ("Exited immediately", "Игра сразу закрылась"),
        "launch.no_pid" => ("Game did not start (no pid)", "Игра не запустилась (нет pid)"),
        "launch.not_started" => ("Game did not start: {tail}", "Игра не запустилась: {tail}"),
        "launch.java_start_failed" => ("Failed to start Java: {err}", "Не удалось запустить Java: {err}"),
        "launch.open_failed" => ("open failed with {status}: {err}", "Не удалось открыть игру ({status}): {err}"),

        // ---- skin.* / cape.* / pack.* : command errors
        "skin.not_found" => ("Skin file not found: {path}", "Файл скина не найден: {path}"),
        "skin.invalid_png" => ("Invalid skin PNG", "Некорректный PNG скина"),
        "skin.empty_path" => ("Empty skin path", "Пустой путь к скину"),
        "skin.dl_not_png" => ("Downloaded skin is not a PNG", "Скачанный скин — не PNG"),
        "skin.dl_too_large" => ("Downloaded skin is too large", "Скачанный скин слишком большой"),
        "cape.not_found" => ("Cape file not found: {path}", "Файл плаща не найден: {path}"),
        "cape.invalid_png" => ("Invalid cape PNG", "Некорректный PNG плаща"),
        "pack.folder_not_found" => ("Pack folder not found", "Папка сборки не найдена"),
        "pack.invalid_id" => ("Invalid pack id", "Некорректный id сборки"),
        "pack.not_installed" => ("Pack `{id}` is not installed", "Сборка `{id}` не установлена"),
        "pack.delete_outside" => (
            "Refusing to delete pack outside packs folder",
            "Нельзя удалять сборку вне папки сборок",
        ),
        "pack.not_in_catalog" => ("Pack `{id}` not in remote catalog", "Сборки `{id}` нет в каталоге"),
        "pack.catalog_empty" => ("Remote pack catalog is empty", "Каталог сборок пуст"),
        "pack.fetching_catalog" => ("Fetching pack catalog…", "Загрузка каталога сборок…"),
        "pack.already_installed" => ("Pack {version} already installed", "Сборка {version} уже установлена"),
        "pack.using_existing" => ("Using existing pack as {version}", "Используется установленная сборка {version}"),
        "pack.downloading_file" => ("Downloading {name}…", "Скачивание {name}…"),
        "pack.sha_mismatch" => (
            "SHA256 mismatch: got {got}, expected {expected}",
            "Контрольная сумма не совпала: получено {got}, ожидалось {expected}",
        ),
        "pack.checksum_ok" => ("Checksum OK", "Контрольная сумма в порядке"),
        "pack.sha_unavailable" => (
            "sha256 verify unavailable — skipping",
            "Проверка sha256 недоступна — пропускаю",
        ),
        "pack.extracting" => ("Extracting pack…", "Распаковка сборки…"),
        "pack.ready" => ("Pack {version} ready", "Сборка {version} готова"),

        // ---- java.*
        "java.unsupported_os" => ("Unsupported OS", "Неподдерживаемая ОС"),
        "java.unsupported_arch" => ("Unsupported CPU arch", "Неподдерживаемая архитектура процессора"),
        "java.downloading" => ("Downloading Java…", "Скачивание Java…"),
        "java.ready" => ("Java {major} ready", "Java {major} готова"),
        "java.downloading_jdk" => ("Downloading OpenJDK {major}…", "Скачивание OpenJDK {major}…"),
        "java.extracting" => ("Extracting Java {major}…", "Распаковка Java {major}…"),
        "java.binary_missing" => (
            "Java {major} binary missing after extract",
            "После распаковки не найден файл Java {major}",
        ),
        "java.probe_failed" => ("Failed to probe installed Java", "Не удалось проверить установленную Java"),
        "java.wrong_version" => (
            "Installed Java is not {major}: {version}",
            "Установлена не Java {major}: {version}",
        ),
        "java.installed" => ("Java {major} installed", "Java {major} установлена"),

        // ---- runtime.* : Fabric libraries / assets progress
        "runtime.resolving_fabric" => ("Resolving Fabric libraries…", "Подготовка библиотек Fabric…"),
        "runtime.libraries_ready" => ("Libraries ready ({n})", "Библиотеки готовы ({n})"),
        "runtime.checking_assets" => ("Checking game assets…", "Проверка ресурсов игры…"),
        "runtime.assets_ready" => ("Assets ready", "Ресурсы готовы"),
        "runtime.ready" => ("Runtime ready", "Окружение готово"),
        "runtime.library_n" => ("Library {n}/{total}: {rel}", "Библиотека {n}/{total}: {rel}"),
        "runtime.dl_client_jar" => ("Downloading client jar…", "Скачивание клиента…"),
        "runtime.dl_assets" => ("Downloading {total} assets…", "Скачивание ресурсов: {total}…"),
        "runtime.assets_n" => ("Assets {n}/{total}", "Ресурсы {n}/{total}"),

        // ---- vanilla.* / rvanilla.* : Remined Vanilla install progress + errors
        "vanilla.no_version" => ("No version selected", "Версия не выбрана"),
        "vanilla.unknown_version" => ("Unknown Minecraft version: {version}", "Неизвестная версия Minecraft: {version}"),
        "vanilla.old_format" => (
            "{version} uses an older launch format Remined does not support yet. Pick 1.13+",
            "{version} использует старый формат запуска, который Remined пока не поддерживает. Выбери 1.13+",
        ),
        "rvanilla.unsupported_version" => (
            "{version} is not in the Remined Vanilla skin-compatible set",
            "{version} нет в списке версий Remined Vanilla со скинами",
        ),
        "rvanilla.new_launch_format" => (
            "{version} uses an unsupported launch format",
            "{version} использует неподдерживаемый формат запуска",
        ),
        "rvanilla.dl_iris" => ("Downloading Iris…", "Скачивание Iris…"),
        "rvanilla.iris_unavailable" => ("Iris unavailable for {game} — skipped", "Iris для {game} недоступен — пропускаю"),
        "rvanilla.dl_sodium" => ("Downloading Sodium…", "Скачивание Sodium…"),
        "rvanilla.item_skipped" => ("{label} skipped ({err})", "{label}: пропущено ({err})"),
        "rvanilla.item_unavailable" => ("{label} unavailable for {game} — skipped", "{label} для {game} недоступен — пропускаю"),
        "rvanilla.dropped_conflict" => ("Dropped conflicting {removed}", "Убран конфликтующий мод: {removed}"),
        "rvanilla.removing" => ("Removing {file} — {why}", "Удаляю {file} — {why}"),
        "rvanilla.resolving_dep" => ("Resolving dependency {slug}…", "Подбор зависимости {slug}…"),
        "rvanilla.fixing_sodium_iris" => ("Fixing Sodium / Iris…", "Исправление Sodium / Iris…"),
        "rvanilla.replacing" => ("Replacing {label} for {game}…", "Замена {label} для {game}…"),
        "rvanilla.installing" => ("Installing {label}…", "Установка {label}…"),
        "rvanilla.dl_mojang" => ("Downloading Mojang version…", "Скачивание версии Mojang…"),
        "rvanilla.resolving_loader" => ("Resolving Fabric loader…", "Подбор Fabric Loader…"),
        "rvanilla.dl_fabric_api" => ("Downloading Fabric API…", "Скачивание Fabric API…"),
        "rvanilla.dl_skinshuffle" => ("Downloading SkinShuffle…", "Скачивание SkinShuffle…"),
        "rvanilla.patch_skinshuffle" => ("Patching SkinShuffle…", "Патч SkinShuffle…"),
        "rvanilla.dl_csl" => ("Downloading CustomSkinLoader…", "Скачивание CustomSkinLoader…"),
        "rvanilla.dl_lan_helper" => ("Downloading LAN (offline) helper…", "Скачивание помощника LAN (офлайн)…"),
        "rvanilla.install_lan_helper" => ("Installing LAN offline helper…", "Установка помощника LAN (офлайн)…"),
        "rvanilla.dep_fix" => ("Dependency fix: {n}", "Исправление зависимостей: {n}"),
        "rvanilla.warning" => ("Warning: {err}", "Предупреждение: {err}"),
        "rvanilla.checking_fabric_libs" => ("Checking Fabric libraries…", "Проверка библиотек Fabric…"),
        "rvanilla.ready" => ("Remined Vanilla ready", "Remined Vanilla готов"),
        "rvanilla.unresolved_deps" => (
            "Remined Vanilla {version}: unresolved mod dependencies — {issues}",
            "Remined Vanilla {version}: не удалось подобрать зависимости модов — {issues}",
        ),
        "rvanilla.unsafe_mods" => (
            "Remined Vanilla {game}: mod set is not safe to launch — {issues}. Reinstall, or report this version.",
            "Remined Vanilla {game}: набор модов небезопасен для запуска — {issues}. Переустанови или сообщи об этой версии.",
        ),
        "rvanilla.iris_no_sodium" => ("Iris is installed without Sodium", "Iris установлен без Sodium"),
        "rvanilla.iris_wrong_game" => ("Iris jar does not target Minecraft {game}", "Iris не подходит для Minecraft {game}"),
        "rvanilla.sodium_extra_mismatch" => (
            "Sodium Extra is on a different line than Sodium",
            "Sodium Extra не той линейки, что Sodium",
        ),
        "rvanilla.stack_conflict" => (
            "conflicting optimization stacks are still present",
            "остались конфликтующие моды оптимизации",
        ),
        "rvanilla.no_loader" => ("No Fabric loader for {game}", "Нет Fabric Loader для {game}"),
        "rvanilla.no_modrinth_build" => (
            "No Modrinth Fabric build of {project} for {game}",
            "На Modrinth нет Fabric-сборки {project} для {game}",
        ),

        // ---- screenshots / crash
        "game.crash_hs_err" => ("Java crashed (hs_err log)", "Java аварийно завершилась (лог hs_err)"),
        "game.screenshot_bad_name" => ("invalid screenshot name", "Некорректное имя скриншота"),
        "game.screenshot_too_large" => ("screenshot too large to preview", "Скриншот слишком большой для предпросмотра"),
        "game.pack_not_installed_yet" => ("Pack is not installed yet", "Сборка ещё не установлена"),

        // ---- relay.*
        "relay.invalid_creds" => ("Invalid Remined Relay credentials", "Некорректные данные Remined Relay"),
        "relay.creds_missing" => (
            "Remined Relay credentials missing — sign in and retry (fetched from Supabase)",
            "Нет данных Remined Relay — войди в аккаунт и повтори",
        ),
        "relay.bad_share_code_prefix" => (
            "Invalid Remined relay share code (expected rmd1_…)",
            "Неверный код Remined Relay (ожидается rmd1_…)",
        ),
        "relay.bad_share_code" => ("Invalid Remined relay share code", "Неверный код Remined Relay"),
        "relay.bad_lan_port" => ("Invalid LAN port in share code", "Неверный LAN-порт в коде"),
        "relay.status_failed" => ("Relay status failed: {err}", "Не удалось получить статус Relay: {err}"),
        "relay.check_failed" => ("Relay check failed: {err}", "Проверка Relay не удалась: {err}"),
        "relay.status_ok_ver" => ("Remined Relay (frpc {ver})", "Remined Relay (frpc {ver})"),
        "relay.status_ok" => ("Remined Relay ready", "Remined Relay готов"),
        "relay.not_installed" => (
            "Relay client not installed — tap Check to download frpc",
            "Клиент Relay не установлен — нажми «Проверить», чтобы скачать frpc",
        ),
        "relay.ready_ver" => ("Relay ready (frpc {ver})", "Relay готов (frpc {ver})"),
        "relay.version_failed" => ("frpc found but --version failed", "frpc найден, но не отвечает на --version"),
        "relay.creds_pending" => ("credentials pending (Supabase)", "данные ещё не получены (Supabase)"),
        "relay.frpc_download_failed" => ("frpc download failed: {err}", "Не удалось скачать frpc: {err}"),
        "relay.frpc_download_http" => ("frpc download HTTP {status}", "Не удалось скачать frpc: HTTP {status}"),
        "relay.frpc_missing_zip" => ("frpc not found in zip", "frpc не найден в архиве"),
        "relay.frpc_missing_archive" => ("frpc not found in archive", "frpc не найден в архиве"),
        "relay.frpc_missing_after" => ("frpc missing after extract", "После распаковки frpc не найден"),
        "relay.frpc_run_failed" => ("Failed to run frpc: {err}", "Не удалось запустить frpc: {err}"),
        "relay.frpc_start_failed" => ("Failed to start frpc: {err}", "Не удалось запустить frpc: {err}"),
        "relay.host_not_running" => (
            "Relay host is not running — start voice or ensure host first",
            "Хост Relay не запущен — сначала запусти голос или хост",
        ),
        "relay.host_key_missing" => ("Relay host key missing", "Нет ключа хоста Relay"),
        "relay.lan_host_exited" => ("frpc LAN host exited ({status}){detail}", "frpc (LAN-хост) завершился ({status}){detail}"),
        "relay.host_exited" => ("frpc host exited immediately ({status}){detail}", "frpc (хост) сразу завершился ({status}){detail}"),
        "relay.visitor_exited" => ("frpc LAN visitor exited ({status}){detail}", "frpc (LAN-гость) завершился ({status}){detail}"),
        "relay.purpose_voice" => ("in voice", "в голосовой комнате"),
        "relay.purpose_lan" => ("hosting LAN", "раздаёт LAN"),
        "relay.port_closed" => (
            "Relay connected but localhost:{port} is not open yet — is the host still {purpose}?",
            "Relay подключён, но localhost:{port} пока закрыт — хост ещё {purpose}?",
        ),
        "relay.visitor_port_closed" => (
            "Relay LAN visitor up but localhost:{port} not open — is the host still {purpose}?",
            "Relay (LAN-гость) запущен, но localhost:{port} закрыт — хост ещё {purpose}?",
        ),

        // ---- voice.* : voice runtime progress + errors (event phase stays "Voice")
        "voice.finding_runtime" => ("Finding voice runtime…", "Поиск голосового модуля…"),
        "voice.downloading_runtime" => ("Downloading voice runtime…", "Скачивание голосового модуля…"),
        "voice.downloading_runtime_ver" => ("Downloading voice runtime {ver}…", "Скачивание голосового модуля {ver}…"),
        "voice.unpacking" => ("Unpacking…", "Распаковка…"),
        "voice.checking_runtime" => ("Checking voice runtime…", "Проверка голосового модуля…"),
        "voice.runtime_ready" => ("Voice runtime ready", "Голосовой модуль готов"),
        "voice.server_ready" => ("Voice server ready", "Голосовой сервер готов"),
        "voice.starting_server" => ("Starting voice server…", "Запуск голосового сервера…"),
        "voice.opening_tunnel" => ("Opening Relay tunnel…", "Открытие туннеля Relay…"),
        "voice.no_github_build" => (
            "No GitHub LiveKit build for this platform",
            "Для этой платформы нет сборки LiveKit на GitHub",
        ),
        "voice.livekit_missing_zip" => ("livekit-server not found in zip", "livekit-server не найден в архиве"),
        "voice.livekit_missing_archive" => ("livekit-server not found in archive", "livekit-server не найден в архиве"),
        "voice.homebrew_unreachable" => ("Could not reach Homebrew API: {err}", "Нет связи с Homebrew API: {err}"),
        "voice.homebrew_error" => ("Homebrew API error: {err}", "Ошибка Homebrew API: {err}"),
        "voice.bottle_list_missing" => ("Homebrew bottle list missing for livekit", "В Homebrew нет списка пакетов для livekit"),
        "voice.no_macos_bottle" => (
            "No macOS LiveKit bottle for this CPU — voice host needs Apple Silicon or a preinstalled livekit-server",
            "Для этого процессора нет сборки LiveKit под macOS — для голосового хоста нужен Apple Silicon или установленный livekit-server",
        ),
        "voice.download_failed" => ("Download failed: {err}", "Не удалось скачать: {err}"),
        "voice.download_http" => ("Download failed: HTTP {status}", "Не удалось скачать: HTTP {status}"),
        "voice.binary_missing" => ("LiveKit binary missing after download", "После скачивания LiveKit не найден"),
        "voice.not_ready" => (
            "LiveKit did not become ready in time (HTTP/RTC)",
            "LiveKit не успел запуститься (HTTP/RTC)",
        ),
        "voice.start_failed" => ("Failed to start LiveKit: {err}", "Не удалось запустить LiveKit: {err}"),
        "voice.room_identity_required" => ("room and identity required", "Нужны комната и идентификатор"),

        // ---- tray
        "tray.open" => ("Open Remined", "Открыть Remined"),
        "tray.quit" => ("Quit Remined", "Выйти из Remined"),
        "tray.tooltip" => ("Remined — running in background", "Remined — работает в фоне"),

        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translates_and_substitutes() {
        set_locale("ru");
        assert_eq!(trf("pack.ready", &[("version", "1.2")]), "Сборка 1.2 готова");
        set_locale("en");
        assert_eq!(trf("pack.ready", &[("version", "1.2")]), "Pack 1.2 ready");
        assert_eq!(tr("nope.missing"), "nope.missing");
    }
}
