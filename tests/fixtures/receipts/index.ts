import { bankAtmFixture } from "./bank-atm";
import { bankNoRefFixture } from "./bank-no-ref";
import { cashReceiptFixture } from "./cash-receipt";
import { retailBasicFixture } from "./retail-basic";
import { retailNoInvoiceFixture } from "./retail-no-invoice";

export type { ReceiptFixture } from "./types";

export const RECEIPT_FIXTURES = [
  cashReceiptFixture,
  bankAtmFixture,
  bankNoRefFixture,
  retailBasicFixture,
  retailNoInvoiceFixture,
] as const;
