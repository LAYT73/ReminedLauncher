#!/usr/bin/env node
// Generates src/entities/recipe/fixtures/index.fixture.json: a tiny fake pack for the Recipes page
// in a plain browser (npm run dev). Textures are generated 16x16 PNGs.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(rgb, { mode = "block", seed = 1, size = 16 } = {}) {
  const n = size;
  const raw = Buffer.alloc((n * 4 + 1) * n);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let y = 0; y < n; y++) {
    raw[y * (n * 4 + 1)] = 0;
    for (let x = 0; x < n; x++) {
      const o = y * (n * 4 + 1) + 1 + x * 4;
      let a = 255;
      if (mode === "sprite") {
        const dx = x - 7.5, dy = y - 7.5;
        a = Math.abs(dx) + Math.abs(dy) < 7 ? 255 : 0; // diamond sprite
      } else if (mode === "cross") {
        a = x === y || x === 15 - y || x === 8 ? 255 : 0;
      }
      const j = 0.82 + rnd() * 0.3;
      raw[o] = Math.min(255, rgb[0] * j);
      raw[o + 1] = Math.min(255, rgb[1] * j);
      raw[o + 2] = Math.min(255, rgb[2] * j);
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

const textures = {};
const tex = (key, rgb, mode, seed, size) => {
  textures[key] = png(rgb, { mode, seed: seed ?? key.length * 7, size });
  return key;
};

const items = [];
const ru = {};
const mods = [
  { id: "minecraft", name: "Minecraft", namespaces: ["minecraft"] },
  { id: "farmersdelight", name: "Farmer's Delight", namespaces: ["farmersdelight"] },
  { id: "create", name: "Create", namespaces: ["create"] },
];
function cube(id, en, ruName, top, side = top, front = side, tint) {
  const ns = id.split(":")[0];
  const p = id.split(":")[1];
  const k = (suffix, c) => tex(`${ns}:block/${p}_${suffix}`, c);
  items.push({
    id, name: en, mod: ns,
    icon: { k: "cube", top: k("top", top), side: k("side", side), front: k("front", front), ...(tint ? { tint } : {}) },
  });
  ru[id] = ruName;
}
function flat(id, en, ruName, rgb, mode = "sprite") {
  const ns = id.split(":")[0];
  items.push({ id, name: en, mod: ns, icon: { k: mode === "cross" ? "cross" : "flat", t: tex(`${ns}:item/${id.split(":")[1]}`, rgb, mode) } });
  ru[id] = ruName;
}

cube("minecraft:oak_planks", "Oak Planks", "Дубовые доски", [170, 130, 70]);
cube("minecraft:birch_planks", "Birch Planks", "Берёзовые доски", [210, 190, 130]);
cube("minecraft:spruce_planks", "Spruce Planks", "Еловые доски", [110, 80, 45]);
cube("minecraft:oak_log", "Oak Log", "Дубовое бревно", [150, 120, 70], [90, 70, 40]);
cube("minecraft:cobblestone", "Cobblestone", "Булыжник", [125, 125, 125]);
cube("minecraft:stone", "Stone", "Камень", [140, 140, 140]);
cube("minecraft:stone_bricks", "Stone Bricks", "Каменные кирпичи", [120, 120, 125]);
cube("minecraft:iron_ore", "Iron Ore", "Железная руда", [140, 130, 125]);
cube("minecraft:iron_block", "Block of Iron", "Железный блок", [215, 215, 215]);
cube("minecraft:glass", "Glass", "Стекло", [190, 225, 235]);
cube("minecraft:sand", "Sand", "Песок", [220, 205, 150]);
cube("minecraft:white_wool", "White Wool", "Белая шерсть", [235, 235, 235]);
cube("minecraft:crafting_table", "Crafting Table", "Верстак", [160, 115, 60], [140, 100, 50], [120, 85, 45]);
cube("minecraft:furnace", "Furnace", "Печь", [130, 130, 130], [120, 120, 120], [95, 95, 95]);
cube("minecraft:blast_furnace", "Blast Furnace", "Плавильная печь", [90, 90, 95], [85, 85, 90], [60, 60, 65]);
cube("minecraft:stonecutter", "Stonecutter", "Камнерез", [150, 150, 150], [125, 125, 125], [110, 110, 120]);
cube("minecraft:smithing_table", "Smithing Table", "Кузнечный стол", [60, 50, 70], [90, 70, 50], [70, 60, 55]);
flat("minecraft:stick", "Stick", "Палка", [140, 105, 55]);
flat("minecraft:iron_ingot", "Iron Ingot", "Железный слиток", [220, 220, 220]);
flat("minecraft:raw_iron", "Raw Iron", "Сырое железо", [190, 150, 120]);
flat("minecraft:coal", "Coal", "Уголь", [40, 40, 40]);
flat("minecraft:charcoal", "Charcoal", "Древесный уголь", [60, 50, 40]);
flat("minecraft:diamond", "Diamond", "Алмаз", [80, 230, 220]);
flat("minecraft:netherite_ingot", "Netherite Ingot", "Незеритовый слиток", [75, 60, 70]);
flat("minecraft:wooden_pickaxe", "Wooden Pickaxe", "Деревянная кирка", [160, 120, 60]);
flat("minecraft:iron_pickaxe", "Iron Pickaxe", "Железная кирка", [200, 200, 205]);
flat("minecraft:diamond_pickaxe", "Diamond Pickaxe", "Алмазная кирка", [90, 220, 215]);
flat("minecraft:netherite_pickaxe", "Netherite Pickaxe", "Незеритовая кирка", [85, 70, 80]);
flat("minecraft:netherite_upgrade_smithing_template", "Netherite Upgrade", "Улучшение до незерита", [100, 70, 90]);
flat("minecraft:bread", "Bread", "Хлеб", [200, 150, 70]);
flat("minecraft:wheat", "Wheat", "Пшеница", [210, 190, 80]);
flat("minecraft:bowl", "Bowl", "Миска", [150, 110, 60]);
flat("minecraft:oak_sapling", "Oak Sapling", "Саженец дуба", [70, 150, 50], "cross");
flat("minecraft:torch", "Torch", "Факел", [240, 190, 70]);
cube("farmersdelight:cooking_pot", "Cooking Pot", "Кастрюля", [100, 100, 105], [90, 90, 95], [70, 70, 75]);
cube("farmersdelight:cutting_board", "Cutting Board", "Разделочная доска", [185, 140, 80]);
flat("farmersdelight:knife", "Iron Knife", "Железный нож", [195, 195, 200]);
flat("farmersdelight:tomato", "Tomato", "Помидор", [220, 60, 50]);
flat("farmersdelight:tomato_sauce", "Tomato Sauce", "Томатный соус", [200, 50, 40]);
flat("farmersdelight:tomato_seeds", "Tomato Seeds", "Семена помидора", [180, 90, 60]);
cube("create:mechanical_press", "Mechanical Press", "Механический пресс", [130, 120, 110], [110, 100, 90], [95, 85, 75]);
cube("create:basin", "Basin", "Таз", [90, 85, 80], [100, 95, 90], [80, 75, 70]);
flat("create:andesite_alloy", "Andesite Alloy", "Андезитовый сплав", [150, 160, 150]);
flat("create:brass_ingot", "Brass Ingot", "Латунный слиток", [220, 180, 80]);
flat("create:copper_sheet", "Copper Sheet", "Медный лист", [210, 120, 80]);
flat("minecraft:copper_ingot", "Copper Ingot", "Медный слиток", [200, 115, 80]);
flat("create:zinc_ingot", "Zinc Ingot", "Цинковый слиток", [160, 170, 175]);

// ---- "model" icons (real geometry) ----
const DEF_GUI = { rotation: [30, 225, 0], translation: [0, 0, 0], scale: [0.625, 0.625, 0.625] };
function modelItem(id, en, ruName, gui, elements) {
  items.push({ id, name: en, mod: id.split(":")[0], icon: { k: "model", gui, elements } });
  ru[id] = ruName;
}
const T16 = (key, rgb) => tex(key, rgb);
const planksT = T16("minecraft:block/fx_planks", [170, 130, 70]);
const logT = T16("minecraft:block/fx_log", [95, 72, 40]);
const stoneT = T16("minecraft:block/fx_stone", [130, 130, 130]);
const allFaces = (t, uv = [0, 0, 16, 16]) => ({
  up: { t, uv }, down: { t, uv }, north: { t, uv }, south: { t, uv }, east: { t, uv }, west: { t, uv },
});
const box = (from, to, t) => {
  const [x1, y1, z1] = from, [x2, y2, z2] = to;
  return {
    from, to,
    faces: {
      up: { t, uv: [x1, z1, x2, z2] }, down: { t, uv: [x1, 16 - z2, x2, 16 - z1] },
      north: { t, uv: [16 - x2, 16 - y2, 16 - x1, 16 - y1] }, south: { t, uv: [x1, 16 - y2, x2, 16 - y1] },
      east: { t, uv: [16 - z2, 16 - y2, 16 - z1, 16 - y1] }, west: { t, uv: [z1, 16 - y2, z2, 16 - y1] },
    },
  };
};
modelItem("minecraft:fx_slab", "Oak Slab", "Дубовая плита", DEF_GUI, [box([0, 0, 0], [16, 8, 16], planksT)]);
modelItem("minecraft:fx_stairs", "Stone Stairs", "Каменные ступени", DEF_GUI, [box([0, 0, 0], [16, 8, 16], stoneT), box([8, 8, 0], [16, 16, 16], stoneT)]);
modelItem("minecraft:fx_fence", "Oak Fence", "Дубовый забор", DEF_GUI, [
  box([6, 0, 6], [10, 16, 10], planksT), box([7, 12, 0], [9, 15, 16], planksT), box([7, 6, 0], [9, 9, 16], planksT),
]);
const bedT = tex("minecraft:entity/bed/red", [200, 40, 40], "block", 3, 64);
const bedLegT = tex("minecraft:entity/bed/red_leg", [110, 80, 45], "block", 5, 64);
modelItem("minecraft:fx_bed", "Red Bed", "Красная кровать", { rotation: [30, 225, 0], translation: [0, 0, 0], scale: [0.5, 0.5, 0.5] }, [
  box([0, 3, 0], [16, 9, 32], bedT),
  box([0, 0, 0], [3, 3, 3], bedLegT), box([13, 0, 0], [16, 3, 3], bedLegT),
  box([0, 0, 29], [3, 3, 32], bedLegT), box([13, 0, 29], [16, 3, 32], bedLegT),
]);
const chestT = tex("minecraft:entity/chest/normal", [150, 105, 50], "block", 9, 64);
modelItem("minecraft:fx_chest", "Chest", "Сундук", DEF_GUI, [
  box([1, 0, 1], [15, 10, 15], chestT), box([1, 10, 1], [15, 15, 15], chestT), box([7, 8, 0], [9, 12, 1], bedLegT),
]);
cube("minecraft:fx_obsidian", "Obsidian", "Обсидиан", [22, 16, 36]);
flat("minecraft:fx_black_dye", "Ink Sac", "Чернильный мешок", [18, 18, 20]);

const I = (...ids) => ({ items: ids });
const T = (tag, ...ids) => ({ tag, items: ids });
const planks = T("minecraft:planks", "minecraft:oak_planks", "minecraft:birch_planks", "minecraft:spruce_planks");
const stack = (id, count = 1) => ({ id, count });
const mc = (p) => `minecraft:${p}`;

const recipes = [
  { id: mc("stick"), type: mc("crafting_shaped"), mod: "minecraft", station: mc("crafting_table"), layout: "shaped", w: 1, h: 2, inputs: [planks, planks], outputs: [stack(mc("stick"), 4)] },
  { id: mc("wooden_pickaxe"), type: mc("crafting_shaped"), mod: "minecraft", station: mc("crafting_table"), layout: "shaped", w: 3, h: 3, inputs: [planks, planks, planks, null, I(mc("stick")), null, null, I(mc("stick")), null], outputs: [stack(mc("wooden_pickaxe"))] },
  { id: mc("iron_pickaxe"), type: mc("crafting_shaped"), mod: "minecraft", station: mc("crafting_table"), layout: "shaped", w: 3, h: 3, inputs: [I(mc("iron_ingot")), I(mc("iron_ingot")), I(mc("iron_ingot")), null, I(mc("stick")), null, null, I(mc("stick")), null], outputs: [stack(mc("iron_pickaxe"))] },
  { id: mc("furnace"), type: mc("crafting_shaped"), mod: "minecraft", station: mc("crafting_table"), layout: "shaped", w: 3, h: 3, inputs: [I(mc("cobblestone")), I(mc("cobblestone")), I(mc("cobblestone")), I(mc("cobblestone")), null, I(mc("cobblestone")), I(mc("cobblestone")), I(mc("cobblestone")), I(mc("cobblestone"))], outputs: [stack(mc("furnace"))] },
  { id: mc("crafting_table"), type: mc("crafting_shaped"), mod: "minecraft", station: mc("crafting_table"), layout: "shaped", w: 2, h: 2, inputs: [planks, planks, planks, planks], outputs: [stack(mc("crafting_table"))] },
  { id: mc("torch"), type: mc("crafting_shaped"), mod: "minecraft", station: mc("crafting_table"), layout: "shaped", w: 1, h: 2, inputs: [T("minecraft:coals", mc("coal"), mc("charcoal")), I(mc("stick"))], outputs: [stack(mc("torch"), 4)] },
  { id: mc("oak_planks"), type: mc("crafting_shapeless"), mod: "minecraft", station: mc("crafting_table"), layout: "shapeless", inputs: [I(mc("oak_log"))], outputs: [stack(mc("oak_planks"), 4)] },
  { id: mc("white_wool_x"), type: mc("crafting_shapeless"), mod: "minecraft", station: mc("crafting_table"), layout: "shapeless", inputs: [I(mc("sand")), I(mc("sand")), I(mc("wheat")), I(mc("wheat"))], outputs: [stack(mc("white_wool"))] },
  { id: mc("iron_ingot_from_smelting"), type: mc("smelting"), mod: "minecraft", station: mc("furnace"), layout: "cooking", inputs: [I(mc("iron_ore"), mc("raw_iron"))], outputs: [stack(mc("iron_ingot"))], extras: { time: 10, xp: 0.7 } },
  { id: mc("iron_ingot_from_blasting"), type: mc("blasting"), mod: "minecraft", station: mc("blast_furnace"), layout: "cooking", inputs: [I(mc("iron_ore"), mc("raw_iron"))], outputs: [stack(mc("iron_ingot"))], extras: { time: 5, xp: 0.7 } },
  { id: mc("glass"), type: mc("smelting"), mod: "minecraft", station: mc("furnace"), layout: "cooking", inputs: [I(mc("sand"))], outputs: [stack(mc("glass"))], extras: { time: 10, xp: 0.1 } },
  { id: mc("stone"), type: mc("smelting"), mod: "minecraft", station: mc("furnace"), layout: "cooking", inputs: [I(mc("cobblestone"))], outputs: [stack(mc("stone"))], extras: { time: 10, xp: 0.1 } },
  { id: mc("stone_bricks_from_stone_stonecutting"), type: mc("stonecutting"), mod: "minecraft", station: mc("stonecutter"), layout: "stonecutting", inputs: [I(mc("stone"))], outputs: [stack(mc("stone_bricks"))] },
  { id: mc("netherite_pickaxe_smithing"), type: mc("smithing_transform"), mod: "minecraft", station: mc("smithing_table"), layout: "smithing", inputs: [I(mc("netherite_upgrade_smithing_template")), I(mc("diamond_pickaxe")), I(mc("netherite_ingot"))], outputs: [stack(mc("netherite_pickaxe"))] },
  { id: "farmersdelight:tomato_sauce", type: "farmersdelight:cooking", mod: "farmersdelight", station: "farmersdelight:cooking_pot", layout: "process", inputs: [I("farmersdelight:tomato"), I("farmersdelight:tomato"), I(mc("bread"))], outputs: [stack("farmersdelight:tomato_sauce")], extras: { time: 10, xp: 1, container: I(mc("bowl")) } },
  { id: "farmersdelight:tomato_seeds", type: "farmersdelight:cutting", mod: "farmersdelight", station: "farmersdelight:cutting_board", layout: "process", inputs: [I("farmersdelight:tomato")], outputs: [stack("farmersdelight:tomato_seeds", 2)], extras: { tool: I("farmersdelight:knife") } },
  { id: "create:pressing/copper", type: "create:pressing", mod: "create", station: "create:mechanical_press", layout: "process", inputs: [I(mc("copper_ingot"))], outputs: [stack("create:copper_sheet")] },
  { id: "create:mixing/brass", type: "create:mixing", mod: "create", station: "create:basin", layout: "process", inputs: [I(mc("copper_ingot")), I("create:zinc_ingot")], outputs: [stack("create:brass_ingot", 2)], extras: { time: 5, fluid: { id: "minecraft:water", amount: 250 }, note: "heated" } },
  { id: "create:mixing/andesite", type: "create:mixing", mod: "create", station: "create:basin", layout: "process", inputs: [I(mc("cobblestone")), I(mc("iron_ingot"))], outputs: [stack("create:andesite_alloy")] },
];

const index = {
  format: 1,
  source: { packId: "fixture", name: "Fixture Pack", mcVersion: "1.21.1" },
  locale: "en",
  mods,
  items,
  tags: {
    "minecraft:planks": ["minecraft:oak_planks", "minecraft:birch_planks", "minecraft:spruce_planks"],
    "minecraft:coals": ["minecraft:coal", "minecraft:charcoal"],
    "minecraft:logs": ["minecraft:oak_log"],
  },
  textures,
  recipes,
};

const out = new URL("../src/entities/recipe/fixtures/index.fixture.json", import.meta.url);
writeFileSync(out, JSON.stringify({ index, ru }));
console.log(`fixture: ${items.length} items, ${recipes.length} recipes, ${Object.keys(textures).length} textures`);
