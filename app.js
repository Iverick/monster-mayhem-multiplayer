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
const { getUsernameById, broadcastAll, broadcastExcept, handleDisconnection, handleEndTurn, handleMove, startGame } = require("./helpers/serverHelpers.js");

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
  // playersTurnCompleted: {
  //   "playerId1": true,
  //   "playerId2": false,
  // },
  // monsters: {
  //   "m_playerId1-monsterType": {
  //     playerId: "playerId1",
  //     type: "monsterType",
  //     position: {
  //       row: 0,
  //       col: 0,
  //     },
  //     hasMoved: false,
  //   }
  // },
  // gameOver: false,
const gameState = {
  players: {},
  playersTurnCompleted: {},
  monsters: {},
  gameOver: false,
};

wss.on("connection", (ws, req) => {
  console.log("New WebSocket connection");

  const playerId = nextPlayerId++;

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

      // Inform all clients about the new player joining
      broadcastAll({ 
        type: "playerJoined",
        data: {
          allPlayers: gameState.players,
        },
      }, wss);
    }

    // Handle game start event with a helper function
    if (messageData.type === "start") {
      await startGame (gameState, wss);
      // console.log("gameState after after calling gameStart:", gameState);
    }

    // Handle monster movement
    // Update the gameState object with the new position of the monster and broadcast the updated monster object to all clients
    // Also check for collisions with other monsters and resolve them
    // Also check for the end of the game after processing the collision
    if (messageData.type === "move") {
      handleMove(messageData, gameState, wss);
    }

    if (messageData.type === "endTurnButton") {
      // Mark the player's turn as completed
      handleEndTurn(gameState, playerId, wss);
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
