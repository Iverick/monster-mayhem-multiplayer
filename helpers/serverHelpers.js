const WebSocket = require("ws");
const Game = require("../models/Game.js");
const User = require("../models/User.js");
const {
  addMonsters,
  getUserStats,
  processCollision,
  startNewRound,
  clearGameState,
  updatePlayerTurnStatus,
  checkRoundCompletion,
} = require("./gameHelpers.js");

function initializeNewGame(gameState, playerId, ws, wss) {
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

// Helper function that allows start the game by initializing monsters and modifying player data in the database
async function startGame(gameState, monsterTypes, userStats, wss) {
  // Reset game over state
  gameState.gameOver = false;

  for (const playerId in gameState.players) {
    console.log("19. serverHelper. startGame method: Check username for id: ", gameState.players[playerId]);
    // Add monsters to the game state for each player
    addMonsters(gameState, playerId, monsterTypes);

    // Initializes player turn status
    gameState.playersTurnCompleted[playerId] = false;

    // Find the user by username, update their game stats, and store them in the userStats object
    await getUserStats(gameState, playerId, userStats);
  }
  
  console.log("30. serverHelper. after initializing turn status: ", gameState);

  // Send start message to all players with the gameState object
  broadcastAll({ 
    type: "start",
    data: {
      players: gameState.players,
      stats: userStats,
      monsters: gameState.monsters,
      playersTurnCompleted: gameState.playersTurnCompleted,
    },
  }, wss);
}

function handleMove(messageData, gameState, wss) {
  console.log("123. Player moved:", messageData);
  const { monsterId, position, userId } = messageData;
  const movingMonster = gameState.monsters[monsterId];
  if (!movingMonster) return;

  console.log("49. serverHelpers. handleMove. Monster to be moved:", movingMonster);

  // Check if the monster belongs to the player
  if (String(movingMonster.playerId) !== String(userId)) {
    console.log(`68. serverHelpers. handleMove. Player ${userId} tried to move monster they don't own.`);
    return;
  }

  // Find if there is a monster at the destination position that belongs to a different player
  const destinationMonster = Object.entries(gameState.monsters).find(([id, monster]) => {
    return id !== monsterId && 
            monster.position.row === position.row && 
            monster.position.col === position.col &&
            String(monster.playerId) !== String(userId); // Ensure it's not the same player's monster
  });

  if (destinationMonster) {
    processCollision(gameState, monsterId, movingMonster, destinationMonster, position);
    
    // Check if the game is over after resolving the collision
    checkGameOver(gameState, userId, wss);
  }

  // If monster survived, update its position
  if (gameState.monsters[monsterId]) {
    movingMonster.position = position;
    movingMonster.hasMoved = true;
  }

  // Check if the player has moved all their monsters and complete their turn
  updatePlayerTurnStatus(gameState, userId);
  checkRoundCompletion(gameState);

  // Broadcast the new move to all clients
  broadcastAll({
    type: "update",
    monsters: gameState.monsters,
    playersTurnCompleted: gameState.playersTurnCompleted,
  }, wss);
}

// Function handles the end of the player's turn
// It sets the player's turn as completed, resets the hasMoved flag for their monsters
function handleEndTurn(gameState, playerId, wss) {
  gameState.playersTurnCompleted[playerId] = true;
  
  // Check if all players have completed their turns
  const allPlayersCompletedTurn = Object.values(gameState.playersTurnCompleted).every((completed) => completed);
  if (!allPlayersCompletedTurn) {
    // Reset the hasMoved flag for the player's monsters
    Object.values(gameState.monsters).forEach((monster) => {
      if (String(monster.playerId) === String(playerId)) {
        monster.hasMoved = true; 
      }
    });
  } else {
    // Start a new round if all players have completed their turns
    startNewRound(gameState);
  }

  // Broadcast the new round state to all clients
  broadcastAll({
    type: "update",
    monsters: gameState.monsters,
    playersTurnCompleted: gameState.playersTurnCompleted,
  }, wss);
}

// Helper function to handle player disconnection
// It stores the game state in the database and notifies the remaining player
async function handleDisconnection (gameState, leftPlayerId = playerId, ws, wss) {
  // This guard prevents the game from being processed and stored twice in the database
  if (gameState.gameOver) return;
  gameState.gameOver = true;

  const leftPlayerUsername = gameState.players[leftPlayerId];

  console.log(`Player ${leftPlayerId} (${leftPlayerUsername}) disconnected`);

  // Create a new game entry in the database to store the current game state
  const gameEntry = await Game.create({
    players: gameState.players,
    monsters: gameState.monsters,
    playersTurnCompleted: gameState.playersTurnCompleted,
    status: "paused",
  })

  const remainingPlayerId = Object.keys(gameState.players).find(id => id !== String(leftPlayerId));
  const remainingPlayerUsername = gameState.players[remainingPlayerId];

  // Link the game entry to the players in the database
  await User.findOneAndUpdate({ username: leftPlayerUsername }, { gameId: gameEntry._id });
  await User.findOneAndUpdate({ username: remainingPlayerUsername }, { gameId: gameEntry._id });

  clearGameState(gameState);

  // Notify other player that the game is over
  broadcastExcept(ws, {
    type: "gamePaused",
    leftPlayerUsername,
  }, wss);
}

// Function to check if there is a game over condition after a move
function checkGameOver(gameState, movingUserId, wss) {
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

  console.log("202. checkGameOver. Active players with monsters:", activePlayers);

  // If one or no players remain with monsters, declare the game over and set a winner of the game
  if (activePlayers.length < 2 && !gameState.gameOver) {
    processGameOver(gameState, activePlayers, movingUserId, wss)
  }
}

// Function sets the game winner, updates the database with the win/loss counts, resets the game state and emits a gameOver message
async function processGameOver(gameState, activePlayers, movingUserId, wss) {
  let winnerPlayerId;

  if (activePlayers.length === 1) {
    winnerPlayerId = activePlayers[0];
  } else {
    // If no players left, the current player is the winner
    winnerPlayerId = movingUserId; 
  }

  const winnerUsername = gameState.players[winnerPlayerId];

  const loserPlayerId = Object.keys(gameState.players).find(id => id !== String(winnerPlayerId));
  const loserUsername = gameState.players[loserPlayerId];

  // Modify the number of wins and losses for the players
  await User.findOneAndUpdate({ username: winnerUsername }, { $inc: { wins: 1 } });
  await User.findOneAndUpdate({ username: loserUsername }, { $inc: { losses: 1 } });

  // Reset game state
  gameState.gameOver = true;
  clearGameState(gameState);

  // Broadcast game over message to all clients passing the winner and loser usernames
  broadcastAll({
    type: "gameOver",
    winner: winnerUsername,
    loser: loserUsername,
  }, wss);
}

// Function allows to get the username by playerId
function getUsernameById(id, playerIdToUsername) {
  return playerIdToUsername[id];
}

// Helper function to broadcast a message to all clients
function broadcastAll(message, wss) {
  const str = JSON.stringify(message);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(str);
    }
  });
}

// Helper function to broadcast a message to all clients except the sender
function broadcastExcept(exceptClient, message, wss) {
  const str = JSON.stringify(message);

  wss.clients.forEach((client) => {
    if (client !== exceptClient && client.readyState === WebSocket.OPEN) {
      client.send(str);
    }
  });
}

module.exports = {
  startGame,
  handleMove,
  handleEndTurn,
  handleDisconnection,
  getUsernameById,
  broadcastAll,
  broadcastExcept,
  checkGameOver,
  initializeNewGame,
}