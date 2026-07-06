import { BlockStack, Button, ContrastCode, InlineStack, Text } from "@agentlint/ui";
import { useState } from "react";
import { m } from "@/paraglide/messages.js";
import type { ReviewRulePayload } from "@/types";

/**
 * Guidance with incremental disclosure: the standard and checks are always
 * visible (they are the decision procedure); examples and refs are behind
 * toggles, mirroring how `agentlint explain` works for agents.
 */
export function GuidancePanel({ rule }: { rule: ReviewRulePayload }) {
  const [showExamples, setShowExamples] = useState(false);
  const [showRefs, setShowRefs] = useState(false);

  return (
    <BlockStack gap="sm" className="px-4">
      <BlockStack gap="xs" className="border-l-2 border-border pl-3">
        <Text size="sm">{rule.standard}</Text>
        {rule.checks.length > 0 ? (
          <ul className="m-0 list-disc pl-5">
            {rule.checks.map((check, index) => (
              <li key={index}>
                <Text tone="muted" size="sm">
                  {check}
                </Text>
              </li>
            ))}
          </ul>
        ) : null}
      </BlockStack>

      {(rule.examples.length > 0 || rule.refs.length > 0) && (
        <InlineStack gap="sm">
          {rule.examples.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setShowExamples(!showExamples)}>
              {showExamples ? m.guidance_hide_examples() : m.guidance_show_examples({ count: rule.examples.length })}
            </Button>
          ) : null}
          {rule.refs.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setShowRefs(!showRefs)}>
              {showRefs ? m.guidance_hide_refs() : m.guidance_show_refs({ count: rule.refs.length })}
            </Button>
          ) : null}
        </InlineStack>
      )}

      {showExamples
        ? rule.examples.map((example, index) => (
            <BlockStack key={index} gap="xs">
              {example.label ? (
                <Text tone="muted" size="xs">
                  {example.label}
                </Text>
              ) : null}
              {example.bad ? <ContrastCode kind="bad">{example.bad}</ContrastCode> : null}
              {example.good ? <ContrastCode kind="good">{example.good}</ContrastCode> : null}
            </BlockStack>
          ))
        : null}

      {showRefs ? (
        <BlockStack gap="xs">
          {rule.refs.map((ref, index) =>
            ref.type === "url" ? (
              <a
                key={index}
                href={ref.href}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
              >
                {ref.href}
              </a>
            ) : (
              <Text key={index} tone="muted" size="xs">
                {m.skill_ref({ id: ref.id })}
              </Text>
            ),
          )}
        </BlockStack>
      ) : null}
    </BlockStack>
  );
}
