import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CloudProfile } from "@/entities/profile";
import { SkinHead, SkinModel } from "@/entities/skin";
import { useT } from "@/shared/i18n";

const OPEN_DELAY = 250;
const CLOSE_DELAY = 150;
const CARD_W = 200;
const CARD_H = 280;
const GAP = 8;

/** Only one peek card open at a time. */
let closeActive: (() => void) | null = null;

type Pos = { left: number; top: number };

function place(anchor: DOMRect): Pos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = anchor.right + GAP;
  if (left + CARD_W > vw - GAP) left = anchor.left - GAP - CARD_W;
  left = Math.max(GAP, Math.min(left, vw - CARD_W - GAP));
  let top = anchor.top + anchor.height / 2 - CARD_H / 2;
  top = Math.max(GAP, Math.min(top, vh - CARD_H - GAP));
  return { left, top };
}

/** Friend avatar that shows a floating 3D skin + cape preview on hover/focus. */
export function FriendSkinPeek({ profile }: { profile: CloudProfile }) {
  const t = useT();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);

  const clearTimers = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  };

  const close = useCallback(() => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    setOpen(false);
    if (closeActive === close) closeActive = null;
  }, []);

  const doOpen = useCallback(() => {
    if (closeActive && closeActive !== close) closeActive();
    closeActive = close;
    setOpen(true);
  }, [close]);

  const scheduleOpen = () => {
    clearTimers();
    if (open) return;
    openTimer.current = window.setTimeout(doOpen, OPEN_DELAY);
  };
  const scheduleClose = () => {
    clearTimers();
    closeTimer.current = window.setTimeout(close, CLOSE_DELAY);
  };
  const keepOpen = () => window.clearTimeout(closeTimer.current);

  useLayoutEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (el) setPos(place(el.getBoundingClientRect()));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // Capture: scroll events don't bubble, so this catches the list scrolling.
    const onScroll = () => close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, close]);

  useEffect(
    () => () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
      if (closeActive === close) closeActive = null;
    },
    [close],
  );

  const name = profile.username;
  const capeUrl = profile.cape_path?.trim() || null;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="friend-avatar-btn"
        aria-label={t("social.friends.skinPeek", { name })}
        onPointerEnter={scheduleOpen}
        onPointerLeave={scheduleClose}
        onFocus={() => {
          clearTimers();
          doOpen();
        }}
        onBlur={scheduleClose}
      >
        <SkinHead skinUrl={profile.skin_path} className="friend-avatar" size={40} />
      </button>
      {open && pos
        ? createPortal(
            <div
              className="friend-skin-peek"
              style={{ left: pos.left, top: pos.top, width: CARD_W, height: CARD_H }}
              onPointerEnter={keepOpen}
              onPointerLeave={scheduleClose}
            >
              <SkinModel
                variant="full"
                className="friend-skin-peek-canvas"
                skinUrl={profile.skin_path}
                capeUrl={capeUrl}
                skinModel={profile.skin_model}
                nameTag={name}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
