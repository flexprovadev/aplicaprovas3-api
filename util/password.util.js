const bcrypt = require("bcrypt");

const encryptPassword = async (input, salt) => {
  if (!salt) {
    salt = await bcrypt.genSalt(1);
  }
  return await bcrypt.hash(input, salt);
};

const comparePassword = async (source, target) => {
  return await bcrypt.compare(source, target);
};

const generateSalt = async () => {
  return await bcrypt.genSalt(1);
};

module.exports = { encryptPassword, comparePassword, generateSalt };
