import { useRoute } from "wouter";
import { Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { PeopleShell } from "./PeopleShell";
import { useOrgUnits, useRoleDefinitions } from "./peopleSeed";

const SUBS = [
  { id: "units", label: "Org units" },
  { id: "roles", label: "Role library" },
];

export default function PeopleOrg() {
  const [, params] = useRoute("/people/org/:section");
  const section = params?.section ?? "units";

  return (
    <PeopleShell module="org">
      <LensPageHeader
        headline="The org chart and the role library"
        lede="Where the firm decides what shape it wants to be: practices, reporting lines, role definitions and the bands they map to."
      />
      <div className="container-atelier py-6 space-y-6">
        <TabNav>
          {SUBS.map((s) => (
            <TabNavLink key={s.id} href={`/people/org/${s.id}`} active={section === s.id}>
              {s.label}
            </TabNavLink>
          ))}
        </TabNav>
        <div className="mt-4">
          {section === "units" && <UnitsView />}
          {section === "roles" && <RolesView />}
        </div>
      </div>
    </PeopleShell>
  );
}

function UnitsView() {
  const rows = useOrgUnits();
  return (
    <div className="space-y-2">
      {rows.map((u) => {
        const indent = u.parentId ? "ml-6" : "";
        return (
          <Card key={u.id} className={`p-3 ${indent}`}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-text">{u.name}</div>
                <div className="text-xs text-text-faint">head · {u.headName}</div>
              </div>
              <MonoChip>{u.headcount} ppl</MonoChip>
              <MonoChip tone={u.openRoles > 0 ? "gold" : "default"}>{u.openRoles} open</MonoChip>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function RolesView() {
  const rows = useRoleDefinitions();
  return (
    <Card className="p-4">
      <table className="w-full text-sm">
        <thead className="text-xs text-text-mute font-mono uppercase">
          <tr><th className="text-left py-2">Title</th><th>Level</th><th>Band</th><th className="text-left">Competencies</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border-soft">
              <td className="py-2 text-text">{r.title}</td>
              <td className="text-center text-text-mute">{r.level}</td>
              <td className="text-center"><MonoChip>{r.bandId}</MonoChip></td>
              <td className="text-text-mute">{r.competencies.join(", ")}</td>
              <td className="text-center">
                <MonoChip tone={r.draft ? "amber" : "green"}>{r.draft ? "draft" : "published"}</MonoChip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
