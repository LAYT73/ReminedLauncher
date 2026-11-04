import type { Dict } from "../types";
import type { recipes as en } from "../en/recipes";

export const recipes: Dict<typeof en> = {
  title: "Рецепты",
  source: {
    label: "Сборка",
    placeholder: "Нет сборок",
    reload: "Пересобрать индекс рецептов",
  },
  loading: {
    title: "Читаю рецепты сборки…",
    hint: "Первая сборка индекса большой сборки может занять десятки секунд. В следующий раз откроется мгновенно.",
  },
  error: {
    title: "Не удалось прочитать рецепты",
    retry: "Повторить",
    sources: "Не удалось загрузить список сборок: {error}",
  },
  empty: {
    noPacksTitle: "Нет установленных сборок",
    noPacksBody: "Сначала установите сборку или инстанс — тогда здесь появятся его предметы и рецепты.",
    notInstalledTitle: "Эта версия не установлена",
    notInstalledBody: "Установи её на вкладке «Играть», и здесь появятся её рецепты.",
    noItems: "Ничего не найдено",
    noRecipes: "Нет рецептов, предмет добывается в мире.",
    noUses: "Предмет не используется ни в одном рецепте.",
    pick: "Выберите предмет.",
  },
  search: {
    label: "Поиск предметов",
    placeholder: "Поиск… @мод  #тег",
  },
  mod: {
    label: "Мод",
    all: "Все моды",
  },
  count: { one: "{count} предмет", few: "{count} предмета", many: "{count} предметов", other: "{count} предмета" },
  view: {
    craft: "Как скрафтить",
    uses: "Где используется",
    back: "Назад",
    prev: "Предыдущий рецепт",
    next: "Следующий рецепт",
    page: "{n}/{total}",
    shapeless: "Без формы",
    seconds: "{s} с",
    xp: "{xp} опыта",
    container: "Тара",
    tool: "Инструмент",
    fluid: "Жидкость",
    note: "Примечание",
    time: "Время",
    tag: "Тег: #{tag}",
    station: "Станок",
  },
  keys: {
    hint: "R рецепты · U применение · Backspace назад · ←/→ страницы · Ctrl+F поиск",
  },

};
