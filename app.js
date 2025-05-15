const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require("connect-mongo");

const passport = require("./config/passportInit.js");
const { PORT, MONGO_URI, SESSION_SECRET_KEY } = require("./config/config");
const authRoutes = require("./routes/authRoutes.js");

const app = express();

// Connect to MongoDB
mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));

// Session setup
// Manage authentication and cookies
app.use(session({
  secret: SESSION_SECRET_KEY,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI })
}));

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

  res.render("game.ejs");
});

// WebSocket server setup
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let nextPlayerId = 1;
const gameState = {
  // Maps playerId to { row, col }
  // Object structure is:
  // players: {
  //   playerId1: { row: 0, col: 0 },
  //   playerId2: { row: 9, col: 9 },
  // }
  players: {}
};

wss.on("connection", (ws) => {
  console.log("New WebSocket connection");

  const playerId = nextPlayerId++;
  const startPosition = Object.keys(gameState.players).length % 2 === 0
    // If it's a first player start in the top of the grid
    ? { row: 0, col: 0 }
    // Second player starts in the bottom of the grid
    : { row: 9, col: 9 };

  gameState.players[playerId] = startPosition;
  
  // Send full game state to the newly connected player
  ws.send(JSON.stringify({ 
    type: "init",
    id: playerId,
    allPlayers: gameState.players,
  }));

  // Notify other players of the new player with sync message
  broadcastExcept(ws, {
    type: "sync",
    allPlayers: gameState.players,
  });

  // Message WebSocket handler
  ws.on("message", (message) => {
    console.log("Received:", message);
    console.log("gameState object:", gameState);

    const messageData = JSON.parse(message);

    // Handle player movement
    // Call broadcastAll to update gameState object with the new position and pass this object to all clients
    if (messageData.type === "move") {
      console.log("allPlayers", gameState);
      console.log("Player moved:", messageData);
      gameState.players[messageData.id] = messageData.position;

      // Broadcast the new move to all clients
      broadcastAll({
        type: "update",
        id: messageData.id,
        position: messageData.position,
      });
    }
  });

  // Handle player disconnection
  // Call broadcastAll to remove the player from all clients passing the playerId
  ws.on("close", () => {
    delete gameState.players[playerId];
    broadcastAll({ type: "remove", id: playerId });
  });
});

// Helper function to broadcast a message to all clients
function broadcastAll(message) {
  const str = JSON.stringify(message);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(str);
    }
  });
}

// Helper function to broadcast a message to all clients except the sender
function broadcastExcept(exceptClient, message) {
  const str = JSON.stringify(message);

  wss.clients.forEach((client) => {
    if (client !== exceptClient && client.readyState === WebSocket.OPEN) {
      client.send(str);
    }
  });
}

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
