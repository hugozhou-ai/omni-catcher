import type { Messages } from "./messages.js";

export function intentKey(intent: string): keyof Messages {
  switch (intent) {
    case "bookmark":
      return "intentBookmark";
    case "todo":
      return "intentTodo";
    case "mixed":
      return "intentMixed";
    default:
      return "intentNote";
  }
}
