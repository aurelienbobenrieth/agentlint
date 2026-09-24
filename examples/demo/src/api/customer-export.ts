declare function exportCustomerData(input: {
  readonly customerId: string;
  readonly fields: readonly string[];
}): Promise<Uint8Array>;

export function createCustomerExport(customerId: string, requestedFields: readonly string[]) {
  return exportCustomerData({ customerId, fields: requestedFields });
}
