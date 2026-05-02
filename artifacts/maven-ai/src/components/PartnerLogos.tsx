import { motion } from "framer-motion";
import { FaMicrosoft, FaAws } from "react-icons/fa";
import {
  SiGooglecloud,
  SiAnthropic,
  SiSnowflake,
  SiDatabricks,
  SiGithub,
  SiLangchain,
  SiOpenai,
  SiNvidia,
} from "react-icons/si";
import type { IconType } from "react-icons";

type Partner = {
  name: string;
  Icon?: IconType;
  wordmark?: string;
};

const partners: Partner[] = [
  { name: "Microsoft", Icon: FaMicrosoft },
  { name: "Google Cloud", Icon: SiGooglecloud },
  { name: "AWS", Icon: FaAws },
  { name: "Anthropic", Icon: SiAnthropic },
  { name: "OpenAI", Icon: SiOpenai },
  { name: "NVIDIA", Icon: SiNvidia },
  { name: "Snowflake", Icon: SiSnowflake },
  { name: "Databricks", Icon: SiDatabricks },
  { name: "LangChain", Icon: SiLangchain },
  { name: "GitHub", Icon: SiGithub },
  { name: "Thoughtworks", wordmark: "thoughtworks" },
  { name: "G42", wordmark: "G42" },
];

interface PartnerLogosProps {
  variant?: "light" | "dark";
  showHeading?: boolean;
}

export default function PartnerLogos({ variant = "light", showHeading = true }: PartnerLogosProps) {
  const isDark = variant === "dark";
  const bgClass = isDark ? "bg-[#0E2841]" : "bg-white";
  const headingColor = isDark ? "text-white" : "text-[#0E2841]";
  const subColor = isDark ? "text-gray-400" : "text-gray-600";
  const eyebrowColor = isDark ? "text-[#F5A623]" : "text-[#F5A623]";
  const logoColor = isDark ? "text-gray-300" : "text-gray-500";
  const logoHover = isDark ? "hover:text-white" : "hover:text-[#0E2841]";
  const tileBg = isDark ? "bg-white/5" : "bg-gray-50/60";

  return (
    <section className={`py-20 ${bgClass}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {showHeading && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-12"
          >
            <div className={`text-xs font-bold uppercase tracking-[0.25em] mb-3 ${eyebrowColor}`}>
              Platform Partners
            </div>
            <h2 className={`text-3xl sm:text-4xl font-extrabold mb-4 ${headingColor}`}>
              Built on the platforms that ship enterprise AI.
            </h2>
            <p className={`max-w-2xl mx-auto ${subColor}`}>
              We are platform-agnostic by design. We deliver on the stack the client picks, with deep
              expertise across hyperscalers, foundation models, and the agentic and data tooling that
              powers production AI.
            </p>
          </motion.div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-px rounded-2xl overflow-hidden border border-gray-200/80"
          style={{ backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(229,231,235,1)" }}>
          {partners.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.04, duration: 0.4 }}
              className={`${tileBg} ${logoColor} ${logoHover} flex items-center justify-center h-24 transition-colors duration-300`}
              title={p.name}
              aria-label={p.name}
            >
              {p.Icon ? (
                <p.Icon size={36} aria-hidden="true" />
              ) : (
                <span
                  className="font-bold text-lg tracking-tight"
                  style={{
                    fontFamily: "'Anton', 'Impact', 'Arial Narrow', sans-serif",
                    letterSpacing: "0.02em",
                  }}
                >
                  {p.wordmark}
                </span>
              )}
            </motion.div>
          ))}
        </div>

        <p className={`text-center text-xs mt-6 ${subColor}`}>
          Plus deep partnerships with regional sovereign cloud providers and specialist data &amp; agentic platforms.
        </p>
      </div>
    </section>
  );
}
