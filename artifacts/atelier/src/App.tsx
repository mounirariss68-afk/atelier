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
import RosterPeople from "@/pages/roster/RosterPeople";
import RosterPerson from "@/pages/roster/RosterPerson";
import RosterAccessMatrix from "@/pages/roster/RosterAccessMatrix";
import RosterInvitations from "@/pages/roster/RosterInvitations";
import RosterOnboarding from "@/pages/roster/RosterOnboarding";
import RosterOffboarding from "@/pages/roster/RosterOffboarding";
import RosterCompliance from "@/pages/roster/RosterCompliance";
import RosterSkillGraph from "@/pages/roster/RosterSkillGraph";
import Timesheet from "@/pages/ledger/Timesheet";
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
import StudioIndex from "@/pages/studio/StudioIndex";
import GuardhouseIndex from "@/pages/guardhouse/GuardhouseIndex";
import IpCatalog from "@/pages/atelier/IpCatalog";
import Codex from "@/pages/Codex";
import CodexContract from "@/pages/CodexContract";
// Task #368 — Manage shell lens placeholders. The Clients/People/Partners
// lens contents ship in their own follow-up tasks; until then these render
// a "Lens coming soon" page so the picker, deep links and persistence still
// resolve. /finance keeps its existing pages as its lens home.
import {
  ClientsLensHome,
  PeopleLensHome,
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

const queryClient = new QueryClient();

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/sign-in" component={SignIn} />
        <Route path="/cli" component={Cli} />
        <Route path="/" component={Home} />
        <Route path="/crm" component={Crm} />
        <Route path="/pipeline">
          {() => {
            window.history.replaceState(null, "", "/opportunities");
            window.location.replace("/opportunities");
            return null;
          }}
        </Route>
        <Route path="/opportunities" component={Pipeline} />
        <Route path="/pipeline/:oppId" component={Opportunity} />
        <Route path="/opportunities/:oppId/win-loss" component={WinLoss} />
        <Route path="/opportunities/:oppId" component={Opportunity} />
        <Route path="/win-loss/debriefs" component={WinLossLibrary} />
        <Route path="/win-loss" component={WinLossLibrary} />
        {/* Task #271 — Forecast folded into Opportunities → Forecast tab.
            Preserve any ?by=… group-by selection so dossier/report deep-links
            land on the same view they used to. */}
        <Route path="/forecast">
          {() => {
            const search = window.location.search ?? "";
            const params = new URLSearchParams(search);
            const by = params.get("by");
            const target = `/opportunities?view=forecast${by ? `&by=${encodeURIComponent(by)}` : ""}`;
            window.history.replaceState(null, "", target);
            window.location.replace(target);
            return null;
          }}
        </Route>
        <Route path="/reports" component={Reports} />
        <Route path="/engagements" component={Engagements} />
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
        <Route path="/studio" component={StudioIndex} />
        <Route path="/studio/:section" component={StudioIndex} />
        <Route path="/guardhouse" component={GuardhouseIndex} />
        <Route path="/guardhouse/:section" component={GuardhouseIndex} />
        <Route path="/roster/access-matrix" component={RosterAccessMatrix} />
        <Route path="/roster/skill-graph" component={RosterSkillGraph} />
        <Route path="/roster/invitations" component={RosterInvitations} />
        <Route path="/roster/onboarding" component={RosterOnboarding} />
        <Route path="/roster/offboarding" component={RosterOffboarding} />
        <Route path="/roster/compliance" component={RosterCompliance} />
        <Route path="/roster/people" component={RosterPeople} />
        <Route path="/roster/people/:id" component={RosterPerson} />
        <Route path="/roster/people/:id/:tab" component={RosterPerson} />
        <Route path="/ledger" component={Timesheet} />
        <Route path="/ledger/timesheet" component={Timesheet} />
        <Route path="/ledger/timesheets" component={Timesheet} />
        <Route path="/ledger/timesheets/:personId/:weekIso" component={Timesheet} />
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
        <Route path="/clients" component={ClientsLensHome} />
        <Route path="/clients/:rest*" component={ClientsLensHome} />
        <Route path="/people" component={PeopleLensHome} />
        <Route path="/people/:rest*" component={PeopleLensHome} />
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
