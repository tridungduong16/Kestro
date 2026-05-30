import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-linear-lime focus-visible:ring-offset-2 focus-visible:ring-offset-linear-black disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-linear-lime text-linear-black hover:bg-[#f0ff3a]",
        secondary: "bg-linear-ash text-linear-porcelain hover:bg-linear-gunmetal",
        outline: "border border-linear-charcoal bg-transparent text-linear-steel hover:bg-linear-slate hover:text-linear-porcelain",
        ghost: "text-linear-storm hover:bg-linear-slate hover:text-linear-porcelain",
        danger: "bg-linear-red text-linear-porcelain hover:bg-[#ff6666]",
        dark: "bg-linear-slate text-linear-porcelain hover:bg-linear-charcoal"
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-5",
        icon: "h-8 w-8"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
