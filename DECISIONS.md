# Designbeslut och avvägningar

Detta dokument beskriver viktiga designval där alternativa lösningar medvetet valdes bort, inklusive motiveringar och trade-offs.

---

## 1. Mock LLM istället för riktig AI-integration

### Val som gjordes
Använd en mock LLM (`src/mock_llm.ts`) med fördefinierade svar och kontrollerad hallucineringsfunktion.

### Alternativ som valdes bort
Integration med riktig AI-tjänst:
- **OpenAI API** (GPT-4, GPT-3.5)
- **Anthropic Claude API** (Claude 3.5 Sonnet)
- **Lokal modell** (Ollama, LLaMA)

### Varför valt bort
1. **Uppgiftens fokus**: Projektet syftar till att testa guardrails och hallucinationsskydd, inte produktionsklar AI
2. **Deterministiska tester**: Omöjligt att garantera att riktig LLM hallucinerar vid exakt rätt tillfällen för testning
3. **API-kostnad**: Utveckling och testning skulle kosta pengar per request
4. **Latency**: Externa API-anrop skulle göra testerna långsammare och mindre tillförlitliga

### Fördelar med vårt val
- ✅ **Kontrollerad testning**: "hallucinate"-trigger garanterar felaktiga svar
- ✅ **Inga externa dependencies**: Fungerar offline
- ✅ **Deterministiska tester**: Samma input ger alltid samma output
- ✅ **Snabbt**: Ingen nätverkslatency
- ✅ **Gratis**: Inga API-kostnader

### Nackdelar med vårt val
- ❌ **Orealistiska svar**: Svaren är hårdkodade och enkla
- ❌ **Begränsad täckning**: Endast 3-4 frågetyper stöds
- ❌ **Ingen naturlig variation**: Samma fråga ger exakt samma svar
- ❌ **Inte production-ready**: Måste bytas ut för verklig användning

### Production path
För produktion skulle man ersätta `mock_llm.ts` med:

```typescript
import Anthropic from "@anthropic-ai/sdk";

export async function streamResponse(
  query: string,
  callbacks: StreamCallbacks,
  abortSignal?: AbortSignal
): Promise<void> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const stream = await anthropic.messages.stream({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1024,
    messages: [{ role: "user", content: query }],
  });

  for await (const chunk of stream) {
    if (abortSignal?.aborted) break;
    if (chunk.type === "content_block_delta") {
      callbacks.onToken(chunk.delta.text);
    }
  }
}
```

---

## 2. Enkel keyword-sökning istället för vektor-embeddings

### Val som gjordes
Enkel keyword-baserad sökning (`searchKnowledgeBase()`) som matchar ord från query mot KB-innehåll.

### Alternativ som valdes bort
Semantisk sökning med vektor-embeddings:
- **Vektor-databaser**: Pinecone, Weaviate, Chroma, Qdrant
- **Embedding-modeller**: OpenAI text-embedding-3, Cohere, Sentence Transformers
- **Hybrid search**: Kombinera keyword + semantic search

### Varför valt bort
1. **Liten kunskapsbas**: 5 markdown-filer med totalt ~50 rader innehåll
2. **Overkill**: Vektor-databas kräver setup, hosting, och maintenance
3. **Overhead**: Embedding-generering tar tid och kostar pengar
4. **Komplexitet**: Projektet fokuserar på grounding, inte avancerad retrieval

### Fördelar med vårt val
- ✅ **Enkelhet**: 20 rader kod, inga externa tjänster
- ✅ **Snabbt**: O(n) sökning över 5 filer är omedelbart
- ✅ **Inga dependencies**: Behöver inte vector DB, embedding API, etc.
- ✅ **Transparent**: Lätt att debugga vilka keywords som matchade
- ✅ **Fungerar offline**: Ingen API-anrop nödvändig

### Nackdelar med vårt val
- ❌ **Dålig semantisk förståelse**: "pris" matchar inte "kostnad" eller "avgift"
- ❌ **Skalbarhet**: Blir långsamt vid 1000+ dokument
- ❌ **Ingen ranking**: Alla matchningar är likvärdiga
- ❌ **Språkkänsligt**: Kräver exakt ordmatchning

### När byta till embeddings?
Överväg vektor-sökning när:
- KB växer till >100 dokument
- Semantisk förståelse behövs ("billig" ska hitta "låg kostnad")
- Multi-language support krävs
- Ranking av relevans är viktigt

**Estimerad brytpunkt**: ~50-100 KB-dokument eller när keyword-search ger dålig precision/recall.

