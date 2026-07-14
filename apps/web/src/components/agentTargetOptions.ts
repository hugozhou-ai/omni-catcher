import type { AgentTarget } from "@omni-catcher/shared";
import type { SelectOption } from "./Select.js";

export function buildAgentTargetOptions(
  agents: AgentTarget[],
  preferred: string,
  labels: { defaultOption: string; unavailable: string },
): SelectOption<string>[] {
  return [
    { value: "", label: labels.defaultOption },
    ...(preferred && !agents.some((agent) => agent.agentTargetId === preferred)
      ? [{ value: preferred, label: `${preferred} (${labels.unavailable})`, disabled: true }]
      : []),
    ...agents.map((agent) => {
      const available = agent.runtimeSupported && agent.status === "available";
      return {
        value: agent.agentTargetId,
        label: `${agent.displayName} (${agent.agentTargetId})${available ? "" : ` — ${labels.unavailable}`}`,
        disabled: !available,
      };
    }),
  ];
}
