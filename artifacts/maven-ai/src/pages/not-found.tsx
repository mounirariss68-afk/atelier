import { Link } from "wouter";
import { ArrowRight } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#F8F9FA] pt-20">
      <div className="text-center max-w-lg mx-auto px-6">
        <p className="text-[#E97132] font-semibold text-sm uppercase tracking-widest mb-4">404 — Page not found</p>
        <h1 className="text-5xl font-extrabold text-[#0E2841] mb-5 leading-tight">
          This page doesn't exist.
        </h1>
        <p className="text-gray-600 text-lg mb-10 leading-relaxed">
          The page you're looking for may have moved or never existed. Let's get you back on track.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href="/" className="inline-flex items-center gap-2 bg-[#0E2841] hover:bg-[#156082] text-white font-bold px-7 py-3 rounded-xl text-sm transition-colors">
            Back to home <ArrowRight size={16} />
          </Link>
          <Link href="/contact" className="inline-flex items-center gap-2 border border-[#156082] text-[#156082] hover:bg-[#156082] hover:text-white font-semibold px-7 py-3 rounded-xl text-sm transition-colors">
            Contact us <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}
