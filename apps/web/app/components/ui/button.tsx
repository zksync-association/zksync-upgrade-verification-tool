import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils/cn";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-600/20 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-brand-600 text-white hover:bg-brand-500 active:bg-brand-700",
        secondary:
          "border border-brand-600/25 bg-brand-600/5 font-normal text-brand-600 hover:bg-brand-600/10",
        outline: "border border-slate-200 bg-white text-slate-950 hover:bg-slate-50",
        ghost: "font-medium text-slate-700 hover:bg-slate-75 hover:text-slate-950",
        destructive: "bg-red-600 text-white hover:bg-red-700",
        link: "rounded-none px-0 font-medium text-brand-600 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 text-sm",
        sm: "h-8 px-3.5 text-[13px]",
        lg: "h-12 px-6 text-base",
        icon: "h-9 w-9",
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
