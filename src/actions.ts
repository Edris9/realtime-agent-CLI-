export type ActionType = "schedule_callback" | "send_sms" | "create_ticket";

export interface ActionPayload {
  phone?: string;
  time?: string;
  subject?: string;
  message?: string;
}

export interface ActionSuggestion {
  suggestionId: string;
  action: ActionType;
  payload: ActionPayload;
  timestamp: number;
}

export interface ActionResult {
  success: boolean;
  ignored?: boolean;
  message: string;
  suggestionId: string;
}

const pendingActions = new Map<string, ActionSuggestion>();
const executedActions = new Map<string, { timestamp: number; result: ActionResult }>();

const ACTION_TRIGGERS: Record<string, ActionType> = {
  "ring mig": "schedule_callback",
  "ring upp": "schedule_callback",
  "skicka sms": "send_sms",
  "sms:a": "send_sms",
  "skapa ärende": "create_ticket",
  "öppna ticket": "create_ticket",
};

function extractPhone(text: string): string | undefined {
  const phonePattern = /\+?\d+[\s-]?\d+[\s-]?\d+[\s-]?\d+[\s-]?\d+/;
  const match = text.match(phonePattern);
  return match ? match[0].replace(/\s+/g, " ").trim() : undefined;
}

export function detectActionTrigger(text: string): {
  action: ActionType | null;
  payload: ActionPayload;
} {
  const lowerText = text.toLowerCase();

  for (const [trigger, action] of Object.entries(ACTION_TRIGGERS)) {
    if (lowerText.includes(trigger)) {
      const payload: ActionPayload = {};

      const phone = extractPhone(text);
      if (phone) {
        payload.phone = phone;
      }

      if (action === "create_ticket") {
        payload.subject = "Kundsupport";
      }

      return { action, payload };
    }
  }

  return { action: null, payload: {} };
}

export function createActionSuggestion(
  action: ActionType,
  payload: ActionPayload
): ActionSuggestion {
  const suggestionId = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const suggestion: ActionSuggestion = {
    suggestionId,
    action,
    payload,
    timestamp: Date.now(),
  };

  pendingActions.set(suggestionId, suggestion);

  return suggestion;
}

export function confirmAction(suggestionId: string): ActionResult {
  const executed = executedActions.get(suggestionId);
  if (executed && Date.now() - executed.timestamp < 30000) {
    return {
      success: true,
      ignored: true,
      message: "Action already executed within 30 seconds",
      suggestionId,
    };
  }

  const pending = pendingActions.get(suggestionId);
  if (!pending) {
    return {
      success: false,
      message: "Action not found or expired",
      suggestionId,
    };
  }

  let message = "";
  switch (pending.action) {
    case "schedule_callback":
      message = `Callback scheduled${pending.payload.phone ? ` to ${pending.payload.phone}` : ""}`;
      break;
    case "send_sms":
      message = `SMS sent${pending.payload.phone ? ` to ${pending.payload.phone}` : ""}`;
      break;
    case "create_ticket":
      message = `Ticket created${pending.payload.subject ? `: ${pending.payload.subject}` : ""}`;
      break;
  }

  const result: ActionResult = {
    success: true,
    message,
    suggestionId,
  };

  executedActions.set(suggestionId, { timestamp: Date.now(), result });
  pendingActions.delete(suggestionId);

  return result;
}

export function getPendingAction(suggestionId: string): ActionSuggestion | undefined {
  return pendingActions.get(suggestionId);
}

export function clearExpiredActions(maxAgeMs: number = 300000): void {
  const now = Date.now();

  for (const [id, suggestion] of pendingActions.entries()) {
    if (now - suggestion.timestamp > maxAgeMs) {
      pendingActions.delete(id);
    }
  }

  for (const [id, executed] of executedActions.entries()) {
    if (now - executed.timestamp > maxAgeMs) {
      executedActions.delete(id);
    }
  }
}
