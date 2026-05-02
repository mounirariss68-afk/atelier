import { Switch, Route, Router as WouterRouter } from "wouter";
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
import Contact from "@/pages/Contact";
import AssessmentsIndex from "@/pages/assessments/AssessmentsIndex";
import AssessmentDetail from "@/pages/assessments/AssessmentDetail";
import AssessmentResults from "@/pages/assessments/AssessmentResults";
import TeamAssessment from "@/pages/assessments/TeamAssessment";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
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
