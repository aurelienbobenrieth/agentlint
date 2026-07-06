import type * as React from "react";
import { cn } from "@ui/lib/utils";

type Gap = "none" | "xs" | "sm" | "md" | "lg" | "xl";

const GAP_CLASSES: Record<Gap, string> = {
  none: "gap-0",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
  xl: "gap-10",
};

type Align = "start" | "center" | "end" | "baseline" | "stretch";

const ALIGN_CLASSES: Record<Align, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  baseline: "items-baseline",
  stretch: "items-stretch",
};

type Justify = "start" | "center" | "end" | "between";

const JUSTIFY_CLASSES: Record<Justify, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
};

interface StackProps extends React.ComponentProps<"div"> {
  gap?: Gap;
  align?: Align;
  justify?: Justify;
  wrap?: boolean;
}

/**
 * InlineStack — horizontal flex row with gap/alignment tokens.
 */
export function InlineStack({
  gap = "sm",
  align = "center",
  justify = "start",
  wrap = false,
  className,
  ...props
}: StackProps) {
  return (
    <div
      data-slot="inline-stack"
      className={cn(
        "flex flex-row",
        GAP_CLASSES[gap],
        ALIGN_CLASSES[align],
        JUSTIFY_CLASSES[justify],
        wrap && "flex-wrap",
        className,
      )}
      {...props}
    />
  );
}

/**
 * BlockStack — vertical flex column with gap/alignment tokens.
 */
export function BlockStack({ gap = "sm", align = "stretch", justify = "start", className, ...props }: StackProps) {
  return (
    <div
      data-slot="block-stack"
      className={cn("flex flex-col", GAP_CLASSES[gap], ALIGN_CLASSES[align], JUSTIFY_CLASSES[justify], className)}
      {...props}
    />
  );
}

type TextTone = "default" | "muted" | "danger" | "success" | "warning";
type TextSize = "xs" | "sm" | "base" | "lg";

const TONE_CLASSES: Record<TextTone, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  danger: "text-destructive-foreground",
  success: "text-success-foreground",
  warning: "text-warning-foreground",
};

const SIZE_CLASSES: Record<TextSize, string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
};

interface TextProps extends React.HTMLAttributes<HTMLElement> {
  tone?: TextTone;
  size?: TextSize;
  weight?: "normal" | "medium" | "semibold" | "bold";
  mono?: boolean;
  as?: "span" | "p" | "div" | "code";
}

/**
 * Text — typography primitive with tone/size/weight/mono tokens.
 */
export function Text({
  tone = "default",
  size = "sm",
  weight = "normal",
  mono = false,
  as: Component = "span",
  className,
  ...props
}: TextProps) {
  return (
    <Component
      data-slot="text"
      className={cn(
        TONE_CLASSES[tone],
        SIZE_CLASSES[size],
        weight !== "normal" && `font-${weight}`,
        mono && "font-mono",
        className,
      )}
      {...props}
    />
  );
}

/**
 * PageSection — main content column with consistent width and padding.
 */
export function PageSection({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main data-slot="page-section" className={cn("mx-auto w-full max-w-4xl px-6 py-6 pb-24", className)} {...props} />
  );
}
