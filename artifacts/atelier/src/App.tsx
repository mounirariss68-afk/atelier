import * as React from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useAtelierGetMe } from "@workspace/api-client-react";
import { isSelfOnlyRole, isAlliancePartnerRole, isNonEquityPartnerRole } from "@/lib/lens";
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
  MutationCache,
} from "@tanstack/react-query";
import { AuthProvider, useAuth, notifyUnauthenticated } from "@/lib/auth";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "@/components/layout/Shell";
import { CreateAccountProvider } from "@/components/CreateAccountContext";
import { ThemeProvider } from "@/lib/theme";
import NotFound from "@/pages/not-found";

// Pages
import SignIn from "@/pages/SignIn";
import { PartnerPortalHome, PartnerPortalOpportunity, PartnerPortalContracts, PartnerPortalBilling, PartnerPortalCompany, PartnerPortalDelivery, PartnerPortalDeliveryDetail, PartnerPortalDocuments, PartnerPortalPreview } from "@/pages/PartnerPortal";
import Activate from "@/pages/Activate";
import PartnerRegister from "@/pages/PartnerRegister";
import ResetPassword from "@/pages/ResetPassword";
import PrivacyPolicy from "@/pages/PrivacyPolicy";
import SupportPage from "@/pages/Support";
import ForcePasswordChange from "@/pages/ForcePasswordChange";
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
import WinLossIntake from "@/pages/WinLossIntake";
import Reports from "@/pages/Reports";
import Documents from "@/pages/Documents";
import Agreements from "@/pages/Agreements";
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
import WalletCash from "@/pages/wallet/WalletCash";
import WalletCashRecon from "@/pages/wallet/WalletCashRecon";
import WalletTreasury from "@/pages/wallet/WalletTreasury";
import { SalonRoot } from "@/pages/salon/SalonRoutes";
// v5 — Scale & Trust
import PressIndex from "@/pages/press/PressIndex";
import PartnersIndex from "@/pages/partners/PartnersIndex";
// Task #125 — the old Studio views were replaced by real hiring CRUD under
// /people/hire; the legacy /studio/* paths still permanently redirect.
import GuardhouseIndex from "@/pages/guardhouse/GuardhouseIndex";
import IpCatalog from "@/pages/atelier/IpCatalog";
import Codex from "@/pages/Codex";
import CodexContract from "@/pages/CodexContract";
import CodexCounterparty from "@/pages/CodexCounterparty";
import CodexClause from "@/pages/CodexClause";
import CodexDpa from "@/pages/CodexDpa";
import CodexDpas from "@/pages/CodexDpas";
import CodexRenewals from "@/pages/CodexRenewals";
// Task #368 — Manage shell lens placeholders. The Clients lens content ships
// in its own follow-up task; until then it renders a "Lens coming soon" page
// so the picker, deep links and persistence still resolve. The People lens
// is filled in by Task #364. /finance keeps its
// existing pages as its lens home.
import {
  FinanceLensHome,
} from "@/pages/lens/LensPlaceholder";
// Founder-facing Finance MVP. Advanced finance routes remain mounted below for
// bookmarked detail links, but the primary workspace exposes six simple tasks.
import FinanceMvpOverview from "@/pages/finance/FinanceMvpOverview";
import FinanceMvpMoneyOut from "@/pages/finance/FinanceMvpMoneyOut";
import FinanceMvpMoneyIn from "@/pages/finance/FinanceMvpMoneyIn";
import FinanceMvpReconcile from "@/pages/finance/FinanceMvpReconcile";
import FinanceMvpReports from "@/pages/finance/FinanceMvpReports";
// Task #1091 — unified finance approvals inbox + autopilot settings.
import FinanceApprovals from "@/pages/finance/FinanceApprovals";
import FinanceEntities from "@/pages/finance/FinanceEntities";
import FinanceEntityDetail from "@/pages/finance/FinanceEntityDetail";
// Task #418 — Finance Payables (P2P) hardening sub-pages.
import {
  FinancePayablesPaymentRuns,
  FinancePayablesRunHistory,
  FinancePayablesSelfBilling,
  FinancePayablesPartnerInvoices,
  FinancePayablesSupplierInvoices,
  FinancePayablesWht,
} from "@/pages/finance/FinancePayables";
// Task #419 — Wave 7: Finance Comply sub-pages.
import FinanceComplyControls from "@/pages/finance/FinanceComplyControls";
import FinanceComplyStatutory from "@/pages/finance/FinanceComplyStatutory";
import FinanceComplyTp from "@/pages/finance/FinanceComplyTp";
import FinanceComplyInsurance from "@/pages/finance/FinanceComplyInsurance";
// Task #415 — Finance Plan: 13-week cash forecast and backlog/pipeline coverage.
import FinancePlanCash13w from "@/pages/finance/FinancePlanCash13w";
import FinancePlanBacklog from "@/pages/finance/FinancePlanBacklog";
import FinanceReportsPnl from "@/pages/finance/FinanceReportsPnl";
import FinanceReportsBs from "@/pages/finance/FinanceReportsBs";
import FinanceReportsCf from "@/pages/finance/FinanceReportsCf";
import FinanceReportsCube from "@/pages/finance/FinanceReportsCube";
import FinanceReportsMargin from "@/pages/finance/FinanceReportsMargin";
import FinanceReportsWorkingCapital from "@/pages/finance/FinanceReportsWorkingCapital";
import FinanceReportsBoardPack from "@/pages/finance/FinanceReportsBoardPack";
// Task #414 — Wave 2 engagement P&L / EAC / change-order register pages.
import EngagementHealth from "@/pages/finance/EngagementHealth";
import EngagementPnl from "@/pages/finance/EngagementPnl";
// Task #1251 — vendor tooling cost allocation.
import ToolingSpend from "@/pages/finance/ToolingSpend";
import BillingWorklist from "@/pages/finance/BillingWorklist";
import FinancePayroll from "@/pages/finance/FinancePayroll";
import FinanceNepComp from "@/pages/finance/FinanceNepComp";
import LedgerPage from "@/pages/finance/LedgerPage";
// Task #420 — Wave 8: FP&A driver-based plan surfaces. Renewals/Scenarios
// supersede the simpler Task #440 stubs with the FP&A-engine versions.
import FinancePlanBudget from "@/pages/finance/FinancePlanBudget";
import FinancePlanScenarios from "@/pages/finance/FinancePlanScenarios";
import FinancePlanHeadcount from "@/pages/finance/FinancePlanHeadcount";
import FinancePlanRenewals from "@/pages/finance/FinancePlanRenewals";
import FinancePlanBonus from "@/pages/finance/FinancePlanBonus";
// Agents is deliberately small and runtime-backed: catalogue, profile, and
// persisted run detail/history. Lifecycle showcase pages are not operations.
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
  ClientsEngagement,
  ClientsEngagementDeliverable,
  ClientsBilling,
  ClientsReferences,
} from "@/pages/lens/ClientsStages";
import { Redirect } from "@/components/Redirect";

