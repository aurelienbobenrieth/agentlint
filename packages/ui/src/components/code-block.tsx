import type * as React from "react";
import { cn } from "@ui/lib/utils";

interface CodeBlockProps extends React.ComponentProps<"div"> {
  /** Pre-rendered lines, e.g. `"  12 | const x = 1"`. */
  lines: ReadonlyArray<string>;
  /** Predicate marking the highlighted line(s). */
  isHighlighted?: (line: string, index: number) => boolean;
}

/**
 * CodeBlock — monospace source excerpt with optional highlighted lines.
 * Purely presentational: callers pass already-formatted gutter text.
 */
export function CodeBlock({ lines, isHighlighted, className, ...props }: CodeBlockProps) {
  return (
    <div
      data-slot="code-block"
      className={cn(
        "overflow-x-auto rounded-lg border bg-muted/40 py-2 font-mono text-xs leading-relaxed",
        className,
      )}
      {...props}
    >
      {lines.map((line, index) => (
        <div
          key={index}
          className={cn(
            "whitespace-pre px-3",
            isHighlighted?.(line, index) && "border-l-2 border-amber-500 bg-amber-500/10",
          )}
        >
          {line.length > 0 ? line : " "}
        </div>
      ))}
    </div>
  );
}

/**
 * ContrastCode — bad/good calibration snippet used for guidance examples.
 */
export function ContrastCode({
  kind,
  children,
  className,
  ...props
}: React.ComponentProps<"pre"> & { kind: "bad" | "good" }) {
  return (
    <pre
      data-slot="contrast-code"
      className={cn(
        "overflow-x-auto rounded-md border px-3 py-2 font-mono text-xs",
        kind === "bad"
          ? "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300"
          : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
        className,
      )}
      {...props}
    >
      {children}
    </pre>
  );
}
