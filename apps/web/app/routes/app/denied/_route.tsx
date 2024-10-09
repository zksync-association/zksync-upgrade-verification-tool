import { Card } from "@/components/ui/card";
import denied from "@/images/denied.svg";
import { Meta } from "@/utils/meta";

export const meta = Meta["/app/denied"];

export default function Denied() {
  return (
    <Card className="flex flex-col items-center space-y-4 p-14 py-20">
      <img src={denied} alt="Access denied" />
      <h2 className="font-bold text-4xl">Access Denied</h2>
      <p>The wallet you connected is not whitelisted to vote on upgrade proposals.</p>
      <p>Please go back...</p>
    </Card>
  );
}
