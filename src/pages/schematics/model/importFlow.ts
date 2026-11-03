import { open } from "@tauri-apps/plugin-dialog";
import { t } from "@/shared/i18n";
import { toast } from "@/shared/lib/toast";
import { SCHEMATIC_EXTENSIONS, localizedError } from "./format";
import { useSchematicsStore } from "./store";

/** Native file picker (several files) -> import. */
export async function openImportDialog(): Promise<void> {
  try {
    const picked = await open({
      multiple: true,
      directory: false,
      filters: [
        { name: t("schematics.library.importDialog"), extensions: [...SCHEMATIC_EXTENSIONS] },
      ],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    await useSchematicsStore.getState().importPaths(paths);
  } catch (err) {
    toast(localizedError(err), "err");
  }
}
