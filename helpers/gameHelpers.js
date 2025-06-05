const User = require("../models/User.js");

// This function adds the specified number of monsters with a random type, adds their location 
// and stores them in the gameState object
function addMonsters(gameState, playerIndex, playerId, monsterTypes, monsterCount) {
  // Set the monster spawn column
  const isEven = parseInt(playerIndex) % 2 === 0;
  const col = isEven ? 0 : 9;

  // Set the monster spawn rows
  const maxRow = 9;
  const spawnRows = getUniqueRandomRows(monsterCount, maxRow);

  // Generate specified number of monsters with a random type
  for (let i = 0; i < monsterCount; i++) {
    const randomType = monsterTypes[Math.floor(Math.random() * monsterTypes.length)];
    const monsterId = `m_${playerId}-${i}`;
    const row = spawnRows[i];
    gameState.monsters[monsterId] = {
      playerId,
      type: randomType,
      position: {
        row,
        col,
      },
      hasMoved: false,
    };
  }
}

// Function populates gameState with existing game data
function resumeGame(gameState, gameDoc) {
  gameState.players = {}; // Reset players (rejoin fresh)
  gameState.monsters = Object.fromEntries(gameDoc.monsters);
  gameState.playersTurnCompleted = Object.fromEntries(gameDoc.playersTurnCompleted);
  gameState.gameStart = true;
}

// Helper function that fetches and modifies user stats from the database, and updates the userStats object
async function getUserStats(gameState, playerId, userStats) {
  const username = gameState.players[playerId];
  if (username) {
    const user = await User.findOne({ username });

    if (!gameState.gameStart) {
      user.games += 1;
      await user.save();
    }

    userStats[playerId] = {
      username,
      wins: user.wins,
      losses: user.losses,
      games: user.games,
    }
  }
}

// Function check if the player has moved all their monsters and updates the gameState accordingly
function updatePlayerTurnStatus(gameState, userId) {
  const playerMonsters = Object.values(gameState.monsters).filter((monster) => String(monster.playerId) === String(userId));
  const allPlayerMonstersMoved = playerMonsters.every((monster) => monster.hasMoved);
  // If all monsters have moved, set the player's turn as completed
  if (allPlayerMonstersMoved) {
    gameState.playersTurnCompleted[userId] = true;
  }
}

// Function checks if all players have completed their turns and its necessary to start a new round
function checkRoundCompletion(gameState) {
  const allPlayersCompletedTurn = Object.values(gameState.playersTurnCompleted).every((completed) => completed);
  if (allPlayersCompletedTurn) startNewRound(gameState);
}

// Function resets the playersTurnCompleted and hasMoved status for all monsters if all players have completed their turns
function startNewRound(gameState) {
  // Reset all players' turn status for the next round
  for (const playerId in gameState.playersTurnCompleted) {
    gameState.playersTurnCompleted[playerId] = false;
  }

  // Reset hasMoved status for all monsters
  Object.values(gameState.monsters).forEach((monster) => {
    monster.hasMoved = false; 
  });

  console.log("72. gameHelpers. startNewRound. All players completed their moves. Starting new round...");
}

// Function processes the collision between movingMonster and another monster that belongs to a different player
function processCollision(gameState, monsterId, movingMonster, destinationMonster, position) {
  const [defenderId, defender] = destinationMonster;

  // Get array of monster IDs to be removed
  const { removed, winnerId } = resolveCollision(movingMonster, monsterId, defender, defenderId);

  // Remove monsters from gameState based on the result
  removed.forEach((monsterId) => delete gameState.monsters[monsterId]);

  // If there is a winner of the monster collision, update its position as passed in the message
  if (winnerId) {
    gameState.monsters[winnerId].position = position;
  }
}

// This helper function resolves a collision between two monsters in a game.
// It for the monster types collided and determines what monsters should be removed.
function resolveCollision (attacker, attackerId, defender, defenderId) {
  // eliminationRules object defines the set of rules used to determine which monster should be removed based on their types
  // You need to pass the attacker and defender types to use this object, like this:
  //
  // const removedId = eliminationRules[typeAttacker][typeDefender]
  //
  // Returns an ID of the monster that should be removed based on the elimination rules
  const eliminationRules = {
    "vampire": { "werewolf": defenderId, "ghost": attackerId },
    "werewolf": { "vampire": attackerId, "ghost": defenderId },
    "ghost": { "vampire": defenderId, "werewolf": attackerId },
  };

  const typeAttacker = attacker.type;
  const typeDefender = defender.type;  

  // Remove both monsters if they are of the same type
  if (typeAttacker === typeDefender) {
    return { removed: [attackerId, defenderId] };
  }

  // If the attacker and defender are of different types, use the elimination rules to determine which monster to remove
  const removedId = eliminationRules[typeAttacker][typeDefender];
  const winnerId = removedId === attackerId ? defenderId : attackerId;

  return { removed: [removedId], winnerId };
}

// This resets the game state by clearing all players and monsters
function clearGameState(gameState, activeGameIdObj) {
  gameState.players = {};
  gameState.monsters = {};
  gameState.playersTurnCompleted = {};
  gameState.gameStart = false;

  activeGameIdObj.activeGameId = "";
}

// This function generates a array of unique random rows values between 0 and 9
function getUniqueRandomRows(count, maxRow) {
  const rowsSet = new Set();
  
  while (rowsSet.size < count) {
    const randomRow = Math.floor(Math.random() * (maxRow + 1));
    rowsSet.add(randomRow);
  }

  return Array.from(rowsSet);
}

module.exports = {
  addMonsters,
  getUserStats,
  clearGameState,
  processCollision,
  startNewRound,
  updatePlayerTurnStatus,
  checkRoundCompletion,
  resumeGame,
};
