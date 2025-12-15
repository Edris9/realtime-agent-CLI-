# Mini Realtime Agent

## Projektbeskrivning

En WebSocket-server med hallucinationsskydd som streamar AI-svar token för token och verifierar alla siffror mot en kunskapsbas. Systemet använder en fail-closed strategi där korrekthet prioriteras över täckning.

## Arkitektur

```
Klient (client.html)
    ↓ WebSocket
Server (src/server.ts)
    ↓
Mock LLM (src/mock_llm.ts) → Streaming
    ↓
Grounding (src/grounding.ts) → Verifiering mot KB
    ↓
Response med citations
```

## Krav

- Servern körs på `ws://localhost:8787`
- Streama svar token för token (20-80ms delay)
- Grunda alla siffror mot kunskapsbas (`kb/`)
- Fail-closed: Hellre "jag vet inte" än fel information
- Stöd för actions med användarbekräftelse
- Cancel-stöd för att avbryta pågående streaming

## Struktur

```
realtime-agent-02/
├── src/
│   ├── server.ts           # WebSocket-server (huvudfil)
│   ├── mock_llm.ts         # Fake LLM med streaming
│   ├── grounding.ts        # Hallucinationsskydd
│   ├── actions.ts          # Action-hantering
│   └── tests/test.ts       # Testsuite
├── kb/                     # Kunskapsbas (markdown-filer)
├── .claude/                # Projektinstruktioner
├── client.html             # Testklient
└── README.md
```

---

## 1. Sifferdefinition och verifiering

### Vad är en siffra?

En "siffra" definieras som en sekvens av siffertecken 0-9, inklusive:

- **Heltal**: `99`, `200`, `1000`
- **Decimaler**: `12.5`, `12,5` (både punkt och komma)
- **Procent**: `20%`, `50%`
- **Telefonnummer**: `+46 8 123 45 67`, `+46-8-123-45-67`
- **Datum**: `2025-12-31`, `2025/12/31`
- **Kombinationer**: `399 kr`, `1 TB`, `10 000`

### Normalisering

Alla siffror normaliseras innan jämförelse:

| Original | Normaliserat |
|----------|--------------|
| `12,5` | `12.5` |
| `+46 8 123 45 67` | `+46 8 123 45 67` (mellanslag behålls) |
| `10 000` | `10 000` |
| `20%` | `20` och `20%` (båda sparas) |

**Regel**: Ett normaliserat nummer från LLM-svaret måste finnas exakt i kunskapsbasen (antingen i original- eller normaliserad form).

### Verifieringsprocess

1. **Extrahera alla siffror** från LLM-svaret med `extractAllNumbers()`
2. **Normalisera** varje siffra
3. **Kontrollera** att varje normaliserad siffra finns i minst en KB-fil
4. **Fail-closed**: Om någon siffra saknas → returnera `"Jag kan inte verifiera det."`

### Exempel

#### Godkänt

```
LLM-svar: "Basic kostar 99 kr/månad"
Extraherade siffror: ["99"]
KB (kb/pricing.md): "Basic: 99 kr/månad"
Resultat: ✓ Godkänt (99 finns i KB)
```

#### Avvisat

```
LLM-svar: "Basic kostar 777 kr/månad"
Extraherade siffror: ["777"]
KB (kb/pricing.md): "Basic: 99 kr/månad"
Resultat: ✗ Avvisat (777 finns inte i KB)
Output: "Jag kan inte verifiera det."
```

### Citation-krav

- Varje verifierat svar måste inkludera minst en citation från KB
- Citation-format: `{ file: "kb/pricing.md", snippet: "Basic: 99 kr/månad" }`
- Om inga relevanta snippets hittas → returnera `"Jag hittar inget stöd i kunskapsbasen."`

---

## 2. Actions med bekräftelse

### Action-typer

```typescript
type ActionType =
  | "schedule_callback"  // Boka återuppringning
  | "send_sms"          // Skicka SMS
  | "create_ticket"     // Skapa support-ärende
```

### Triggers

Systemet detekterar följande fraser i användarmeddelanden:

| Trigger | Action |
|---------|--------|
| `"ring mig"`, `"ring upp"` | `schedule_callback` |
| `"skicka sms"`, `"sms:a"` | `send_sms` |
| `"skapa ärende"`, `"öppna ticket"` | `create_ticket` |

**Telefonnummer-extraktion**: Om användaren inkluderar ett telefonnummer (t.ex. `"Ring +46 70 123 45 67"`), extraheras det automatiskt och inkluderas i `payload.phone`.

### Flöde

1. **Detektion** (Server)
   - Användaren skickar: `"Ring mig imorgon på +46 70 123 45 67"`
   - Server kör `detectActionTrigger(text)`
   - Trigger hittas: `"ring mig"` → `schedule_callback`

