export async function listOpenOrders(db: Database, accountId: string): Promise<Order[]> {
  return db.orders.findMany({
    where: { accountId, status: "open" },
    orderBy: { createdAt: "desc" },
  });
}

export async function listFailedDeliveries(db: Database): Promise<Delivery[]> {
  return db.deliveries.findMany({ where: { status: "failed" } });
}

export async function listRecentOrders(db: Database): Promise<Order[]> {
  return db.orders.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
}
