/** Minecraft-flavored adjective + noun + id for voice room titles. */
const ADJECTIVES = [
  "Swift",
  "Silent",
  "Golden",
  "Crimson",
  "Ancient",
  "Hidden",
  "Frozen",
  "Lunar",
  "Solar",
  "Wild",
  "Brave",
  "Lucky",
  "Dusty",
  "Mossy",
  "Iron",
  "Copper",
  "Nether",
  "Ender",
  "Shiny",
  "Quiet",
  "Mighty",
  "Tiny",
  "Grand",
  "Phantom",
  "Scarlet",
  "Azure",
  "Jade",
  "Obsidian",
  "Ember",
  "Stormy",
] as const;

const NOUNS = [
  "Creeper",
  "Village",
  "Stronghold",
  "Bastion",
  "Minecart",
  "Portal",
  "Beacon",
  "Temple",
  "Canyon",
  "Grove",
  "Spire",
  "Cavern",
  "Outpost",
  "Raft",
  "Elytra",
  "Shulker",
  "Golem",
  "Pickaxe",
  "Trident",
  "Farm",
  "Forge",
  "Realm",
  "Biome",
  "Lagoon",
  "Citadel",
  "Warden",
  "Squid",
  "Axolotl",
  "Campfire",
  "Anvil",
] as const;

function pick<T extends readonly string[]>(list: T): T[number] {
  return list[Math.floor(Math.random() * list.length)]!;
}

/** e.g. "Mossy Bastion 742" — unique enough for lobby placeholders. */
export function randomVoiceRoomTitle(): string {
  const id = Math.floor(Math.random() * 1001);
  return `${pick(ADJECTIVES)} ${pick(NOUNS)} ${id}`;
}
