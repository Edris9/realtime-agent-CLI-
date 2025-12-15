# Mini Realtime Agent

## Projektbeskrivning
En WebSocket-server med hallucinationsskydd som streamar svar token för token.

## Krav
- Servern körs på ws://localhost:8787
- Streama svar token för token
- Grunda alla siffror mot kunskapsbas (kb/)
- Fail-closed: Hellre "jag vet inte" än fel information

## Struktur
- `src/` - källkod
- `kb/` - kunskapsbas för faktakontroll
- `.claude/` - projektinstruktioner
