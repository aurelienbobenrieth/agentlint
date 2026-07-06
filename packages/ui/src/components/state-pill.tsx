import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@ui/lib/utils";

/**
 * StatePill — semantic status indicator for finding and disposition states.
 * Rounded-full pill with tone-based color ramps for instantly legible state,
 * independent of theme accent tokens.
 */
const statePillVariants = cva(
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        unresolved: "bg-red-500/10 text-red-600 dark:text-red-400",
        pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        accepted: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        approved: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        deferred: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
        muted: "bg-muted text-muted-foreground",
        human: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
        durable: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
      },
    },
    defaultVariants: {
      tone: "muted",
    },
  },
);

export type StatePillTone = NonNullable<VariantProps<typeof statePillVariants>["tone"]>;

export function StatePill({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof statePillVariants>) {
  return <span data-slot="state-pill" className={cn(statePillVariants({ tone }), className)} {...props} />;
}
