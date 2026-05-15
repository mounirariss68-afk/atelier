import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "@/components/layout/Shell";
import NotFound from "@/pages/not-found";

// Pages
import SignIn from "@/pages/SignIn";
import Cli from "@/pages/Cli";
import Home from "@/pages/Home";
import Pipeline from "@/pages/Pipeline";
import Crm from "@/pages/Crm";
import Opportunity from "@/pages/Opportunity";
import Engagements from "@/pages/Engagements";
import Engagement from "@/pages/Engagement";
import AtelierIndex from "@/pages/AtelierIndex";
import Agents from "@/pages/Agents";
import AgentProfile from "@/pages/AgentProfile";
import Settings from "@/pages/Settings";
import Admin from "@/pages/Admin";
import FirmProfile from "@/pages/FirmProfile";
import ReferenceData from "@/pages/admin/ReferenceData";
import Pricing from "@/pages/Pricing";
import Account from "@/pages/Account";
import Deliverable from "@/pages/Deliverable";
import AgentRun from "@/pages/AgentRun";
import WinLoss from "@/pages/WinLoss";
import WinLossLibrary from "@/pages/WinLossLibrary";
import Reports from "@/pages/Reports";
// Task #364 — RosterPeople/RosterPerson/RosterAccessMatrix/RosterInvitations/
// RosterOnboarding/RosterOffboarding/RosterCompliance/RosterSkillGraph and
// Timesheet are now mounted under /people/* via PeopleShell wrappers; the
// legacy /roster/* and /ledger/timesheet* paths permanently redirect.
import LedgerApprovals from "@/pages/ledger/LedgerApprovals";
import EngagementEconomics from "@/pages/ledger/EngagementEconomics";
import Utilization from "@/pages/ledger/Utilization";
import FirmEconomics from "@/pages/ledger/FirmEconomics";
import WalletExpenses from "@/pages/wallet/WalletExpenses";
import WalletNewExpense from "@/pages/wallet/WalletNewExpense";
import WalletExpenseDetail from "@/pages/wallet/WalletExpenseDetail";
import WalletPolicy from "@/pages/wallet/WalletPolicy";
import WalletCards from "@/pages/wallet/WalletCards";
import WalletVat from "@/pages/wallet/WalletVat";
import WalletApprovals from "@/pages/wallet/WalletApprovals";
import WalletClientBillable from "@/pages/wallet/WalletClientBillable";
import WalletRevrec from "@/pages/wallet/WalletRevrec";
import WalletWip from "@/pages/wallet/WalletWip";
import WalletMargin from "@/pages/wallet/WalletMargin";
import WalletInvoices from "@/pages/wallet/WalletInvoices";
import WalletInvoiceDetail from "@/pages/wallet/WalletInvoiceDetail";
import WalletAr from "@/pages/wallet/WalletAr";
import WalletCollections from "@/pages/wallet/WalletCollections";
import { SalonRoot } from "@/pages/salon/SalonRoutes";
// v5 — Scale & Trust
import PressIndex from "@/pages/press/PressIndex";
import PartnersIndex from "@/pages/partners/PartnersIndex";
// Task #364 — StudioIndex view functions are now consumed by /people/hire and
// /people/attract; the /studio/* paths permanently redirect.
import GuardhouseIndex from "@/pages/guardhouse/GuardhouseIndex";
import IpCatalog from "@/pages/atelier/IpCatalog";
import Codex from "@/pages/Codex";
import CodexContract from "@/pages/CodexContract";
// Task #368 — Manage shell lens placeholders. The Clients lens content ships
// in its own follow-up task; until then it renders a "Lens coming soon" page
// so the picker, deep links and persistence still resolve. The People lens
// is filled in by Task #364 with the People Studio. /finance keeps its
// existing pages as its lens home.
import {
  FinanceLensHome,
} from "@/pages/lens/LensPlaceholder";
// Task #370 — Agents lens (Design → Retire). The lens home replaces
// the bare /agents catalogue with a lifecycle ribbon; the catalogue
// itself re-mounts under /agents/monitor and runs under
// /agents/monitor/runs/:id. Profile becomes the spec view at
// /agents/design/:id. Old URLs redirect.
import AgentsLensHome from "@/pages/agents/AgentsLensHome";
import AgentsDesign from "@/pages/agents/AgentsDesign";
import AgentsBuild from "@/pages/agents/AgentsBuild";
import AgentsEvaluate from "@/pages/agents/AgentsEvaluate";
import AgentsDeploy from "@/pages/agents/AgentsDeploy";
import AgentsImprove from "@/pages/agents/AgentsImprove";
import AgentsRetire from "@/pages/agents/AgentsRetire";
// Task #369 — Clients lens re-homes the commercial loop under /clients
// with a flat IA (Overview · Accounts · Opportunities · Engagements ·
// Billing · References). Renewals/expansions are a flag on each
// opportunity, not a separate tab. Old top-level URLs (/crm, /pipeline,
// …) and the previous lifecycle URLs (/clients/prospect …) keep
// resolving via permanent redirects below.
import ClientsHome from "@/pages/lens/ClientsHome";
import {
  ClientsAccounts,
  ClientsOpportunities,
  ClientsEngagements,
  ClientsBilling,
  ClientsReferences,
} from "@/pages/lens/ClientsStages";
import { Redirect } from "@/components/Redirect";

