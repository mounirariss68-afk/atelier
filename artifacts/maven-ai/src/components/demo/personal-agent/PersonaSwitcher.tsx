/**
 * Persona + language switcher used across both Personal Agent demos.
 *
 * Sales (Mariam · Atlas) ↔ HR (Yusuf · Ember), and EN/AR/TR cycling.
 * Lives in its own file so the Cockpit and the Mind don't drift apart.
 */
import { Languages, Users } from "lucide-react";
import { Link } from "wouter";
import { useLang, tStr, type Lang } from "@/lib/lang";
import { PERSONAS, type Persona } from "@/data/personal-agent-seed";

const LANG_CYCLE: Lang[] = ["en", "ar", "tr"];
const LANG_LABEL: Record<Lang, string> = { en: "EN", ar: "العربية", tr: "TR" };

interface Props {
  personaId: Persona["id"];
  onPersona: (id: Persona["id"]) => void;
  /** Optional cross-link to the other demo variant. */
  otherVariant?: { route: "cockpit" | "mind"; label: { en: string; ar: string; tr?: string } };
  accent: string;
}

export default function PersonaSwitcher({ personaId, onPersona, otherVariant, accent }: Props) {
  const { lang, setLang } = useLang();
  const next = LANG_CYCLE[(LANG_CYCLE.indexOf(lang) + 1) % LANG_CYCLE.length];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-1 rounded-full bg-white/10 p-1 text-xs">
        <Users size={12} className="ml-2 text-white/70" />
        {PERSONAS.map((p) => {
          const active = p.id === personaId;
          return (
            <button
              key={p.id}
              onClick={() => onPersona(p.id)}
              className={`px-3 py-1.5 rounded-full font-bold transition-colors ${active ? "text-[#0E2841]" : "text-white/80 hover:text-white"}`}
              style={active ? { background: accent } : undefined}
            >
              {p.agentName} · {tStr(p.role, lang).split(" · ")[0]}
            </button>
          );
        })}
      </div>
      <button
        onClick={() => setLang(next)}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/10 text-white text-xs font-bold hover:bg-white/20"
        title={`Switch language → ${LANG_LABEL[next]}`}
      >
        <Languages size={12} />
        {LANG_LABEL[lang]}
      </button>
      {otherVariant && (
        <Link
          href={`/demo/maven-personal-agent/${otherVariant.route}`}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full border border-white/20 text-white text-xs font-bold hover:bg-white/10"
        >
          {tStr(otherVariant.label, lang)} →
        </Link>
      )}
    </div>
  );
}
