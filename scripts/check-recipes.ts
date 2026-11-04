// Self-check for src/entities/recipe pure logic (lookup + search) against the dev fixture.
// Run: npm run check:recipes
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLookup, canonType, groupRecipes, prettyType } from "../src/entities/recipe/lib/lookup";
import { searchItems } from "../src/entities/recipe/lib/search";
import type { RecipeIndex } from "../src/entities/recipe/model/types";

const fx = JSON.parse(readFileSync("src/entities/recipe/fixtures/index.fixture.json", "utf8"));
const index = fx.index as RecipeIndex;
const L = buildLookup(index);

// items keep index order
assert.equal(L.items.length, index.items.length);
assert.deepEqual(L.items.map((i) => i.id), index.items.map((i) => i.id), "index order kept");
assert.ok(L.itemsById.has("minecraft:stick"));

// by output / input (tag members and tool/container/station count as inputs)
assert.equal(L.recipesByOutput.get("minecraft:stick")?.length, 1);
assert.ok(L.recipesByInput.get("minecraft:birch_planks")?.some((r) => r.id === "minecraft:stick"), "tag member is an input");
assert.ok(L.recipesByInput.get("farmersdelight:knife")?.length, "tool is an input");
assert.ok(L.recipesByInput.get("minecraft:bowl")?.length, "container is an input");
assert.ok(L.recipesByInput.get("minecraft:furnace")?.some((r) => r.type === "minecraft:smelting"), "station is an input");
const stickUses = L.recipesByInput.get("minecraft:stick")!;
assert.equal(new Set(stickUses).size, stickUses.length, "no duplicate recipes per input");

// grouping: shaped + shapeless share the crafting tab; smelting is separate
const crafting = groupRecipes(L.recipesByOutput.get("minecraft:oak_planks")!);
assert.equal(crafting.length, 1);
assert.equal(canonType("minecraft:crafting_shapeless"), "minecraft:crafting");
const ironIngot = groupRecipes(L.recipesByOutput.get("minecraft:iron_ingot")!);
assert.equal(ironIngot.length, 2, "furnace + blast furnace tabs");
assert.equal(prettyType("create:mixing"), "Mixing");

// search
const names = (q: string, mod: string | null = null) => searchItems(L, q, mod).map((i) => i.id);
assert.equal(names("").length, L.items.length);
assert.ok(names("pickaxe").every((id) => id.includes("pickaxe")) && names("pickaxe").length === 4);
assert.ok(names("OAK").includes("minecraft:oak_log"));
assert.ok(names("minecraft:stick").includes("minecraft:stick"), "id substring");
assert.ok(names("@create").length > 0 && names("@create").every((id) => id.startsWith("create:")));
assert.ok(names("@farmer").every((id) => id.startsWith("farmersdelight:")), "mod by name");
assert.deepEqual(names("@create ingot").sort(), ["create:brass_ingot", "create:zinc_ingot"]);
assert.deepEqual(names("#coals").sort(), ["minecraft:charcoal", "minecraft:coal"]);
assert.deepEqual(names("", "farmersdelight").every((id) => id.startsWith("farmersdelight:")), true);
assert.equal(names("zzzz-nothing").length, 0);

console.log("check:recipes ok");
