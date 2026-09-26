import { SelectHTMLAttributes, forwardRef } from "react";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className = "", children, ...props }, ref) => (
    <select
      ref={ref}
      className={`w-full rounded-md border border-[var(--surface-border)] bg-[var(--surface-bg)] px-3 py-2 text-sm outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary ${className}`}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";
