import React from "react";
import { Button, type ButtonProps } from "./ui/button";
import { CirclePlus } from "lucide-react";

const AddButton = React.forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "asChild"> & {
    icon?: React.ReactNode;
  }
>(
  (
    {
      children,
      size = "sm",
      variant = "success",
      icon = <CirclePlus className="mr-2 h-4 w-4" />,
      ...props
    },
    ref
  ) => {
    return (
      <Button ref={ref} size={size} variant={variant} {...props}>
        {icon}
        {children}
      </Button>
    );
  }
);
AddButton.displayName = "AddButton";

export default AddButton;
