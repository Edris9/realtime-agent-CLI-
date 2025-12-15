export interface StreamCallbacks {
  onToken: (token: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

const RESPONSES: Record<string, string> = {
  pris: "Basic kostar 99 kr/månad, Standard 199 kr, Premium 399 kr.",
  ångerrätt: "Privatpersoner har 30 dagars ångerrätt.",
  kontakt: "Ring +46 8 123 45 67, öppet 08:00-18:00.",
};

const HALLUCINATED_RESPONSES: Record<string, string> = {
  pris: "Basic kostar 75 kr/månad med 75% rabatt just nu!",
  kontakt: "Ring +46 8 999 00 11, öppet dygnet runt!",
  default: "Vi erbjuder 90% rabatt och 24/7 support på alla planer!",
};

function getResponse(query: string): string {
  const lowerQuery = query.toLowerCase();

  if (lowerQuery.includes("hallucinate")) {
    if (lowerQuery.includes("pris") || lowerQuery.includes("kostar")) return HALLUCINATED_RESPONSES.pris;
    if (lowerQuery.includes("kontakt") || lowerQuery.includes("ring")) return HALLUCINATED_RESPONSES.kontakt;
    return HALLUCINATED_RESPONSES.default;
  }

  // Check for pricing queries
  if (lowerQuery.includes("pris") || lowerQuery.includes("kostar") ||
      lowerQuery.includes("kostnad") || lowerQuery.includes("premium") ||
      lowerQuery.includes("basic") || lowerQuery.includes("standard")) {
    return RESPONSES.pris;
  }

  // Check for policy queries
  if (lowerQuery.includes("ångerrätt") || lowerQuery.includes("ångra")) {
    return RESPONSES.ångerrätt;
  }

  // Check for contact queries
  if (lowerQuery.includes("kontakt") || lowerQuery.includes("ring") ||
      lowerQuery.includes("telefon") || lowerQuery.includes("öppettid")) {
    return RESPONSES.kontakt;
  }

  if (Math.random() < 0.2) {
    return HALLUCINATED_RESPONSES.default;
  }

  return "Jag vet inte svaret på den frågan.";
}

export async function streamResponse(
  query: string,
  callbacks: StreamCallbacks,
  abortSignal?: AbortSignal
): Promise<void> {
  const response = getResponse(query);
  const tokens = response.split(" ");

  try {
    for (const token of tokens) {
      if (abortSignal?.aborted) {
        throw new Error("Streaming aborted");
      }

      const delay = Math.floor(Math.random() * 60) + 20;
      await new Promise((resolve) => setTimeout(resolve, delay));

      if (abortSignal?.aborted) {
        throw new Error("Streaming aborted");
      }

      callbacks.onToken(token + " ");
    }

    callbacks.onComplete();
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
}

export function extractNumbers(text: string): string[] {
  const patterns = [
    /\d+[.,]\d+/g,
    /\d+/g,
    /\+\d+\s*\d+\s*\d+\s*\d+\s*\d+/g,
  ];

  const numbers: string[] = [];
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      numbers.push(...matches);
    }
  }

  return [...new Set(numbers)];
}

export function normalizeNumber(num: string): string {
  return num.replace(/,/g, ".");
}
