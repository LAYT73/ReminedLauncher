import { useT } from "@/shared/i18n";
import { useRef } from "react";
import {
  PixelCapeIcon,
  PixelPlusIcon,
  PixelSkinIcon,
  PixelTrashIcon,
  PixelUploadIcon,
} from "@/shared/ui/PixelIcons";
import { burstEnchantFrom } from "@/shared/ui/enchantBurst";
import {
  clearCape,
  clearSkin,
  pickCape,
  pickSkin,
  setSkinModel,
} from "@/features/profile-edit";
import { SkinHead, type SkinModelKind } from "@/entities/skin";

type SkinProps = {
  skinUrl: string | null;
  hasSkin: boolean;
  skinModel: SkinModelKind | null | undefined;
};

export function SkinCard({ skinUrl, hasSkin, skinModel }: SkinProps) {
  const t = useT();
  const previewRef = useRef<HTMLDivElement>(null);
  const upload = async () => {
    const ok = await pickSkin();
    if (ok && previewRef.current) burstEnchantFrom(previewRef.current);
  };
  return (
    <section className="wardrobe-card" aria-labelledby="wardrobe-skin-title">
      <h4 className="wardrobe-card-title" id="wardrobe-skin-title">
        <PixelSkinIcon />
        {t("profile.wardrobe.skin")}
      </h4>
      <div className="wardrobe-card-body">
        <div className="wardrobe-preview wardrobe-preview-skin" ref={previewRef}>
          <SkinHead skinUrl={skinUrl} size={48} />
        </div>
        <div className="wardrobe-info">
          <p className="wardrobe-status">
            {hasSkin ? t("profile.wardrobe.customSkin") : t("profile.wardrobe.defaultSkin")}
          </p>
          <p className="wardrobe-hint">{t("profile.wardrobe.skinHint")}</p>
        </div>
      </div>
      <div className="field wardrobe-arms">
        <span className="field-label" id="skin-model-label">
          {t("profile.wardrobe.arms")}
        </span>
        <div
          className="skin-model-toggle"
          role="group"
          aria-labelledby="skin-model-label"
        >
          {(
            [
              ["default", t("profile.wardrobe.wide")],
              ["slim", t("profile.wardrobe.slim")],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              className={`skin-model-btn${
                skinModel === kind ? " is-active" : ""
              }`}
              aria-pressed={skinModel === kind}
              onClick={() => void setSkinModel(kind)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="btn-row wardrobe-actions">
        <button
          type="button"
          className="btn-mc ok btn-mc-icon"
          onClick={() => void upload()}
        >
          <PixelUploadIcon />
          {t("profile.wardrobe.uploadSkin")}
        </button>
        {hasSkin ? (
          <button
            type="button"
            className="btn-mc danger btn-mc-icon"
            onClick={() => void clearSkin()}
          >
            <PixelTrashIcon />
            {t("profile.wardrobe.remove")}
          </button>
        ) : null}
      </div>
    </section>
  );
}

type CapeProps = {
  capeUrl: string | null;
  hasCape: boolean;
};

export function CapeCard({ capeUrl, hasCape }: CapeProps) {
  const t = useT();
  const slotRef = useRef<HTMLElement | null>(null);
  const upload = async () => {
    const ok = await pickCape();
    if (ok && slotRef.current) burstEnchantFrom(slotRef.current);
  };
  return (
    <section className="wardrobe-card" aria-labelledby="wardrobe-cape-title">
      <h4 className="wardrobe-card-title" id="wardrobe-cape-title">
        <PixelCapeIcon />
        {t("profile.wardrobe.cape")}
      </h4>
      <div className="wardrobe-card-body">
        {hasCape && capeUrl ? (
          <div
            className="wardrobe-preview wardrobe-preview-cape"
            ref={(el) => {
              slotRef.current = el;
            }}
          >
            <div
              className="cape-crop"
              style={{ backgroundImage: `url("${capeUrl}")` }}
            />
          </div>
        ) : (
          <button
            type="button"
            className="wardrobe-preview wardrobe-cape-slot"
            ref={(el) => {
              slotRef.current = el;
            }}
            aria-label={t("profile.wardrobe.chooseCape")}
            onClick={() => void upload()}
          >
            <PixelCapeIcon />
            <span className="cape-slot-plus">
              <PixelPlusIcon />
            </span>
          </button>
        )}
        <div className="wardrobe-info">
          <p className="wardrobe-status">
            {hasCape ? t("profile.wardrobe.capeEquipped") : t("profile.wardrobe.noCape")}
          </p>
          <p className="wardrobe-hint">{t("profile.wardrobe.capeHint")}</p>
        </div>
      </div>
      <div className="btn-row wardrobe-actions">
        <button
          type="button"
          className="btn-mc ok btn-mc-icon"
          onClick={() => void upload()}
        >
          <PixelUploadIcon />
          {t("profile.wardrobe.uploadCape")}
        </button>
        {hasCape ? (
          <button
            type="button"
            className="btn-mc danger btn-mc-icon"
            onClick={() => void clearCape()}
          >
            <PixelTrashIcon />
            {t("profile.wardrobe.remove")}
          </button>
        ) : null}
      </div>
    </section>
  );
}
