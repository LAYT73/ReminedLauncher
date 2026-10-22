import type { Dict } from "../types";
import type { pack as en } from "../en/pack";

export const pack: Dict<typeof en> = {
  install: {
    preparing: "Подготовка…",
    updatingPack: "Обновляем сборку…",
    packReady: "Сборка готова",
    readyToPlay: "Можно играть",
    cancelled: "Отменено",
    deletingPack: "Удаляем сборку…",
    packDeleted: "Сборка удалена",
    installationRemoved: "Установка удалена",
    checkingPackUpdate: "Проверяем обновление сборки…",
    updatingTo: "Обновляем до {v}…",
    downloading: "Скачиваем {v}…",
    installingVersion: "Устанавливаем {v}…",
    installingReminedVanilla: "Устанавливаем Remined Vanilla {v}…",
    deleteConfirm:
      "Удалить установку «{id}»? Сохранения в этой папке будут стёрты.",
    deleteTitle: "Удалить установку",
    deleteOk: "Удалить",
    deleteCancel: "Отмена",
  },
  launch: {
    preparing: "Готовимся к запуску…",
    joiningFriend: "Заходим к другу…",
    joined: "Готово — подключаемся в Minecraft",
    usernameLength: "От 3 до 16 символов",
    connectingNetwork: "Подключаем Network Play…",
    installRelay: "Сначала установи клиент Relay в Network Play",
    joining: "Заходим к {name}…",
    crashed: "Minecraft вылетел: {summary}",
    hostNotReady: "Лобби хоста ещё не готово — пусть снова нажмёт «Открыть для LAN»",
    oldSession:
      "Хост в старой сетевой сессии — пусть обновит Remined и снова откроет мир для LAN",
    prepareFailed: "Не удалось подготовить сборку — попробуй «Играть» ещё раз",
  },
  play: {
    installing: "Установка…",
    launching: "Запуск…",
    running: "Запущено",
    download: "Скачать",
    play: "Играть",
  },
  phase: {
    java: "Java",
    pack: "Сборка",
    libraries: "Библиотеки",
    assets: "Ресурсы",
    runtime: "Среда",
    done: "Готово",
    launch: "Запуск",
  },
  select: {
    installation: "Установка",
    version: "Версия",
    noVersions: "Нет версий — проверь подключение",
    noPacks: "Нет доступных сборок",
    installed: "Установлено",
    release: "Релиз",
    fabricSkins: "Fabric + скины",
  },
  playbar: {
    cancel: "Отмена",
    cancelInstall: "Отменить установку",
  },
  playtime: {
    played: "{time} в игре",
    totalSeconds: "Всего {seconds} с",
    lastLaunch: "Последний запуск: {when}",
    justNow: "Последний запуск только что",
  },
  gallery: {
    screenshot: "Скриншот",
    previous: "Назад",
    next: "Вперёд",
    gallery: "Галерея",
    slide: "Слайд {n}",
  },
  home: {
    logoAlt: "Remined Launcher — Java Edition",
    installed: "Установлено",
    notInstalled: "Не установлено",
    open: "Открыть",
    view: "Смотреть",
  },
  installations: {
    title: "Установки",
    emptyTitle: "Пока ничего не установлено",
    emptyDescription: "Выбери сборку в лаунчере, чтобы создать первую установку.",
    selected: "Выбрано",
    openFolder: "Открыть папку",
    delete: "Удалить",
  },
  page: {
    javaEdition: "Java Edition",
    fabricSkins: "Fabric · Скины",
    screenshots: "Скриншоты",
    notInstalled: "Не установлено",
    reminedBadge: "Скины + Sodium/Iris · друзья видят твой скин",
    reminedBadgeTitle:
      "Ставит Fabric со SkinShuffle + CustomSkinLoader, чтобы твой скин Remined работал у тебя и у друзей, а также Sodium/Iris и другие моды для производительности, если они есть для этой версии.",
    reminedBlurb:
      "Чистый Minecraft на Fabric, только для версий, где работают скины Remined. При скачивании ставятся скины, LAN-помощник и набор оптимизаций Remined для нужной ветки (в стиле 1.20 или 26.x: Sodium/Iris, Lithium, Culling, C2ME и другие), а также Resourcify, если на Modrinth есть подходящая сборка.",
    vanillaBadge: "Только локальный скин · друзья не увидят его онлайн",
    vanillaBadgeTitle:
      "Твой скин Remined применяется локально через ресурспак. Другие игроки не увидят его в мультиплеере.",
    vanillaBlurb:
      "Minecraft — открытый мир из блоков, где можно копать, крафтить и строить что угодно. Переживи ночь, исследуй пещеры и биомы или обоснуйся и преобрази землю — в одиночку или с друзьями в одном мире.",
  },
};