// Task #364 — the People lens.
import PeopleHome from "@/pages/people/PeopleHome";
// Task #50 — the self-service Me lens (visible to all; only lens for
// self-only personas).
import MeHome from "@/pages/me/MeHome";
// Task #161 — read-only Me-lens contract detail (self-scope routes).
import MeContractDetail from "@/pages/me/MeContractDetail";
// Task #159 — contract lifecycle (templates + contracts + detail).
// Task #274 — promoted to a top-level Contracts lens: Overview page plus
// per-section pages (Templates · Drafts · Active · Archive).
import ContractsOverview from "@/pages/contracts/ContractsOverview";
import {
  ContractsTemplatesPage,
  ContractsDraftsPage,
  ContractsActivePage,
  ContractsArchivePage,
} from "@/pages/contracts/ContractsHome";
import ContractDetail from "@/pages/contracts/ContractDetail";
import PeopleAttract from "@/pages/people/PeopleAttract";
import PeopleHire from "@/pages/people/PeopleHire";
import PeopleOnboard from "@/pages/people/PeopleOnboard";
import PeopleDevelop from "@/pages/people/PeopleDevelop";
import PeoplePerform from "@/pages/people/PeoplePerform";
import PeopleReward from "@/pages/people/PeopleReward";
import PeopleOffboard from "@/pages/people/PeopleOffboard";
import PeopleApprovals from "@/pages/people/PeopleApprovals";
import PeoplePeople from "@/pages/people/PeoplePeople";
import PeoplePerson from "@/pages/people/PeoplePerson";
import PeopleAccess from "@/pages/people/PeopleAccess";
import PeopleSkills from "@/pages/people/PeopleSkills";
import PeopleComposition from "@/pages/people/PeopleComposition";
import PeopleCompliance from "@/pages/people/PeopleCompliance";
import PeopleTime from "@/pages/people/PeopleTime";
import FinancePreFormation from "@/pages/finance/FinancePreFormation";

