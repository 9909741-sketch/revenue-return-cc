import { ReactNode } from "react";

// noPadding — для карточек с таблицей внутри (своя внутренняя вёрстка ячеек).
// Отдельный флаг, а не класс "p-0" в className, потому что при одинаковой специфичности
// Tailwind-утилит порядок в итоговом CSS не гарантирует победу класса, добавленного позже.
export function Card({
  className = "",
  noPadding = false,
  children,
}: {
  className?: string;
  noPadding?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] shadow-sm ${noPadding ? "" : "p-4"} ${className}`}
    >
      {children}
    </div>
  );
}
