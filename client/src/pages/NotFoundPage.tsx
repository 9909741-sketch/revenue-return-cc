import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="p-6 text-sm">
      <p className="mb-2">Страница не найдена.</p>
      <Link to="/" className="text-brand-primary underline">
        Вернуться на главную
      </Link>
    </div>
  );
}
