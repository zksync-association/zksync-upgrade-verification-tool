import { PROPOSAL_STATES, StatusTime } from "@/utils/proposal-states";

export type ProposalStateProps = {
  status: PROPOSAL_STATES,
  times: StatusTime | null
}

export default function ProposalState({ status, times }: ProposalStateProps) {
  let color: string;
  let label: string;

  const timeData = times ? `(day ${times.currentDay} out of ${times.totalDays})` : "";

  switch (status) {
    case PROPOSAL_STATES.None:
      color = "text-red-400";
      label = "NONE";
      break;
    case PROPOSAL_STATES.LegalVetoPeriod:
      color = "text-yellow-400";
      label = "LEGAL VETO PERIOD";
      break;
    case PROPOSAL_STATES.Waiting:
      color = "text-yellow-400";
      label = "WAITING";
      break;
    case PROPOSAL_STATES.ExecutionPending:
      color = "text-yellow-400";
      label = "EXECUTION PENDING";
      break;
    case PROPOSAL_STATES.Ready:
      color = "text-green-400";
      label = "READY";
      break;
    case PROPOSAL_STATES.Expired:
      color = "text-red-400";
      label = "EXPIRED";
      break;
    case PROPOSAL_STATES.Done:
      color = "text-green-400";
      label = "DONE";
      break;
  }

  return (
    <p className={color}>
      {label} {timeData}
    </p>
  );
}