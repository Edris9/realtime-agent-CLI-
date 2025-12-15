import fs from "fs";
import path from "path";

export interface Citation {
  file: string;
  snippet: string;
}

export interface GroundingResult {
  isGrounded: boolean;
  verifiedText: string;
  citations?: Citation[];
}

interface KnowledgeBaseEntry {
  file: string;
  content: string;
  numbers: string[];
}

let knowledgeBase: KnowledgeBaseEntry[] = [];

export function loadKnowledgeBase(kbPath: string): void {
  knowledgeBase = [];

  const files = fs.readdirSync(kbPath);
  const mdFiles = files.filter((f) => f.endsWith(".md"));

  for (const file of mdFiles) {
    const filePath = path.join(kbPath, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const numbers = extractAllNumbers(content);

    knowledgeBase.push({
      file: `kb/${file}`,
      content,
      numbers,
    });
  }
}

export function extractAllNumbers(text: string): string[] {
  const patterns = [
    /\+\d+\s+\d+\s+\d+\s+\d+\s+\d+/g,
    /\d{4}-\d{2}-\d{2}/g,
    /\d+[.,]\d+%?/g,
    /\d+%/g,
    /\d+/g,
  ];

  const numbers = new Set<string>();

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach((m) => {
        numbers.add(normalizeNumber(m));
        numbers.add(m);
      });
    }
  }

  return Array.from(numbers);
}

function normalizeNumber(num: string): string {
  return num.replace(/,/g, ".").replace(/\s+/g, " ").trim();
}

export function searchKnowledgeBase(query: string): Citation[] {
  const lowerQuery = query.toLowerCase();
  // Remove punctuation and split into words
  const keywords = lowerQuery.replace(/[.,!?;:]/g, ' ').split(/\s+/);
  const citations: Citation[] = [];

  // Stopwords to filter out
  const stopwords = new Set(["vad", "hur", "när", "var", "vilka", "vilken", "är", "den", "det", "de", "som", "på", "i", "för", "med", "att"]);

  // Keyword synonyms/expansions
  const synonyms: Record<string, string[]> = {
    "kostar": ["pris", "kostnad", "avgift"],
    "pris": ["kostar", "kostnad", "avgift"],
    "premium": ["premium"],
    "basic": ["basic"],
    "standard": ["standard"],
    "ring": ["telefon", "kontakt"],
    "telefon": ["ring", "kontakt"],
    "ångerrätt": ["ångra", "villkor", "policy"],
    "ångerrätten": ["ångerrätt", "ångra", "villkor", "policy"],
    "lång": ["dagar", "tid"],
  };

  // Expand keywords with synonyms
  const expandedKeywords = new Set<string>();
  for (const keyword of keywords) {
    if (!stopwords.has(keyword) && keyword.length > 2) {
      expandedKeywords.add(keyword);
      if (synonyms[keyword]) {
        synonyms[keyword].forEach(syn => expandedKeywords.add(syn));
      }
    }
  }

  for (const entry of knowledgeBase) {
    const lowerContent = entry.content.toLowerCase();
    const lowerFilename = entry.file.toLowerCase();

    for (const keyword of expandedKeywords) {
      // Match in content or filename
      if (lowerContent.includes(keyword) || lowerFilename.includes(keyword)) {
        const lines = entry.content.split("\n");
        for (const line of lines) {
          if (line.toLowerCase().includes(keyword) && line.trim().length > 0) {
            citations.push({
              file: entry.file,
              snippet: line.trim(),
            });
          }
        }
      }
    }
  }

  // Remove duplicates
  const uniqueCitations = Array.from(
    new Map(citations.map(c => [`${c.file}:${c.snippet}`, c])).values()
  );
  return uniqueCitations.slice(0, 5);
}

export function verifyGrounding(
  responseText: string,
  query: string
): GroundingResult {
  const responseNumbers = extractAllNumbers(responseText);

  if (responseNumbers.length === 0) {
    const citations = searchKnowledgeBase(query);
    if (citations.length === 0) {
      return {
        isGrounded: false,
        verifiedText: "Jag hittar inget stöd i kunskapsbasen.",
      };
    }
    return {
      isGrounded: true,
      verifiedText: responseText,
      citations,
    };
  }

  const allKnownNumbers = new Set<string>();
  for (const entry of knowledgeBase) {
    entry.numbers.forEach((n) => allKnownNumbers.add(n));
  }

  for (const num of responseNumbers) {
    const normalized = normalizeNumber(num);
    let found = false;

    for (const knownNum of allKnownNumbers) {
      if (knownNum === num || knownNum === normalized) {
        found = true;
        break;
      }

      const numValue = parseFloat(normalized.replace(/[^\d.]/g, ""));
      const knownValue = parseFloat(knownNum.replace(/[^\d.]/g, ""));
      if (!isNaN(numValue) && !isNaN(knownValue) && numValue === knownValue) {
        found = true;
        break;
      }
    }

    if (!found) {
      return {
        isGrounded: false,
        verifiedText: "Jag kan inte verifiera det.",
      };
    }
  }

  const citations = searchKnowledgeBase(query);
  if (citations.length === 0) {
    return {
      isGrounded: false,
      verifiedText: "Jag hittar inget stöd i kunskapsbasen.",
    };
  }

  return {
    isGrounded: true,
    verifiedText: responseText,
    citations,
  };
}