---

## 3. In-memory state istället för persistent lagring

### Val som gjordes
Lagra pending/executed actions i JavaScript `Map`:

```typescript
const pendingActions = new Map<string, ActionSuggestion>();
const executedActions = new Map<string, { timestamp: number; result: ActionResult }>();
```

### Alternativ som valdes bort
Persistent lagring med:
- **Redis**: In-memory database med persistence
- **PostgreSQL**: Relationsdatabas med transactions
- **MongoDB**: Dokumentdatabas
- **SQLite**: Lokal fil-baserad databas

### Varför valt bort
1. **Projektkrav**: Detta är en demo/proof-of-concept, inte produktionssystem
2. **Setup-komplexitet**: Redis/Postgres kräver installation och konfiguration
3. **Overkill**: Idempotency-fönster är bara 30 sekunder
4. **Development velocity**: Snabbare att iterera utan databas-schema

### Fördelar med vårt val
- ✅ **Enkelhet**: Ingen database setup, migrations, eller schema
- ✅ **Snabbhet**: O(1) lookup i Map, ingen nätverkslatency
- ✅ **Portabilitet**: Fungerar överallt utan externa tjänster
- ✅ **Zero config**: Bara `npm install` och kör

### Nackdelar med vårt val
- ❌ **Förlorar state vid restart**: Server-omstart rensar alla actions
- ❌ **Inte skalbart**: Kan inte dela state mellan flera server-instanser
- ❌ **Ingen audit trail**: Historik försvinner efter 5 minuter
- ❌ **Memory leak risk**: Om cleanup-logik failar, växer Maps oändligt

### Production path
För produktion, använd Redis:

```typescript
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL);

export async function confirmAction(suggestionId: string): Promise<ActionResult> {
  // Check if already executed (within 30s)
  const executed = await redis.get(`action:${suggestionId}`);
  if (executed) {
    return { success: true, ignored: true, message: "Already executed" };
  }

  // Execute action
  const result = await executeActionLogic(suggestionId);

  // Store with 30s TTL
  await redis.setex(`action:${suggestionId}`, 30, JSON.stringify(result));

  return result;
}
```

**Redis fördelar**:
- Persistent (med AOF/RDB)
- Skalbar (Redis Cluster)
- TTL built-in (automatisk cleanup)
- Pub/sub för events

---

## 4. Fail-closed istället för fail-open (med varningar)

### Val som gjordes
**Fail-closed strategi**: Avvisa alla svar där siffror inte kan verifieras.

```typescript
if (!isVerified(number)) {
  return { verifiedText: "Jag kan inte verifiera det." };
}
```

### Alternativ som valdes bort

#### Alternativ A: Fail-open (returnera svar med varning)
```typescript
if (!isVerified(number)) {
  return {
    verifiedText: originalText,
    warning: "⚠️ Kunde inte verifiera alla uppgifter"
  };
}
```

#### Alternativ B: Partial acceptance (visa verifierade delar)
```typescript
return {
  verifiedText: "Premium kostar [DOLD] kr/månad",  // 399 togs bort
  citations: [...]
};
```

#### Alternativ C: Confidence scores
```typescript
return {
  verifiedText: originalText,
  confidence: 0.65,  // 65% av siffror verifierade
  unverified: ["777"]
};
```

### Varför valt bort
1. **Juridisk risk**: Felaktig information kan leda till kontrakt eller reklamation
2. **Trovärdighet**: Användare litar på systemet, varningar ignoreras ofta
3. **Användarbeteende**: Folk tar screenshots och delar utan kontext
4. **Ansvarsrisker**: "Men systemet sa att..." är inte ett försvar

### Fördelar med vårt val (fail-closed)
- ✅ **Säkerhet först**: Inga felaktiga siffror visas någonsin
- ✅ **Tydligt**: "Jag vet inte" är ärligt och transparent
- ✅ **Juridiskt säkert**: Kan inte skapa missvisande expectations
- ✅ **Bygger förtroende**: När systemet svarar, är det korrekt

### Nackdelar med vårt val
- ❌ **Lägre coverage**: Fler "vet inte"-svar
- ❌ **Sämre UX**: Användare får inte alltid hjälp
- ❌ **Frustration**: Kan upplevas som "dum" av användare
- ❌ **Mindre flexibelt**: Kan inte hantera edge cases

### Exempel-scenario

**Fråga**: "Vad kostar Premium och hur många enheter ingår?"

