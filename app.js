const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require("connect-mongo");

const passport = require("./config/passportInit.js");
const { PORT, MONGO_URI, SESSION_SECRET_KEY } = require("./config/config");
const authRoutes = require("./routes/authRoutes.js");
const User = require("./models/User.js");
const { getUsernameById, broadcastAll, broadcastExcept, handleDisconnection, startGame } = require("./helpers/serverHelpers.js");
const { resolveCollision } = require("./helpers/gameHelpers.js");

const app = express();

// Connect to MongoDB
mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));

// Session setup
// Manage authentication and cookies
const sessionParser = session({
  secret: SESSION_SECRET_KEY,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI })
});

app.use(sessionParser);

// Middleware setup
// Initialize passport and use it for session management
app.use(passport.initialize());
app.use(passport.session());

// Allows to parse JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup template engine
app.set("view engine", "ejs");
app.use(express.static("public"));

// Routes setup
app.use("/", authRoutes);
app.get("/game", (req, res) => {
  if (!(req.isAuthenticated())) return res.redirect("/login");

  res.render("game.ejs", { user: req.user });
});

// WebSocket server setup
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Variables required for the game setup
let nextPlayerId = 1;
  // Maps playerId to { row, col }
  // Object structure is:
  // players: {
  //   "playerId1": "username1",
  //   "playerId2": "username2",
  // },
  // monsters: {
  //   "m_playerId1-monsterType": {
  //     playerId: "playerId1",
  //     type: "monsterType",
  //     position: {
  //       row: 0,
  //       col: 0,
  //     }
  //   }
  // },
  // gameOver: false,
const gameState = {
  players: {},
  monsters: {},
  gameOver: false,
};

wss.on("connection", (ws, req) => {
  console.log("New WebSocket connection");

  const playerId = nextPlayerId++;

  // Notify other players of the new player with sync message
  broadcastExcept(ws, {
    type: "sync",
    allPlayers: gameState.players,
  }, wss);

  // Message WebSocket handler
  ws.on("message", async (message) => {
    console.log("Received:", message);
    console.log("99. gameState object:", gameState);

    const messageData = JSON.parse(message);

    if (messageData.type === "identify") {
      console.log("112: Identify message received " + messageData.username);
      const username = messageData.username;
      gameState.players[playerId] = username;

      // Send init message after registering the player and assingintg the username
      ws.send(JSON.stringify({ 
        type: "init",
        id: playerId,
        allPlayers: gameState.players,
      }));
    }

    // Handle game start event with a helper function
    if (messageData.type === "start") {
      await startGame (gameState, wss);
      // console.log("gameState after after calling gameStart:", gameState);
    }

    // Handle monster movement
    // Update the gameState object with the new position of the monster and broadcast the updated monster object to all clients
    if (messageData.type === "move") {
      console.log("123. Player moved:", messageData);
      const { monsterId, position, userId } = messageData;
      const movingMonster = gameState.monsters[monsterId];
      if (!movingMonster) return;

      // console.log("128. Monster to be moved:", movingMonster);

      // Check if the monster belongs to the player
      if (String(movingMonster.playerId) !== String(userId)) {
        console.log(`Player ${userId} tried to move monster they don't own.`);
        return;
      }

      // Check if there is a collision with another monster object that belongs to a different player
      const destinationMonster = Object.entries(gameState.monsters).find(([id, monster]) => {
        return id !== monsterId && 
                monster.position.row === position.row && 
                monster.position.col === position.col &&
                String(monster.playerId) !== String(userId); // Ensure it's not the same player's monster
      });

      if (destinationMonster) {
        const [defenderId, defender] = destinationMonster;

        // Get array of monster IDs to be removed
        const { removed, winnerId } = resolveCollision(movingMonster, monsterId, defender, defenderId);

        // console.log("150. Collision resolved:", {
        //   removed,
        //   winnerId,
        // });

        // Remove monsters from gameState based on the result
        removed.forEach((monsterId) => delete gameState.monsters[monsterId]);

        // If there is a winner of the monster collision, update its position as passed in the message
        if (winnerId) {
          gameState.monsters[winnerId].position = position;
        }

        // TODO: Refactor this to move the whole logic to a separate function
        // After collision resolution, check if a player has lost all monsters
        const playerMonsterCounts = {};

        // Count remaining monsters for each player
        for (const monster of Object.values(gameState.monsters)) {
          if (!playerMonsterCounts[monster.playerId]) {
            playerMonsterCounts[monster.playerId] = 0;
          }
          playerMonsterCounts[monster.playerId]++;
        }

        // Get all player IDs in the game
        const remainingPlayers = Object.keys(gameState.players);

        // Find which players still have monsters
        const activePlayers = remainingPlayers.filter(
          playerId => playerMonsterCounts[playerId] > 0
        );

        console.log("183. Active players with monsters:", activePlayers);

        // If one or no players remain with monsters, declare the game over and set a winner of the game
        if (activePlayers.length < 2 && !gameState.gameOver) {

          let winnerPlayerId;

          if (activePlayers.length === 1) {
            winnerPlayerId = activePlayers[0];
          } else {
            // If no players left, the current player is the winner
            winnerPlayerId = userId; 
          }

          const winnerUsername = gameState.players[winnerPlayerId];

          const loserPlayerId = Object.keys(gameState.players).find(id => id !== String(winnerPlayerId));
          const loserUsername = gameState.players[loserPlayerId];

          // Modify the number of wins and losses for the players
          await User.findOneAndUpdate({ username: winnerUsername }, { $inc: { wins: 1 } });
          await User.findOneAndUpdate({ username: loserUsername }, { $inc: { losses: 1 } });

          // Reset game state
          gameState.gameOver = true;
          gameState.players = {};
          gameState.monsters = {};

          // Broadcast game over message to all clients passing the winner and loser usernames
          broadcastAll({
            type: "gameOver",
            winner: winnerUsername,
            loser: loserUsername,
          }, wss);
        }

        // TODO: END of refactoring
      } else {
        // No collision — apply move
        movingMonster.position = position;
      }

      // console.log("160. Monster moved:", movingMonster);

      // Broadcast the new move to all clients
      broadcastAll({
        type: "update",
        monsters: gameState.monsters,
      }, wss);
    }
  });

  // Handle player disconnection
  ws.on("close", async () => {
    await handleDisconnection(gameState, playerId, ws, wss);
    // console.log("Updated gameState after player disconnection:", gameState);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
