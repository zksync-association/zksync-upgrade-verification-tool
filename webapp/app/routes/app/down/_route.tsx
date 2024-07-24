import { Card } from "@/components/ui/card";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

export default function ConnectionFailed() {
  return (
    <Card className="mt-10 flex flex-col items-center space-y-4 p-14 py-20">
      <ExclamationTriangleIcon width={134} height={134} />

      <h2 className="font-bold text-4xl">ConnectionFailed</h2>
      <p>Server's connection to BlockChain cannot be made.</p>
      <p>Please try again later.</p>
    </Card>
  );
}
