const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require("connect-mongo");

const setupWebSocketServer = require("./websocketServer");
const passport = require("./config/passportInit.js");
const { PORT, MONGO_URI, SESSION_SECRET_KEY } = require("./config/config");
const authRoutes = require("./routes/authRoutes.js");
const gameRoutes = require("./routes/gameRoutes.js");
const User = require("./models/User.js");

const app = express();
const server = http.createServer(app);

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
app.use("/game", gameRoutes);

// Variables required for the game setup
// gameState object stores main game info
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

// WebSocket server setup
setupWebSocketServer(server, gameState, MONSTER_TYPES, userStats, activeGameIdObj);

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// gameState structure is:
// gameState: {
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
//     position: { row: 0, col: 0, },
//     hasMoved: false,
//   }
// },
// gameOver: false,
// gameStart: false,
// }
