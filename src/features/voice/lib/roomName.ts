import { t } from "@/shared/i18n";

/** Minecraft-flavored adjective + noun + id for voice room titles (localized word lists). */
const words = (key: "voice.roomNames.adjectives" | "voice.roomNames.nouns") =>
  t(key).split("|");

function pick(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)]!;
}

/** e.g. "Mossy Bastion 742" — unique enough for lobby placeholders. */
export function randomVoiceRoomTitle(): string {
  const id = Math.floor(Math.random() * 1001);
  return `${pick(words("voice.roomNames.adjectives"))} ${pick(words("voice.roomNames.nouns"))} ${id}`;
}

/** DB default / old clients store "Voice room"; show it localized (storage unchanged). */
export function displayRoomTitle(title: string | null | undefined): string {
  const v = title ?? "";
  return v === "Voice room" ? t("voice.voiceRoom") : v;
}
