import type { FormEvent, RefObject } from "react";
import type { VoiceMessage } from "@/entities/voice-room";
import { SkinHead } from "@/entities/skin";
import { FALLBACK_USERNAME } from "@/shared/config/limits";

type Props = {
  userId: string;
  messages: VoiceMessage[];
  chatEndRef: RefObject<HTMLDivElement | null>;
  draft: string;
  setDraft: (v: string) => void;
  onSend: (e: FormEvent) => Promise<void>;
};

export function VoiceChat({
  userId,
  messages,
  chatEndRef,
  draft,
  setDraft,
  onSend,
}: Props) {
  return (
    <div className="voice-col voice-chat">
      <h3 className="settings-heading">Chat</h3>
      <div className="voice-chat-log">
        {messages.length === 0 ? (
          <p className="friends-muted">No messages yet.</p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`voice-chat-line ${
                m.senderId === userId ? "is-mine" : ""
              }`}
            >
              <SkinHead
                skinUrl={m.senderSkinPath ?? null}
                className="voice-chat-avatar"
                size={32}
              />
              <div className="voice-chat-body">
                <strong>{m.senderName || FALLBACK_USERNAME}</strong>
                <span>{m.body}</span>
              </div>
            </div>
          ))
        )}
        <div ref={chatEndRef} />
      </div>
      <form
        className="friends-add voice-chat-form"
        onSubmit={(e) => void onSend(e)}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the room…"
          maxLength={2000}
          aria-label="Chat message"
        />
        <button
          type="submit"
          className="btn-mc ok"
          disabled={!draft.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
}
