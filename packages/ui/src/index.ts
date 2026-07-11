/**
 * @agentlint/ui — presentational component library.
 *
 * Layers:
 * - `components/ui/*`: COSS UI primitives (Base UI + Tailwind, copy-in).
 * - `components/*`: agentlint composition and domain presentational
 *   components built on those primitives.
 *
 * Everything exported here is presentation-only: no data fetching, no
 * routing, no agentlint domain logic. Containers live in the apps.
 */

// Composition primitives
export { BlockStack, InlineStack, PageSection, Text } from "./components/layout.js";
export { StatePill, type StatePillTone } from "./components/state-pill.js";
export { CodeBlock, ContrastCode } from "./components/code-block.js";
export { ThemeToggle } from "./components/theme-toggle.js";

// COSS UI primitives
export { Button, buttonVariants, type ButtonProps } from "./components/ui/button.js";
export { Badge, badgeVariants, type BadgeProps } from "./components/ui/badge.js";
export {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "./components/ui/card.js";
export { Tabs, TabsList, TabsPanel, TabsTab } from "./components/ui/tabs.js";
export { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table.js";
export { Textarea } from "./components/ui/textarea.js";
export { Checkbox } from "./components/ui/checkbox.js";
export { Separator } from "./components/ui/separator.js";
export { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js";
export {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./components/ui/alert-dialog.js";
export { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./components/ui/empty.js";
export { Kbd, KbdGroup } from "./components/ui/kbd.js";
export { ScrollArea } from "./components/ui/scroll-area.js";
export { Spinner } from "./components/ui/spinner.js";
export { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip.js";

// Utility
export { cn } from "./lib/utils.js";
