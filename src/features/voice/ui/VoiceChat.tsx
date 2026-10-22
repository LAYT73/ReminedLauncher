import type { FormEvent, RefObject } from "react";
import type { VoiceMessage } from "@/entities/voice-room";
import { SkinHead } from "@/entities/skin";
import { useT } from "@/shared/i18n";
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
  const t = useT();
  return (
    <div className="voice-col voice-chat">
      <div className="voice-chat-log">
        {messages.length === 0 ? (
          <p className="friends-muted">{t("voice.chatUi.empty")}</p>
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
                size={28}
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
          placeholder={t("voice.chatUi.placeholder")}
          maxLength={2000}
          aria-label={t("voice.chatUi.aria")}
        />
        <button
          type="submit"
          className="btn-mc ok"
          disabled={!draft.trim()}
        >
          {t("voice.chatUi.send")}
        </button>
      </form>
    </div>
  );
}
