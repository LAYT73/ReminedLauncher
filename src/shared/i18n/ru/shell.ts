import type { Dict } from "../types";
import type { shell as en } from "../en/shell";

export const shell: Dict<typeof en> = {
  tabs: {
    play: "Играть",
    screenshots: "Скрины",
    friends: "Друзья",
    network: "Сеть",
    voice: "Пати",
  },
  rail: {
    home: "Главная",
    pack: "Сборка",
    vanilla: "Vanilla Minecraft",
    reminedVanilla: "Remined Vanilla",
    installations: "Установки",
    settings: "Настройки",
  },
  nav: {
    pendingInvites: {
      one: "Ожидает {count} приглашение",
      few: "Ожидают {count} приглашения",
      many: "Ожидают {count} приглашений",
      other: "Ожидают {count} приглашений",
    },
    friendRequests: {
      one: "{count} заявка в друзья",
      few: "{count} заявки в друзья",
      many: "{count} заявок в друзья",
      other: "{count} заявок в друзья",
    },
    friendsOnline: {
      one: "Друзья, {count} в сети",
      few: "Друзья, {count} в сети",
      many: "Друзья, {count} в сети",
      other: "Друзья, {count} в сети",
    },
  },
  chip: {
    offlineTitle: "Офлайн — нажми, чтобы проверить подключение",
    offlineAria: "Офлайн-режим — проверить подключение",
    profile: "Профиль",
  },
  tray: {
    launching: "Запуск",
    loading: "Загрузка",
    inMenu: "В меню",
    hostingLan: "Хост LAN",
    lan: "LAN",
    server: "Сервер",
    world: "Мир",
    copyPublic:
      "Нажми, чтобы скопировать публичный адрес (проброс портов / прямое подключение)",
    resolvingIp: "Определяем публичный IP…",
    copyTunnel:
      "Нажми, чтобы скопировать (локальный туннель — 127.0.0.1, показан публичный IP)",
    copyAddress: "Нажми, чтобы скопировать адрес",
    copy: "Нажми, чтобы скопировать",
    liveStatus: "Статус игры",
    copied: "Адрес скопирован",
    copyFailed: "Не удалось скопировать",
    crashReport: "Отчёт о вылете",
    crashTitle: "{summary} — нажми, чтобы открыть отчёт о вылете",
  },
  routeError: {
    title: "Что-то сломалось",
    reload: "Перезагрузить",
  },
  ui: {
    dismiss: "Закрыть",
    hideHelp: "Скрыть подсказку",
    showHelp: "Показать подсказку",
  },
  /** Системные уведомления (отправляются, только когда окно лаунчера в фоне). */
  notify: {
    packReady: {
      title: "Сборка готова",
      body: "{name} установлена и готова к игре.",
    },
    launcherUpdate: {
      title: "Доступно обновление лаунчера",
      body: "Remined {v} готов к установке.",
    },
    friendRequest: {
      title: "Заявка в друзья",
      body: "{name} хочет добавить вас в друзья.",
    },
    partyInvite: {
      title: "Приглашение в пати",
    },
    partyWorld: {
      title: "{host} открыл мир",
      body: "Зайди через вкладку Пати.",
    },
  },
};
