import { Component, type ErrorInfo, type ReactNode } from "react";
import { useI18n, type Translate } from "@/i18n";

interface Props {
  children: ReactNode;
  t: Translate;
}

interface State {
  message?: string;
}

class ErrorBoundaryInner extends Component<Props, State> {
  override state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { message: error.message };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("WebFile Hunter 界面错误", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.message) {
      return (
        <main className="fatal-error">
          <h1>{this.props.t("界面暂时无法显示")}</h1>
          <p>{this.state.message}</p>
          <button type="button" onClick={() => location.reload()}>
            {this.props.t("重新加载")}
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

export function ErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return <ErrorBoundaryInner t={t}>{children}</ErrorBoundaryInner>;
}
