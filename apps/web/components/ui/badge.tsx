import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-5 items-center whitespace-nowrap rounded px-1.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-linear-lime text-linear-black",
        success: "bg-linear-emerald/15 text-[#77df8d]",
        warning: "bg-linear-lime/15 text-linear-lime",
        danger: "bg-linear-red/15 text-[#ff8585]",
        neutral: "bg-linear-gunmetal text-linear-storm",
        dark: "bg-linear-charcoal text-linear-steel"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
