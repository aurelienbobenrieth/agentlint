/** Whether leaving the page would lose work: a detached review holds decisions that were not exported yet.
 *  Attached reviews are never dirty because the server persists each decision. Only commands write this;
 *  `entry.ts` reads it for the leave prompt. */
let dirty = false;

export const markDirty = (value: boolean): void => {
  dirty = value;
};

export const isDirty = (): boolean => dirty;
