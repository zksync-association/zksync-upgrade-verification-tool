import * as React from "react";
import { useId } from "react";
import { Form as RemixForm } from "@remix-run/react";
import { cn } from "@/utils/cn";
import { Label } from "./label";
import { Input } from "./input";
import { Textarea } from "./textarea";

const Form = React.forwardRef<HTMLFormElement, React.ComponentPropsWithoutRef<typeof RemixForm>>(
  ({ className, ...props }, ref) => (
    <RemixForm ref={ref} className={cn("space-y-4", className)} {...props} />
  )
);
Form.displayName = "Form";

const FormItemContext = React.createContext<{ name: string; id: string }>({ name: "", id: "" });

const FormItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { name: string }
>(({ className, name, ...props }, ref) => {
  const id = useId();
  return (
    <FormItemContext.Provider value={{ name, id }}>
      <div ref={ref} className={cn("flex flex-col space-y-2", className)} {...props} />
    </FormItemContext.Provider>
  );
});
FormItem.displayName = "FormItem";

const FormLabel = React.forwardRef<
  React.ElementRef<typeof Label>,
  Omit<React.ComponentPropsWithoutRef<typeof Label>, "htmlFor">
>(({ className, ...props }, ref) => {
  const { id } = React.useContext(FormItemContext);
  return <Label ref={ref} className={cn(className)} htmlFor={id} {...props} />;
});
FormLabel.displayName = "FormLabel";

const FormInput = React.forwardRef<
  React.ElementRef<typeof Input>,
  Omit<React.ComponentPropsWithoutRef<typeof Input>, "id" | "name">
>(({ className, ...props }, ref) => {
  const { name, id } = React.useContext(FormItemContext);
  return <Input ref={ref} className={cn(className)} id={id} name={name} {...props} />;
});
FormInput.displayName = "FormInput";

const FormTextarea = React.forwardRef<
  React.ElementRef<typeof Textarea>,
  Omit<React.ComponentPropsWithoutRef<typeof Textarea>, "id" | "name">
>(({ className, ...props }, ref) => {
  const { name, id } = React.useContext(FormItemContext);
  return <Textarea ref={ref} className={cn(className)} id={id} name={name} {...props} />;
});
FormTextarea.displayName = "FormTextarea";

const FormDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => {
  return <p ref={ref} className={cn("text-muted-foreground text-sm", className)} {...props} />;
});
FormDescription.displayName = "FormDescription";

const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-red-500 text-sm", className)} {...props} />
));
FormMessage.displayName = "FormError";

export { Form, FormItem, FormLabel, FormInput, FormDescription, FormMessage, FormTextarea };
