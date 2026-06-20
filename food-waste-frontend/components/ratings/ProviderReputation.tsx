import ReviewSummary from "@/components/ratings/ReviewSummary";
import type { ProviderRatingSummary } from "@shared/contracts/api-contracts";

type ProviderReputationProps = {
  summary: ProviderRatingSummary | null;
};

export default function ProviderReputation({ summary }: ProviderReputationProps) {
  return <ReviewSummary summary={summary} variant="panel" showDimensions />;
}
