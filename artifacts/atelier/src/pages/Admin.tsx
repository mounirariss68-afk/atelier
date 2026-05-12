import { useAtelierGetMe } from "@workspace/api-client-react";
import { SectionHead, PageHero, Card } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert, Shield } from "lucide-react";

export default function Admin() {
  const { data: me, isLoading } = useAtelierGetMe();

  if (isLoading) return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  if (!me) return null;

  if (me.role !== 'partner') {
    return (
      <div className="container-atelier py-20 flex flex-col items-center text-center animate-in fade-in">
        <div className="w-16 h-16 bg-danger/10 rounded-full flex items-center justify-center mb-6 text-danger">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-semibold text-text mb-3">Partner Access Required</h2>
        <p className="text-text-mute max-w-md">
          The administration console is restricted to firm Partners. 
          Your current persona ({me.name}, {me.roleLabel}) does not have sufficient privileges.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead 
          headline="Admin Console"
          lede="Firm-wide configuration, access control, and billing."
        />
      </PageHero>

      <div className="container-atelier py-10 max-w-2xl">
        <Card className="p-12 flex flex-col items-center justify-center text-center border-dashed bg-bg-deep border-gold/30">
          <div className="w-12 h-12 bg-gold/10 rounded-full flex items-center justify-center mb-4 text-gold">
            <Shield className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-semibold text-text mb-2">Partner View</h3>
          <p className="text-text-mute">Admin modules (Tenant config, User roles, API keys) will be populated here.</p>
        </Card>
      </div>
    </div>
  );
}
