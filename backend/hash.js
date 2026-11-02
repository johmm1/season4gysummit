const bcrypt = require("bcryptjs");

bcrypt.hash("Grace@2026", 12).then(hash => {
  console.log(hash);
});