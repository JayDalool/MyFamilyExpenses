import { bankAtmFixture } from "./bank-atm";
import { cashReceiptFixture } from "./cash-receipt";
import { retailBasicFixture } from "./retail-basic";

export type { ReceiptFixture } from "./types";

export const RECEIPT_FIXTURES = [
  cashReceiptFixture,
  bankAtmFixture,
  retailBasicFixture,
] as const;