2. **Suggestion** (Server → Klient)
   ```json
   {
     "type": "action_suggestion",
     "suggestionId": "action_1702896543210_x7k9m2",
     "action": "schedule_callback",
     "payload": {
       "phone": "+46 70 123 45 67"
     }
   }
   ```

3. **Bekräftelse** (Klient)
   - Klient visar UI med "Bekräfta" och "Avvisa"-knappar
   - Användaren klickar "Bekräfta"

4. **Exekvering** (Klient → Server)
   ```json
   {
     "type": "confirm_action",
     "suggestionId": "action_1702896543210_x7k9m2"
   }
   ```

5. **Resultat** (Server → Klient)
   ```json
   {
     "type": "action_executed",
     "suggestionId": "action_1702896543210_x7k9m2",
     "result": {
       "success": true,
       "ignored": false,
       "message": "Callback scheduled to +46 70 123 45 67"
     }
   }
   ```

### Idempotency

**Regel**: Samma `suggestionId` kan endast exekveras en gång inom 30 sekunder.

```typescript
// Första gången
confirmAction("action_123")
// → { success: true, ignored: false, message: "..." }

// Inom 30 sekunder
confirmAction("action_123")
// → { success: true, ignored: true, message: "Already executed" }
```

**Implementation**:
- Lagra executed actions i en `Map<suggestionId, { timestamp, result }>`
- Vid bekräftelse: Kontrollera om `Date.now() - timestamp < 30000`
- Rensa gamla actions var 60:e sekund med `clearExpiredActions()`

### State management

- **Pending actions**: `Map<suggestionId, ActionSuggestion>`
- **Executed actions**: `Map<suggestionId, { timestamp, result }>`
- Actions tas bort från pending när de exekveras
- Executed actions rensas efter 5 minuter (300 000 ms)

---

## 3. Cancel-flöde

### Användningsfall

Användaren vill avbryta pågående streaming (t.ex. svaret är för långt eller fel fråga ställdes).

### Flöde

1. **Streaming pågår**
   - Server streamar tokens via `streamResponse()`
   - Klient visar "Avbryt"-knapp

2. **Användaren klickar "Avbryt"**
   ```json
   {
     "type": "cancel"
   }
   ```

3. **Server avbryter streaming**
   - `AbortController.abort()` triggas
   - `streamResponse()` kastar `Error("Streaming aborted")`
   - Streaming stoppas omedelbart

4. **Server bekräftar cancel**
   ```json
   {
     "type": "stream_end",
     "reason": "cancelled"
   }
   ```

5. **State rensas**
   - `state.abortController = null`
   - `state.currentMessageId = null`
   - Server är redo för nästa message **direkt**

### Viktiga detaljer

- **Omedelbar abort**: Ingen delay, streaming stoppas mellan tokens
- **Ingen partial response**: Inget `response`-meddelande skickas vid cancel
- **Idempotent cancel**: Flera cancel-anrop är säkra (no-op om ingen streaming pågår)
- **Per-klient state**: Varje WebSocket-anslutning har egen `AbortController`

### Client-side implementation

```javascript
function cancelStream() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'cancel' }));
    isStreaming = false;
    document.getElementById('cancelBtn').style.display = 'none';
  }
}
```

### Server-side implementation

```typescript
if (message.type === "cancel") {
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
    state.currentMessageId = null;

    ws.send(JSON.stringify({
      type: "stream_end",
      reason: "cancelled"
    }));
  }
  return;
}
```

---

## 4. Innovation: Retrieve-First Approach

### Traditionell RAG (Retrieval-Augmented Generation)

```
1. LLM genererar svar
2. Verifiera svar mot kunskapsbas
3. Om fel → avvisa
```

**Problem**: LLM genererar potentiellt felaktigt innehåll som måste kasseras.

### Retrieve-First (vår approach)

```
1. Sök kunskapsbasen INNAN LLM genererar
2. Om inga källor hittas → fail-closed direkt
3. LLM genererar svar (med KB-kontext)
4. Verifiera svar mot KB
5. Om verifiering misslyckas → avvisa
```

**Fördelar**:
- Minskar risken för hallucinationer (LLM har rätt kontext)
- Fail-closed vid brist på sources
- Bättre användarupplevelse (färre avvisade svar)

### Implementation

```typescript
export function verifyGrounding(responseText: string, query: string): GroundingResult {
  // 1. Sök KB baserat på query
  const citations = searchKnowledgeBase(query);

  // 2. Om inga källor → fail-closed
  if (citations.length === 0 && hasNumbers(responseText)) {
    return {
      isGrounded: false,
      verifiedText: "Jag hittar inget stöd i kunskapsbasen."
    };
  }

  // 3. Extrahera siffror från svar
  const responseNumbers = extractAllNumbers(responseText);

  // 4. Verifiera varje siffra
  for (const num of responseNumbers) {
    if (!isInKnowledgeBase(num)) {
      return {
        isGrounded: false,
        verifiedText: "Jag kan inte verifiera det."
      };
    }
  }

  // 5. Godkänt
  return {
    isGrounded: true,
    verifiedText: responseText,
    citations
  };
}
```

