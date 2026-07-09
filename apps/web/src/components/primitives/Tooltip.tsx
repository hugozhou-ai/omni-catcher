import type { ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

export function TooltipProvider(props: { children: ReactNode }): ReactNode {
  return (
    <TooltipPrimitive.Provider delayDuration={280} skipDelayDuration={120}>
      {props.children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip(props: {
  content: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}): ReactNode {
  const { content, children, side = "top" } = props;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content className="app-tooltip-content" side={side} sideOffset={6}>
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
