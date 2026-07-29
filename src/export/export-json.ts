import type { FileCandidate, ScanSession } from "@/types/models";

export function exportJson(
  files: readonly FileCandidate[],
  scanSession: ScanSession,
  settingsSnapshot: unknown
): string {
  return JSON.stringify(
    {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      scanSession,
      settingsSnapshot,
      files
    },
    null,
    2
  );
}
