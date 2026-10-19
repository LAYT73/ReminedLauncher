export type Pack = {
  id: string;
  name: string;
  version: string;
  description: string;
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
