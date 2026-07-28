import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // min-h-11 keeps every button at least a 44px tap target, which is what iOS
  // needs for gloves-on use in the field.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
        secondary:
          "bg-surface-raised text-foreground border border-border hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        danger:
          "bg-danger text-danger-foreground hover:bg-danger/90 active:bg-danger/80",
        success:
          "bg-success text-success-foreground hover:bg-success/90 active:bg-success/80",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "min-h-9 px-3 text-xs",
        md: "min-h-11 px-4",
        lg: "min-h-14 px-6 text-base",
        icon: "size-11",
      },
      block: {
        true: "w-full",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  block,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
