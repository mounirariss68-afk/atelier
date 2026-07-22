import * as React from "react";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";

interface Grant {
  userId: string;
  userName: string | null;
  userRole: string | null;
  engagementId: string;
  engagementName: string | null;
  accountName: string | null;
  roleOnEngagement: string;
  allocationPct: number | null;
  scope: string[] | null;
  status: string;
}

export default function RosterAccessMatrix() {
  const [grants, setGrants] = React.useState<Grant[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch("/api/atelier/roster/access-matrix", { credentials: "include" })
      .then(async (r) => {
        if (r.status === 403) throw new Error("Partner only.");
        return r.json();
      })
      .then((d) => setGrants(d.grants ?? []))
      .catch((e) => setError(e.message));
  }, []);

  if (error)
    return (
      <div className="px-8 py-12">
        <Card className="p-6 text-center text-warning">{error}</Card>
      </div>
    );
  if (!grants)
    return <div className="px-8 py-12 text-text-mute">Loading…</div>;

  // Pivot: userId → engagement → grant
  const userIds = Array.from(new Set(grants.map((g) => g.userId)));
  const engIds = Array.from(new Set(grants.map((g) => g.engagementId)));
  const userMeta = new Map<string, { name: string | null; role: string | null }>();
  const engMeta = new Map<
    string,
    { name: string | null; account: string | null }
  >();
  grants.forEach((g) => {
    userMeta.set(g.userId, { name: g.userName, role: g.userRole });
    engMeta.set(g.engagementId, {
      name: g.engagementName,
      account: g.accountName,
    });
  });
  const cell = (uid: string, eid: string) =>
    grants.find(
      (g) => g.userId === uid && g.engagementId === eid && g.status === "active",
    );

  return (
    <div>
      <PageHero>
        <SectionHead
          headline="The Roster — Access Matrix"
          lede="Who can see what, across every engagement. Grants are written through the Access Sentinel."
        />
      </PageHero>
      <div className="px-4 md:px-8 py-6 max-w-screen-2xl mx-auto">
      <Card className="mt-6 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-text-mute font-mono uppercase text-[10px]">
            <tr>
              <th className="text-left p-3 sticky left-0 bg-bg-elevate z-10">
                Person
              </th>
              {engIds.map((eid) => (
                <th
                  key={eid}
                  className="text-left p-3 border-l border-border-soft min-w-[160px]"
                >
                  <div className="text-text">{engMeta.get(eid)?.name}</div>
                  <div className="text-text-faint normal-case">
                    {engMeta.get(eid)?.account}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {userIds.map((uid) => {
              const role = userMeta.get(uid)?.role ?? "";
              const firmWide = role === "founding_partner" || role === "partner";
              const seniorManager = role === "senior_manager";
              return (
              <tr
                key={uid}
                className="border-t border-border-soft hover:bg-bg-elevate-2"
              >
                <td className="p-3 sticky left-0 bg-bg-elevate z-10">
                  <div className="text-text font-medium">
                    {userMeta.get(uid)?.name}
                  </div>
                  <div className="text-text-faint">{role}</div>
                  {seniorManager && (
                    <div className="text-[10px] text-gold mt-1" data-testid={`scope-note-${uid}`}>
                      All accounts; assigned opportunities &amp; engagements
                    </div>
                  )}
                </td>
                {firmWide ? (
                  <td
                    className="p-3 border-l border-border-soft align-middle text-gold font-mono text-[11px]"
                    colSpan={engIds.length || 1}
                    data-testid={`firm-wide-${uid}`}
                  >
                    Full firm-wide access
                  </td>
                ) : (
                engIds.map((eid) => {
                  const c = cell(uid, eid);
                  return (
                    <td
                      key={eid}
                      className="p-3 border-l border-border-soft align-top"
                      data-testid={`cell-${uid}-${eid}`}
                    >
                      {c ? (
                        <div className="space-y-1">
                          <MonoChip>{c.roleOnEngagement}</MonoChip>
                          {c.allocationPct != null && c.allocationPct > 0 && (
                            <div className="text-text-mute">
                              {c.allocationPct}%
                            </div>
                          )}
                          {c.scope && c.scope.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {c.scope.slice(0, 3).map((s) => (
                                <MonoChip key={s} className="text-[9px]">
                                  {s.replace(/^can_/, "")}
                                </MonoChip>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-text-faint">—</span>
                      )}
                    </td>
                  );
                })
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      </div>
    </div>
  );
}
