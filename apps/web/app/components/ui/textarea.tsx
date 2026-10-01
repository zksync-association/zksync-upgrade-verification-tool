import * as React from "react";

import { cn } from "@/utils/cn";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-[10px] border-[1.5px] border-slate-200 bg-white px-3.5 py-2.5 text-slate-950 text-sm transition-[border-color,box-shadow] placeholder:text-slate-400 focus-visible:border-brand-600 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-600/10 disabled:cursor-not-allowed disabled:bg-slate-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
