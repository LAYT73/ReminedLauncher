import type { Dict } from "../types";
import type { auth as en } from "../en/auth";

export const auth: Dict<typeof en> = {
  usernameTaken: "Ник занят — выбери другой",
  screen: {
    supabaseMissing: "Не заданы переменные Supabase (VITE_SUPABASE_*)",
    createFailed: "Не удалось создать аккаунт",
    signIn: "Вход",
    createAccount: "Создать аккаунт",
    register: "Создать",
    sub: "Лаунчер для друзей. Подтверждение почты не нужно — регистрируйся и играй.",
    username: "Ник",
    usernamePlaceholder: "3–16 символов",
    email: "Почта",
    password: "Пароль",
    continueOffline: "Играть офлайн",
    needAccount: "Нет аккаунта? Зарегистрируйся",
    haveAccount: "Уже есть аккаунт? Войди",
  },
  onboarding: {
    checkingJava: "Проверяем Java…",
    javaReady: "Java готова",
    kicker: "Первая настройка",
    title: "Настройка Java",
    sub: "Remined нужна Java 25. Сборки скачаются позже на экране «Играть».",
  },
  splash: {
    waking: "Будим лаунчер",
    checkingAccount: "Проверяем аккаунт",
    syncingPacks: "Синхронизируем сборки",
    almostThere: "Почти готово",
  },
  boot: {
    usingCache: "Ты офлайн — используем сохранённый аккаунт",
    cloudUnreachable: "Облако недоступно — офлайн-режим",
    cloudUnreachableAfterAuth: "Не удалось связаться с облаком — офлайн-режим",
    offlineMode: "Офлайн-режим",
    noCachedAccount: "Нет сохранённого аккаунта для офлайн-игры",
    hintOfflineCanContinue:
      "Нет сети — можно продолжить офлайн с прошлым аккаунтом.",
    hintOfflineNeedsSignIn:
      "Нет сети. Войди один раз онлайн, чтобы играть офлайн.",
    hintCloudUnreachable: "Облако недоступно. Попробуй позже, когда будет сеть.",
    connectionLost: "Соединение потеряно — офлайн-режим",
    backOnlineSignIn: "Сеть вернулась — войди снова, чтобы синхронизировать друзей и скины",
    backOnlineSignInShort: "Сеть вернулась — войди для синхронизации",
    backOnline: "Сеть вернулась",
    stillOffline: "Облако всё ещё недоступно — остаёмся офлайн",
  },
};