**Mock LLM hallucinerar**: "Premium kostar 399 kr/månad och inkluderar 10 enheter"

#### Med fail-closed (vårt val):
```
Output: "Jag kan inte verifiera det."
Anledning: 399 OK, men "10 enheter" är fel (KB säger 5)
Resultat: Användaren får inte felaktig info
```

#### Med fail-open (avvisat):
```
Output: "Premium kostar 399 kr/månad och inkluderar 10 enheter"
         ⚠️ Kunde inte verifiera alla uppgifter
Resultat: Användaren köper Premium för "10 enheter", upptäcker sen att det är 5
Risk: Reklamation, chargeback, förtroendeskada
```

### När fail-open är OK
Fail-open kan vara lämpligt för:
- **Kreativa use cases**: Brainstorming, storytelling
- **Intern tooling**: Utvecklare som förstår risker
- **Low-stakes domains**: Filmrekommendationer, receptförslag
- **Med explicit consent**: "Visa osäkra svar" toggle

**Inte OK för**:
- Prissättning
- Juridiska villkor
- Medicinska råd
- Finansiell information
- Tekniska specifikationer

---

## 5. Streaming först, verifiering efteråt

### Val som gjordes
Streama LLM-svar token för token → Efter completion, verifiera → Ersätt med "Jag kan inte verifiera det." om grounding misslyckas.

### Alternativ som valdes bort

#### Alternativ A: Verifiera varje token under streaming
```typescript
for (const token of tokens) {
  const numbers = extractNumbers(token);
  for (const num of numbers) {
    if (!isInKB(num)) {
      abort(); // Stoppa streaming omedelbart
      return "Jag kan inte verifiera det.";
    }
  }
  callbacks.onToken(token);
}
```

#### Alternativ B: Verifiera före streaming
```typescript
const fullResponse = await generateComplete(query);
const verified = verifyGrounding(fullResponse);
if (!verified.isGrounded) {
  return "Jag kan inte verifiera det.";
}
// Nu streama det verifierade svaret
for (const token of fullResponse.split(' ')) {
  callbacks.onToken(token);
}
```

### Varför valt bort

**Alternativ A (token-wise verification):**
- ❌ Komplex: Måste hantera siffror som spänner över tokens ("3" + "99" = "399")
- ❌ Latency: Varje token kräver KB-lookup
- ❌ Fel positives: Kan avbryta för legitima partial numbers

**Alternativ B (verify-then-stream):**
- ❌ Långsam time-to-first-token (TTFT)
- ❌ Dålig UX: Användaren väntar på hela svaret innan något visas
- ❌ Strider mot "streaming"-kravet

### Fördelar med vårt val
- ✅ **Bra UX**: Användaren ser svar börja streama omedelbart
- ✅ **Enkel implementation**: Standard streaming-loop utan special logic
- ✅ **Låg latency**: 20-80ms mellan tokens, inget blocking

### Nackdelar med vårt val
- ❌ **Felaktig info visas temporärt**: Användaren ser "777 kr" i 2 sekunder innan det ersätts
- ❌ **Förvirrande**: "Varför visades först ett svar, sen ett annat?"
- ❌ **Screenshot risk**: Användare kan screenshota innan verifiering

### Mitigation
För production, överväg:

1. **Visual indicators under streaming**:
   ```
   Premium kostar 399 kr/månad [⏳ Verifierar...]
   ```

2. **Blur effect tills verifiering klar**:
   ```css
   .streaming-text {
     filter: blur(2px);
     opacity: 0.7;
   }
   ```

3. **Disclaimer**:
   ```
   💬 Svar visas i realtid, verifieras efter completion
   ```

### Rekommendation för produktion
För högkritiska domäner (pricing, legal, medical): **Använd Alternativ B** (verifiera före streaming).

För low-stakes eller snabb feedback: **Vårt val är OK** med visuella indikatorer.

---

## Sammanfattning

| Beslut | Valt | Valt bort | Huvudsaklig anledning |
|--------|------|-----------|----------------------|
| LLM | Mock | OpenAI/Claude API | Testbarhet av guardrails |
| Sökning | Keyword | Vector embeddings | Liten KB (5 filer) |
| State | In-memory Map | Redis/Postgres | Proof-of-concept, ej produktion |
| Failure mode | Fail-closed | Fail-open med varningar | Juridisk säkerhet |
| Streaming | Stream-then-verify | Verify-then-stream | UX (låg TTFT) |

Alla dessa beslut är **rätt för detta projekt** men skulle behöva omprövas för produktion.
