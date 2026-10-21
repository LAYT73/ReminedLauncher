export type VoiceRoomStatus = "open" | "closed";
export type VoiceInviteStatus = "pending" | "accepted" | "declined";
export type VoiceMemberRole = "host" | "member";

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
  username?: string;
  skinPath?: string | null;
};
