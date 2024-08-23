import { Card } from "@/components/ui/card";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

export default function ConnectionFailed() {
  return (
    <Card className="flex flex-col items-center space-y-4 p-14 py-20">
      <ExclamationTriangleIcon width={134} height={134} />

      <h2 className="font-bold text-4xl">Connection Failed</h2>
      <p>The server has been disconnected from the blockchain.</p>
      <p>Please try again later.</p>
    </Card>
  );
}
