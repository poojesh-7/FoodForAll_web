"use client";

import { useState } from "react";

type ModerationActionsProps = {
  onApprove: () => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  disabled?: boolean;
};

export default function ModerationActions({
  onApprove,
  onReject,
  disabled = false,
}: ModerationActionsProps) {
  const [reason, setReason] = useState("");

  const reject = async () => {
    await onReject(reason.trim() || "Rejected by admin");
    setReason("");
  };

  return (
    <div className="space-y-2">
      <textarea
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Rejection reason"
        className="min-h-20 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onApprove}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={reject}
          className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
