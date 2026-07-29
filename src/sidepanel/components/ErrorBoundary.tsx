import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  message?: string;
}

export class ErrorBoundary extends Component<Props, State> {
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
          <h1>界面暂时无法显示</h1>
          <p>{this.state.message}</p>
          <button type="button" onClick={() => location.reload()}>
            重新加载
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
