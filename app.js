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
const { getUsernameById, broadcastAll, broadcastExcept, handleDisconnection } = require("./helpers/serverHelpers.js");
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
const gameState = {
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
  players: {},
  monsters: {},
  gameOver: false,
};

const monsterTypes = ['vampire', 'werewolf', 'ghost'];

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

    // Notify all players that the game is ready and increase the game count for participants
    if (messageData.type === "start") {
      // Reset game over state
      gameState.gameOver = false;
      // Use fixed cols for simplicity
      const spawnRows = [2, 5, 7]; 

      // The following code is used to generate the monsters and their location for each player
      // and store them in the gameState object
      for (const playerId in gameState.players) {
        const isEven = parseInt(playerId) % 2 === 0;
        const col = isEven ? 0 : 9;

        monsterTypes.forEach((type, index) => {
          const monsterId = `m_${playerId}-${type}`;
          const row = spawnRows[index];
          gameState.monsters[monsterId] = {
            playerId,
            type,
            position: {
              row,
              col,
            }
          };
        })
      }

      // Increment the game count for each player
      for (const playerId in gameState.players) {
        console.log("116: Check username for id: ", gameState.players[playerId]);
        const username = gameState.players[playerId];
        if (username) {
          await User.findOneAndUpdate(
            { username },
            { $inc: { games: 1 }},
          )
        }
      }
      
      // Send start message to all players with the gameState object
      broadcastAll({ 
        type: "start",
        data: {
          players: gameState.players,
          monsters: gameState.monsters
        },
      }, wss);
    }

    // Handle player movement
    // Call broadcastAll to update gameState object with the new position and pass this object to all clients
    if (messageData.type === "move") {
      console.log("Player moved:", messageData);
      gameState.players[messageData.id] = messageData.position;

      // Broadcast the new move to all clients
      broadcastAll({
        type: "update",
        id: messageData.id,
        position: messageData.position,
      }, wss);
    }

    if (messageData.type === "collision") {
      const { attackerId, defenderId } = messageData;
      const attacker = gameState.monsters[attackerId];
      const defender = gameState.monsters[defenderId];

      if (!attacker || !defender) return;

      const result = resolveCollision(attacker, attackerId, defender, defenderId);

      // console.log("Collision result:", result);

      result.removed.forEach((monsterId) => {
        console.log(`Removing monster: ${monsterId}`);
        delete gameState.monsters[monsterId];
      });

      // TODO: Emit update and pass the client updated gameState object
      
      console.log("193. gameState object after resolver collision:", gameState);
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
