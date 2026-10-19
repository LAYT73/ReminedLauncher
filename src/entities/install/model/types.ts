export type ProgressEvent = {
  phase: string;
  percent: number;
  message: string;
};

export type StatusKind = "idle" | "ok" | "error";
