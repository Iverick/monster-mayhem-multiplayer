// This helper function resolves a collision between two monsters in a game.
// It for the monster types collided and determines what monsters should be removed.
function resolveCollision (attacker, attackedId, defender, defenderId) {
  console.log(`Collision detected: ${attacker.type} attacked ${defender.type}`);
  console.log("Monster A:", attacker);

  const typeAttacker = attacker.type;
  const typeDefender = defender.type;  

  // Remove both monsters if they are of the same type
  if (typeAttacker === typeDefender) {
    console.log("Both monsters are of the same type.");
    return { removed: [attackedId, defenderId] };
  }

  // TODO: Handle other collision logic based on monster types
}

module.exports = {
  resolveCollision,
};
