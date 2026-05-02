import { Link } from "wouter";
import { Linkedin, Twitter, Mail, MapPin, Phone } from "lucide-react";
import Logo from "./Logo";

const offices = [
  { city: "Dubai", country: "UAE", address: "Jumeirah Lakes Towers, Cluster Y\nSwiss Tower 3402, 34th Floor", phone: "+971 4 561 3707" },
  { city: "Riyadh", country: "KSA", address: "4288, Anas Bin Malik\n6745 Al Malqa District", phone: "+966 11 257 1940" },
  { city: "Abu Dhabi", country: "UAE", address: "Block B Offices\nMusaffah, M40, 91", phone: "+971 5 259 91055" },
  { city: "Doha", country: "Qatar", address: "Office 241-3, Floor 2\nRegus, No. 67", phone: "+974 442 31111" },
];

export default function Footer() {
  return (
    <footer className="bg-[#0E2841] text-white">
      {/* Main Footer */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Brand */}
          <div className="lg:col-span-4">
            <div className="mb-5">
              <Logo size="md" />
            </div>
            <p className="text-gray-400 text-sm leading-relaxed mb-6 max-w-sm">
              A boutique AI advisory and engineering services firm. We take clients from AI ambition to AI in production — with senior delivery, lean economics, and an agentic-native practice.
            </p>
            <div className="flex items-center gap-3">
              <a href="https://linkedin.com/company/maven-ai" target="_blank" rel="noreferrer" className="w-9 h-9 rounded-lg bg-white/10 hover:bg-[#156082] flex items-center justify-center transition-colors">
                <Linkedin size={16} />
              </a>
              <a href="https://twitter.com/MavenAI" target="_blank" rel="noreferrer" className="w-9 h-9 rounded-lg bg-white/10 hover:bg-[#156082] flex items-center justify-center transition-colors">
                <Twitter size={16} />
              </a>
              <a href="mailto:info@maven-ai.com" className="w-9 h-9 rounded-lg bg-white/10 hover:bg-[#156082] flex items-center justify-center transition-colors">
                <Mail size={16} />
              </a>
            </div>
          </div>

          {/* Navigation */}
          <div className="lg:col-span-2">
            <h3 className="text-white font-semibold text-sm uppercase tracking-widest mb-5">Company</h3>
            <ul className="space-y-3">
              {[
                { href: "/about", label: "About Maven AI", external: false },
                { href: "/about#founders", label: "Our Founders", external: false },
                { href: "/about#operating-model", label: "How We Work", external: false },
                { href: "/contact", label: "Contact Us", external: false },
                { href: "https://www.maveninsights.com", label: "Maven Insights ↗", external: true },
              ].map((link) => (
                <li key={link.href}>
                  {link.external ? (
                    <a href={link.href} target="_blank" rel="noreferrer" className="text-gray-400 text-sm hover:text-white transition-colors">
                      {link.label}
                    </a>
                  ) : (
                    <Link href={link.href} className="text-gray-400 text-sm hover:text-white transition-colors">
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-2">
            <h3 className="text-white font-semibold text-sm uppercase tracking-widest mb-5">Services</h3>
            <ul className="space-y-3">
              {[
                { href: "/services/agentic-ai-transformation", label: "Agentic AI" },
                { href: "/services/ai-driven-sdlc", label: "AI-Driven SDLC" },
                { href: "/services/data-governance-foundations", label: "Data & Governance" },
                { href: "/services/ai-product-studio", label: "AI Product Studio" },
              ].map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-gray-400 text-sm hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-2">
            <h3 className="text-white font-semibold text-sm uppercase tracking-widest mb-5">Industries</h3>
            <ul className="space-y-3">
              {[
                { href: "/industries#public-sector", label: "Public Sector" },
                { href: "/industries#telecom", label: "Telecommunications" },
                { href: "/industries#financial-services", label: "Financial Services" },
              ].map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-gray-400 text-sm hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div className="lg:col-span-2">
            <h3 className="text-white font-semibold text-sm uppercase tracking-widest mb-5">Contact</h3>
            <div className="space-y-4">
              <div className="flex items-start gap-2">
                <Mail size={14} className="text-[#0F9ED5] mt-0.5 flex-shrink-0" />
                <a href="mailto:info@maven-ai.com" className="text-gray-400 text-sm hover:text-white transition-colors">
                  info@maven-ai.com
                </a>
              </div>
              <div className="flex items-start gap-2">
                <MapPin size={14} className="text-[#E97132] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-gray-400 text-sm">Dubai · Riyadh</p>
                  <p className="text-gray-400 text-sm">Abu Dhabi · Doha</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Offices */}
        <div className="mt-14 pt-10 border-t border-white/10">
          <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-6">Our Offices</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {offices.map((office) => (
              <div key={office.city}>
                <div className="flex items-center gap-2 mb-2">
                  <MapPin size={12} className="text-[#E97132]" />
                  <span className="text-white font-semibold text-sm">{office.city}, {office.country}</span>
                </div>
                <p className="text-gray-500 text-xs leading-relaxed whitespace-pre-line">{office.address}</p>
                <div className="flex items-center gap-1 mt-1.5">
                  <Phone size={10} className="text-gray-500" />
                  <p className="text-gray-500 text-xs">{office.phone}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-gray-500 text-xs">© {new Date().getFullYear()} Maven AI. All rights reserved. A sister company of Maven Insights & Solutions.</p>
          <div className="flex items-center gap-5">
            <a href="#" className="text-gray-500 text-xs hover:text-gray-300 transition-colors">Privacy Policy</a>
            <a href="#" className="text-gray-500 text-xs hover:text-gray-300 transition-colors">Terms of Use</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
