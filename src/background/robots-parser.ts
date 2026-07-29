interface RobotsRule {
  allow: boolean;
  pattern: string;
}

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelayMs?: number;
}

export interface RobotsRules {
  crawlDelayMs?: number;
  sitemaps: string[];
  isAllowed(url: string): boolean;
}

function ruleMatches(pattern: string, path: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = body
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${regex}${anchored ? "$" : ""}`).test(path);
}

export function parseRobotsTxt(text: string, userAgent = "*"): RobotsRules {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | undefined;
  let hasRules = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s*#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!current || hasRules) {
        current = { agents: [], rules: [] };
        groups.push(current);
        hasRules = false;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (!current) continue;
    if (field === "allow" || field === "disallow") {
      hasRules = true;
      if (value) current.rules.push({ allow: field === "allow", pattern: value });
    } else if (field === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelayMs = seconds * 1000;
    }
  }

  const agent = userAgent.toLowerCase();
  const exact = groups.filter((group) => group.agents.includes(agent));
  const selected = exact.length ? exact : groups.filter((group) => group.agents.includes("*"));
  const rules = selected.flatMap((group) => group.rules);
  const delays = selected
    .map((group) => group.crawlDelayMs)
    .filter((delay): delay is number => delay !== undefined);
  const crawlDelayMs = delays.length ? Math.max(...delays) : undefined;

  return {
    ...(crawlDelayMs !== undefined ? { crawlDelayMs } : {}),
    sitemaps: [...new Set(sitemaps)],
    isAllowed(url: string): boolean {
      let path: string;
      try {
        const parsed = new URL(url);
        path = `${parsed.pathname}${parsed.search}`;
      } catch {
        return false;
      }
      const matches = rules.filter((rule) => ruleMatches(rule.pattern, path));
      if (!matches.length) return true;
      matches.sort((left, right) => {
        const lengthDifference = right.pattern.length - left.pattern.length;
        return lengthDifference || Number(right.allow) - Number(left.allow);
      });
      return matches[0]?.allow ?? true;
    }
  };
}
