import { Transition } from "@headlessui/react";
import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

import Loading from "@/components/ui/loading";
import { cn } from "@/utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:pointer-events-none disabled:bg-gray-600 drop-shadow-md",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-foreground hover:bg-background/70 hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-10 py-6",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
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
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }), "relative overflow-hidden")}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        <Transition show={loading ?? false} unmount={false}>
          <div className="data-[leave]:data-[closed]:-translate-y-full absolute transition ease-in-out data-[enter]:data-[closed]:translate-y-full data-[closed]:opacity-0">
            <Loading className="h-6 w-6" />
          </div>
        </Transition>
        <Transition show={!loading}>
          <div
            className={cn(
              "data-[leave]:data-[closed]:-translate-y-full inline-flex items-center justify-center transition ease-in-out data-[enter]:data-[closed]:translate-y-full data-[closed]:opacity-0",
              className
            )}
          >
            {children}
          </div>
        </Transition>
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
