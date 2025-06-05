// This function checks if the path is blocked by an enemy monster
function isBlockedByEnemy (startRow, startCol, endRow, endCol) {
  // Find the direction of the movement from the start position to the end position
  const dRow = Math.sign(endRow - startRow);
  const dCol = Math.sign(endCol - startCol);

  // Calculate the first hexagon in the path of the start position
  let r = startRow + dRow;
  let c = startCol + dCol;

  // Loop through the hexagons in the path until we reach the end position
  while (r !== endRow || c !== endCol) {
    // Check if the hexagon is occupied by an enemy monster
    const occupied = Object.values(monsters).some(monster => 
      monster.position.row === r &&
      monster.position.col === c &&
      parseInt(monster.playerId) !== parseInt(userId)
    );
    
    if (occupied) return true;

    r += dRow;
    c += dCol;
  }

  return false;
};

/**
 * Method checks if the destination hex already has a monster that belongs to the User
 **/
function findUserMonsterAt(monsters, userId, row, col) {
  return Object.values(monsters).find(monsterData => {
    return (
      monsterData.position.row === row &&
      monsterData.position.col === col &&
      String(monsterData.playerId) === String(userId)
    );
  });
}

// This function is used to update the UI based on the number of players
// If there are two players, the start button is enabled and waiting message is hidden
function toggleControlsOverlay() {
  const playerCount = Object.keys(allPlayers).length;
  if (playerCount >= 2) {
    startButton.disabled = false;
    startButton.classList.add('enabled');
    waitingMessage.textContent = 'Ready to start the game!';
  } else {
    startButton.disabled = true;
    startButton.classList.remove('enabled');
    waitingMessage.textContent = 'Waiting for another player to join...';
  }
}

// This function is used to toggle the visibility of player stats block
function toggleStatsVisibility() {
  const playerCount = Object.keys(allPlayers).length;
  (playerCount >= 2) ? playerStatsContainer.style.display = 'flex' : playerStatsContainer.style.display = 'none';
}

function toggleHintsVisibility() {
  const playerCount = Object.keys(allPlayers).length;
  (playerCount >= 2) ? gameHintsContainer.style.display = 'block' : gameHintsContainer.style.display = 'none';
}

// Helper function to toggle the board and waiting turn message styles based on whether the player has completed their turn
function toggleBoardAvailability() {
  // console.log("277. toggleBoardDisplay called");
  // console.log(`278. Updated playersTurnCompleted: ${playersTurnCompleted[userId]} for local player with userID ${userId}`);

  if (playersTurnCompleted[userId]) {
    board.style.opacity = "0.4";
    waitingTurnMsg.textContent = "Waiting for other players to finish their turn...";
    waitingTurnMsg.style.color = "red";
  } else {
    board.style.opacity = "1";
    waitingTurnMsg.textContent = "Move your monsters!";
    waitingTurnMsg.style.color = "green";
  }
}

function toggleEndButtonAvailability() {
  playersTurnCompleted[userId] ? endTurnButton.disabled = true : endTurnButton.disabled = false;
}
