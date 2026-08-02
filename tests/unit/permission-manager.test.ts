import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALL_SITES_ORIGINS,
  hasAllSitesPermission,
  revokeAllSitesPermission
} from "@/background/permission-manager";

const contains = vi.fn();
const getAll = vi.fn();
const remove = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.chrome = {
    permissions: { contains, getAll, remove }
  } as unknown as typeof chrome;
  getAll.mockResolvedValue({ origins: [...ALL_SITES_ORIGINS] });
});

describe("all-sites permission", () => {
  it("同时检查 HTTP 与 HTTPS 全站权限", async () => {
    contains.mockResolvedValue(true);

    await expect(hasAllSitesPermission()).resolves.toBe(true);
    expect(contains).toHaveBeenCalledWith({ origins: ALL_SITES_ORIGINS });
  });

  it("一次撤销完整嗅探的全部主机权限", async () => {
    remove.mockResolvedValue(true);

    await expect(revokeAllSitesPermission()).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith({ origins: ALL_SITES_ORIGINS });
  });

  it("权限不完整时只撤销仍存在的全站范围", async () => {
    getAll.mockResolvedValue({ origins: ["https://*/*", "https://example.test/*"] });
    remove.mockResolvedValue(true);

    await expect(revokeAllSitesPermission()).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith({ origins: ["https://*/*"] });
  });
});
