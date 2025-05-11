let socket;
let playerId;
let allPlayers = {}; // allPlayers = { playerId: { row, col } }

// Get access to the root div#board element on index.html page
// Which will be later populated with rows of hexagons
const board = document.getElementById("board");

// Setup initial position of the character
let currentCharacterPosition = { row: 0, col: 0 };

// Setup number of rows and columns
const rows = 10;
const cols = 10;

// This function used to create a single hex div element
function createHex(row, col) {
  const hex = document.createElement("div");
  hex.classList.add("hex");
  hex.dataset.row = row;
  hex.dataset.col = col;
  hex.textContent = ``;

  // Add click event to handle selection and movement
  hex.addEventListener("click", () => {
    if (hex.classList.contains("highlight")) {
      moveCharacter(row, col);
      socket.send(JSON.stringify({
        type: "move",
        id: playerId,
        position: { row, col }
      }));
    } else {
      highlightPath(row, col);
    }
  });

  return hex;
}

// This function is used to move character of the player with the given id
// from the starting point to desired destination
function moveCharacter(row, col, id = playerId) {
  const old = allPlayers[id];
  if (old) {
    const oldHex = document.querySelector(
      `.hex[data-row="${old.row}"][data-col="${old.col}"]`
    );
    if (oldHex) oldHex.classList.remove("character");
  }

  allPlayers[id] = { row, col };

  const newHex = document.querySelector(
    `.hex[data-row="${row}"][data-col="${col}"]`
  );
  if (newHex) newHex.classList.add("character");

  if (id === playerId) {
    currentCharacterPosition = { row, col };
    clearPathHighlights();
  }
}

function highlightPath(row, col) {
  // Clear any previous highlights
  clearPathHighlights();

  // Highlight a path from the starting point to the end
  const path = calculatePath(currentCharacterPosition, { row, col });
  // Select every hex from the path and apply a highlight class to them
  path.forEach((hex) => {
    const hexElement = document.querySelector(
      `.hex[data-row="${hex.row}"][data-col="${hex.col}"]`
    );
    if (hexElement) hexElement.classList.add("highlight");
  });
}

function clearPathHighlights() {
  // Function removes highlight class from hexes once the path has been changed or completed
  document.querySelectorAll(".hex.highlight").forEach((hex) => {
    hex.classList.remove("highlight");
  });
}

function calculatePath(start, end) {
  // Function calculates path from the starting point to the end
  // Increments row and col values until we reach destination coordinates
  const path = [];
  let { row: currentRow, col: currentCol } = start;

  while (currentRow !== end.row || currentCol !== end.col) {
    if (currentRow != end.row) {
      if (currentRow < end.row) currentRow++;
      else if (currentRow > end.row) currentRow--;

      path.push({ row: currentRow, col: currentCol });
      continue;
    }

    if (currentCol !== end.col) {
      if (currentCol < end.col) currentCol++;
      else if (currentCol > end.col) currentCol--;

      path.push({ row: currentRow, col: currentCol });
      continue;
    }
  }

  return path;
}

// This is the main function of the script
// It sets up a playing board with HTML elements
function setupBoard() {
  // Loop over the number of rows and populate them with hexagons
  for (let row = 0; row < rows; row++) {
    const rowElement = document.createElement("div");
    rowElement.classList.add("row");

    // Apply a different stylesheet if the row is odd
    // This ensures there are no gaps between hexagons
    if (row % 2 != 0) {
      rowElement.classList.add("odd");
    }

    // This loop used to add hexagons to each row using createHex function
    // Number of hexagons equals the declared number of columns
    for (let col = 0; col < cols; col++) {
      const hex = createHex(row, col);
      rowElement.appendChild(hex);
    }

    // Append each row to the root element
    board.appendChild(rowElement);
  }
}

// This function is used to create a WebSocket connection on the browser window load
// and listen for incoming messages
window.onload = () => {
  socket = new WebSocket(`ws://${window.location.host}`);

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);

    // On init message we setup the board and move all players to their starting positions
    if (message.type === "init") {
      playerId = message.id;
      allPlayers = message.allPlayers;
      setupBoard();

      for (const [id, position] of Object.entries(allPlayers)) {
        moveCharacter(position.row, position.col, id);
      }
    }

    // On update message we move the character to the new position and update the allPlayers object
    if (message.type === "update") {
      allPlayers[message.id] = message.position;
      moveCharacter(message.position.row, message.position.col, message.id);
    }

    // On remove message we remove the character from the board and delete it from allPlayers object
    // This is used when a player disconnects and we need to remove their character from the game
    if (message.type === "remove") {
      const oldPosition = allPlayers[message.id];
      if (oldPosition) {
        const oldHex = document.querySelector(
          `.hex[data-row="${oldPosition.row}"][data-col="${oldPosition.col}"]`
        );
        if (oldHex) oldHex.classList.remove("character");
        delete allPlayers[message.id];
      }
    }
  };
};
