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
const Game = require("./models/Game.js");
const { 
  handleDisconnection,
  handleEndTurn,
  handleMove,
  startGame,
  initializeNewGame,
} = require("./helpers/serverHelpers.js");

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
app.get("/", async (req, res) => {
  if (!(req.isAuthenticated())) {
    return res.redirect("/login");
  }

  console.log("index route " + req.user);
  const userObj = await User.findOne({ username: req.user.username });
  const lastGameId = userObj.gameId?.toString();
  res.render("index.ejs", { lastGameId });
});

app.use("/", authRoutes);

app.get("/game/:gameId", async (req, res) => {
  const { gameId } = req.params;
  const pausedGame = await Game.findOne({ _id: gameId });

  res.send(pausedGame);
});

app.get("/game", (req, res) => {
  if (!(req.isAuthenticated())) return res.redirect("/login");

  res.render("game.ejs", { user: req.user });
});

// WebSocket server setup
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Variables required for the game setup

// gameState object stores main game info
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

// const MONSTER_TYPES = ['vampire', 'werewolf', 'ghost'];
// TODO: Use simplified line 90 simplified for testing
const MONSTER_TYPES = ['vampire', 'werewolf'];

const userStats = {};
  
let playerId = null;

// Websocket connection handler
wss.on("connection", (ws, req) => {
  console.log("New WebSocket connection");
  
  console.log("126. playerId:", playerId);

  // Message WebSocket handler
  ws.on("message", async (message) => {
    console.log("Received:", message);
    console.log("131. gameState object:", gameState);

    const messageData = JSON.parse(message);

    if (messageData.type === "identify") {
      console.log("136: Identify message received " + messageData.username);
      const username = messageData.username;

      // Check if the same User already tried to connect the game
      const isAlreadyConnected = Object.values(gameState.players).includes(username);
      if (isAlreadyConnected) {
        console.log(`Duplicate identify attempt: ${username} is already in the game.`);
        ws.send("You are already connected to the game.");
        ws.close();
        return;
      }

      // Check if the lobby is full (limit to 2 players)
      const currentPlayerCount = Object.keys(gameState.players).length;
      if (currentPlayerCount >= 2) {
        ws.send("Lobby is full. Cannot join the game.");
        ws.close();
        return;
      }

      // Initialize player and add him to the gameState
      playerId = playerId + 1;
      gameState.players[playerId] = username;

      initializeNewGame(gameState, playerId, ws, wss);
    }

    // Handle game start event with a helper function
    if (messageData.type === "start") {
      await startGame (gameState, MONSTER_TYPES, userStats, wss);
      // console.log("gameState after after calling gameStart:", gameState);
    }

    // Handle monster movement
    if (messageData.type === "move") {
      handleMove(messageData, gameState, wss);
    }

    // Mark the player's turn as completed
    if (messageData.type === "endTurnButton") {
      handleEndTurn(gameState, playerId, wss);
    }
  });

  // Handle player disconnection
  ws.on("close", async () => {
    if (playerId) await handleDisconnection(gameState, playerId, ws, wss);
    // console.log("Updated gameState after player disconnection:", gameState);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
