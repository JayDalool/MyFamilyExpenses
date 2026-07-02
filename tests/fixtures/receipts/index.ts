import { balanceOnlyFixture } from "./balance-only";
import { bankAtmFixture } from "./bank-atm";
import { bankNoRefFixture } from "./bank-no-ref";
import { cashBackFixture } from "./cash-back";
import { cashReceiptFixture } from "./cash-receipt";
import { debitSlipFixture } from "./debit-slip";
import { feeTotalZeroFixture } from "./fee-total-zero";
import { gasReceiptFixture } from "./gas-receipt";
import { restaurantTipFixture } from "./restaurant-tip";
import { retailBasicFixture } from "./retail-basic";
import { retailNoInvoiceFixture } from "./retail-no-invoice";
import { retailTaxChangeFixture } from "./retail-tax-change";

export type { ReceiptFixture } from "./types";

export const RECEIPT_FIXTURES = [
  cashReceiptFixture,
  bankAtmFixture,
  bankNoRefFixture,
  retailBasicFixture,
  retailNoInvoiceFixture,
  restaurantTipFixture,
  gasReceiptFixture,
  balanceOnlyFixture,
  cashBackFixture,
  debitSlipFixture,
  retailTaxChangeFixture,
  feeTotalZeroFixture,
] as const;
