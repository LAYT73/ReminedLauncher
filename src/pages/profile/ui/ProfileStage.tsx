import { EnchantParticles } from "@/shared/ui/EnchantParticles";
import { SkinModel, type SkinModelKind } from "@/entities/skin";

type Props = {
  skinUrl: string | null;
  capeUrl: string | null;
  skinModel: SkinModelKind | null | undefined;
  nameTag?: string | null;
};

export function ProfileStage({ skinUrl, capeUrl, skinModel, nameTag }: Props) {
  return (
    <div className="profile-stage-col">
      <div className="profile-stage">
        <EnchantParticles className="profile-stage-fx" count={14} />
        <SkinModel
          skinUrl={skinUrl}
          capeUrl={capeUrl}
          skinModel={skinModel}
          variant="full"
          nameTag={nameTag}
          transparent
          className="skin-stage"
        />
      </div>
    </div>
  );
}
