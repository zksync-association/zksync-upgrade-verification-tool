import { getZkGovOpsProposals } from "@/.server/service/l2-governor-proposals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { $path } from "remix-routes";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "@radix-ui/react-icons";
import { Link } from "@remix-run/react";

export async function loader() {
  await getZkGovOpsProposals();
  return null
}

export default function L2Proposals() {
  return (
    <Card className="pb-10">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Active L2 Veto Proposals</CardTitle>
          <Link to={$path("/app/l2-governor-proposals/new")}>
            <Button data-testid="new-emergency-proposal" variant="secondary" size="icon">
              <PlusIcon className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
      </CardContent>
    </Card>
  );
}
