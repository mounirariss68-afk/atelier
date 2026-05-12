import { useAtelierGetHome } from "@workspace/api-client-react";
import { SectionHead, PageHero, Card, MonoChip, PlmPill, PillButton } from "@/components/ui/primitives";
import { Link, useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Clock, FileText, ArrowRight, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Home() {
  const { data: home, isLoading } = useAtelierGetHome();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  if (isLoading) {
    return (
      <div className="container-atelier py-12 space-y-12">
        <Skeleton className="h-8 w-48 bg-bg-elevate" />
        <Skeleton className="h-16 w-3/4 bg-bg-elevate" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <Skeleton className="h-96 bg-bg-elevate col-span-2" />
          <Skeleton className="h-96 bg-bg-elevate" />
        </div>
      </div>
    );
  }

  if (!home) return null;

  const handlePullAsset = (assetTitle: string) => {
    toast({
      title: "Asset Pulled",
      description: `"${assetTitle}" has been copied to your current workspace.`,
    });
  };

  const navigateTo = (kind: string, targetId: string) => {
    if (kind === 'opportunity') setLocation(`/pipeline/${targetId}`);
    else if (kind === 'engagement') setLocation(`/engagements/${targetId}`);
    else if (kind === 'atelier') setLocation(`/atelier/assets?focus=${targetId}`);
  };

  return (
    <div className="animate-in fade-in duration-500">
      <PageHero>
        <SectionHead 
          eyebrow={home.eyebrowDate}
          headline={
            <span dangerouslySetInnerHTML={{ __html: home.greeting.replace(home.persona.name, `<em class="accent">${home.persona.name}</em>`) }} />
          }
        />
      </PageHero>

      <div className="container-atelier py-10 space-y-12 grid grid-cols-1 xl:grid-cols-3 gap-8">
        
        {/* PANE A: What needs me today */}
        <div className="xl:col-span-2 space-y-6">
          <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-3">
            What needs me today
            <span className="flex-1 h-px bg-border" />
          </h3>
          
          <div className="space-y-4">
            {home.paneA.map((item) => (
              <Card key={item.id} className="p-5 flex flex-col sm:flex-row gap-5 items-start sm:items-center hover:border-gold/50 transition-colors group">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-3">
                    <MonoChip tone={item.priority === 'high' ? 'gold' : item.priority === 'medium' ? 'amber' : 'default'}>
                      {item.priority}
                    </MonoChip>
                    <h4 className="font-semibold text-lg text-text group-hover:text-gold transition-colors">{item.title}</h4>
                  </div>
                  <p className="text-text-mute text-sm leading-relaxed">{item.summary}</p>
                  <div className="flex items-center gap-2 text-xs font-mono text-text-faint">
                    <Clock className="w-3.5 h-3.5" />
                    {item.dueLabel}
                  </div>
                </div>
                <div className="shrink-0 w-full sm:w-auto">
                  <PillButton 
                    variant="ghost" 
                    className="w-full sm:w-auto"
                    onClick={() => navigateTo(item.hrefKind, item.hrefTargetId)}
                  >
                    Open <ArrowRight className="w-4 h-4 ml-1" />
                  </PillButton>
                </div>
              </Card>
            ))}
            {home.paneA.length === 0 && (
              <div className="text-center py-12 text-text-mute font-mono text-sm border border-dashed border-border rounded-lg">
                No items require your attention today.
              </div>
            )}
          </div>
        </div>

        {/* PANE B & C Column */}
        <div className="space-y-12">
          
          {/* PANE B: Pipeline & Engagements */}
          <div className="space-y-6">
            <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-3">
              At a glance
              <span className="flex-1 h-px bg-border" />
            </h3>
            
            <div className="grid grid-cols-2 gap-4">
              <Card className="p-5 space-y-3 bg-bg-deep border-border-soft">
                <div className="text-xs font-mono text-text-mute uppercase tracking-wider">Active Engagements</div>
                <div className="text-3xl font-light text-text">{home.engagements.activeCount}</div>
                <div className="flex flex-col gap-1.5 pt-2 border-t border-border/50">
                  <div className="flex justify-between text-xs">
                    <span className="text-text-faint">Due this week</span>
                    <span className="text-text">{home.engagements.deliverablesDueThisWeek}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-text-faint">RAID Red/Amber</span>
                    <span className="text-warn">{home.engagements.raidAmberCount}</span>
                    <span className="text-danger">{home.engagements.raidRedCount}</span>
                  </div>
                </div>
              </Card>
              
              <Card className="p-5 space-y-3 bg-bg-deep border-border-soft flex flex-col justify-between">
                <div className="text-xs font-mono text-text-mute uppercase tracking-wider">Pipeline Value</div>
                <div className="text-3xl font-light text-gold">
                  ${(home.pipeline.reduce((acc, p) => acc + p.weightedValueUsd, 0) / 1000000).toFixed(1)}M
                </div>
                <div className="text-xs text-text-faint font-mono">Weighted Total</div>
              </Card>
            </div>

            <Card className="p-0 overflow-hidden">
              <div className="p-3 bg-bg-deep border-b border-border text-xs font-mono text-text-mute uppercase tracking-wider">
                Pipeline Stages
              </div>
              <div className="divide-y divide-border">
                {home.pipeline.map(stage => (
                  <div key={stage.stage} className="flex items-center justify-between p-3 hover:bg-bg-elevate-2 transition-colors">
                    <PlmPill stage={stage.stage} />
                    <div className="flex items-center gap-4 text-sm">
                      <span className="font-mono text-text-mute">{stage.count} opps</span>
                      {stage.agedRedCount > 0 && (
                        <span className="flex items-center gap-1 text-danger font-mono text-xs">
                          <AlertCircle className="w-3.5 h-3.5" />
                          {stage.agedRedCount} aged
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* PANE C: From the Atelier */}
          <div className="space-y-6">
            <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-3">
              From the Atelier
              <span className="flex-1 h-px bg-border" />
            </h3>
            
            <div className="space-y-4">
              {home.paneC.map((asset) => (
                <Card key={asset.id} className="p-4 space-y-3 bg-bg-deep border-border-soft">
                  <div className="flex justify-between items-start gap-2">
                    <MonoChip>{asset.kind.replace('_', ' ')}</MonoChip>
                    <button 
                      onClick={() => handlePullAsset(asset.title)}
                      className="text-text-mute hover:text-gold transition-colors"
                      title="Pull into current workspace"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                  <h4 className="font-medium text-text leading-tight">{asset.title}</h4>
                  <p className="text-sm text-text-faint line-clamp-2">{asset.abstract}</p>
                  <div className="text-xs font-mono text-gold/70">{asset.provenance}</div>
                </Card>
              ))}
            </div>
            <Link href="/atelier" className="inline-flex items-center gap-2 text-sm text-gold hover:text-gold-soft transition-colors font-mono uppercase tracking-wider">
              Browse full catalog <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
}
