/**
 * Russian style guide (read before translating anything in phase 2).
 *
 * - Natural, concise, gamer-friendly Russian as used in the Russian Minecraft
 *   community. Informal, "ты"-neutral imperative on buttons: "Играть",
 *   "Скачать", "Отмена". Avoid bureaucratic phrasing.
 * - Glossary: Play=Играть, Launcher=Лаунчер, Pack/Modpack=Сборка,
 *   Installation=Установка, Version=Версия, Skin=Скин, Cape=Плащ,
 *   Friends=Друзья, Voice room=Голосовая комната, Host=Хост,
 *   Join=Присоединиться, Invite=Пригласить, Screenshots=Скриншоты,
 *   Settings=Настройки, Sign out=Выйти, Offline=Офлайн, Mods=Моды, World=Мир,
 *   Server=Сервер, LAN=LAN.
 * - Do NOT translate: Relay (brand), Remined (brand), Fabric, Sodium, Iris,
 *   Java, Minecraft, Network Play (keep as "Network Play" if used as a name).
 * - Keep product names, version numbers, file formats untouched.
 * - Prefer shorter synonyms: strings must not break layout (rail, buttons,
 *   chips). Use "…" (single char) and "—" like the English source.
 * - Placeholders {name} must be kept verbatim. Plurals need all four forms:
 *   one (1, 21), few (2-4, 22-24), many (0, 5-20, 25-30), other (fractions).
 */
import type { Dict } from "../types";
import type { common as en } from "../en/common";

export const common: Dict<typeof en> = {
  somethingWentWrong: "Что-то пошло не так",
  cancel: "Отмена",
  save: "Сохранить",
  retry: "Повторить",
  close: "Закрыть",
  delete: "Удалить",
  copy: "Копировать",
  copied: "Скопировано",
  couldNotCopy: "Не удалось скопировать",
  later: "Позже",
  loading: "Загрузка…",
  ok: "ОК",
  back: "Назад",
  next: "Далее",
  done: "Готово",
  confirm: "Подтвердить",
  yes: "Да",
  no: "Нет",
  unknownError: "Неизвестная ошибка",
  server: {
    notAuthenticated: "Вы не вошли в аккаунт",
    invalidPackId: "Неизвестная сборка",
    unauthorized: "Нет доступа — войдите заново",
    methodNotAllowed: "Запрос не разрешён",
    serverMisconfigured: "Сервер настроен неверно — попробуйте позже",
    relaySecretsNotConfigured: "Remined Relay ещё не настроен на сервере",
  },
  offline: {
    packUpdates: "Для обновления сборок нужен интернет",
    updateCheck: "Для проверки обновлений нужен интернет",
    install: "Для установки нужен интернет",
    usernameSync: "Для синхронизации ника нужен интернет",
    skinSync: "Для синхронизации скинов нужен интернет — подключись и войди",
    signInForSkin: "Войди, чтобы сохранить скин",
    friends: "Для друзей нужен интернет. Сейчас ты в офлайн-режиме.",
    friendsSignedOut: "Войди, чтобы увидеть друзей.",
    network:
      "Для Network Play нужен интернет. Ты в офлайн-режиме — локальные миры доступны через «Играть».",
    voice: "Для голосовых комнат нужен интернет. Сейчас ты в офлайн-режиме.",
    voiceSignedOut: "Войди, чтобы пользоваться голосовыми комнатами.",
    chipHint:
      "Ты офлайн — доступны только сохранённый аккаунт и сборки. Друзьям, скинам и обновлениям нужен интернет.",
    accountNote:
      "Офлайн — играешь с сохранённым аккаунтом. Войди при наличии сети, чтобы синхронизировать друзей и скины.",
    leaveOffline: "Выйти из офлайна",
    signOut: "Выйти",
  },
};
