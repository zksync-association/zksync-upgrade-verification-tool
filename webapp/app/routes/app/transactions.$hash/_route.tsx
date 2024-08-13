import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Loading from "@/components/ui/loading";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { displayBytes32 } from "@/routes/app/proposals/$id/common-tables";
import { getTransactionUrl } from "@/utils/etherscan";
import { capitalizeFirstLetter } from "@/utils/string";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import { ArrowLeft, CircleCheckBig, SquareArrowOutUpRight } from "lucide-react";
import { type Hex, formatEther, formatGwei } from "viem";
import { useWaitForTransactionReceipt } from "wagmi";
import { json } from "@remix-run/node";
import { env } from "@config/env.server";

export async function loader() {
  return json({ ethNetwork: env.ETH_NETWORK })
}

export default function Transactions() {
  const params = useParams();
  const navigate = useNavigate();
  const { ethNetwork } = useLoaderData<typeof loader>()
  const { data, isLoading, isSuccess } = useWaitForTransactionReceipt({ hash: params.hash as Hex });

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
        <h2 className="font-semibold">Go back</h2>
      </div>

      <Card className="flex flex-1 flex-col">
        <CardHeader>
          <CardTitle className="flex">
            Transaction
            <a
              href={getTransactionUrl(params.hash as Hex, ethNetwork)}
              className="ml-2 flex items-center hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              <span>{displayBytes32(params.hash ?? "")}</span>
              <SquareArrowOutUpRight className="ml-1" width={12} height={12} />
            </a>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col">
          {isLoading && (
            <div className="flex flex-1 flex-col items-center justify-center space-y-8">
              <Loading className="h-24 w-24" />
              <h2>Waiting for transaction...</h2>
            </div>
          )}
          {isSuccess && data && (
            <div className="flex flex-1 flex-col items-center">
              <div className="mt-10 flex flex-col items-center space-y-4">
                <CircleCheckBig className="h-24 w-24 stroke-green-500" />
                <h2 className="text-green-400">Transaction successful</h2>
              </div>
              <Table className="mt-4">
                <TableHeader>
                  <TableRow>
                    <TableHead>Detail</TableHead>
                    <TableHead>Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>Transaction Hash</TableCell>
                    <TableCell>{data.transactionHash}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Status</TableCell>
                    <TableCell>{capitalizeFirstLetter(data.status)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Block</TableCell>
                    <TableCell>{data.blockNumber.toString()}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>From</TableCell>
                    <TableCell>{data.from}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>To</TableCell>
                    <TableCell>{data.to}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Transaction Fee</TableCell>
                    <TableCell>{formatEther(data.gasUsed * data.effectiveGasPrice)} ETH</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Gas Price</TableCell>
                    <TableCell>{formatGwei(data.effectiveGasPrice)} Gwei</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
