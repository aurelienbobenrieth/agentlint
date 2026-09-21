export async function reconcileOrders(db: Database): Promise<void> {
  const orders = await db.orders.findMany({
    where: { reconciliationState: "pending" },
  });

  for (const order of orders) {
    await reconcileOrder(order);
  }
}

export async function expireCheckoutSessions(db: Database): Promise<void> {
  const sessions = await db.checkoutSession.findMany({
    where: { expiresAt: { lt: new Date() } },
  });

  await Promise.all(sessions.map(expireSession));
}
