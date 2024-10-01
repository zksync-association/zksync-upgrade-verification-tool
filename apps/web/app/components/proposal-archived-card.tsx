export default function ProposalArchivedCard({
  archivedOn,
  archivedReason,
  archivedBy,
}: {
  archivedOn: Date;
  archivedReason: string;
  archivedBy: string;
}) {
  return (
    <div className="flex flex-col space-y-6 rounded-sm p-2 text-red-500">
      <div className="flex justify-between">
        <span>Archived On:</span>
        <div className="flex w-3/4 flex-col break-words text-right">
          <span>{new Date(archivedOn ?? 0).toLocaleDateString()}</span>
          <span>{new Date(archivedOn ?? 0).toLocaleTimeString()}</span>
        </div>
      </div>
      <div className="flex justify-between">
        <span>Archived Reason:</span>
        <span className="w-4/5 justify-end break-words text-right">{archivedReason}</span>
      </div>
      <div className="flex justify-between">
        <span>Archived By:</span>
        <span className="w-4/5 justify-end break-words text-right">{archivedBy}</span>
      </div>
    </div>
  );
}
