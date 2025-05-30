const WebSocket = require("ws");
const Game = require("../models/Game.js");
const User = require("../models/User.js");
const { resolveCollision, clearGameState, getUniqueRandomRows } = require("./gameHelpers.js");

// const monsterTypes = ['vampire', 'werewolf', 'ghost'];
// TODO: Use simplified line 7 simplified for testing
const monsterTypes = ['vampire', 'werewolf'];

// Helper function that allows start the game by initializing monsters and modifying player data in the database
async function startGame (gameState, wss) {
  // Reset game over state
  gameState.gameOver = false;

  const userStats = {};

  // The following code is used to generate the monsters and their location for each player
  // and store them in the gameState object
  for (const playerId in gameState.players) {
    // Set the monster spawn column
    const isEven = parseInt(playerId) % 2 === 0;
    const col = isEven ? 0 : 9;

    // Set the monster spawn rows
    const maxRow = 9;
    const spawnRows = getUniqueRandomRows(monsterTypes.length, maxRow);

    monsterTypes.forEach((type, index) => {
      const monsterId = `m_${playerId}-${type}`;
      const row = spawnRows[index];
      gameState.monsters[monsterId] = {
        playerId,
        type,
        position: {
          row,
          col,
        },
        hasMoved: false,
      };
    })
  }

  // Find the user by username, initializes player turn status, update their game stats, and store them in the userStats object
  for (const playerId in gameState.players) {
    console.log("44. serverHelper. startGame method: Check username for id: ", gameState.players[playerId]);

    gameState.playersTurnCompleted[playerId] = false;
    const username = gameState.players[playerId];
    if (username) {
      const user = await User.findOne({ username });
      user.games += 1;
      await user.save();

      userStats[playerId] = {
        username,
        wins: user.wins,
        losses: user.losses,
        games: user.games,
      }
    }
  }
  
  console.log("65. serverHelper. after initializing turn status: ", gameState);

  // Send start message to all players with the gameState object
  broadcastAll({ 
    type: "start",
    data: {
      players: gameState.players,
      stats: userStats,
      monsters: gameState.monsters,
    },
  }, wss);
}

function handleMove(messageData, gameState, wss) {
  console.log("123. Player moved:", messageData);
  const { monsterId, position, userId } = messageData;
  const movingMonster = gameState.monsters[monsterId];
  if (!movingMonster) return;

  console.log("64. serverHelpers. handleMove. Monster to be moved:", movingMonster);

  // Check if the monster belongs to the player
  if (String(movingMonster.playerId) !== String(userId)) {
    console.log(`68. serverHelpers. handleMove. Player ${userId} tried to move monster they don't own.`);
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

    // Remove monsters from gameState based on the result
    removed.forEach((monsterId) => delete gameState.monsters[monsterId]);

    // If there is a winner of the monster collision, update its position as passed in the message
    if (winnerId) {
      gameState.monsters[winnerId].position = position;
    }

    // Check if the game is over after resolving the collision
    checkGameOver(gameState, userId, wss);
  } else {
    // No collision — apply move
    movingMonster.position = position;
    movingMonster.hasMoved = true;
  }

  // console.log("121. serverHelpers. Monster moved:", movingMonster);
  // console.log("121. serverHelpers. Monsters after monster moved:", gameState.monsters);

  // Broadcast the new move to all clients
  broadcastAll({
    type: "update",
    monsters: gameState.monsters,
  }, wss);
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
  handleDisconnection,
  getUsernameById,
  broadcastAll,
  broadcastExcept,
}