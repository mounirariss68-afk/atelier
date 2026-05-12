import * as React from "react";
import { useAtelierListAssets, getAtelierListAssetsQueryKey } from "@workspace/api-client-react";
import { SectionHead, PageHero, Card, MonoChip } from "@/components/ui/primitives";
import { Link, useRoute } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";

const SUB_ROUTES = [
  { id: 'assets', label: 'Assets' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'credentials', label: 'Credentials' },
  { id: 'people', label: 'People' }
];

export default function AtelierIndex() {
  const [, params] = useRoute("/atelier/:section");
  const section = params?.section || "assets";
  const { toast } = useToast();

  const { data: assets, isLoading, isError } = useAtelierListAssets({
    query: { enabled: section === 'assets', queryKey: getAtelierListAssetsQueryKey() },
  });

  const [filter, setFilter] = React.useState('');

  const handlePullAsset = (assetTitle: string) => {
    toast({
      title: "Asset Pulled",
      description: `"${assetTitle}" has been copied to your workspace.`,
    });
  };

  const renderContent = () => {
    if (section !== 'assets') {
      return (
        <Card className="p-12 flex flex-col items-center justify-center text-center border-dashed bg-bg-deep mt-8">
          <div className="w-12 h-12 bg-bg-elevate rounded-full flex items-center justify-center mb-4 text-gold">
            <Search className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-semibold text-text mb-2">{SUB_ROUTES.find(s=>s.id===section)?.label} Library</h3>
          <p className="text-text-mute max-w-md">This section is registered in the shell. Content population ships in the next workstream.</p>
        </Card>
      );
    }

    if (isLoading) return <div className="py-8 space-y-4"><Skeleton className="h-24 bg-bg-elevate"/><Skeleton className="h-24 bg-bg-elevate"/></div>;
    if (isError || !assets) return <div className="py-8 text-danger">Failed to load assets.</div>;

    const filtered = assets.filter(a => a.title.toLowerCase().includes(filter.toLowerCase()) || a.kind.includes(filter.toLowerCase()));

    return (
      <div className="mt-8 space-y-6">
        <div className="max-w-md relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-mute" />
          <Input 
            placeholder="Search assets..." 
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="pl-9 bg-bg-elevate border-border text-text placeholder:text-text-faint"
          />
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map(asset => (
            <Card key={asset.id} className="p-5 flex flex-col justify-between hover:border-gold/50 transition-colors">
              <div className="space-y-3">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex flex-wrap gap-2">
                    <MonoChip>{asset.kind.replace('_', ' ')}</MonoChip>
                  </div>
                  <button 
                    onClick={() => handlePullAsset(asset.title)}
                    className="text-text-mute hover:text-gold transition-colors p-1 shrink-0"
                    title="Pull into workspace"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
                <h4 className="font-semibold text-text leading-tight">{asset.title}</h4>
                <p className="text-sm text-text-mute line-clamp-2">{asset.abstract}</p>
              </div>
              <div className="mt-4 pt-4 border-t border-border-soft flex justify-between items-center text-xs font-mono">
                <span className="text-gold/70 truncate max-w-[200px]">{asset.provenance}</span>
                <span className="text-text-faint">{new Date(asset.createdAt).toLocaleDateString()}</span>
              </div>
            </Card>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full py-12 text-center text-text-mute font-mono border border-dashed border-border rounded-lg">
              No assets match your search.
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead 
          headline="Knowledge Atelier"
          lede="The firm's compounded IP and reusable assets."
        />
      </PageHero>

      <div className="container-atelier py-10">
      <div className="border-b border-border">
        <div className="flex gap-6 overflow-x-auto scrollbar-thin">
          {SUB_ROUTES.map(sub => (
            <Link
              key={sub.id}
              href={`/atelier/${sub.id}`}
              className={`pb-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${section === sub.id ? 'border-gold text-gold' : 'border-transparent text-text-mute hover:text-text'}`}
            >
              {sub.label}
            </Link>
          ))}
        </div>
      </div>

      {renderContent()}
      </div>
    </div>
  );
}
