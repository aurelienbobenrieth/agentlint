import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReviewActionRequest, ReviewActionResult, ReviewFinishResult, ReviewStatePayload } from "./types";

async function fetchState(): Promise<ReviewStatePayload> {
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error(`Failed to load review state (${response.status})`);
  return (await response.json()) as ReviewStatePayload;
}

export function useReviewState() {
  return useQuery({ queryKey: ["state"], queryFn: fetchState, refetchOnWindowFocus: false });
}

export function useReviewAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: ReviewActionRequest): Promise<ReviewActionResult> => {
      const response = await fetch("/api/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action),
      });
      const result = (await response.json()) as ReviewActionResult;
      if (!response.ok) throw new Error(result.message);
      return result;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["state"] }),
  });
}

export function useFinishReview() {
  return useMutation({
    mutationFn: async (): Promise<ReviewFinishResult> => {
      const response = await fetch("/api/finish", { method: "POST" });
      if (!response.ok) throw new Error(`Failed to finish review (${response.status})`);
      return (await response.json()) as ReviewFinishResult;
    },
  });
}
