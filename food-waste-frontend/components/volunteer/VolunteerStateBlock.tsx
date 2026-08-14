import OperationalFeedbackBlock from "@/components/OperationalFeedbackBlock";

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
  return (
    <OperationalFeedbackBlock
      title={title}
      description={description}
      tone={tone}
    />
  );
}
