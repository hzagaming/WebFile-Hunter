import { DEFAULT_SETTINGS } from "@/utils/defaults";
import type { AppSettings } from "@/types/models";

const KEY = "settings";

export async function getSettings(): Promise<AppSettings> {
  const result = await chrome.storage.local.get(KEY);
  const saved = result[KEY] as Partial<AppSettings> | undefined;
  if (!saved) return structuredClone(DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    scan: { ...DEFAULT_SETTINGS.scan, ...saved.scan },
    customExtensions: saved.customExtensions ?? {},
    customMimeTypes: saved.customMimeTypes ?? {}
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: settings });
}
