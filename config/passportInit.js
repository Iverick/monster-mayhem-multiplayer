const passport = require("passport");
const localStrategy = require("passport-local").Strategy;
const User = require("../models/User.js");

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

passport.use(new localStrategy(User.authenticate()));

module.exports = passport;
