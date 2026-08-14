import OperationalFeedbackBlock from "@/components/OperationalFeedbackBlock";

type NGOStateBlockProps = {
  title: string;
  description?: string;
  tone?: "neutral" | "error" | "success";
};

export default function NGOStateBlock({
  title,
  description,
  tone = "neutral",
}: NGOStateBlockProps) {
  return (
    <OperationalFeedbackBlock
      title={title}
      description={description}
      tone={tone}
    />
  );
}
