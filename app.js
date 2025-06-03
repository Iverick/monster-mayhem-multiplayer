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
const { 
  handleDisconnection,
  handleEndTurn,
  handleMove,
  startGame,
  identifyPlayer,
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

  const userObj = await User.findOne({ username: req.user.username });
  const lastGameId = userObj.gameId?.toString();
  res.render("index.ejs", { lastGameId });
});

app.use("/", authRoutes);

app.get("/game/:gameId", async (req, res) => {
  if (!(req.isAuthenticated())) return res.redirect("/login");

  const { gameId } = req.params;

  res.render("game.ejs", { 
    user: req.user,
    gameId: gameId || null
  });
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
// gameStart: false,
const gameState = {
  players: {},
  playersTurnCompleted: {},
  monsters: {},
  gameOver: false,
  gameStart: false,
};

// const MONSTER_TYPES = ['vampire', 'werewolf', 'ghost'];
// TODO: Use simplified line 90 simplified for testing
const MONSTER_TYPES = ['vampire', 'werewolf'];

const userStats = {};
const activeGameIdObj = {
  activeGameId: "",
}

// Websocket connection handler
wss.on("connection", (ws, req) => {
  console.log("New WebSocket connection");
  
  let playerId = null;

  // Message WebSocket handler
  ws.on("message", async (message) => {
    console.log("Received:", message);
    console.log("131. gameState object:", gameState);

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
      console.log("151. app. new game - activeGameId must be null: " + activeGameIdObj.activeGameId)
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

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
