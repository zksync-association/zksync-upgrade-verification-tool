import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils/cn";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border-2 border-transparent font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-slate-600 disabled:bg-slate-200 disabled:text-slate-700 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-brand-700 bg-brand-600 text-white hover:border-navy-800 hover:bg-brand-700 active:bg-navy-800",
        secondary:
          "border-navy-800 bg-navy-800 text-white hover:border-brand-700 hover:bg-brand-700 active:border-brand-600 active:bg-brand-600",
        outline:
          "border-slate-600 bg-white text-slate-950 hover:border-navy-800 hover:bg-slate-100",
        ghost:
          "border-slate-600 bg-slate-75 text-navy-800 hover:border-navy-800 hover:bg-slate-100",
        destructive: "border-red-900 bg-red-800 text-white hover:bg-red-900",
        link: "rounded-none border-0 px-0 text-brand-700 underline underline-offset-4",
      },
      size: {
        default: "h-11 px-5 text-sm sm:h-10",
        sm: "h-11 px-3.5 text-[13px] sm:h-9",
        lg: "h-12 px-6 text-base",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    if (asChild) {
      return (
        <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
          {children}
        </Comp>
      );
    }
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && <Loader2 className="animate-spin" />}
        {children}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
