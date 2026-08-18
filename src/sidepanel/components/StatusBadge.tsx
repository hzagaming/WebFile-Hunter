import { useI18n, type MessageKey } from "@/i18n";

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const labels: Record<string, MessageKey> = {
    created: "已创建",
    requesting_permission: "等待授权",
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    cancelled: "已取消",
    failed: "失败",
    queued: "排队中",
    starting: "正在启动",
    in_progress: "下载中",
    interrupted: "已中断"
  };
  return (
    <span className={`status status-${status}`}>{labels[status] ? t(labels[status]) : status}</span>
  );
}