// Task #364 — People Studio (the People lens).
import PeopleHome from "@/pages/people/PeopleHome";
import PeopleAttract from "@/pages/people/PeopleAttract";
import PeopleHire from "@/pages/people/PeopleHire";
import PeopleOnboard from "@/pages/people/PeopleOnboard";
import PeopleDevelop from "@/pages/people/PeopleDevelop";
import PeoplePerform from "@/pages/people/PeoplePerform";
import PeopleReward from "@/pages/people/PeopleReward";
import PeopleRetain from "@/pages/people/PeopleRetain";
import PeopleOffboard from "@/pages/people/PeopleOffboard";
import PeopleOrg from "@/pages/people/PeopleOrg";
import PeopleApprovals from "@/pages/people/PeopleApprovals";
import PeoplePeople from "@/pages/people/PeoplePeople";
import PeoplePerson from "@/pages/people/PeoplePerson";
import PeopleAccess from "@/pages/people/PeopleAccess";
import PeopleSkills from "@/pages/people/PeopleSkills";
import PeopleCompliance from "@/pages/people/PeopleCompliance";
import PeopleTime from "@/pages/people/PeopleTime";

/**
 * Permanent client-side redirect — used for the legacy /studio, /roster
 * and /ledger/timesheet* paths which Task #364 folded into the People
 * Studio. Preserves dynamic path segments and the search string so deep
 * links from emails / dossiers keep landing on the right page.
 */
function redirectTo(target: string) {
  return function Redirect() {
    const search = window.location.search ?? "";
    const dest = `${target}${search}`;
    window.history.replaceState(null, "", dest);
    window.location.replace(dest);
    return null;
  };
}

