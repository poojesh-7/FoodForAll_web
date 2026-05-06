type VolunteerSummaryCardProps = {
  label: string;
  value: string | number;
  detail?: string;
};

export default function VolunteerSummaryCard({
  label,
  value,
  detail,
}: VolunteerSummaryCardProps) {
  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-zinc-600">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-950">{value}</p>
      {detail && <p className="mt-1 text-sm text-zinc-500">{detail}</p>}
    </article>
  );
}
