import {
  Badge,
  Checkbox,
  Empty,
  EmptyHeader,
  EmptyTitle,
  PageSection,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from "@agentlint/ui";
import { useState } from "react";
import { useReviewState } from "@/api";
import { m } from "@/paraglide/messages.js";

export function LedgerPage() {
  const { data, isLoading } = useReviewState();
  const [newOnly, setNewOnly] = useState(true);

  if (isLoading || !data) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{m.loading_state()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  const records = data.ledger
    .filter((record) => !newOnly || record.isNew)
    .toSorted((a, b) => b.at.localeCompare(a.at));

  return (
    <PageSection className="max-w-5xl">
      <label className="mb-4 flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <Checkbox checked={newOnly} onCheckedChange={(checked) => setNewOnly(checked === true)} />
        <span>{m.ledger_only_new({ base: data.base })}</span>
      </label>

      {records.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{newOnly ? m.ledger_empty_new({ base: data.base }) : m.ledger_empty()}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead>{m.ledger_col_status()}</TableHead>
              <TableHead>{m.ledger_col_rule()}</TableHead>
              <TableHead>{m.ledger_col_reason()}</TableHead>
              <TableHead>{m.ledger_col_actor()}</TableHead>
              <TableHead>{m.ledger_col_when()}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record, index) => (
              <TableRow key={index}>
                <TableCell>
                  {record.isNew ? (
                    <Badge variant="warning" className="px-1.5 py-px text-[10px]">
                      {m.ledger_tag_new()}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Text mono size="xs">
                    {record.status}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text mono size="xs">
                    {record.ruleId} [{record.hash}]
                  </Text>
                </TableCell>
                <TableCell>{record.reason}</TableCell>
                <TableCell>
                  <Text mono size="xs">
                    {record.actor}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text mono size="xs">
                    {record.at}
                  </Text>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </PageSection>
  );
}
