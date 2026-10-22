/** Per-locale overrides of catalog copy (raw, from packs.i18n). */
export type PackI18n = Record<
  string,
  Partial<{
    name: string;
    tagline: string;
    blurb: string;
    highlights: string[];
  }>
>;

export type Pack = {
  id: string;
  name: string;
  version: string;
  description: string;
  i18n?: PackI18n;
};

export type PackRelease = {
  id: string;
  version: string;
};

export type PackStatus = {
  id: string;
  installed: boolean;
  local_version: string | null;
  path: string;
};
