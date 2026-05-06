type VolunteerStateBlockProps = {
  title: string;
  description?: string;
  tone?: "neutral" | "error" | "success";
};

export default function VolunteerStateBlock({
  title,
  description,
  tone = "neutral",
}: VolunteerStateBlockProps) {
  const toneClass =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-zinc-200 bg-white text-zinc-600";

  return (
    <div className={`rounded-lg border p-5 text-sm shadow-sm ${toneClass}`}>
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 opacity-90">{description}</p>}
    </div>
  );
}
