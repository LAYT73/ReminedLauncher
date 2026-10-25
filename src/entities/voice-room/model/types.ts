export type VoiceRoomStatus = "open" | "closed";
export type VoiceInviteStatus = "pending" | "accepted" | "declined";
export type VoiceMemberRole = "host" | "member";

/** Shared-world state of the party as seen by the host (voice_rooms.game_state). */
export type PartyGameState = "idle" | "launching" | "in_world" | "open";

/** Per-member party state (voice_room_members.state). */
export type PartyMemberState =
  | "joined"
  | "installing"
  | "ready"
  | "in_game"
  | "in_world";

export type VoiceRoom = {
  id: string;
  hostId: string;
  title: string;
  status: VoiceRoomStatus;
  relayShareCode: string | null;
  lkWsUrl: string;
  lkTcpPort: number;
  lkUdpStart: number;
  lkUdpEnd: number;
  /** Party pack (catalog id). Null for rooms made by pre-party launchers. */
  packId: string | null;
  gameState: PartyGameState;
  /** LAN port of the host world while game_state is 'open'. */
  lanPort: number | null;
  maxMembers: number;
  createdAt: string;
};

export type VoiceInvite = {
  id: string;
  roomId: string;
  fromId: string;
  toId: string;
  status: VoiceInviteStatus;
  createdAt: string;
  roomTitle?: string;
  /** Party pack of the room the invite is for (null when none or unknown). */
  roomPackId?: string | null;
  fromName?: string;
  fromSkinPath?: string | null;
};

export type VoiceMessage = {
  id: string;
  roomId: string;
  senderId: string;
  body: string;
  createdAt: string;
  senderName?: string;
  senderSkinPath?: string | null;
};

export type VoiceMember = {
  userId: string;
  role: VoiceMemberRole;
  joinedAt: string;
  state: PartyMemberState;
  /** Install progress 0..100 while state is 'installing'. */
  progress: number | null;
  /** Last row write (heartbeat); null when unknown. */
  updatedAt?: string | null;
  username?: string;
  skinPath?: string | null;
};
