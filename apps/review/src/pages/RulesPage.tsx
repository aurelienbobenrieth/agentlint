import { BlockStack, Card, InlineStack, PageSection, StatePill, Text } from "@agentlint/ui";
import { useReviewState } from "@/api";
import { GuidancePanel } from "@/components/GuidancePanel";
import { m } from "@/paraglide/messages.js";

export function RulesPage() {
  const { data, isLoading } = useReviewState();

  if (isLoading || !data) return null;

  return (
    <PageSection>
      {data.rules.map((rule) => (
        <Card key={rule.id} className="mb-4 gap-0 p-0">
          <BlockStack gap="xs" className="border-b px-4 py-3">
            <Text mono weight="semibold" className="text-blue-600 dark:text-blue-400">
              {rule.id}
            </Text>
            <Text tone="muted" size="sm">
              {rule.description}
            </Text>
          </BlockStack>
          <BlockStack gap="sm" className="py-3">
            <GuidancePanel rule={rule} />
            <InlineStack gap="sm" className="px-4">
              <StatePill tone={rule.resolution === "human" ? "human" : "muted"}>
                {m.rules_resolution({ resolution: rule.resolution })}
              </StatePill>
              <StatePill tone={rule.persistence === "durable" ? "durable" : "muted"}>
                {m.rules_persistence({ persistence: rule.persistence })}
              </StatePill>
            </InlineStack>
          </BlockStack>
        </Card>
      ))}
    </PageSection>
  );
}
