import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { AppSettings, LanguagePreference } from "@/types/models";
import { englishMessages, type MessageKey } from "./messages";

export type { MessageKey } from "./messages";

export type AppLanguage = "zh-CN" | "en";
export type MessageValues = Readonly<Record<string, string | number>>;
export type Translate = (key: MessageKey, values?: MessageValues) => string;

function interpolate(template: string, values?: MessageValues): string {
  if (!values) return template;
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match
  );
}

export function resolveLanguage(
  preference: LanguagePreference,
  uiLanguage = globalThis.chrome?.i18n?.getUILanguage?.() ?? globalThis.navigator?.language ?? "en"
): AppLanguage {
  if (preference !== "auto") return preference;
  return uiLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function translate(language: AppLanguage, key: MessageKey, values?: MessageValues): string {
  return interpolate(language === "en" ? englishMessages[key] : key, values);
}

interface I18nValue {
  language: AppLanguage;
  locale: string;
  preference: LanguagePreference;
  setPreference: (preference: LanguagePreference) => void;
  t: Translate;
  known: (message: string) => string;
}

const fallbackValue: I18nValue = {
  language: "zh-CN",
  locale: "zh-CN",
  preference: "zh-CN",
  setPreference: () => undefined,
  t: (key, values) => translate("zh-CN", key, values),
  known: (message) => message
};

const I18nContext = createContext<I18nValue>(fallbackValue);

interface I18nProviderProps {
  children: ReactNode;
  preference?: LanguagePreference;
  title?: MessageKey;
}

function savedPreference(value: unknown): LanguagePreference {
  if (value === "auto" || value === "zh-CN" || value === "en") return value;
  return "auto";
}

export function I18nProvider({ children, preference: controlled, title }: I18nProviderProps) {
  const [preference, setPreference] = useState<LanguagePreference>(controlled ?? "auto");
  const language = resolveLanguage(preference);

  useEffect(() => {
    if (controlled || !globalThis.chrome?.storage?.local) return;
    let active = true;
    void chrome.storage.local
      .get("settings")
      .then((result) => {
        const settings = result.settings as Partial<AppSettings> | undefined;
        if (active) setPreference(savedPreference(settings?.language));
      })
      .catch(() => undefined);
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ): void => {
      if (area !== "local" || !changes.settings) return;
      const settings = changes.settings.newValue as Partial<AppSettings> | undefined;
      setPreference(savedPreference(settings?.language));
    };
    chrome.storage.onChanged?.addListener(listener);
    return () => {
      active = false;
      chrome.storage.onChanged?.removeListener(listener);
    };
  }, [controlled]);

  const t = useCallback<Translate>((key, values) => translate(language, key, values), [language]);
  const known = useCallback(
    (message: string): string => {
      if (language === "zh-CN") return message;
      if (message in englishMessages) return englishMessages[message as MessageKey];
      const patterns: ReadonlyArray<[RegExp, string]> = [
        [/^服务器返回 HTTP (\d+)。$/, "Server returned HTTP $1."],
        [
          /^robots\.txt 请求失败（HTTP (\d+)），为安全起见已停止。$/,
          "The robots.txt request failed (HTTP $1), so the scan stopped for safety."
        ],
        [/^页面请求失败（HTTP (\d+)）。$/, "The page request failed (HTTP $1)."]
      ];
      for (const [pattern, replacement] of patterns) {
        if (pattern.test(message)) return message.replace(pattern, replacement);
      }
      return message;
    },
    [language]
  );

  useEffect(() => {
    document.documentElement.lang = language;
    if (title) document.title = t(title);
  }, [language, t, title]);

  const value = useMemo<I18nValue>(
    () => ({ language, locale: language, preference, setPreference, t, known }),
    [known, language, preference, t]
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
