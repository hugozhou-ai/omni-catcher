import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "../platform/react.js";
import { toastStore } from "../platform/toast.js";
import { Icon } from "./Icons.js";

export function Toast(): ReactNode {
  const message = useStore(toastStore);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 1800);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <div className={`toast ${visible ? "show" : ""}`} role="status" aria-live="polite">
      <span className="toast-icon">
        <Icon name="check" />
      </span>
      <span>{message?.text ?? ""}</span>
    </div>
  );
}
