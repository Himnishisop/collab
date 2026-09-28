import { useState } from "react";
import { PLANS, purchase, restorePurchases, type PlanId } from "../lib/billing";
import { IconCheck, IconSpinner, IconWave } from "./Icons";

interface PaywallScreenProps {
  onClose: () => void;
  onUnlocked: () => void;
}

const BENEFITS = [
  "Unlimited video exports",
  "Studio reverb, echo and volume controls",
  "Full-resolution capture up to 4K",
  "No watermark, everything stays on your phone",
];

export default function PaywallScreen({ onClose, onUnlocked }: PaywallScreenProps) {
  const [selected, setSelected] = useState<PlanId>("yearly");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const run = async (action: () => ReturnType<typeof purchase>) => {
    setBusy(true);
    setMessage("");
    const result = await action();
    setBusy(false);
    if (result.ok) {
      onUnlocked();
      return;
    }
    if (result.reason !== "cancelled") setMessage(result.message);
  };

  return (
    <main className="paywall-screen">
      <section className="paywall-card">
        <header className="paywall-head">
          <span className="paywall-badge">
            <IconWave width={18} height={18} />
          </span>
          <h1 className="paywall-title">
            Echo <span>Pro</span>
          </h1>
          <p className="paywall-sub">Your free export is used. Subscribe to keep exporting.</p>
        </header>

        <ul className="paywall-benefits">
          {BENEFITS.map((benefit) => (
            <li key={benefit}>
              <IconCheck width={14} height={14} />
              {benefit}
            </li>
          ))}
        </ul>

        <div className="paywall-plans">
          {PLANS.map((plan) => (
            <button
              key={plan.id}
              type="button"
              onClick={() => setSelected(plan.id)}
              aria-pressed={plan.id === selected}
              className={plan.id === selected ? "paywall-plan is-on" : "paywall-plan"}
            >
              {plan.badge && <span className="paywall-plan-badge">{plan.badge}</span>}
              <span className="paywall-plan-title">{plan.title}</span>
              <span className="paywall-plan-price">{plan.price}</span>
              <span className="paywall-plan-period">{plan.period}</span>
              <span className="paywall-plan-blurb">{plan.blurb}</span>
            </button>
          ))}
        </div>

        <button type="button" disabled={busy} onClick={() => void run(() => purchase(selected))} className="paywall-buy">
          {busy ? <IconSpinner width={17} height={17} className="animate-spin" /> : null}
          {busy ? "Contacting Google Play…" : `Subscribe · ${PLANS.find((p) => p.id === selected)?.price}`}
        </button>

        {message && <p className="paywall-message">{message}</p>}

        <div className="paywall-foot">
          <button type="button" disabled={busy} onClick={() => void run(restorePurchases)}>
            Restore purchase
          </button>
          <span>·</span>
          <button type="button" disabled={busy} onClick={onClose}>
            Not now
          </button>
        </div>

        <p className="paywall-legal">
          Billed through Google Play. Renews automatically until cancelled; manage or cancel anytime in Play Store →
          Subscriptions.
        </p>
      </section>
    </main>
  );
}
