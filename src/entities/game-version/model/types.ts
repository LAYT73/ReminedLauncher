export type VanillaVersionRow = {
  id: string;
  type: string;
  release_time: string;
  pack_id: string;
  installed: boolean;
};

/** The two "pick a Minecraft version" editions. */
export type Edition = "vanilla" | "remined-vanilla";

export type VersionList = {
  versions: VanillaVersionRow[];
  /** Id to fall back to when nothing was picked / the pick vanished. */
  latest: string;
};

export type PackOption = { id: string; name: string; version: string };
