export type FeedbackKind = "success" | "info" | "warning" | "error";

interface Props {
  kind: FeedbackKind;
  children: string;
}

export function FeedbackNotice({ kind, children }: Props) {
  return (
    <div
      className={`notice notice-${kind}`}
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
    >
      {children}
    </div>
  );
}
