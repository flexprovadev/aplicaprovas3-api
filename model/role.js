const mongoose = require("mongoose");
const { BaseModel, BaseSchemaOptions } = require("./base");
const { Permission } = require("../enumerator");

const Schema = mongoose.Schema;

const schemaObj = {
  ...BaseModel,
  name: {
    type: String,
    unique: true,
    trim: true,
    required: true,
  },
  permissions: [
    {
      type: String,
      enum: Object.values(Permission).map((o) => o.key),
    },
  ],
};

const RoleSchema = new Schema(schemaObj, BaseSchemaOptions);

module.exports = mongoose.model("Role", RoleSchema);
