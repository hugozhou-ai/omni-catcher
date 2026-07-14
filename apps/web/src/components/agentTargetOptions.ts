import type { AgentTarget } from "@omni-catcher/shared";

export interface AgentTargetOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function buildAgentTargetOptions(
  agents: AgentTarget[],
  preferred: string,
  labels: { defaultOption: string; unavailable: string },
): AgentTargetOption[] {
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
