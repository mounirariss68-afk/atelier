import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { getAssessment, type AssessmentSlug } from "@workspace/assessments";
import { fetchTeamLink } from "@/lib/api";
import AssessmentWizard from "@/components/assessment/AssessmentWizard";
import { useLang, tStr } from "@/lib/lang";

export default function TeamAssessment() {
  const [, params] = useRoute("/assessments/team/:token");
  const token = params?.token;
  const { lang, dir } = useLang();
  const [info, setInfo] = useState<{ slug: string; company: string; initiatorName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetchTeamLink(token)
      .then(setInfo)
      .catch(() => setError("not-found"));
  }, [token]);

  if (!token || error) {
    return (
      <div className="pt-32 pb-16 text-center">
        <p className="text-gray-500">{tStr({ en: "Invitation not found.", ar: "الدعوة غير موجودة.", tr: "Davet bulunamadı." }, lang)}</p>
      </div>
    );
  }
  if (!info) return <div className="pt-32 text-center text-gray-500">{tStr({ en: "Loading…", ar: "جارٍ التحميل…", tr: "Yükleniyor…" }, lang)}</div>;

  const def = getAssessment(info.slug as AssessmentSlug);
  return (
    <div dir={dir}>
      <div className="pt-20">
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 text-sm text-amber-900">
            <strong>{info.initiatorName}</strong>{" "}
            {tStr(
              {
                en: `at ${info.company} invited you to share your view on this diagnostic.`,
                ar: `في ${info.company} دعاك لمشاركة رأيك في هذا التشخيص.`,
                tr: `${info.company} firmasından bu teşhis hakkındaki görüşünüzü paylaşmanız için sizi davet etti.`,
              },
              lang,
            )}
          </div>
        </div>
        <AssessmentWizard def={def} teamToken={token} />
      </div>
    </div>
  );
}
