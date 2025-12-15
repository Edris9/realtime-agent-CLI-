import { extractAllNumbers, loadKnowledgeBase, verifyGrounding } from "../grounding.js";
import { detectActionTrigger, createActionSuggestion, confirmAction } from "../actions.js";

interface Test {
  name: string;
  fn: () => boolean | void;
}

const tests: Test[] = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean | void) {
  tests.push({ name, fn });
}

function assert(condition: boolean, message: string = "Assertion failed") {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(
      message || `Expected ${expected}, got ${actual}`
    );
  }
}

function assertIncludes(array: any[], value: any, message?: string) {
  if (!array.includes(value)) {
    throw new Error(
      message || `Expected array to include ${value}`
    );
  }
}

console.log("Loading knowledge base...");
loadKnowledgeBase("./kb");
console.log("Knowledge base loaded.\n");

test("Extraherar heltal (99)", () => {
  const numbers = extractAllNumbers("Priset är 99 kr");
  assertIncludes(numbers, "99", "Should extract integer 99");
});

test("Extraherar decimaler (12.5)", () => {
  const numbers = extractAllNumbers("Värdet är 12.5 eller 12,5");
  assert(
    numbers.some(n => n.includes("12")),
    "Should extract decimal 12.5 or 12,5"
  );
});

test("Extraherar procent (20%)", () => {
  const numbers = extractAllNumbers("Rabatt på 20%");
  assert(
    numbers.some(n => n.includes("20")),
    "Should extract percentage 20%"
  );
});

test("Extraherar telefonnummer (+46 8 123 45 67)", () => {
  const numbers = extractAllNumbers("Ring +46 8 123 45 67");
  assert(
    numbers.some(n => n.includes("46") && n.includes("8")),
    "Should extract phone number"
  );
});

test("Godkänner svar med korrekta siffror från KB", () => {
  const result = verifyGrounding("Basic kostar 99 kr/månad", "pris");
  assertEqual(result.isGrounded, true, "Should accept correct numbers from KB");
  assertEqual(result.verifiedText, "Basic kostar 99 kr/månad");
});

test("Avvisar svar med påhittade siffror (777)", () => {
  const result = verifyGrounding("Basic kostar 777 kr/månad", "pris");
  assertEqual(result.isGrounded, false, "Should reject hallucinated numbers");
  assertEqual(result.verifiedText, "Jag kan inte verifiera det.");
});

test("Avvisar påhittade telefonnummer", () => {
  const result = verifyGrounding("Ring +46 8 999 00 11", "kontakt");
  assertEqual(result.isGrounded, false, "Should reject fake phone numbers");
  assertEqual(result.verifiedText, "Jag kan inte verifiera det.");
});

test("Godkänner svar utan siffror", () => {
  const result = verifyGrounding("Vi har flera planer", "pris");
  assert(result.isGrounded !== undefined, "Should handle text without numbers");
});

test("Fail-closed vid inga relevanta källor", () => {
  const result = verifyGrounding("Någon information", "xyzabc123");
  assertEqual(result.isGrounded, false, "Should fail-closed when no sources");
  assertEqual(result.verifiedText, "Jag hittar inget stöd i kunskapsbasen.");
});

test("Detekterar 'ring mig' → schedule_callback", () => {
  const result = detectActionTrigger("Kan du ring mig?");
  assertEqual(result.action, "schedule_callback", "Should detect callback request");
});

test("Detekterar 'skicka sms' → send_sms", () => {
  const result = detectActionTrigger("Skicka sms till mig");
  assertEqual(result.action, "send_sms", "Should detect SMS request");
});

test("Detekterar 'skapa ärende' → create_ticket", () => {
  const result = detectActionTrigger("Skapa ärende åt mig");
  assertEqual(result.action, "create_ticket", "Should detect ticket request");
});

test("Returnerar null för vanliga meddelanden", () => {
  const result = detectActionTrigger("Vad kostar Basic?");
  assertEqual(result.action, null, "Should return null for regular messages");
});

test("Idempotency - samma ID ger ignored: true", () => {
  const suggestion = createActionSuggestion("schedule_callback", { phone: "+46 8 123 45 67" });
  const firstResult = confirmAction(suggestion.suggestionId);
  assertEqual(firstResult.success, true, "First execution should succeed");
  assertEqual(firstResult.ignored, undefined, "First execution should not be ignored");

  const secondResult = confirmAction(suggestion.suggestionId);
  assertEqual(secondResult.success, true, "Second execution should succeed");
  assertEqual(secondResult.ignored, true, "Second execution should be ignored");
});

function runTests() {
  console.log("Running tests...\n");

  for (const test of tests) {
    try {
      test.fn();
      console.log(`\x1b[32m✓\x1b[0m ${test.name}`);
      passed++;
    } catch (error) {
      console.log(`\x1b[31m✗\x1b[0m ${test.name}`);
      if (error instanceof Error) {
        console.log(`  \x1b[31m${error.message}\x1b[0m`);
      }
      failed++;
    }
  }

  console.log("\n" + "─".repeat(50));
  console.log(`Total: ${tests.length} tests`);
  console.log(`\x1b[32mPassed: ${passed}\x1b[0m`);

  if (failed > 0) {
    console.log(`\x1b[31mFailed: ${failed}\x1b[0m`);
    process.exit(1);
  } else {
    console.log("\n\x1b[32m✓ All tests passed!\x1b[0m");
    process.exit(0);
  }
}

runTests();