const queryClient = new QueryClient();

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/sign-in" component={SignIn} />
        <Route path="/cli" component={Cli} />
        <Route path="/" component={Home} />
        {/* Task #369 — commercial-loop redirects. The lens lives at
            /clients/*; old top-level URLs keep resolving so deep-links
            from email, dossiers and audit logs don't die. Detail routes
            (opp / engagement workspaces) stay at their existing paths. */}
        <Route path="/crm">{() => <Redirect to="/clients/accounts" />}</Route>
        <Route path="/pipeline">{() => <Redirect to="/clients/opportunities" />}</Route>
        {/* Listing-level redirects move to the lens; detail routes
            (workspaces) stay canonical at their existing paths. */}
        <Route path="/opportunities">{() => <Redirect to="/clients/opportunities" />}</Route>
        <Route path="/pipeline/:oppId" component={Opportunity} />
        <Route path="/opportunities/:oppId/win-loss" component={WinLoss} />
        <Route path="/opportunities/:oppId" component={Opportunity} />
        {/* `/win-loss-library` → references (themes); `/win-loss` debrief
            intake stays available standalone for deep-links. */}
        <Route path="/win-loss-library">{() => <Redirect to="/clients/references" />}</Route>
        <Route path="/win-loss/debriefs">{() => <WinLossLibrary />}</Route>
        <Route path="/win-loss">{() => <WinLossLibrary defaultView="debriefs" />}</Route>
        {/* Task #271 — Forecast folded into Opportunities → Forecast tab.
            Preserve any ?by=… group-by selection so dossier/report
            deep-links land on the same view they used to. */}
        <Route path="/forecast">
          {() => {
            const search = typeof window !== "undefined" ? window.location.search : "";
            const params = new URLSearchParams(search);
            const by = params.get("by");
            const target = `/clients/opportunities?view=forecast${by ? `&by=${encodeURIComponent(by)}` : ""}`;
            return <Redirect to={target} />;
          }}
        </Route>
        <Route path="/reports" component={Reports} />
        {/* `/engagements` listing redirects to the Deliver stage; engagement
            detail / workspace routes stay canonical until the workspace
            re-mount lands (deferred per the task's sequencing note for
            L2C Wave 1 / #360). */}
        <Route path="/engagements">{() => <Redirect to="/clients/engagements" />}</Route>
        <Route path="/engagements/:engId" component={Engagement} />
        <Route path="/engagements/:engId/deliverables/:delId" component={Deliverable} />
        {/* L2C Wave 1 (Task #360) — Codex (CLM) workspace. */}
        <Route path="/codex/contracts/:id" component={CodexContract} />
        <Route path="/codex/:section" component={Codex} />
        <Route path="/codex" component={Codex} />
        <Route path="/atelier/firm-profile" component={FirmProfile} />
        {/* v5 — IP catalog extends /atelier/assets with code, OSS, demos, licensing. */}
        <Route path="/atelier/ip" component={IpCatalog} />
        <Route path="/atelier/ip/:section" component={IpCatalog} />
        <Route path="/atelier" component={AtelierIndex} />
        <Route path="/atelier/:section" component={AtelierIndex} />
        {/* v5 — The Press, Alliances, The Studio, The Guardhouse. */}
        <Route path="/press" component={PressIndex} />
        <Route path="/press/:section" component={PressIndex} />
        {/* Task #371 — Alliances re-homed under Partners lens. Permanent
            redirects from /alliances and /alliances/:section into the
            matching lifecycle stage so deep-links from dossiers / audit
            logs / notification emails keep resolving. */}
        <Route path="/alliances">
          {() => {
            window.history.replaceState(null, "", "/partners/identify");
            window.location.replace("/partners/identify");
            return null;
          }}
        </Route>
        <Route path="/alliances/:section">
          {(p) => {
            const map: Record<string, string> = {
              firms: "/partners/identify",
              "joint-pipeline": "/partners/co-sell",
              certifications: "/partners/govern",
              conflicts: "/partners/govern",
            };
            const target = map[p.section] ?? "/partners";
            window.history.replaceState(null, "", target);
            window.location.replace(target);
            return null;
          }}
        </Route>
        {/* Task #364 — /studio routes are folded into People Studio /people/hire.
            The legacy components stay imported for code reuse but the URLs
            permanently redirect. */}
        <Route path="/studio">
          {redirectTo("/people/hire")}
        </Route>
        <Route path="/studio/referrals">
          {redirectTo("/people/attract/referrals")}
        </Route>
        <Route path="/studio/:section">
          {(p) => {
            const section = p.section ?? "roles";
            window.location.replace(`/people/hire/${section}${window.location.search ?? ""}`);
            return null;
          }}
        </Route>
        <Route path="/guardhouse" component={GuardhouseIndex} />
        <Route path="/guardhouse/:section" component={GuardhouseIndex} />
        {/* Task #364 — Roster sub-pages now live under /people/*. The legacy
            paths permanently redirect; the components are still mounted under
            /people/* via thin wrappers. */}
        <Route path="/roster">{redirectTo("/people/people")}</Route>
        <Route path="/roster/access-matrix">{redirectTo("/people/access")}</Route>
        <Route path="/roster/skill-graph">{redirectTo("/people/skills")}</Route>
        <Route path="/roster/invitations">{redirectTo("/people/onboard/invitations")}</Route>
        <Route path="/roster/onboarding">{redirectTo("/people/onboard")}</Route>
        <Route path="/roster/offboarding">{redirectTo("/people/offboard")}</Route>
        <Route path="/roster/compliance">{redirectTo("/people/compliance")}</Route>
        <Route path="/roster/people">{redirectTo("/people/people")}</Route>
        <Route path="/roster/people/:id">
          {(p) => {
            window.location.replace(`/people/people/${p.id}${window.location.search ?? ""}`);
            return null;
          }}
        </Route>
        <Route path="/roster/people/:id/:tab">
          {(p) => {
            window.location.replace(`/people/people/${p.id}/${p.tab}${window.location.search ?? ""}`);
            return null;
          }}
        </Route>
        {/* Task #364 — /ledger/timesheet* folds into /people/time. */}
        <Route path="/ledger">{redirectTo("/people/time")}</Route>
        <Route path="/ledger/timesheet">{redirectTo("/people/time")}</Route>
        <Route path="/ledger/timesheets">{redirectTo("/people/time")}</Route>
        <Route path="/ledger/timesheets/:personId/:weekIso">
          {(p) => {
            window.location.replace(`/people/time/${p.personId}/${p.weekIso}${window.location.search ?? ""}`);
            return null;
          }}
        </Route>
        {/* Task #271 — Approvals fold into Home → "What needs me today".
            Redirect deep-links (notification emails, audit logs) to Home. */}
        <Route path="/ledger/approvals">
          {() => {
            window.history.replaceState(null, "", "/");
            window.location.replace("/");
            return null;
          }}
        </Route>
        {/* Internal route still mounted for back-compat with any direct callers. */}
        <Route path="/ledger/approvals/_legacy" component={LedgerApprovals} />
        <Route path="/ledger/engagement-economics/:engagementId" component={EngagementEconomics} />
        <Route path="/ledger/utilization" component={Utilization} />
        <Route path="/ledger/utilization/:personId" component={Utilization} />
        <Route path="/ledger/firm-economics" component={FirmEconomics} />
        <Route path="/wallet" component={WalletExpenses} />
        <Route path="/wallet/expenses" component={WalletExpenses} />
        <Route path="/wallet/expenses/new" component={WalletNewExpense} />
        <Route path="/wallet/expenses/:id" component={WalletExpenseDetail} />
        <Route path="/wallet/policy" component={WalletPolicy} />
        <Route path="/wallet/cards" component={WalletCards} />
        <Route path="/wallet/vat" component={WalletVat} />
        <Route path="/wallet/approvals" component={WalletApprovals} />
        <Route path="/wallet/client-billable/:engagementId" component={WalletClientBillable} />
        <Route path="/wallet/revrec" component={WalletRevrec} />
        <Route path="/wallet/wip" component={WalletWip} />
        <Route path="/wallet/margin" component={WalletMargin} />
        {/* Task #362 — L2C Wave 3: Invoicing, AR aging, Collections. */}
        <Route path="/wallet/invoices" component={WalletInvoices} />
        <Route path="/wallet/invoices/:id" component={WalletInvoiceDetail} />
        <Route path="/wallet/ar" component={WalletAr} />
        <Route path="/wallet/collections" component={WalletCollections} />
        <Route path="/accounts/:accountId" component={Account} />
        {/* Task #370 — Agents lens (Design → Retire). New stage routes
            live under `/agents/<stage>`; the catalogue re-mounts at
            `/agents/monitor` and run-detail at `/agents/monitor/runs/:id`.
            Old `/agents/library`, `/agents/runs/:id` and `/agents/:id`
            paths redirect to the new structure so deep-links keep
            resolving. */}
        <Route path="/agents/design" component={AgentsDesign} />
        <Route path="/agents/build" component={AgentsBuild} />
        <Route path="/agents/evaluate" component={AgentsEvaluate} />
        <Route path="/agents/deploy" component={AgentsDeploy} />
        <Route path="/agents/improve" component={AgentsImprove} />
        <Route path="/agents/retire" component={AgentsRetire} />
        <Route path="/agents/monitor" component={Agents} />
        <Route path="/agents/monitor/runs/:runId" component={AgentRun} />
        <Route path="/agents/design/:agentId" component={AgentProfile} />
        {/* Redirects from the pre-lens URLs. */}
        <Route path="/agents/library">
          {() => {
            window.history.replaceState(null, "", "/agents/monitor");
            window.location.replace("/agents/monitor");
            return null;
          }}
        </Route>
        <Route path="/agents/runs/:runId">
          {(params) => {
            const target = `/agents/monitor/runs/${params.runId}`;
            window.history.replaceState(null, "", target);
            window.location.replace(target);
            return null;
          }}
        </Route>
        <Route path="/agents/:agentId">
          {(params) => {
            const target = `/agents/design/${params.agentId}`;
            window.history.replaceState(null, "", target);
            window.location.replace(target);
            return null;
          }}
        </Route>
        <Route path="/settings" component={Settings} />
        <Route path="/admin" component={Admin} />
        {/* Task #290 — Reference-data admin (countries, industries, sub-industries). */}
        <Route path="/admin/reference-data" component={ReferenceData} />
        {/* Finance: rate cards + margin policy (Partner-only). The legacy
            /pricing path stays as a back-compat alias so deep-linked rows
            (audit links, dossier exports) keep resolving. Task #368 —
            `/finance` itself becomes the Finance lens shell-phase
            placeholder; rate-card sections move under `/finance/rates`
            and the legacy `/pricing` alias keeps resolving. */}
        <Route path="/finance/rates" component={Pricing} />
        <Route path="/finance/rates/:section" component={Pricing} />
        <Route path="/finance/:section" component={Pricing} />
        <Route path="/pricing" component={Pricing} />
        {/* Task #368 — Manage shell lens homes for all five lenses, with
            catch-alls (`/:rest*`) so deep links under a lens prefix
            (e.g. `/clients/foo`, `/people/bar/baz`) resolve to the
            placeholder instead of 404 during the shell phase. */}
        {/* Task #369 — Clients lens: lifecycle ribbon home + 7 stage
            wrappers (Accounts · Opportunities · Engagements · Billing ·
            References). Engagement workspace re-mount under
            `/clients/engagements/:id` is deferred until L2C Wave 1
            (#360) merges; current detail routes stay canonical. */}
        <Route path="/clients" component={ClientsHome} />
        <Route path="/clients/accounts" component={ClientsAccounts} />
        <Route path="/clients/opportunities" component={ClientsOpportunities} />
        <Route path="/clients/engagements" component={ClientsEngagements} />
        <Route path="/clients/billing" component={ClientsBilling} />
        <Route path="/clients/references" component={ClientsReferences} />
        {/* Permanent redirects from the previous lifecycle IA so external
            deep-links (dossiers, reports, audit trail) keep landing. */}
        <Route path="/clients/prospect">{() => <Redirect to="/clients/accounts" />}</Route>
        <Route path="/clients/pursue">{() => <Redirect to="/clients/opportunities" />}</Route>
        <Route path="/clients/win">{() => <Redirect to="/clients/opportunities" />}</Route>
        <Route path="/clients/deliver">{() => <Redirect to="/clients/engagements" />}</Route>
        <Route path="/clients/bill">{() => <Redirect to="/clients/billing" />}</Route>
        <Route path="/clients/renew">{() => <Redirect to="/clients/opportunities" />}</Route>
        <Route path="/clients/reference">{() => <Redirect to="/clients/references" />}</Route>
        {/* Task #364 — People Studio. Order matters: more specific routes
            first, then sub-section catch-alls, then the lens home. */}
        <Route path="/people/attract" component={PeopleAttract} />
        <Route path="/people/attract/:section" component={PeopleAttract} />
        <Route path="/people/hire" component={PeopleHire} />
        <Route path="/people/hire/:section" component={PeopleHire} />
        <Route path="/people/onboard" component={PeopleOnboard} />
        <Route path="/people/onboard/:section" component={PeopleOnboard} />
        <Route path="/people/develop" component={PeopleDevelop} />
        <Route path="/people/develop/:section" component={PeopleDevelop} />
        <Route path="/people/perform" component={PeoplePerform} />
        <Route path="/people/perform/:section" component={PeoplePerform} />
        <Route path="/people/reward" component={PeopleReward} />
        <Route path="/people/reward/:section" component={PeopleReward} />
        <Route path="/people/retain" component={PeopleRetain} />
        <Route path="/people/retain/:section" component={PeopleRetain} />
        <Route path="/people/offboard" component={PeopleOffboard} />
        <Route path="/people/offboard/:section" component={PeopleOffboard} />
        <Route path="/people/org" component={PeopleOrg} />
        <Route path="/people/org/:section" component={PeopleOrg} />
        <Route path="/people/approvals" component={PeopleApprovals} />
        <Route path="/people/people" component={PeoplePeople} />
        <Route path="/people/people/:id" component={PeoplePerson} />
        <Route path="/people/people/:id/:tab" component={PeoplePerson} />
        <Route path="/people/access" component={PeopleAccess} />
        <Route path="/people/skills" component={PeopleSkills} />
        <Route path="/people/compliance" component={PeopleCompliance} />
        <Route path="/people/time" component={PeopleTime} />
        <Route path="/people/time/:personId/:weekIso" component={PeopleTime} />
        <Route path="/people" component={PeopleHome} />
        {/* Task #371 — Partners lens (alliance lifecycle). The index +
            stage views all live in PartnersIndex, which keys off the
            :section param. */}
        <Route path="/partners" component={PartnersIndex} />
        <Route path="/partners/:section" component={PartnersIndex} />
        <Route path="/agents" component={AgentsLensHome} />
        <Route path="/finance" component={FinanceLensHome} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function TopLevelRouter() {
  return (
    <Switch>
      <Route path="/salon" component={SalonRoot} />
      <Route path="/salon/:rest*" component={SalonRoot} />
      <Route><Router /></Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <TopLevelRouter />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