/**
 * Permanent client-side redirect — used for the legacy /studio, /roster
 * and /ledger/timesheet* paths which Task #364 folded into the People
 * lens. Preserves dynamic path segments and the search string so deep
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

// Task #1 — any query/mutation failing with 401 flips the auth gate back
// to the login screen (session expired or revoked server-side).
function is401(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { status?: number }).status === 401
  );
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => {
      if (is401(err)) notifyUnauthenticated();
    },
  }),
  mutationCache: new MutationCache({
    onError: (err) => {
      if (is401(err)) notifyUnauthenticated();
    },
  }),
});

/** Renders the login screen for any route while unauthenticated. */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { status, mustChangePassword } = useAuth();
  // One-time joiner activation link — must render pre-auth (the new
  // joiner has no session yet). The page itself validates the token.
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/activate")) {
    return <Activate />;
  }
  // Task #874 — public partner registration link (token-gated). Must render
  // pre-auth: the invited partner has no session yet. The page validates
  // the single-use token itself.
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/partner-register")) {
    return <PartnerRegister />;
  }
  // Task #820 — self-service password reset (request form + tokened set
  // form). Must render pre-auth; the page itself validates the token.
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/reset-password")) {
    return <ResetPassword />;
  }
  // Task #621 — App Store compliance pages: publicly readable, no session
  // required. Static informational content only; every data route stays
  // behind the server's auth gate.
  if (typeof window !== "undefined" && window.location.pathname === "/privacypolicy") {
    return <PrivacyPolicy />;
  }
  if (typeof window !== "undefined" && window.location.pathname === "/support") {
    return <SupportPage />;
  }
  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="font-mono text-xs uppercase tracking-widest text-text-faint">
          Loading…
        </span>
      </div>
    );
  }
  if (status === "unauthenticated") return <SignIn />;
  // Task #5 — after a partner reset, block the app behind a forced change
  // (the server also 403s every data route until it's done).
  if (mustChangePassword) return <ForcePasswordChange />;
  return <>{children}</>;
}

/**
 * Task #444 — route-level guard for self-only personas (employee /
 * contractor). Their server boundary is locked to /me + /cli, so every
 * org-wide page (Clients, People, Reports, …) would just mount and fire
 * a stream of 403'd fetches. Steer them to the Me lens instead of
 * rendering the dead-end page at all.
 */
function SelfOnlyRouteGuard({ children }: { children: React.ReactNode }) {
  const { data: me } = useAtelierGetMe();
  const [location, setLocation] = useLocation();
  const selfOnly = isSelfOnlyRole(me?.role);
  // Task #873 — alliance-partner logins are even narrower: ONLY the
  // partner portal (/partner*) and chat. No Me lens either.
  const alliancePartner = isAlliancePartnerRole(me?.role);
  // Task #1297 — non-equity partners: Me lens + their accounts/opportunities
  // slice + chat. Every other org page would 403 at the server's central
  // gate, so steer them to their accounts list instead.
  const nep = isNonEquityPartnerRole(me?.role);
  const nepAllowed =
    location === "/sign-in" ||
    location === "/me" ||
    location.startsWith("/me/") ||
    location === "/cli" ||
    location.startsWith("/cli/") ||
    location === "/clients/accounts" ||
    location.startsWith("/clients/accounts/") ||
    location === "/clients/opportunities" ||
    location.startsWith("/clients/opportunities/") ||
    location.startsWith("/accounts/") ||
    location.startsWith("/opportunities/");
  const allowed =
    location === "/sign-in" ||
    location === "/me" ||
    location.startsWith("/me/") ||
    location === "/cli" ||
    location.startsWith("/cli/");
  const partnerAllowed =
    location === "/sign-in" ||
    location === "/partner" ||
    location.startsWith("/partner/") ||
    location === "/cli" ||
    location.startsWith("/cli/");
  const blocked =
    (alliancePartner && !partnerAllowed) ||
    (nep && !nepAllowed) ||
    (!alliancePartner && !nep && selfOnly && !allowed);
  React.useEffect(() => {
    if (blocked)
      setLocation(
        alliancePartner ? "/partner" : nep ? "/clients/accounts" : "/me",
        { replace: true },
      );
  }, [blocked, alliancePartner, nep, setLocation]);
  if (blocked) return null;
  // Task #444 — while /me is still loading we can't tell whether the user is
  // self-only. Hold off mounting org routes so their queries (accounts,
  // executive-mapper rollups, …) don't fire-and-403 for employee/contractor.
  if (!me && !allowed) return null;
  return <>{children}</>;
}

