import { useAtelierListPersonas, useAtelierSwitchPersona, getAtelierGetMeQueryKey, getAtelierGetHomeQueryKey, getAtelierGetActivityQueryKey } from "@workspace/api-client-react";
import { Card, SectionHead, PillButton } from "@/components/ui/primitives";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import Logo from "@/components/ui/Logo";
import { Skeleton } from "@/components/ui/skeleton";

export default function SignIn() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: personas, isLoading } = useAtelierListPersonas();
  const switchPersona = useAtelierSwitchPersona();

  const handleSignIn = (personaId: string) => {
    switchPersona.mutate({ data: { personaId } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAtelierGetMeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getAtelierGetHomeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getAtelierGetActivityQueryKey() });
        setLocation("/");
      }
    });
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-20 px-4">
      <div className="w-full max-w-md space-y-12">
        <div className="text-center space-y-6">
          <div className="flex justify-center">
            <Logo variant="mark" size="lg" />
          </div>
          <SectionHead 
            headline={<>Sign in to <em className="accent">The Atelier</em></>}
            lede="Select a persona to enter the workspace."
            className="flex flex-col items-center text-center"
          />
        </div>

        <div className="space-y-4">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full bg-bg-elevate rounded-lg" />
            ))
          ) : (
            personas?.map((p) => (
              <Card 
                key={p.id} 
                className="p-4 hover:border-gold transition-colors cursor-pointer group flex items-center justify-between"
                onClick={() => handleSignIn(p.id)}
                role="button"
              >
                <div className="flex items-center gap-4">
                  <Avatar className="h-12 w-12 border border-border group-hover:border-gold transition-colors">
                    <AvatarImage src={p.avatarUrl || ""} />
                    <AvatarFallback className="bg-bg-deep text-gold font-mono">{p.initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <span className="font-semibold text-text group-hover:text-gold transition-colors">{p.name}</span>
                    <span className="text-sm text-text-mute">{p.roleLabel}</span>
                  </div>
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity font-mono text-xs text-gold uppercase tracking-wider">
                  Enter
                </div>
              </Card>
            ))
          )}
        </div>

        <div className="pt-8 border-t border-border space-y-4">
          <p className="text-center text-sm text-text-faint">Enterprise Authentication</p>
          <div className="flex flex-col gap-3">
            <PillButton variant="ghost" disabled className="w-full justify-center opacity-50 cursor-not-allowed">
              Continue with Google (Coming soon)
            </PillButton>
            <PillButton variant="ghost" disabled className="w-full justify-center opacity-50 cursor-not-allowed">
              Continue with Microsoft (Coming soon)
            </PillButton>
          </div>
        </div>
      </div>
    </div>
  );
}
