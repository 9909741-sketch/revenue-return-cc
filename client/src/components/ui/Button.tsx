import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-brand-primary text-white hover:opacity-90 disabled:opacity-50",
  secondary: "bg-[var(--surface-bg)] border border-[var(--surface-border)] hover:bg-black/5 dark:hover:bg-white/5",
  danger: "bg-brand-error text-white hover:opacity-90 disabled:opacity-50",
  ghost: "hover:bg-black/5 dark:hover:bg-white/10",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", className = "", ...props }, ref) => (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  ),
);
Button.displayName = "Button";
