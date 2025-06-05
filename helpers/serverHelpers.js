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
  resumeGame,
} = require("./gameHelpers.js");

async function identifyPlayer(username, pausedGameId, gameState, activeGameIdObj, playerId, ws, wss) {
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

  // Resume game logic - guarding from unauthorized access
  if (pausedGameId) {
    const pausedGame = await Game.findById(pausedGameId);

    if (!pausedGame) {
      ws.send("Game not found.");
      ws.close();
      return;
    }

    // First time resuming
    if (!activeGameIdObj.activeGameId) {
      await resumeGame(gameState, pausedGame);
      activeGameIdObj.activeGameId = String(pausedGame._id);
    }

    // Prevent other players from joining game to be resumed
    if (String(pausedGame._id) !== activeGameIdObj.activeGameId) {
      ws.send("You cannot join a game lobby right now.");
      ws.close();
      return;
    }

    const isParticipant = Array.from(pausedGame.players.keys()).some((participantId) =>
      participantId === playerId
    );

    if (!isParticipant) {
      ws.send("You are not a participant of this game.");
      ws.close();
      return;
    }
  } else {
    // Can't join a game if there is a resume game in progress
    if (activeGameIdObj.activeGameId) {
      ws.send("You cannot start a new game while another is in progress.");
      ws.close();
      return;
    }
  }

  // Add new player to the gameState
  gameState.players[playerId] = username;
      
  initializeNewGame(gameState, playerId, ws, wss);
}

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
async function startGame(gameState, monsterTypes, monsterCount, userStats, wss) {
  const playerIds = Object.keys(gameState.players);
  
  for (let index = 0; index < playerIds.length; index++) {
    const playerId = playerIds[index];

    // If it's a new game add monster to the game state and initializes player turn status
    if (!gameState.gameStart) {
      addMonsters(gameState, index, playerId, monsterTypes, monsterCount);
      gameState.playersTurnCompleted[playerId] = false;
    }

    // Find the user by username, update their game stats, and store them in the userStats object
    await getUserStats(gameState, playerId, userStats);
  }

  // Reset game state flags
  gameState.gameOver = false;
  gameState.gameStart = true;
  
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

function handleMove(messageData, gameState, activeGameIdObj, wss) {
  console.log("123. Player moved:", messageData);
  const { monsterId, position, userId } = messageData;
  const movingMonster = gameState.monsters[monsterId];
  if (!movingMonster) return;

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
    checkGameOver(gameState, activeGameIdObj, userId, wss);
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

// Helper function to handle socket disconnection
async function handleDisconnection (gameState, activeGameIdObj, leftPlayerId = playerId, ws, wss) {
  // gameState.gameOver prevents the game from being processed and stored twice in the database
  if (!(gameState.gameOver) &&
        leftPlayerId &&
        gameState.gameStart &&
        (Object.keys(gameState.players).length >= 2)) {
    await savePausedGame(gameState, activeGameIdObj, leftPlayerId, ws, wss);
  }
}

// Function stores the paused game state in the database and notifies the remaining player
async function savePausedGame(gameState, activeGameIdObj, leftPlayerId, ws, wss) {
  console.log("219. serverHelpers. savePausedgame called!")
  const leftPlayerUsername = gameState.players[leftPlayerId];
  gameState.gameOver = true;

  const remainingPlayerId = Object.keys(gameState.players).find(id => id !== String(leftPlayerId));
  const remainingPlayerUsername = gameState.players[remainingPlayerId];

  let gameInstance;

  // If the game was already paused, update an existing game object in the db
  // Otherwise, create a new game entry in the database to store the current game state
  if (activeGameIdObj.activeGameId) {
    gameInstance = await Game.findByIdAndUpdate(
      activeGameIdObj.activeGameId,
      {
        players: gameState.players,
        monsters: gameState.monsters,
        playersTurnCompleted: gameState.playersTurnCompleted,
        status: "paused",
      },
      { new: true } // Return the updated document
    );
  } else {
    gameInstance = await Game.create({
      players: gameState.players,
      monsters: gameState.monsters,
      playersTurnCompleted: gameState.playersTurnCompleted,
      status: "paused",
    })

    activeGameIdObj.activeGameId = String(gameInstance._id);
  }

  // Link the game entry to the players in the database
  await User.findOneAndUpdate({ username: leftPlayerUsername }, { gameId: gameInstance._id });
  await User.findOneAndUpdate({ username: remainingPlayerUsername }, { gameId: gameInstance._id });

  clearGameState(gameState, activeGameIdObj);

  // Notify other player that the game is over
  broadcastExcept(ws, {
    type: "gamePaused",
    leftPlayerUsername,
  }, wss);
}

// Function to check if there is a game over condition after a move
function checkGameOver(gameState, activeGameIdObj, movingUserId, wss) {
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
    processGameOver(gameState, activeGameIdObj, activePlayers, movingUserId, wss)
  }
}

// Function sets the game winner, updates the database with the win/loss counts, resets the game state and emits a gameOver message
async function processGameOver(gameState, activeGameIdObj, activePlayers, movingUserId, wss) {
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

  // Update game status in DB and clear gameId for both users if the game was resumed 
  if (activeGameIdObj.activeGameId) {
    await Game.findByIdAndUpdate(activeGameIdObj.activeGameId, {
      status: "finished",
    });

    await User.updateMany(
      { username: { $in: [winnerUsername, loserUsername] } },
      { $unset: { gameId: "" } },
    );
  }

  // Reset game state
  gameState.gameOver = true;
  clearGameState(gameState, activeGameIdObj);

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
  identifyPlayer,
}