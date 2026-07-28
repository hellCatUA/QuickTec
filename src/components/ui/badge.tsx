import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        neutral: "bg-muted text-muted-foreground",
        primary:
          "bg-primary/15 text-primary ring-1 ring-inset ring-primary/30",
        success:
          "bg-success/15 text-success ring-1 ring-inset ring-success/30",
        warning:
          "bg-warning/15 text-warning ring-1 ring-inset ring-warning/30",
        danger: "bg-danger/15 text-danger ring-1 ring-inset ring-danger/30",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
