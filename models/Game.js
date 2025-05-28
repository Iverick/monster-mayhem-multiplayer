const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
  players: {
    type: Map,
    of: String, // Maps playerId to username
    required: true,
  },
  monsters: {
    type: Map,
    of: {
      type: Object,
      required: true,
    },
  },
  createdAt: { type: Date, default: Date.now },
  status: { type: String, enum: ["active", "paused", "finished"], default: "paused" },
});

const Game = mongoose.model("Game", gameSchema);

module.exports = Game;
