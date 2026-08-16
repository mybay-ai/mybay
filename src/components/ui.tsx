import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "link";
type ButtonSize = "default" | "xs" | "sm" | "lg" | "xl" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-action text-action-contrast hover:bg-action-hover shadow-sm",
  secondary: "bg-surface-muted text-content hover:bg-control-hover border border-outline",
  outline: "border border-outline bg-surface hover:bg-control-hover text-content-secondary hover:text-content",
  ghost: "border border-transparent text-content-secondary hover:bg-surface-muted hover:text-content",
  danger: "bg-danger text-danger-contrast hover:bg-danger-hover shadow-sm",
  link: "h-auto p-0 text-action underline-offset-4 hover:text-action-hover hover:underline",
};

const buttonSizes: Record<ButtonSize, string> = {
  default: "h-10 px-4 py-2",
  sm: "h-8 px-3 text-xs",
  xs: "h-7 px-2 text-xs",
  lg: "h-12 px-8 text-base",
  xl: "h-14 px-10 text-lg",
  icon: "h-10 w-10",
};

export const Button = ({ className, variant = "primary", size = "default", ...props }: ButtonProps) => {
  const base = "inline-flex items-center justify-center rounded-lg text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:pointer-events-none disabled:opacity-50 active:scale-95";
  return (
    <button
      className={cn(base, buttonVariants[variant], buttonSizes[size], className)}
      {...props}
    />
  );
};

export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => {
  return (
    <input
      className={cn(
        "mt-1 flex h-10 w-full rounded-lg border border-outline bg-control px-3 py-1 text-sm text-content shadow-sm transition-all file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-content-muted focus-visible:border-action focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
};

export const Label = ({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) => (
  <label
    className={cn("block text-sm font-medium leading-none text-content-secondary peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)}
    {...props}
  />
);

export const Card = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("rounded-2xl border border-outline bg-surface p-5 text-content shadow-sm", className)}
    {...props}
  />
);