function Router() {
  return (
    <Shell>
      <SelfOnlyRouteGuard>
      <Switch>
        <Route path="/sign-in" component={SignIn} />
        <Route path="/cli" component={Cli} />
        {/* Task #873 — alliance-partner portal (the ONLY pages that
            role can reach; SelfOnlyRouteGuard steers them here). */}
        <Route path="/partner" component={PartnerPortalHome} />
        <Route path="/partner/opportunities/:oppId" component={PartnerPortalOpportunity} />
        {/* Task #875 — partner contracts & billing hub. */}
        <Route path="/partner/contracts" component={PartnerPortalContracts} />
        <Route path="/partner/billing" component={PartnerPortalBilling} />
        {/* Task #1174 — partner delivery view + shared documents. */}
        <Route path="/partner/delivery" component={PartnerPortalDelivery} />
        <Route path="/partner/delivery/:engId" component={PartnerPortalDeliveryDetail} />
        <Route path="/partner/documents" component={PartnerPortalDocuments} />
        {/* Task #1172 — partner company profile (firm details, documents, contacts). */}
        <Route path="/partner/company" component={PartnerPortalCompany} />
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
        {/* Task #376 split into the flat-IA Clients lens: themes-only
            reference library lives under `/clients/references`; the
            debrief intake workbench (WinLossIntake) keeps a standalone
            `/win-loss` URL for dossier / report deep-links since the
            flat IA doesn't expose a dedicated Win stage. */}
        <Route path="/win-loss-library">{() => <Redirect to="/clients/references" />}</Route>
        <Route path="/win-loss/debriefs">{() => <WinLossIntake />}</Route>
        <Route path="/win-loss">{() => <WinLossIntake />}</Route>
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
        <Route path="/documents" component={Documents} />
        {/* Task #274 — Contracts is a top-level Manage lens (partner-tier):
            Overview · Templates · Drafts · Out for Signature · Active ·
            Archive, with the CLM register (former Codex) under
            /contracts/codex. The e-sign surface (Task #62, formerly
            /agreements) is the "Out for Signature" section; /agreements
            permanent-redirects and preserves ?request=/?focus= deep-links. */}
        <Route path="/agreements" component={redirectTo("/contracts/signatures")} />
        <Route path="/contracts/signatures" component={Agreements} />
        <Route path="/contracts/templates" component={ContractsTemplatesPage} />
        <Route path="/contracts/drafts" component={ContractsDraftsPage} />
        <Route path="/contracts/active" component={ContractsActivePage} />
        <Route path="/contracts/archive" component={ContractsArchivePage} />
        {/* CLM register (Codex) re-mounted inside the Contracts lens.
            More specific routes must precede /contracts/codex/:section,
            and all of these must precede /contracts/:id. */}
        <Route path="/contracts/codex/contracts/:id" component={CodexContract} />
        <Route path="/contracts/codex/counterparties/:id" component={CodexCounterparty} />
        <Route path="/contracts/codex/clauses/:id" component={CodexClause} />
        <Route path="/contracts/codex/dpas/:id" component={CodexDpa} />
        <Route path="/contracts/codex/dpas" component={CodexDpas} />
        <Route path="/contracts/codex/renewals" component={CodexRenewals} />
        <Route path="/contracts/codex/:section" component={Codex} />
        <Route path="/contracts/codex" component={Codex} />
        {/* Task #159 — contract record detail. Registered after the section
            and codex routes so those segments never parse as :id. */}
        <Route path="/contracts/:id" component={ContractDetail} />
        <Route path="/contracts" component={ContractsOverview} />
        {/* Task #375 — engagement workspace re-mounted under the Clients
            lens. Listing + detail + deliverable detail (with the optional
            `:tab` deep-link segment) all live under
            `/clients/deliver/engagements/*`; legacy `/engagements/*` and
            the interim `/clients/engagements/*` paths permanent-redirect
            via `<Redirect/>` (which preserves query strings) so dossier
            links, audit logs and notification emails keep resolving. */}
        <Route path="/engagements">{() => <Redirect to="/clients/deliver/engagements" />}</Route>
        <Route path="/engagements/:engId/deliverables/:delId">
          {(p) => (
            <Redirect
              to={`/clients/deliver/engagements/${p.engId}/deliverables/${p.delId}`}
            />
          )}
        </Route>
        <Route path="/engagements/:engId/:tab">
          {(p) => (
            <Redirect to={`/clients/deliver/engagements/${p.engId}/${p.tab}`} />
          )}
        </Route>
        <Route path="/engagements/:engId">
          {(p) => <Redirect to={`/clients/deliver/engagements/${p.engId}`} />}
        </Route>
        {/* Task #274 — legacy /codex* URLs permanent-redirect into the
            Contracts lens (/contracts/codex*), preserving path segments
            and query strings so dossier / chat deep-links keep landing. */}
        <Route path="/codex/contracts/:id">
          {(p) => <Redirect to={`/contracts/codex/contracts/${p.id}`} />}
        </Route>
        <Route path="/codex/counterparties/:id">
          {(p) => <Redirect to={`/contracts/codex/counterparties/${p.id}`} />}
        </Route>
        <Route path="/codex/clauses/:id">
          {(p) => <Redirect to={`/contracts/codex/clauses/${p.id}`} />}
        </Route>
        <Route path="/codex/dpas/:id">
          {(p) => <Redirect to={`/contracts/codex/dpas/${p.id}`} />}
        </Route>
        <Route path="/codex/:section">
          {(p) => <Redirect to={`/contracts/codex/${p.section}`} />}
        </Route>
        <Route path="/codex" component={redirectTo("/contracts/codex")} />
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
        {/* Task #364 — /studio routes are folded into the People lens /people/hire.
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
        {/* Task #442 — legacy EngagementEconomics page redirects to the
            new Financials tab on the engagement workspace. The page is
            still mounted under /finance/reports/engagement-economics/:id
            for the partner-firm passthrough roll-up + Utilisation
            Analyst commentary deep-dive. */}
        <Route path="/ledger/engagement-economics/:engagementId">
          {(params) => (
            <Redirect
              to={`/clients/deliver/engagements/${params.engagementId}/financials`}
            />
          )}
        </Route>
        <Route path="/ledger/utilization" component={Utilization} />
        <Route path="/ledger/utilization/:personId" component={Utilization} />
        <Route path="/ledger/firm-economics" component={FirmEconomics} />
        <Route path="/wallet">{() => <Redirect to="/finance/money-out" />}</Route>
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
        <Route path="/wallet/cash" component={WalletCash} />
        <Route path="/wallet/cash/recon" component={WalletCashRecon} />
        <Route path="/wallet/treasury" component={WalletTreasury} />
        <Route path="/wallet/collections" component={WalletCollections} />
        <Route path="/accounts/:accountId" component={Account} />
        <Route path="/agents/runs/:runId" component={AgentRun} />
        {/* Legacy lifecycle and monitor URLs redirect to the retained MVP. */}
        <Route path="/agents/library">
          {() => <Redirect to="/agents" />}
        </Route>
        <Route path="/agents/monitor">
          {() => <Redirect to="/agents" />}
        </Route>
        <Route path="/agents/design">
          {() => <Redirect to="/agents" />}
        </Route>
        <Route path="/agents/design/:agentId">
          {(params) => {
            return <Redirect to={`/agents/${params.agentId}`} />;
          }}
        </Route>
        <Route path="/agents/monitor/runs/:runId">
          {(params) => <Redirect to={`/agents/runs/${params.runId}`} />}
        </Route>
        {["/agents/build", "/agents/evaluate", "/agents/deploy", "/agents/improve", "/agents/retire", "/agents/outcomes"].map((path) => (
          <Route key={path} path={path}>
            {() => <Redirect to="/agents" />}
          </Route>
        ))}
        <Route path="/agents/:agentId">
          {(params) => <AgentProfile key={params.agentId} />}
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
        {/* Task #372 — `/finance/rates*` is a back-compat alias for the
            new canonical `/finance/billing/rate-cards`; the bare `/pricing`
            deep-link also still resolves. */}
        <Route path="/finance/rates">{() => <Redirect to="/finance/billing/rate-cards" />}</Route>
        <Route path="/finance/rates/:section">{() => <Redirect to="/finance/billing/rate-cards" />}</Route>
        <Route path="/finance/billing/rate-cards" component={Pricing} />
        <Route path="/finance/billing/rate-cards/:section" component={Pricing} />
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
        {/* Task #375 — engagement workspace re-mounted under the Clients
            lens at `/clients/deliver/engagements/*`. More-specific routes
            must precede the listing route so wouter matches them first.
            The optional `:tab` segment lets other surfaces deep-link
            straight to a workspace tab (charter / workplan / deliverables
            / agents / processes / meetings / artifacts / audit, including
            the L2C Wave 1 surfaces inside those tabs). */}
        <Route
          path="/clients/deliver/engagements/:engId/deliverables/:delId"
          component={ClientsEngagementDeliverable}
        />
        <Route
          path="/clients/deliver/engagements/:engId/:tab"
          component={ClientsEngagement}
        />
        <Route
          path="/clients/deliver/engagements/:engId"
          component={ClientsEngagement}
        />
        <Route path="/clients/deliver/engagements" component={ClientsEngagements} />
        <Route path="/clients/billing" component={ClientsBilling} />
        <Route path="/clients/references" component={ClientsReferences} />
        {/* Permanent redirects from the previous lifecycle IA so external
            deep-links (dossiers, reports, audit trail) keep landing. */}
        <Route path="/clients/prospect">{() => <Redirect to="/clients/accounts" />}</Route>
        <Route path="/clients/pursue">{() => <Redirect to="/clients/opportunities" />}</Route>
        <Route path="/clients/win">{() => <Redirect to="/clients/opportunities" />}</Route>
        {/* Interim path from earlier in #375 — redirect into the canonical
            `/clients/deliver/engagements/*` location. More-specific routes
            first so deep links preserve their tab / deliverable segments. */}
        <Route path="/clients/engagements/:engId/deliverables/:delId">
          {(p) => (
            <Redirect
              to={`/clients/deliver/engagements/${p.engId}/deliverables/${p.delId}`}
            />
          )}
        </Route>
        <Route path="/clients/engagements/:engId/:tab">
          {(p) => (
            <Redirect to={`/clients/deliver/engagements/${p.engId}/${p.tab}`} />
          )}
        </Route>
        <Route path="/clients/engagements/:engId">
          {(p) => <Redirect to={`/clients/deliver/engagements/${p.engId}`} />}
        </Route>
        <Route path="/clients/engagements">{() => <Redirect to="/clients/deliver/engagements" />}</Route>
        <Route path="/clients/deliver">{() => <Redirect to="/clients/deliver/engagements" />}</Route>
        <Route path="/clients/bill">{() => <Redirect to="/clients/billing" />}</Route>
        <Route path="/clients/renew">{() => <Redirect to="/clients/opportunities" />}</Route>
        <Route path="/clients/reference">{() => <Redirect to="/clients/references" />}</Route>
        {/* Task #364 — People lens. Order matters: more specific routes
            first, then sub-section catch-alls, then the lens home. */}
        <Route path="/people/attract">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/attract/:section">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/hire">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/hire/:section">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/onboard">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/onboard/:section">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/develop">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/develop/:section">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/perform">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/perform/:section">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/reward">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/reward/:section">{() => <Redirect to="/people/people" />}</Route>
        {/* Task #509 — Retain and Org stubs removed; redirect stale links. */}
        <Route path="/people/retain/:section">{() => <Redirect to="/people" />}</Route>
        <Route path="/people/retain">{() => <Redirect to="/people" />}</Route>
        <Route path="/people/offboard">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/offboard/:section">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/org/:section">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/org">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/approvals" component={PeopleApprovals} />
        <Route path="/people/people" component={PeoplePeople} />
        <Route path="/people/people/:id" component={PeoplePerson} />
        <Route path="/people/people/:id/:tab" component={PeoplePerson} />
        <Route path="/people/access">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/skills">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/composition">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/compliance">{() => <Redirect to="/people/people" />}</Route>
        <Route path="/people/time" component={PeopleTime} />
        <Route path="/people/time/:personId/:weekIso" component={PeopleTime} />
        <Route path="/people">{() => <Redirect to="/people/people" />}</Route>
        {/* Task #50 — Me lens: one page, section tabs. */}
        <Route path="/me" component={MeHome} />
        {/* Task #161 — read-only self-scope contract detail; must be
            registered before /me/:section so it wins the match. */}
        <Route path="/me/contracts/:id" component={MeContractDetail} />
        <Route path="/me/:section" component={MeHome} />
        {/* Task #371 — Partners lens (alliance lifecycle). The index +
            stage views all live in PartnersIndex, which keys off the
            :section param. */}
        <Route path="/partners" component={PartnersIndex} />
        {/* Task #1173 — preview-as-partner (leadership only). Renders the
            SAME portal pages read-only inside the internal shell. Declared
            BEFORE /partners/:section so "preview" isn't swallowed as a
            PartnersIndex section. */}
        <Route path="/partners/preview/:firmId" component={PartnerPortalPreview} />
        <Route path="/partners/preview/:firmId/contracts" component={PartnerPortalPreview} />
        <Route path="/partners/preview/:firmId/billing" component={PartnerPortalPreview} />
        <Route path="/partners/preview/:firmId/company" component={PartnerPortalPreview} />
        <Route path="/partners/preview/:firmId/opportunities/:oppId" component={PartnerPortalPreview} />
        <Route path="/partners/preview/:firmId/delivery" component={PartnerPortalPreview} />
        <Route path="/partners/preview/:firmId/delivery/:engId" component={PartnerPortalPreview} />
        <Route path="/partners/preview/:firmId/documents" component={PartnerPortalPreview} />
        <Route path="/partners/:section" component={PartnersIndex} />
        <Route path="/agents" component={Agents} />
        {/* Finance MVP: six founder-facing destinations. Advanced pages stay
            mounted as deliberate detail routes for old bookmarks and future
            reactivation, but do not appear in Finance navigation. */}
        <Route path="/finance" component={FinanceMvpOverview} />
        {/* Task #1091 — unified approvals inbox (founding_partner |
            partner | finance; the finance lens itself is already gated to
            those roles). */}
        <Route path="/finance/approvals" component={FinanceApprovals} />
        <Route path="/finance/entities" component={FinanceEntities} />
        <Route path="/finance/money-out" component={FinanceMvpMoneyOut} />
        <Route path="/finance/money-in" component={FinanceMvpMoneyIn} />
        <Route path="/finance/reconcile" component={FinanceMvpReconcile} />
        <Route path="/finance/pre-formation" component={FinancePreFormation} />
        <Route path="/finance/entities/:id" component={FinanceEntityDetail} />
        <Route path="/finance/billing/worklist" component={BillingWorklist} />
        <Route path="/finance/billing">{() => <Redirect to="/finance/money-in" />}</Route>
        {/* Task #1103 — dedicated payables landing (action inbox + staged
            groups) replaces the generic FinanceSection landing. */}
        <Route path="/finance/payables">{() => <Redirect to="/finance/money-out" />}</Route>
        <Route path="/finance/payables/self-billing" component={FinancePayablesSelfBilling} />
        <Route path="/finance/payables/partner-invoices" component={FinancePayablesPartnerInvoices} />
        {/* Task #1070 — internal supplier-invoice upload + review. */}
        <Route path="/finance/payables/supplier-invoices" component={FinancePayablesSupplierInvoices} />
        <Route path="/finance/payables/payment-runs" component={FinancePayablesPaymentRuns} />
        <Route path="/finance/payables/run-history" component={FinancePayablesRunHistory} />
        <Route path="/finance/payables/wht" component={FinancePayablesWht} />
        <Route path="/finance/close">{() => <Redirect to="/finance/reconcile" />}</Route>
        {/* Task #655 — statutory payroll runs, EOSB, filings. */}
        <Route path="/finance/payroll" component={FinancePayroll} />
        {/* Task #1298 — non-salaried NEP compensation (plans, margin-share
            entitlements, conversion tracker). Comp-gated server-side. */}
        <Route path="/finance/nep-comp" component={FinanceNepComp} />
        {/* Task #428 — Finance GL backbone: chart of accounts, journal,
            trial balance, Bookkeeper, exceptions, entity tagging. */}
        <Route path="/finance/ledger" component={LedgerPage} />
        <Route path="/finance/plan/cash-13w" component={FinancePlanCash13w} />
        <Route path="/finance/plan/backlog" component={FinancePlanBacklog} />
        <Route path="/finance/plan/budget" component={FinancePlanBudget} />
        <Route path="/finance/plan/scenarios" component={FinancePlanScenarios} />
        <Route path="/finance/plan/headcount" component={FinancePlanHeadcount} />
        <Route path="/finance/plan/renewals" component={FinancePlanRenewals} />
        <Route path="/finance/plan/bonus" component={FinancePlanBonus} />
        <Route path="/finance/plan">{() => <Redirect to="/finance/reports" />}</Route>
        {/* Task #417 (Wave 5) — three-statement, profitability cube, board pack. */}
        <Route path="/finance/reports/pnl" component={FinanceReportsPnl} />
        <Route path="/finance/reports/bs" component={FinanceReportsBs} />
        <Route path="/finance/reports/cf" component={FinanceReportsCf} />
        <Route path="/finance/reports/profitability" component={FinanceReportsCube} />
        <Route path="/finance/reports/board-pack" component={FinanceReportsBoardPack} />
        <Route path="/finance/reports/margin" component={FinanceReportsMargin} />
        <Route path="/finance/reports/working-capital" component={FinanceReportsWorkingCapital} />
        <Route path="/finance/reports" component={FinanceMvpReports} />
        {/* Task #419 — Comply registers (controls + SoD, statutory, TP, insurance).
            These must come before the catch-all /finance/comply landing. */}
        <Route path="/finance/comply/controls" component={FinanceComplyControls} />
        <Route path="/finance/comply/statutory" component={FinanceComplyStatutory} />
        <Route path="/finance/comply/tp" component={FinanceComplyTp} />
        <Route path="/finance/comply/insurance" component={FinanceComplyInsurance} />
        <Route path="/finance/comply">{() => <Redirect to="/finance/reports" />}</Route>
        {/* Re-mounts of existing pages under canonical /finance/* paths.
            The old URLs (/wallet/*, /ledger/firm-economics etc, /forecast,
            /reports) keep working — internal links throughout the app
            still target them — but the canonical Finance lens path is the
            new one. */}
        <Route path="/finance/reports/firm-economics" component={FirmEconomics} />
        <Route path="/finance/reports/utilization" component={Utilization} />
        <Route path="/finance/reports/utilization/:personId" component={Utilization} />
        <Route path="/finance/reports/engagement-economics/:engagementId" component={EngagementEconomics} />
        <Route path="/finance/reports/saved" component={Reports} />
        <Route path="/finance/plan/long-range">
          {() => {
            const search = typeof window !== "undefined" ? window.location.search : "";
            const params = new URLSearchParams(search);
            const by = params.get("by");
            const target = `/clients/opportunities?view=forecast${by ? `&by=${encodeURIComponent(by)}` : ""}`;
            return <Redirect to={target} />;
          }}
        </Route>
        {/* Task #414 — Wave 2 engagement P&L pages (firm register +
            per-engagement EAC / change-order workflow). */}
        <Route path="/finance/plan/engagement-health" component={EngagementHealth} />
        <Route path="/finance/plan/engagement-pnl/:engagementId" component={EngagementPnl} />
        {/* Task #1251 — vendor tooling cost allocation. No placeholder
            /finance/* route precedes this in the Switch, so first-match is
            safe; deep links (?focus=unmapped | ?focus=<invoiceId>) are read
            from the query string inside the page. */}
        <Route path="/finance/tooling" component={ToolingSpend} />
        <Route path="/finance/_lens" component={FinanceLensHome} />
        <Route component={NotFound} />
      </Switch>
      </SelfOnlyRouteGuard>
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
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <AuthGate>
                <CreateAccountProvider>
                  <TopLevelRouter />
                </CreateAccountProvider>
              </AuthGate>
            </AuthProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
