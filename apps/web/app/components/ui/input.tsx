import * as React from "react";

import { cn } from "@/utils/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-[10px] border-[1.5px] border-slate-300 bg-white px-3.5 py-2 text-[15px] text-slate-950 transition-[border-color,box-shadow] file:border-0 file:bg-transparent file:font-medium file:text-sm placeholder:text-slate-600 focus-visible:border-brand-600 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-600/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-600",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
