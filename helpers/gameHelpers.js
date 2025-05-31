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
function clearGameState(gameState) {
  gameState.players = {};
  gameState.monsters = {};
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

  console.log("64. gameHelpers. resetTurnData. All players completed their moves. Starting new round...");
}

module.exports = {
  clearGameState,
  getUniqueRandomRows,
  resolveCollision,
  startNewRound,
};
