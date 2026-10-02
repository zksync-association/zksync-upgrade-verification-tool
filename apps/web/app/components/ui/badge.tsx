import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/utils/cn";

// Status colors from the ZKsync web-app guide: success / warning / error / info / neutral.
const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-medium text-xs leading-5 [&_svg]:size-3.5",
  {
    variants: {
      variant: {
        neutral: "border-slate-200 bg-slate-50 text-slate-700",
        success: "border-green-200 bg-green-50 text-green-700",
        warning: "border-amber-200 bg-amber-50 text-amber-700",
        error: "border-red-200 bg-red-50 text-red-700",
        info: "border-brand-100 bg-brand-50 text-brand-600",
        navy: "border-navy-100 bg-navy-50 text-navy-800",
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
