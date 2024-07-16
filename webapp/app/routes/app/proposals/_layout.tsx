import { Button } from "@/components/ui/button";
import { displayBytes32 } from "@/routes/app/proposals/$id/common-tables";
import { Outlet, useNavigate, useParams } from "@remix-run/react";
import { ArrowLeft } from "lucide-react";

export default function Layout() {
  const params = useParams();
  const navigate = useNavigate();

  return (
    <div className="mt-10 flex flex-1 flex-col">
      <div className="mb-4 flex items-center pl-2">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => navigate(-1)}
          className="mr-2 hover:bg-transparent"
        >
          <ArrowLeft />
        </Button>
        <h2 className="font-semibold">Proposal {displayBytes32(params.id ?? "")}</h2>
      </div>
      <Outlet />
    </div>
  );
}
