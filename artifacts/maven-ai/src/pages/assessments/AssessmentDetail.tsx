import { useRoute } from "wouter";
import { getAssessment, type AssessmentSlug } from "@workspace/assessments";
import AssessmentWizard from "@/components/assessment/AssessmentWizard";
import NotFound from "../not-found";

export default function AssessmentDetail() {
  const [, params] = useRoute("/assessments/:slug");
  const slug = params?.slug;
  if (!slug || !["ari", "mvi", "dafi", "uvr"].includes(slug)) return <NotFound />;
  const def = getAssessment(slug as AssessmentSlug);
  return <AssessmentWizard def={def} />;
}
