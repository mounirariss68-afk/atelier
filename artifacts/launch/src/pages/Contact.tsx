import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import ContactSection from "@/components/ContactSection";

const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`;

export default function Contact() {
  return (
    <div className="relative min-h-screen bg-navy overflow-x-hidden">
      {/* ===== Nav ===== */}
      <nav className="relative z-50 py-5">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <img src={asset("images/cognirise-logo.png")} alt="Cognirise" className="h-9 md:h-10 w-auto" />
          </Link>
          <Link href="/" className="group inline-flex items-center gap-2 text-sm text-offwhite/75 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" /> Back to home
          </Link>
        </div>
      </nav>

      <ContactSection />
    </div>
  );
}
