declare const payments: {
  capture(input: { orderId: string; amount: number; idempotencyKey?: string }): Promise<void>;
};

export const captureOrderPayment = (orderId: string, amount: number) => payments.capture({ orderId, amount });
