import { SectionHead, Card } from "@/components/ui/primitives";
import { Settings as SettingsIcon } from "lucide-react";

export default function Settings() {
  return (
    <div className="container-atelier py-12 animate-in fade-in">
      <SectionHead 
        headline="Settings"
        lede="Personal preferences and configurations."
      />
      
      <div className="mt-12 max-w-2xl">
        <Card className="p-12 flex flex-col items-center justify-center text-center border-dashed bg-bg-deep">
          <div className="w-12 h-12 bg-bg-elevate rounded-full flex items-center justify-center mb-4 text-gold">
            <SettingsIcon className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-semibold text-text mb-2">Settings Shell</h3>
          <p className="text-text-mute">Preferences and MCP connections will land in the next workstream.</p>
        </Card>
      </div>
    </div>
  );
}
