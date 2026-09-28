/**
 * Entitlement + subscription plumbing.
 *
 * The web build can only track entitlement locally; real money has to move
 * through Google Play Billing, which exists solely inside a native Android
 * container. `purchase()` therefore talks to a native bridge when one is
 * present and reports honestly when it is not, instead of pretending a
 * purchase succeeded.
 */

export const FREE_EXPORTS = 1;

export type PlanId = "monthly" | "yearly";

export interface Plan {
  id: PlanId;
  /** Google Play subscription product ID — must match the Play Console entry */
  productId: string;
  title: string;
  price: string;
  period: string;
  blurb: string;
  badge?: string;
}

export const PLANS: Plan[] = [
  {
    id: "monthly",
    productId: "echo_pro_monthly",
    title: "Monthly",
    price: "₹69",
    period: "per month",
    blurb: "Unlimited exports, cancel anytime",
  },
  {
    id: "yearly",
    productId: "echo_pro_yearly",
    title: "Yearly",
    price: "₹499",
    period: "per year",
    blurb: "Just ₹41.6 a month — best value",
    badge: "Save 40%",
  },
];

const KEY_EXPORTS = "echo.exportCount";
const KEY_SUB = "echo.subscription";

interface StoredSub {
  plan: PlanId;
  /** epoch ms; the native layer is the source of truth, this is only a cache */
  expiresAt: number;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function getExportCount(): number {
  try {
    return Number(localStorage.getItem(KEY_EXPORTS) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function noteExportDone(): void {
  try {
    localStorage.setItem(KEY_EXPORTS, String(getExportCount() + 1));
  } catch {
    /* storage disabled — the session simply stays on the free tier */
  }
}

export function isSubscribed(): boolean {
  const sub = readJson<StoredSub>(KEY_SUB);
  return !!sub && sub.expiresAt > Date.now();
}

export function activePlan(): PlanId | null {
  const sub = readJson<StoredSub>(KEY_SUB);
  return sub && sub.expiresAt > Date.now() ? sub.plan : null;
}

function storeSub(plan: PlanId, expiresAt: number): void {
  try {
    localStorage.setItem(KEY_SUB, JSON.stringify({ plan, expiresAt } satisfies StoredSub));
  } catch {
    /* nothing we can do; the user keeps their session-level access */
  }
}

/** Free exports left, or `Infinity` for subscribers. */
export function exportsRemaining(): number {
  if (isSubscribed()) return Infinity;
  return Math.max(0, FREE_EXPORTS - getExportCount());
}

export function canExport(): boolean {
  return exportsRemaining() > 0;
}

// ---------------------------------------------------------------------------
// Native bridge
// ---------------------------------------------------------------------------

interface BillingBridge {
  purchase: (productId: string) => Promise<{ purchased: boolean; expiresAt?: number }>;
  restore?: () => Promise<{ purchased: boolean; productId?: string; expiresAt?: number }>;
}

type BridgeWindow = Window & {
  EchoBilling?: BillingBridge;
  Capacitor?: { Plugins?: Record<string, unknown> };
};

/**
 * Looks for a billing implementation exposed by the native shell. Wiring a
 * Capacitor Play-Billing plugin to `window.EchoBilling` is enough to switch
 * the whole paywall from demo mode to real purchases.
 */
function bridge(): BillingBridge | null {
  const w = window as BridgeWindow;
  if (w.EchoBilling?.purchase) return w.EchoBilling;
  const plugin = w.Capacitor?.Plugins?.EchoBilling as BillingBridge | undefined;
  return plugin?.purchase ? plugin : null;
}

export function hasNativeBilling(): boolean {
  return bridge() !== null;
}

export type PurchaseResult =
  | { ok: true; plan: PlanId }
  | { ok: false; reason: "cancelled" | "unavailable" | "error"; message: string };

export async function purchase(planId: PlanId): Promise<PurchaseResult> {
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) return { ok: false, reason: "error", message: "Unknown plan" };

  const native = bridge();
  if (!native) {
    return {
      ok: false,
      reason: "unavailable",
      message:
        "Google Play Billing only works in the installed Android app. Build the app with Capacitor and Play Billing to take payments.",
    };
  }

  try {
    const res = await native.purchase(plan.productId);
    if (!res.purchased) return { ok: false, reason: "cancelled", message: "Purchase cancelled" };
    const fallback = Date.now() + (planId === "yearly" ? 365 : 30) * 24 * 60 * 60 * 1000;
    storeSub(planId, res.expiresAt ?? fallback);
    return { ok: true, plan: planId };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : "Purchase failed" };
  }
}

/** Re-reads entitlements from Play (new device, reinstall, refund, etc.). */
export async function restorePurchases(): Promise<PurchaseResult> {
  const native = bridge();
  if (!native?.restore) {
    return {
      ok: false,
      reason: "unavailable",
      message: "Restoring needs the installed Android app.",
    };
  }
  try {
    const res = await native.restore();
    if (!res.purchased) return { ok: false, reason: "cancelled", message: "No active subscription found" };
    const plan: PlanId = res.productId === "echo_pro_yearly" ? "yearly" : "monthly";
    const fallback = Date.now() + (plan === "yearly" ? 365 : 30) * 24 * 60 * 60 * 1000;
    storeSub(plan, res.expiresAt ?? fallback);
    return { ok: true, plan };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : "Restore failed" };
  }
}
