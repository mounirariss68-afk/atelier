import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Logo from "./Logo";

const serviceLinks = [
  { href: "/services/agentic-ai-transformation", label: "Agentic AI Transformation" },
  { href: "/services/ai-driven-sdlc", label: "AI-Driven SDLC & Legacy Modernization" },
  { href: "/services/data-governance-foundations", label: "Data & Governance Foundations" },
  { href: "/services/ai-product-studio", label: "AI Product Studio" },
];

const insightLinks = [
  { href: "/insights?category=Agentic+AI", label: "Agentic AI" },
  { href: "/insights?category=Data+%26+Governance", label: "Data & Governance" },
  { href: "/insights?category=Legacy+Modernization", label: "Legacy Modernization" },
  { href: "/insights?category=Industry+Trends", label: "Industry Trends" },
];

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  const isActive = (path: string) => location.startsWith(path);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? "bg-[#0E2841]/98 shadow-xl backdrop-blur-sm" : "bg-[#0E2841]"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Logo */}
          <Link href="/" className="flex items-center group" aria-label="Maven AI">
            <Logo size="md" />
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-8">
            <Link href="/" className={`nav-link text-sm font-medium transition-colors ${location === "/" ? "text-[#F5A623]" : "text-gray-200 hover:text-white"}`}>
              Home
            </Link>
            <Link href="/about" className={`nav-link text-sm font-medium transition-colors ${isActive("/about") ? "text-[#F5A623]" : "text-gray-200 hover:text-white"}`}>
              About
            </Link>

            {/* Services Dropdown */}
            <div
              className="relative"
              onMouseEnter={() => setServicesOpen(true)}
              onMouseLeave={() => setServicesOpen(false)}
            >
              <button className={`nav-link text-sm font-medium transition-colors flex items-center gap-1 ${isActive("/services") ? "text-[#F5A623]" : "text-gray-200 hover:text-white"}`}>
                Services <ChevronDown size={14} className={`transition-transform ${servicesOpen ? "rotate-180" : ""}`} />
              </button>
              <AnimatePresence>
                {servicesOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-72 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden"
                  >
                    <div className="py-2">
                      {serviceLinks.map((link) => (
                        <Link key={link.href} href={link.href} className="block px-5 py-3 text-sm text-gray-700 hover:bg-gray-50 hover:text-[#156082] transition-colors font-medium">
                          {link.label}
                        </Link>
                      ))}
                      <div className="border-t border-gray-100 mt-1 pt-1">
                        <Link href="/services" className="block px-5 py-3 text-sm text-[#156082] font-semibold hover:bg-blue-50 transition-colors">
                          View All Services →
                        </Link>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Insights Dropdown */}
            <div
              className="relative"
              onMouseEnter={() => setInsightsOpen(true)}
              onMouseLeave={() => setInsightsOpen(false)}
            >
              <button className={`nav-link text-sm font-medium transition-colors flex items-center gap-1 ${isActive("/insights") ? "text-[#F5A623]" : "text-gray-200 hover:text-white"}`}>
                Insights <ChevronDown size={14} className={`transition-transform ${insightsOpen ? "rotate-180" : ""}`} />
              </button>
              <AnimatePresence>
                {insightsOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-56 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden"
                  >
                    <div className="py-2">
                      <Link href="/insights" className="block px-5 py-3 text-sm text-gray-700 hover:bg-gray-50 hover:text-[#156082] transition-colors font-medium">
                        All Insights
                      </Link>
                      {insightLinks.map((link) => (
                        <Link key={link.href} href={link.href} className="block px-5 py-3 text-sm text-gray-600 hover:bg-gray-50 hover:text-[#156082] transition-colors">
                          {link.label}
                        </Link>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <Link href="/industries" className={`nav-link text-sm font-medium transition-colors ${isActive("/industries") ? "text-[#F5A623]" : "text-gray-200 hover:text-white"}`}>
              Industries
            </Link>
            <Link href="/assessments" className={`nav-link text-sm font-medium transition-colors ${isActive("/assessments") ? "text-[#E97132]" : "text-gray-200 hover:text-white"}`}>
              Diagnostics
            </Link>
          </nav>

          {/* CTA */}
          <div className="hidden lg:flex items-center gap-3">
            <Link href="/assessments" className="border border-[#0F9ED5] text-[#0F9ED5] hover:bg-[#0F9ED5] hover:text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors">
              Free Assessment
            </Link>
            <Link href="/contact" className="bg-[#F5A623] hover:bg-[#d4622a] text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">
              Talk to Us
            </Link>
          </div>

          {/* Mobile Toggle */}
          <button
            className="lg:hidden text-white p-2"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="lg:hidden bg-[#0E2841] border-t border-white/10 overflow-hidden"
          >
            <div className="px-4 py-4 space-y-1">
              <Link href="/" className="block py-3 text-white font-medium border-b border-white/10">Home</Link>
              <Link href="/about" className="block py-3 text-white font-medium border-b border-white/10">About</Link>
              <div className="py-2 border-b border-white/10">
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-2">Services</p>
                {serviceLinks.map((link) => (
                  <Link key={link.href} href={link.href} className="block py-2 pl-3 text-gray-300 text-sm hover:text-white">{link.label}</Link>
                ))}
              </div>
              <div className="py-2 border-b border-white/10">
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-2">Insights</p>
                <Link href="/insights" className="block py-2 pl-3 text-gray-300 text-sm hover:text-white">All Insights</Link>
              </div>
              <Link href="/industries" className="block py-3 text-white font-medium border-b border-white/10">Industries</Link>
              <Link href="/assessments" className="block py-3 text-white font-medium border-b border-white/10">Diagnostics</Link>
              <div className="pt-3 space-y-2">
                <Link href="/assessments" className="block text-center border border-[#0F9ED5] text-[#0F9ED5] font-semibold py-3 rounded-lg">
                  Free Assessment
                </Link>
                <Link href="/contact" className="block text-center bg-[#F5A623] text-white font-semibold py-3 rounded-lg">
                  Talk to Us
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
