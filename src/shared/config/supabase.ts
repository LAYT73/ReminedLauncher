/** Supabase table and storage-bucket names. */
export const TABLE = {
  profiles: "profiles",
  friendships: "friendships",
  sessions: "sessions",
  packs: "packs",
  packPlaytime: "pack_playtime",
  voiceRooms: "voice_rooms",
  voiceRoomMembers: "voice_room_members",
  voiceInvites: "voice_invites",
  voiceMessages: "voice_messages",
} as const;

export const BUCKET = {
  skins: "skins",
} as const;
