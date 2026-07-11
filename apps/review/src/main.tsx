import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  BlockStack,
  Button,
  Text,
  ThemeToggle,
} from "@agentlint/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider } from "@tanstack/react-router";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { useFinishReview, useReviewState } from "@/api";
import { m } from "@/messages";
import { FindingsPage } from "@/pages/findings-page";
import { GuidedPage } from "@/pages/guided-page";
import { LedgerPage } from "@/pages/ledger-page";
import { RulesPage } from "@/pages/rules-page";
import "./styles.css";

function Layout() {
  const { data } = useReviewState();
  const finish = useFinishReview();
  const [finished, setFinished] = useState<{ summary: string; feedbackPath: string | null } | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);

  if (finished) {
    return (
      <BlockStack gap="sm" align="center" className="px-6 py-32 text-center">
        <Text size="lg" weight="bold" className="text-emerald-600 dark:text-emerald-400">
          {m.finish_title()}
        </Text>
        <Text>{finished.summary}</Text>
        {finished.feedbackPath ? (
          <Text tone="warning" size="sm">
            {m.finish_feedback_note({ path: finished.feedbackPath })}
          </Text>
        ) : null}
        <Text tone="muted" size="sm">
          {m.finish_close_tab()}
        </Text>
      </BlockStack>
    );
  }

  const pending = data?.findings.filter((finding) => finding.status === "pending_approval").length ?? 0;
  const needsDecision =
    data?.findings.filter((finding) => finding.status === "pending_approval" || finding.status === "unresolved")
      .length ?? 0;

  const navLinkClass =
    "rounded-md px-3 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground [&.active]:bg-accent [&.active]:font-semibold [&.active]:text-foreground";

  return (
    <>
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur sm:gap-4 sm:px-5">
        <Text mono weight="bold" className="text-amber-600 dark:text-amber-500">
          {m.app_title()}
        </Text>
        {data ? (
          <Text mono tone="muted" size="xs">
            {m.app_meta({ project: data.project, base: data.base })}
          </Text>
        ) : null}
        <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:ml-2 sm:w-auto">
          <Link to="/" activeOptions={{ exact: true }} className={navLinkClass}>
            {m.nav_review()}
            {pending > 0 ? ` (${pending})` : ""}
          </Link>
          <Link to="/findings" className={navLinkClass}>
            {m.nav_findings()}
          </Link>
          <Link to="/ledger" className={navLinkClass}>
            {m.nav_ledger()}
          </Link>
          <Link to="/rules" className={navLinkClass}>
            {m.nav_rules()}
          </Link>
        </nav>
        <span className="flex-1" />
        <ThemeToggle label={m.theme_toggle()} />
        <Button disabled={finish.isPending} onClick={() => setFinishOpen(true)}>
          {m.finish_review()}
        </Button>
      </header>
      <Outlet />
      <AlertDialog open={finishOpen} onOpenChange={setFinishOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{m.finish_confirm_title()}</AlertDialogTitle>
            <AlertDialogDescription>
              {needsDecision > 0 ? m.finish_confirm_incomplete({ count: needsDecision }) : m.finish_confirm_clean()}
            </AlertDialogDescription>
            {finish.error ? <Text tone="danger">{m.finish_error()}</Text> : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="ghost" onClick={() => setFinishOpen(false)}>
              {m.action_cancel()}
            </Button>
            <Button
              disabled={finish.isPending}
              variant={needsDecision > 0 ? "destructive" : "default"}
              onClick={() => {
                finish.mutate(undefined, {
                  onSuccess: (result) => setFinished({ summary: result.summary, feedbackPath: result.feedbackPath }),
                });
              }}
            >
              {m.finish_confirm_action()}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

const rootRoute = createRootRoute({ component: Layout });

const guidedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: GuidedPage,
});

const findingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/findings",
  component: FindingsPage,
});

const ledgerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ledger",
  component: LedgerPage,
});

const rulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/rules",
  component: RulesPage,
});

const routeTree = rootRoute.addChildren([guidedRoute, findingsRoute, ledgerRoute, rulesRoute]);
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient();

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
