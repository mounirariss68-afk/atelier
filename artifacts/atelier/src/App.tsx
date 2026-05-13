import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "@/components/layout/Shell";
import NotFound from "@/pages/not-found";

// Pages
import SignIn from "@/pages/SignIn";
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
import Pricing from "@/pages/Pricing";
import Account from "@/pages/Account";
import Deliverable from "@/pages/Deliverable";
import AgentRun from "@/pages/AgentRun";
import WinLoss from "@/pages/WinLoss";
import WinLossLibrary from "@/pages/WinLossLibrary";
import Forecast from "@/pages/Forecast";
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
import { SalonRoot } from "@/pages/salon/SalonRoutes";

const queryClient = new QueryClient();

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/sign-in" component={SignIn} />
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
        <Route path="/forecast" component={Forecast} />
        <Route path="/reports" component={Reports} />
        <Route path="/engagements" component={Engagements} />
        <Route path="/engagements/:engId" component={Engagement} />
        <Route path="/engagements/:engId/deliverables/:delId" component={Deliverable} />
        <Route path="/atelier" component={AtelierIndex} />
        <Route path="/atelier/:section" component={AtelierIndex} />
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
        <Route path="/ledger/approvals" component={LedgerApprovals} />
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
        <Route path="/accounts/:accountId" component={Account} />
        <Route path="/agents" component={Agents} />
        <Route path="/agents/runs/:runId" component={AgentRun} />
        <Route path="/agents/:agentId" component={AgentProfile} />
        <Route path="/settings" component={Settings} />
        <Route path="/admin" component={Admin} />
        {/* Finance: rate cards + margin policy (Partner-only). The legacy
            /pricing path stays as a back-compat alias so deep-linked rows
            (audit links, dossier exports) keep resolving. */}
        <Route path="/finance" component={Pricing} />
        <Route path="/finance/:section" component={Pricing} />
        <Route path="/pricing" component={Pricing} />
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
