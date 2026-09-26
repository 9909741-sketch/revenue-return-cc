// Защита от падения в белый экран (требование репозитория). Ловит ошибки рендера
// React-дерева и показывает понятное сообщение вместо пустой страницы.
import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("Ошибка отрисовки интерфейса:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-brand-bg p-6 text-center">
          <div>
            <h1 className="mb-2 text-lg font-semibold text-brand-fg">Что-то пошло не так</h1>
            <p className="mb-4 text-sm text-[var(--muted-fg)]">
              Произошла непредвиденная ошибка интерфейса. Попробуйте обновить страницу. Если ошибка
              повторяется — обратитесь к администратору.
            </p>
            <button
              className="rounded-md bg-brand-primary px-4 py-2 text-sm text-white"
              onClick={() => window.location.reload()}
            >
              Обновить страницу
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
