declare const payments: {
  capture(input: { orderId: string; amount: number; currency: string; idempotencyKey?: string }): Promise<void>;
};

export async function captureOrder(order: Order): Promise<void> {
  await payments.capture({
    orderId: order.id,
    amount: order.total,
    currency: order.currency,
  });
}

export async function retryCapture(order: Order): Promise<void> {
  await payments.capture({ orderId: order.id, amount: order.total, currency: order.currency });
}

export async function captureWithStableIdentity(order: Order): Promise<void> {
  await payments.capture({
    orderId: order.id,
    amount: order.total,
    currency: order.currency,
    idempotencyKey: `order:${order.id}`,
  });
}
