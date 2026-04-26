import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/ThemeProvider";
import HomePage from "@/pages/HomePage";
import ReportEditorPage from "@/pages/ReportEditorPage";
import PrintReportPage from "@/pages/PrintReportPage";
import SettingsPage from "@/pages/SettingsPage";
import NotFound from "@/pages/not-found";

function KeyedEditor(props: { params: Record<string, string> }) {
  const key = props.params.id ?? props.params.type ?? "new";
  return <ReportEditorPage key={key} />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Router hook={useHashLocation}>
          <Switch>
            <Route path="/" component={HomePage} />
            <Route path="/report/new/:type">{(params) => <ReportEditorPage key={`new-${params.type}`} />}</Route>
            <Route path="/report/:id">{(params) => <ReportEditorPage key={`id-${params.id}`} />}</Route>
            <Route path="/report/:id/print" component={PrintReportPage} />
            <Route path="/settings" component={SettingsPage} />
            <Route component={NotFound} />
          </Switch>
        </Router>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