### Fail-closed philosophy

**Princip**: Hellre "jag vet inte" än felaktig information.

**Tillämpning**:
- Okänd siffra → Avvisa
- Inga källor → Avvisa
- Tveksam match → Avvisa

**Konsekvens**: Lägre coverage (fler "vet inte"-svar) men högre precision (inga fel).

---

## WebSocket API

### Meddelanden: Klient → Server

#### 1. Message
```json
{
  "type": "message",
  "id": "msg_1702896543210",
  "text": "Vad kostar premium?"
}
```

#### 2. Cancel
```json
{
  "type": "cancel"
}
```

#### 3. Confirm Action
```json
{
  "type": "confirm_action",
  "suggestionId": "action_1702896543210_x7k9m2"
}
```

### Meddelanden: Server → Klient

#### 1. Stream
```json
{
  "type": "stream",
  "delta": "Premium "
}
```

#### 2. Stream End
```json
{
  "type": "stream_end",
  "reason": "done" // eller "cancelled"
}
```

#### 3. Response
```json
{
  "type": "response",
  "text": "Premium kostar 399 kr/månad",
  "citations": [
    { "file": "kb/pricing.md", "snippet": "Premium: 399 kr/månad" }
  ]
}
```

#### 4. Action Suggestion
```json
{
  "type": "action_suggestion",
  "suggestionId": "action_1702896543210_x7k9m2",
  "action": "schedule_callback",
  "payload": { "phone": "+46 70 123 45 67" }
}
```

#### 5. Action Executed
```json
{
  "type": "action_executed",
  "suggestionId": "action_1702896543210_x7k9m2",
  "result": {
    "success": true,
    "ignored": false,
    "message": "Callback scheduled"
  }
}
```

---

## Testning

### Kör alla tester

```bash
npm test
```

### Test-kategorier

1. **Number Extraction** (4 tester)
   - Heltal, decimaler, procent, telefonnummer

2. **Grounding** (5 tester)
   - Godkänn korrekta siffror
   - Avvisa påhittade siffror
   - Fail-closed vid inga källor

3. **Actions** (5 tester)
   - Trigger-detektion
   - Idempotency

### Manuell testning

1. Starta server: `npm run dev`
2. Öppna `client.html`
3. Testa exempelchips:
   - **"Vad kostar premium?"** → Ska returnera "399 kr/månad" med citations
   - **"hallucinate"** → Ska avvisas med "Jag kan inte verifiera det."
   - **"Ring mig imorgon"** → Ska visa action-förslag

---

## Designbeslut

### 1. Mock LLM med hallucineringsfunktion

För testning inkluderas en "hallucinate"-trigger som gör att LLM:en medvetet svarar med felaktiga siffror. Detta verifierar att guardrails fungerar.

### 2. WebSocket över HTTP

Real-time streaming kräver WebSocket. HTTP streaming (SSE) hade varit ett alternativ men WebSocket ger dubbelriktad kommunikation för cancel/actions.

### 3. In-memory state (ej persistent)

Actions lagras i `Map` (minne). För produktion skulle man använda Redis/databas för persistent idempotency över server-omstarter.

### 4. Streaming först, verifiering efteråt

Användaren ser svaret streama, men det kan ersättas med "Jag kan inte verifiera det." efter completion. Detta ger bättre UX än att vänta på verifiering innan streaming.

**Alternativ design**: Verifiera varje token under streaming (mer komplext, men förhindrar att felaktig info visas).

### 5. 30-sekunders idempotency-fönster

Balans mellan att förhindra dubbelklick och att tillåta användaren att köra samma action igen efter kort tid.

---

## Produktion-checklista

För att göra detta production-ready:

- [ ] Byt ut mock LLM mot real LLM API (Claude, GPT)
- [ ] Persistent storage för actions (Redis)
- [ ] Autentisering och auktorisering
- [ ] Rate limiting per klient
- [ ] Structured logging (Winston, Pino)
- [ ] Metrics och monitoring (Prometheus)
- [ ] Error tracking (Sentry)
- [ ] Health checks och graceful shutdown
- [ ] HTTPS/WSS för WebSocket
- [ ] Input validation och sanitization
- [ ] Fuzzy number matching (98.99 ≈ 99)
- [ ] Multi-language support
- [ ] Caching av KB-sökningar
- [ ] Horizontal scaling (sticky sessions)
