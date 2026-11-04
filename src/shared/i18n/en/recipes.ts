export const recipes = {
  title: "Recipes",
  source: {
    label: "Pack",
    placeholder: "No packs",
    reload: "Rebuild the recipe index",
  },
  loading: {
    title: "Reading pack recipes…",
    hint: "The first build of a big pack can take tens of seconds. Next time it opens instantly.",
  },
  error: {
    title: "Couldn't read the recipes",
    retry: "Try again",
    sources: "Couldn't load the pack list: {error}",
  },
  empty: {
    noPacksTitle: "No installed packs",
    noPacksBody: "Install a pack or an instance first, then its items and recipes show up here.",
    notInstalledTitle: "This version isn't installed",
    notInstalledBody: "Install it from the Play tab to browse its recipes.",
    noItems: "Nothing found",
    noRecipes: "No recipes. This item is obtained in the world.",
    noUses: "This item isn't used in any recipe.",
    pick: "Pick an item.",
  },
  search: {
    label: "Search items",
    placeholder: "Search… @mod  #tag",
  },
  mod: {
    label: "Mod",
    all: "All mods",
  },
  count: { one: "{count} item", other: "{count} items" },
  view: {
    craft: "How to craft",
    uses: "Where it's used",
    back: "Back",
    prev: "Previous recipe",
    next: "Next recipe",
    page: "{n}/{total}",
    shapeless: "Shapeless",
    seconds: "{s} s",
    xp: "{xp} XP",
    container: "Container",
    tool: "Tool",
    fluid: "Fluid",
    note: "Note",
    time: "Time",
    tag: "Tag: #{tag}",
    station: "Station",
  },
  keys: {
    hint: "R recipes · U uses · Backspace back · ←/→ pages · Ctrl+F search",
  },

};
