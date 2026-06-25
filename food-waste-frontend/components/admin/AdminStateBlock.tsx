type AdminStateBlockProps = {
  title: string;
  description?: string;
  tone?: "neutral" | "error" | "warning" | "success" | "danger";
};

export default function AdminStateBlock({
  title,
  description,
  tone = "neutral",
}: AdminStateBlockProps) {
  return (
    <div
      className={`rounded-lg border p-4 text-sm shadow-sm ${
        tone === "error" || tone === "danger"
          ? "border-red-200 bg-red-50 text-red-700"
          : tone === "warning"
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-zinc-200 bg-white text-zinc-700"
      }`}
    >
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 text-sm opacity-80">{description}</p>}
    </div>
  );
}
