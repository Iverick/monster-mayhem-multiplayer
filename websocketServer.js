const WebSocket = require("ws");
const {
  identifyPlayer,
  startGame,
  handleMove,
  handleEndTurn,
  handleDisconnection,
} = require("./helpers/serverHelpers");
const User = require("./models/User");

function setupWebSocketServer(server, gameState, MONSTER_TYPES, userStats, activeGameIdObj) {
  const wss = new WebSocket.Server({ server });

  // Websocket connection handler
  wss.on("connection", (ws, req) => {
    console.log("New WebSocket connection");
    
    let playerId = null;

    // Message WebSocket handler
    ws.on("message", async (message) => {
      console.log("Received:", message);

      const messageData = JSON.parse(message);

      if (messageData.type === "identify") {
        const { username, pausedGameId } = messageData;
        // Initialize player
        const user = await User.findOne({ username });
        playerId = String(user._id);

        await identifyPlayer(username, pausedGameId, gameState, activeGameIdObj, playerId, ws, wss);
      }

      // Handle game start event with a helper function
      if (messageData.type === "start") {
        console.log("135. gameState object on game start: ", gameState);
        await startGame (gameState, MONSTER_TYPES, userStats, wss);
      }

      // Handle monster movement
      if (messageData.type === "move") {
        handleMove(messageData, gameState, activeGameIdObj, wss);
      }

      // Mark the player's turn as completed
      if (messageData.type === "endTurnButton") {
        handleEndTurn(gameState, playerId, wss);
      }
    });

    // Handle player disconnection
    ws.on("close", async () => {
      handleDisconnection(gameState, activeGameIdObj, playerId, ws, wss);
    });
  });

  return wss;
}

module.exports = setupWebSocketServer;
