import { useEffect, useRef } from "react";
import { IconAlert } from "./Icons";

interface ConfirmExitProps {
  open: boolean;
  /** shown when the user still has an unexported clip in the editor */
  hasUnsavedWork: boolean;
  onStay: () => void;
  onLeave: () => void;
}

/**
 * Asks before discarding the session.
 *
 * A browser tab cannot be closed by script unless the page opened it, so the
 * honest thing to do is offer to return to the camera (which is what "leaving"
 * means inside the app) and let the user close the tab themselves.
 */
export default function ConfirmExit({ open, hasUnsavedWork, onStay, onLeave }: ConfirmExitProps) {
  const stayRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    stayRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onStay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onStay]);

  if (!open) return null;

  return (
    <div className="echo-confirm-layer" role="dialog" aria-modal="true" aria-labelledby="echo-confirm-title">
      <button type="button" aria-label="Keep editing" className="echo-confirm-scrim" onClick={onStay} />
      <div className="echo-confirm-card">
        <span className="echo-confirm-icon">
          <IconAlert width={24} height={24} />
        </span>
        <h2 id="echo-confirm-title" className="echo-confirm-title">
          Discard this clip?
        </h2>
        <p className="echo-confirm-text">
          {hasUnsavedWork
            ? "This take has not been exported yet. Leaving now will discard the clip and all its effect settings."
            : "You will go back to the camera and this session will be cleared."}
        </p>
        <div className="echo-confirm-actions">
          <button ref={stayRef} type="button" onClick={onStay} className="echo-confirm-stay">
            Keep editing
          </button>
          <button type="button" onClick={onLeave} className="echo-confirm-leave">
            Discard &amp; exit
          </button>
        </div>
      </div>
    </div>
  );
}
