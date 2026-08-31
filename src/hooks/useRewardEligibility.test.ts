import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { WashOrder } from "@/hooks/useOrders";

// ---- Mocks ----
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const txnInsert = vi.fn();
const customerInsert = vi.fn();

// Holds the rows the next .select() call will return per table.
const tableData: Record<string, any[]> = {
  loyalty_transactions: [],
  customers: [],
};

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = {
      // SELECT chain returns a thenable resolving to { data, error }
      select: () => Promise.resolve({ data: tableData[table] ?? [], error: null }),
      insert: (payload: any) => {
        if (table === "loyalty_transactions") {
          txnInsert(payload);
          return Promise.resolve({ error: null });
        }
        if (table === "customers") {
          customerInsert(payload);
          const row = { id: `cust-${customerInsert.mock.calls.length}` };
          return {
            select: () => ({
              single: () => Promise.resolve({ data: row, error: null }),
            }),
          };
        }
        return Promise.resolve({ error: null });
      },
    };
    return api;
  };
  return { supabase: { from } };
});

import { useRewardEligibility, FREE_WASH_COST, POINTS_PER_WASH } from "./useRewardEligibility";

const mkOrder = (over: Partial<WashOrder>): WashOrder => ({
  id: "o-" + Math.random().toString(36).slice(2, 9),
  orderNumber: "W-001",
  customer: "Jane Doe",
  customerPhone: "0821234567",
  vehicle: "Toyota",
  plate: "ABC123",
  service: "Basic",
  servicePrice: 15,
  status: "completed",
  createdAt: new Date().toISOString(),
  ...over,
});

const completedVisits = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    mkOrder({ id: `c-${i}`, orderNumber: `W-${100 + i}`, status: "completed" }),
  );

beforeEach(() => {
  txnInsert.mockClear();
  customerInsert.mockClear();
  tableData.loyalty_transactions = [];
  tableData.customers = [];
});

describe("useRewardEligibility", () => {
  it("flags an active order as reward-eligible immediately when the customer has 10+ completed visits", async () => {
    const visitsNeeded = FREE_WASH_COST / POINTS_PER_WASH; // 10
    const active = mkOrder({ id: "active-1", orderNumber: "W-999", status: "waiting" });
    const orders = [...completedVisits(visitsNeeded), active];

    const { result } = renderHook(() => useRewardEligibility(orders));

    // Eligibility is derived synchronously from orders, so the badge appears
    // on the first render — even before the supabase fetch resolves.
    expect(result.current.eligibleOrderIds.has("active-1")).toBe(true);

    // Redemption is manual now: nothing is inserted until applyFreeWash runs.
    await act(async () => { await Promise.resolve(); });
    expect(txnInsert).not.toHaveBeenCalled();
    expect(customerInsert).not.toHaveBeenCalled();
  });

  it("does NOT flag an active order when the customer has fewer than 10 completed visits", async () => {
    const active = mkOrder({ id: "active-1", status: "waiting" });
    const { result } = renderHook(() =>
      useRewardEligibility([...completedVisits(5), active]),
    );
    expect(result.current.eligibleOrderIds.has("active-1")).toBe(false);

    // Give any async effects a tick to (not) fire.
    await act(async () => { await Promise.resolve(); });
    expect(txnInsert).not.toHaveBeenCalled();
  });

  it("applies a free wash once when applyFreeWash is called, and not twice", async () => {
    const visitsNeeded = FREE_WASH_COST / POINTS_PER_WASH;
    const active = mkOrder({ id: "active-1", orderNumber: "W-999", status: "waiting" });
    const orders = [...completedVisits(visitsNeeded), active];

    const { result } = renderHook(() => useRewardEligibility(orders));

    await act(async () => { await result.current.applyFreeWash(active); });

    expect(txnInsert).toHaveBeenCalledTimes(1);
    expect(txnInsert.mock.calls[0][0]).toMatchObject({
      order_id: "active-1",
      type: "redeemed",
      points: FREE_WASH_COST,
    });

    await act(async () => { await result.current.applyFreeWash(active); });
    expect(txnInsert).toHaveBeenCalledTimes(1);
  });
});
