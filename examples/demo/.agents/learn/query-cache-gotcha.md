---
name: query-cache-gotcha
description: useQuery cache keys must include all filter params or stale lists render
triggers:
  files: ["src/**/*.tsx"]
  grep: "useQuery"
---

When a list view renders stale data after filter changes, check that every
filter parameter is part of the queryKey. We lost 50 minutes on this in the
users list: the status filter was read inside queryFn but missing from the
key, so TanStack Query kept serving the unfiltered cache entry.
