const { encryptPassword, comparePassword } = require("../util/password.util");
const config = require("../config");
const jwt = require("jsonwebtoken");
const { UserType, Permission } = require("../enumerator");
const { BaseModel, BaseSchemaOptions } = require("./base");
const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const schemaObj = {
  ...BaseModel,
  email: {
    type: String,
    unique: true,
    trim: true,
    required: true,
  },
  password: {
    type: String,
    trim: true,
    required: true,
  },
  type: {
    type: String,
    required: true,
    enum: Object.values(UserType),
  },
  name: {
    type: String,
  },
  cpf: {
    type: String,
    minLength: 11,
    maxLength: 11,
  },
  contactNumber: {
    type: String,
  },
  parentName: {
    type: String,
  },
  parentContactNumber: {
    type: String,
  },
  roles: [{ type: Schema.Types.ObjectId, ref: "Role" }],
};

const UserSchema = new Schema(schemaObj, BaseSchemaOptions);

UserSchema.virtual("classrooms", {
  ref: "Classroom",
  localField: "_id",
  foreignField: "students",
  match: { enabled: true },
  options: { sort: { name: 1 } },
});

UserSchema.pre("save", async function (next) {
  console.log(`Hashing password for user: ${this.email}`);
  this.password = await encryptPassword(this.password);
  next();
});

UserSchema.methods.isPasswordValid = async function isPasswordValid(password) {
  console.log(`Comparing passwords for user: ${this.email}`);
  return await comparePassword(password, this.password);
};

UserSchema.methods.hasPermission = function hasPermission(permission) {
  const permissionFilter = (entry) => entry === permission;
  const roleFilter = (role) => role.permissions.some(permissionFilter);
  return this.roles.filter(roleFilter).length;
};

UserSchema.methods.getPermissions = function getPermissions() {
  if (this.type === UserType.SUPERUSER) {
    return Object.values(Permission).map((o) => o.key);
  }
  const roleReducer = (accumulator, role) => {
    role.permissions.forEach((entry) => {
      if (!accumulator.includes(entry)) {
        accumulator.push(entry);
      }
    });
    return accumulator;
  };
  return this.roles.reduce(roleReducer, []);
};

UserSchema.methods.getMissingPermissions = function getMissingPermissions() {
  const permissions = this.getPermissions();
  return Object.values(Permission)
    .map((o) => o.key)
    .filter((o) => !permissions.includes(o));
};

UserSchema.methods.getJwtToken = function getJwtToken() {
  const { id, email, name, type } = this;
  const permissions = this.getPermissions();
  return jwt.sign({ id, email, name, type, permissions }, config.jwt.secret);
};

module.exports = mongoose.model("User", UserSchema);

