import { Switch, Route, Router as WouterRouter, useRoute, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LangProvider } from "@/lib/lang";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ScrollToTop from "@/components/ScrollToTop";
import ChatWidget from "@/components/chat/ChatWidget";
import Home from "@/pages/Home";
import About from "@/pages/About";
import Services from "@/pages/Services";
import ServiceDetail from "@/pages/ServiceDetail";
import Insights from "@/pages/Insights";
import InsightDetail from "@/pages/InsightDetail";
import Industries from "@/pages/Industries";
import Marketplace from "@/pages/Marketplace";
import MarketplaceDetail from "@/pages/MarketplaceDetail";
import Demo from "@/pages/Demo";
import Contact from "@/pages/Contact";
import AssessmentsIndex from "@/pages/assessments/AssessmentsIndex";
import AssessmentDetail from "@/pages/assessments/AssessmentDetail";
import AssessmentResults from "@/pages/assessments/AssessmentResults";
import TeamAssessment from "@/pages/assessments/TeamAssessment";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

/**
 * The /demo/:slug route is mounted as a full-screen, chrome-free
 * experience: no Navbar, Footer, or ChatWidget. Everything else
 * renders inside the standard marketing chrome.
 */
function Router() {
  const [isDemo] = useRoute("/demo/:slug");

  if (isDemo) {
    return (
      <>
        <ScrollToTop />
        <Switch>
          <Route path="/demo/:slug" component={Demo} />
        </Switch>
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <ScrollToTop />
      <Navbar />
      <main className="flex-1">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/about" component={About} />
          <Route path="/services" component={Services} />
          <Route path="/services/:slug" component={ServiceDetail} />
          <Route path="/insights" component={Insights} />
          <Route path="/insights/:slug" component={InsightDetail} />
          <Route path="/industries" component={Industries} />
          <Route path="/marketplace" component={Marketplace} />
          {/* Catalogue redesign — redirect old slugs to new ones (or to /marketplace if dropped). */}
          <Route path="/marketplace/programme-health-copilot">{() => <Redirect to="/marketplace/programme-war-room" />}</Route>
          <Route path="/marketplace/citizen-services-agent">{() => <Redirect to="/marketplace/citizen-services-concierge" />}</Route>
          <Route path="/marketplace/procurement-intelligence">{() => <Redirect to="/marketplace/procurement-negotiation-agent" />}</Route>
          <Route path="/marketplace/network-ops-agent">{() => <Redirect to="/marketplace/network-ops-war-room" />}</Route>
          <Route path="/marketplace/sama-compliance-agent">{() => <Redirect to="/marketplace/sama-compliance-sentinel" />}</Route>
          <Route path="/marketplace/customer-care-multi-agent">{() => <Redirect to="/marketplace/customer-care-hive" />}</Route>
          <Route path="/marketplace/sovereign-data-workbench">{() => <Redirect to="/marketplace/sovereign-data-steward" />}</Route>
          <Route path="/marketplace/knowledge-memory-agent">{() => <Redirect to="/marketplace/enterprise-knowledge-concierge" />}</Route>
          <Route path="/marketplace/energy-trading-copilot">{() => <Redirect to="/marketplace" />}</Route>
          <Route path="/marketplace/retail-demand-forecaster">{() => <Redirect to="/marketplace" />}</Route>
          <Route path="/marketplace/hospitality-revenue-optimizer">{() => <Redirect to="/marketplace" />}</Route>
          <Route path="/marketplace/ev-battery-health-agent">{() => <Redirect to="/marketplace" />}</Route>
          <Route path="/marketplace/fpa-rolling-forecast">{() => <Redirect to="/marketplace" />}</Route>
          <Route path="/marketplace/:slug" component={MarketplaceDetail} />
          <Route path="/contact" component={Contact} />
          <Route path="/assessments" component={AssessmentsIndex} />
          <Route path="/assessments/team/:token" component={TeamAssessment} />
          <Route path="/assessments/:slug/results/:publicId" component={AssessmentResults} />
          <Route path="/assessments/:slug" component={AssessmentDetail} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <Footer />
      <ChatWidget />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LangProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </LangProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
