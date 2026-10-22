import type { Dict } from "../types";
import type { network as en } from "../en/network";

export const network: Dict<typeof en> = {
  lan: {
    openingTunnel: "Открываем туннель Network Play…",
    hostingStopped: "Хост остановлен",
    hosting: "Хост запущен — друзья могут присоединиться",
    startFailed: "Не удалось запустить Network Play — проверь клиент Relay",
    voiceKeyMissing:
      "Голосовая комната активна, но ключ Relay не найден — подожди немного и снова открой мир для LAN",
  },
  panel: {
    title: "Network Play",
    checking: "Проверка",
    ready: "Готов",
    issue: "Проблема",
    missing: "Нет",
    found: "Найден",
    readyForVoiceLan: "Готов для голоса и LAN",
    needsAttention: "Нужно внимание",
    foundTitle: "Найден",
    notFound: "Не найден",
    checkingRelay: "Проверяем Relay…",
    binaryFound: "Файл найден.",
    tapCheck: "Нажми «Проверить», чтобы скачать frpc для голоса и открытия мира для LAN.",
    voiceLive:
      "Голосовая комната активна — друзья слышат тебя во время игры, ничего настраивать не нужно.",
    relayHeading: "Remined Relay",
    relayLead:
      "Голос и открытие мира для LAN работают через <b>Remined Relay</b> на нашем сервере. Друзьям нужен только Remined.",
    getFrpc: "Скачать frpc",
    check: "Проверить",
    checkingBtn: "Проверка…",
    refresh: "Обновить",
    frpReleases: "Релизы frp",
    frpcBinary: "Файл frpc",
    autoDetect: "Автопоиск",
    browse: "Выбрать файл frpc",
    auto: "Авто",
    pathHint:
      "Если автопоиск не нашёл: укажи путь к frpc (он скачивается в .remined/frp/).",
    hostingBanner: "Ты хостишь — друзья могут присоединиться во вкладке «Друзья».",
    hostingBannerPort:
      "Ты хостишь на порту {port} — друзья могут присоединиться во вкладке «Друзья».",
    hostHeading: "Хост",
    hostStep1: "Нажми «Проверить», чтобы установить frpc (один раз на ПК).",
    hostStep2: "Играть → открой мир → пауза → <b>Открыть для сети</b>.",
    hostStep3:
      "Remined сам подхватит порт и отметит тебя как <b>Хост</b>.",
    joinHeading: "Присоединиться к другу",
    joinStep1:
      "Вкладка «Друзья» → когда у друга статус <b>Хост</b>, нажми <b>Присоединиться</b>.",
    joinStep2: "Remined подключит Relay и запустит сборку друга прямо в его мир.",
  },
  relay: {
    signInRequired: "Войди, чтобы пользоваться Remined Relay",
    credsFailed: "Не удалось получить доступ к Remined Relay",
    credsEmpty: "Ответ Remined Relay с доступом пустой",
    installFailed: "Не удалось установить Remined Relay (frpc)",
  },
  toast: {
    checkPassed: "Проверка Relay пройдена",
    checkFailed: "Проверка Relay не пройдена",
    openingReleases: "Открываем релизы frp («Проверить» сам скачает frpc)",
    pathSaved: "Путь к frpc сохранён",
    autoDetect: "Используем автопоиск",
  },
};
