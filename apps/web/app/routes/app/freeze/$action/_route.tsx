import { freshAfter } from "@/.server/flows/common";
import { type FreezeDetail, loadFreezeRequest } from "@/.server/flows/freeze";
import { parseFreezeParams } from "@/.server/params";
import { suppliedSignatures } from "@/.server/request";
import { pageLoad } from "@/.server/sync/presence";
import { FREEZE_LABELS } from "@/common/freeze";
import { FREEZE_STATUS_LABELS } from "@/common/upgrade-states";
import { useStatus } from "@/components/app-shell";
import { Facts, LoadingCard, PageHeader } from "@/components/page";
import { SetStateBadge } from "@/components/verification/badges";
import { SignatureSetCard } from "@/components/verification/signature-set";
import { UntilFresh } from "@/components/verification/until-fresh";
import { formatTime, relativeTime } from "@/utils/format";
import { Meta } from "@/utils/meta";
import { type LoaderFunctionArgs, type SerializeFrom, defer } from "@remix-run/node";
import { Await, useLoaderData } from "@remix-run/react";
import { Suspense } from "react";
import { $path } from "remix-routes";

export const meta = Meta["/app/freeze/:action"];

export function loader({ params, request }: LoaderFunctionArgs) {
  const freeze = parseFreezeParams(params.action, new URL(request.url));
  // The signatures' first answer at once (possibly from an older block or older Safe copies,
  // labelled), and the strict result after it in the same response. The set's key joins the page
  // load's grace once it is found.
  const loading = pageLoad(request).run(() =>
    loadFreezeRequest(freeze, { supplied: suppliedSignatures(request), freshness: "page" })
  );
  return defer({
    freeze,
    detail: loading.first,
    fresh: freshAfter(loading.first, loading.fresh, (d) => d.set.stale === true),
  });
}

export default function FreezePage() {
  const { freeze, detail } = useLoaderData<typeof loader>();
  return (
    <Suspense
      fallback={
        <>
          <PageHeader
            back={{ to: $path("/app/freeze"), label: "Freeze requests" }}
            eyebrow="Freeze request"
            title={FREEZE_LABELS[freeze.action]}
          />
          <LoadingCard label="Checking Security Council signatures on-chain…" />
        </>
      }
    >
      <Await resolve={detail}>{(d) => <Detail detail={d} />}</Await>
    </Suspense>
  );
}

function Detail({ detail: d }: { detail: SerializeFrom<FreezeDetail> }) {
  const { governance } = useStatus();
  const { fresh } = useLoaderData<typeof loader>();
  const sc = governance.securityCouncil;
  const p = d.params;
  const currentNonce = {
    SoftFreeze: sc.nonces.softFreeze,
    HardFreeze: sc.nonces.hardFreeze,
    Unfreeze: sc.nonces.unfreeze,
    SetSoftFreezeThreshold: sc.nonces.setSoftFreezeThreshold,
  }[p.action];
  return (
    <div className="space-y-8">
      <PageHeader
        back={{ to: $path("/app/freeze"), label: "Freeze requests" }}
        eyebrow="Freeze request"
        title={`${FREEZE_LABELS[p.action]}${p.action === "SetSoftFreezeThreshold" ? ` to ${p.threshold}` : ""}`}
        badges={<SetStateBadge state={d.state} />}
      />
      <Facts
        items={[
          {
            label: "Nonce",
            value: `${p.nonce} (the contract's next ${FREEZE_LABELS[p.action].toLowerCase()} nonce is ${currentNonce})`,
          },
          {
            label: "Valid until",
            value: `${formatTime(p.validUntil)} · ${relativeTime(p.validUntil, governance.latestBlock.timestamp)} · validUntil = ${p.validUntil}`,
          },
          ...(p.action === "SetSoftFreezeThreshold"
            ? [
                {
                  label: "Soft-freeze threshold",
                  value: `${sc.thresholds.softFreeze} now → ${p.threshold}`,
                },
              ]
            : []),
          {
            label: "Protocol",
            value: FREEZE_STATUS_LABELS[governance.freeze.lastFreezeStatus] ?? "Unknown",
          },
        ]}
      />
      <UntilFresh stale={d.set.stale === true} fresh={fresh}>
        {(current, refresh) => {
          const v = current ?? d;
          return (
            <SignatureSetCard
              testId="set-freeze"
              title="Security Council signatures"
              set={v.set}
              state={v.state}
              execution={v.execution}
              executionToLabel="SecurityCouncil"
              refresh={current ? null : refresh}
            />
          );
        }}
      </UntilFresh>
    </div>
  );
}
