import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "../platform/react.js";
import { dismissToast, toastStore, type ToastMessage } from "../platform/toast.js";
import { Icon, type IconName } from "./Icons.js";

const DURATION: Record<ToastMessage["variant"], number> = {
  success: 1800,
  info: 2400,
  error: 3200,
};

const ICON: Record<ToastMessage["variant"], IconName> = {
  success: "checkMark",
  info: "info",
  error: "warning",
};

export function Toast(): ReactNode {
  const messages = useStore(toastStore);

  return (
    <div className="toast-stack" aria-live="polite">
      {messages.map((message) => (
        <ToastItem key={message.id} message={message} />
      ))}
    </div>
  );
}

function ToastItem(props: { message: ToastMessage }): ReactNode {
  const { message } = props;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
    const hideTimer = window.setTimeout(() => setVisible(false), DURATION[message.variant]);
    const removeTimer = window.setTimeout(() => dismissToast(message.id), DURATION[message.variant] + 200);
    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(removeTimer);
    };
  }, [message.id, message.variant]);

  return (
    <div
      className={`toast ${message.variant} ${visible ? "show" : ""}`}
      role={message.variant === "error" ? "alert" : "status"}
    >
      <span className="toast-icon">
        <Icon name={ICON[message.variant]} />
      </span>
      <span>{message.text}</span>
    </div>
  );
}
