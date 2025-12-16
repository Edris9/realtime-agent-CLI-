# Mini Realtime Agent

![Tests](https://github.com/Edris9/realtime-agent-CLI-/actions/workflows/ci.yml/badge.svg)

En WebSocket-server med hallucinationsskydd som streamar AI-svar token för token och verifierar alla siffror mot en kunskapsbas.

## Funktioner

- **Real-time streaming**: Svar streamar token för token med 20-80ms delay
- **Hallucinationsskydd**: Alla siffror verifieras mot kunskapsbas (fail-closed)
- **Action-hantering**: Detekterar och hanterar actions som "ring mig", "skicka sms", "skapa ärende"
- **Idempotency**: Samma action kan inte köras flera gånger inom 30 sekunder
- **Abort-stöd**: Avbryt streaming mitt i pågående svar
- **WebSocket API**: Real-time kommunikation mellan klient och server

## Installation

```bash
npm install
```

## Hur man kör

### Starta servern

```bash
npm run dev
```

Servern startar på `ws://localhost:8787`

### Kör tester

```bash
npm test
```

Kör alla 14 tester för number extraction, grounding och actions.

### Öppna testklient

Öppna `client.html` i din webbläsare för att testa servern interaktivt.

## API-dokumentation

### Inkommande meddelanden (Klient → Server)

#### 1. Skicka meddelande

```json
{
  "type": "message",
  "id": "msg_1234567890",
  "text": "Vad kostar premium?"
}
```

#### 2. Avbryt streaming

```json
{
  "type": "cancel"
}
```

#### 3. Bekräfta action

```json
{
  "type": "confirm_action",
  "suggestionId": "action_1234567890_abc123"
}
```

### Utgående meddelanden (Server → Klient)

#### 1. Stream token

```json
{
  "type": "stream",
  "delta": "Premium "
}
```

Skickas för varje token under streaming.

#### 2. Stream avslutat

```json
{
  "type": "stream_end",
  "reason": "done" // eller "cancelled"
}
```

#### 3. Verifierat svar

```json
{
  "type": "response",
  "text": "Premium kostar 399 kr/månad",
  "citations": [
    {
      "file": "kb/pricing.md",
      "snippet": "Premium: 399 kr/månad"
    }
  ]
}
```

Om grounding misslyckas:

```json
{
  "type": "response",
  "text": "Jag kan inte verifiera det.",
  "citations": []
}
```

#### 4. Action-förslag

```json
{
  "type": "action_suggestion",
  "suggestionId": "action_1234567890_abc123",
  "action": "schedule_callback",
  "payload": {
    "phone": "+46 8 123 45 67"
  }
}
```

#### 5. Action-resultat

```json
{
  "type": "action_executed",
  "suggestionId": "action_1234567890_abc123",
  "result": {
    "success": true,
    "ignored": false,
    "message": "Callback scheduled to +46 8 123 45 67"
  }
}
```

## Mappstruktur

```
realtime-agent-02/
├── src/
│   ├── server.ts           # WebSocket-server (huvudfil)
│   ├── mock_llm.ts         # Fake LLM med streaming
│   ├── grounding.ts        # Hallucinationsskydd
│   ├── actions.ts          # Action-hantering
│   └── tests/
│       └── test.ts         # Testsuite
├── kb/                     # Kunskapsbas (markdown-filer)
│   ├── pricing.md          # Priser och rabatter
│   ├── policies.md         # Villkor och ångerrätt
│   ├── contact.md          # Kontaktinformation
│   ├── faq.md              # FAQ
│   └── products.md         # Produkter och funktioner
├── .claude/
│   └── CLAUDE.md           # Projektinstruktioner
├── client.html             # Testklient för webbläsare
├── package.json
├── tsconfig.json
└── README.md
```

## Hur hallucinationsskyddet fungerar

### 1. Kunskapsbas

Alla fakta lagras i markdown-filer under `kb/`. Vid uppstart läses alla filer och alla siffror extraheras.

### 2. Number Extraction

Systemet extraherar följande sifferformat:

- **Heltal**: 99, 200
- **Decimaler**: 12.5, 12,5
- **Procent**: 20%, 50%
- **Telefonnummer**: +46 8 123 45 67
- **Datum**: 2025-12-31

### 3. Grounding-verifiering

När LLM:en genererat ett svar:

1. **Extrahera alla siffror** från svaret
2. **Kontrollera varje siffra** mot kunskapsbasen
3. **Fail-closed**: Om någon siffra saknas → returnera "Jag kan inte verifiera det."
4. **Sök källor**: Hitta relevanta snippets från KB baserat på nyckelord
5. **Returnera resultat**: Antingen verifierat svar med citations eller avslag

### 4. Exempel

**Godkänt svar:**
```
Input: "Vad kostar Basic?"
LLM: "Basic kostar 99 kr/månad"
Grounding: ✓ 99 finns i kb/pricing.md
Output: "Basic kostar 99 kr/månad" + citations
```

**Avvisat svar:**
```
Input: "hallucinate pris"
LLM: "Basic kostar 75 kr/månad med 75% rabatt"
Grounding: ✗ 75 finns inte i KB
Output: "Jag kan inte verifiera det."
```

## Action-hantering

### Triggers

Systemet detekterar följande fraser:

- **"ring mig", "ring upp"** → `schedule_callback`
- **"skicka sms", "sms:a"** → `send_sms`
- **"skapa ärende", "öppna ticket"** → `create_ticket`

### Flöde

1. **Detektion**: När användaren skickar "Ring mig imorgon"
2. **Suggestion**: Server skickar `action_suggestion` med unikt ID
3. **Bekräftelse**: Klient visar UI med Bekräfta/Avvisa-knappar
4. **Exekvering**: Vid bekräftelse skickas `confirm_action` till server
5. **Idempotency**: Samma ID inom 30 sek returnerar `{ ignored: true }`

### Telefonnummer-extraktion

Om användaren skriver "Ring +46 70 123 45 67", extraheras numret automatiskt och inkluderas i `payload.phone`.

## Designbeslut

### 1. Fail-closed strategie

Hellre säga "Jag vet inte" än att ge felaktig information. Detta är kritiskt för applikationer där korrekthet är viktigare än täckning.

### 2. Token-för-token streaming

Ger bättre användarupplevelse än att vänta på hela svaret. Delay på 20-80ms simulerar realistisk LLM-hastighet.

### 3. Grounding efter streaming

Svaret verifieras först efter att hela svaret genererats. Detta innebär att användaren ser svaret streama, men det kan ersättas med "Jag kan inte verifiera det." om grounding misslyckas.

**Alternativ design**: Verifiera varje token under streaming (mer komplext, men förhindrar att felaktig info visas).

### 4. Idempotency med 30-sekunders fönster

Förhindrar dubbelklick och accidentell återexekvering utan att kräva persistent databas.

### 5. Mock LLM med hallucineringsfunktion

För testning inkluderas en "hallucinate"-trigger som gör att LLM:en medvetet svarar med felaktiga siffror. Detta verifierar att guardrails fungerar.

### 6. WebSocket istället för HTTP

Real-time streaming kräver WebSocket. HTTP streaming (SSE) hade varit ett alternativ men WebSocket ger dubbelriktad kommunikation för cancel/actions.

### 7. Ingen persistent lagring

Actions lagras i minne (Map). För produktion skulle man använda Redis/databas för persistent idempotency.

## Tester

Projektet har 14 tester som verifierar:

### Number Extraction (4 tester)
- Extraherar heltal (99)
- Extraherar decimaler (12.5, 12,5)
- Extraherar procent (20%)
- Extraherar telefonnummer (+46 8 123 45 67)

### Grounding (5 tester)
- Godkänner svar med korrekta siffror från KB
- Avvisar svar med påhittade siffror (777)
- Avvisar påhittade telefonnummer
- Godkänner svar utan siffror
- Fail-closed vid inga relevanta källor

### Actions (5 tester)
- Detekterar "ring mig" → schedule_callback
- Detekterar "skicka sms" → send_sms
- Detekterar "skapa ärende" → create_ticket
- Returnerar null för vanliga meddelanden
- Idempotency - samma ID ger ignored: true

## Vidareutveckling

### Möjliga förbättringar

1. **Real LLM-integration**: Byt ut mock_llm.ts mot API-anrop till Claude/GPT
2. **Fuzzy matching**: Acceptera "98.99" när KB säger "99"
3. **Persistent actions**: Använd Redis för idempotency över server-omstarter
4. **Loggning**: Lägg till structured logging för debugging
5. **Rate limiting**: Förhindra spam från klienter
6. **Autentisering**: Lägg till WebSocket auth
7. **Multifil-citations**: Kombinera information från flera KB-filer
8. **Streaming grounding**: Verifiera tokens under streaming istället för efteråt
9. **Confidence scores**: Returnera hur säker grounding-verifieringen är
10. **Metrics**: Spåra hallucination rate, grounding success rate, etc.

## Licens

ISC
.github/workflows/ci.yml