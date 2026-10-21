import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/utils/cn";

// Status colors from the ZKsync web-app guide: success / warning / error / info / neutral.
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 font-semibold text-xs leading-5 [&_svg]:size-3.5",
  {
    variants: {
      variant: {
        neutral: "border-slate-300 bg-slate-100 text-slate-800",
        success: "border-green-800 bg-green-800 text-white",
        // Light, for a status repeated down a table (a member's signature).
        successSoft: "border-green-300 bg-green-50 text-green-900",
        warning: "border-amber-400 bg-amber-100 text-amber-950",
        error: "border-red-800 bg-red-800 text-white",
        errorSoft: "border-red-300 bg-red-50 text-red-900",
        info: "border-brand-700 bg-brand-700 text-white",
        navy: "border-navy-800 bg-navy-800 text-white",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
