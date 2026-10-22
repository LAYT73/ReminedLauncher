import type { Dict } from "../types";
import type { screenshots as en } from "../en/screenshots";

export const screenshots: Dict<typeof en> = {
  title: "Скриншоты",
  hint: "Нажми F2 в игре. Показаны файлы из папки скриншотов этой установки — они остаются на твоём компьютере и никуда не загружаются.",
  refresh: "Обновить",
  openFolder: "Открыть папку скриншотов",
  installFirst: "Сначала установи сборку",
  installFirstBody:
    "Сначала установи сборку — скриншоты появятся здесь после того, как ты их сделаешь в игре.",
  installBeforeOpen: "Установи сборку, чтобы открыть скриншоты",
  cantOpenFolder: "Не удалось открыть папку: {error}",
  loading: "Загрузка…",
  emptyTitle: "Скриншотов пока нет",
  emptyBody: "Нажми F2 в игре, чтобы сделать скриншот. Они хранятся на этом компьютере.",
  previewLabel: "Просмотр скриншота",
  closePreview: "Закрыть просмотр",
  previous: "Предыдущий скриншот",
  next: "Следующий скриншот",
  showFile: "Показать файл",
};
