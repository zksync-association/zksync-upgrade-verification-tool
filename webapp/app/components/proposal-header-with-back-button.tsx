import { cn } from "@/utils/cn";
import { useNavigate } from "@remix-run/react";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./ui/button";

export default function HeaderWithBackButton({
  children,
  className,
}: { children?: ReactNode; className?: string }) {
  const navigate = useNavigate();

  return (
    <div className={cn("flex items-center pb-4 pl-2", className)}>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => navigate(-1)}
        className="mr-2 hover:bg-transparent"
      >
        <ArrowLeft />
      </Button>
      <h2 className="font-semibold">{children}</h2>
    </div>
  );
}
