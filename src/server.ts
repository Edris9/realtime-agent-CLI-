import { WebSocketServer, WebSocket } from "ws";
import { loadKnowledgeBase, verifyGrounding } from "./grounding.js";
import { streamResponse } from "./mock_llm.js";
import {
  detectActionTrigger,
  createActionSuggestion,
  confirmAction,
  clearExpiredActions,
} from "./actions.js";

interface ClientState {
  abortController: AbortController | null;
  currentMessageId: string | null;
}

const clientStates = new WeakMap<WebSocket, ClientState>();

const wss = new WebSocketServer({ port: 8787 });

console.log("Loading knowledge base...");
loadKnowledgeBase("./kb");
console.log("Knowledge base loaded.");

setInterval(() => {
  clearExpiredActions();
}, 60000);

wss.on("connection", (ws: WebSocket) => {
  console.log("Client connected");

  clientStates.set(ws, {
    abortController: null,
    currentMessageId: null,
  });

  ws.on("message", async (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      const state = clientStates.get(ws);

      if (!state) return;

      if (message.type === "cancel") {
        if (state.abortController) {
          state.abortController.abort();
          state.abortController = null;
          state.currentMessageId = null;

          ws.send(
            JSON.stringify({
              type: "stream_end",
              reason: "cancelled",
            })
          );
        }
        return;
      }

      if (message.type === "confirm_action") {
        const result = confirmAction(message.suggestionId);
        ws.send(
          JSON.stringify({
            type: "action_executed",
            suggestionId: message.suggestionId,
            result,
          })
        );
        return;
      }

      if (message.type === "message") {
        const { id, text } = message;

        if (state.abortController) {
          state.abortController.abort();
        }

        state.abortController = new AbortController();
        state.currentMessageId = id;

        const actionTrigger = detectActionTrigger(text);
        if (actionTrigger.action) {
          const suggestion = createActionSuggestion(
            actionTrigger.action,
            actionTrigger.payload
          );
          ws.send(
            JSON.stringify({
              type: "action_suggestion",
              suggestionId: suggestion.suggestionId,
              action: suggestion.action,
              payload: suggestion.payload,
            })
          );
        }

        let fullResponse = "";

        await streamResponse(
          text,
          {
            onToken: (token: string) => {
              fullResponse += token;
              ws.send(
                JSON.stringify({
                  type: "stream",
                  delta: token,
                })
              );
            },
            onComplete: () => {
              if (state.currentMessageId !== id) return;

              ws.send(
                JSON.stringify({
                  type: "stream_end",
                  reason: "done",
                })
              );

              const groundingResult = verifyGrounding(fullResponse.trim(), text);

              ws.send(
                JSON.stringify({
                  type: "response",
                  text: groundingResult.verifiedText,
                  citations: groundingResult.citations || [],
                })
              );

              state.abortController = null;
              state.currentMessageId = null;
            },
            onError: (error: Error) => {
              if (error.message === "Streaming aborted") {
                return;
              }

              console.error("Stream error:", error);
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: error.message,
                })
              );

              state.abortController = null;
              state.currentMessageId = null;
            },
          },
          state.abortController.signal
        );
      }
    } catch (error) {
      console.error("Message handling error:", error);
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Failed to process message",
        })
      );
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    const state = clientStates.get(ws);
    if (state?.abortController) {
      state.abortController.abort();
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

console.log("WebSocket server running on ws://localhost:8787");
