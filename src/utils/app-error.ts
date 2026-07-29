import type { AppErrorCode } from "@/types/models";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly causeValue?: unknown;

  constructor(code: AppErrorCode, message: string, causeValue?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.causeValue = causeValue;
  }
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误，请重试。";
}
