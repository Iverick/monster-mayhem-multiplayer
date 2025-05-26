const WebSocket = require("ws");
const User = require("../models/User.js");

const monsterTypes = ['vampire', 'werewolf', 'ghost'];

// Helper function that allows start the game by initializing monsters and modifying player data in the database
async function startGame (gameState, wss) {
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
    console.log("startGame method: Check username for id: ", gameState.players[playerId]);
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

// Helper function to handle player disconnection
async function handleDisconnection (gameState, playerId, ws, wss) {
  const leftPlayerUsername = gameState.players[playerId];

  console.log(`Player ${playerId} (${leftPlayerUsername}) disconnected`);

  // Remove the left player from the gameState and remove its monsters
  delete gameState.players[playerId];
  for (const monsterId in gameState.monsters) {
    if (gameState.monsters[monsterId].playerId === playerId) {
      delete gameState.monsters[monsterId];
    }
  }

  // Escape the modifying game counts if the game is already over
  if (gameState.gameOver) return;
    
  const remainingPlayerId = Object.keys(gameState.players)[0];
  const winnerUsername = gameState.players[remainingPlayerId];

  // Modify the number of wins and losses for the players
  await User.findOneAndUpdate({ username: leftPlayerUsername }, { $inc: { losses: 1 } });
  await User.findOneAndUpdate({ username: winnerUsername }, { $inc: { wins: 1 } });

  // Mark game as over to prevent double updates
  gameState.gameOver = true;

  // Notify other player that the game is over
  broadcastExcept(ws, {
    type: "remove",
    winner: winnerUsername,
    loser: leftPlayerUsername,
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
  handleDisconnection,
  getUsernameById,
  broadcastAll,
  broadcastExcept,
}