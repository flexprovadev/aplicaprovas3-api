const mongoose = require("mongoose");
const { BaseModel, BaseSchemaOptions } = require("./base");

const Schema = mongoose.Schema;

const schemaObj = {
  ...BaseModel,
  name: {
    type: String,
    trim: true,
    required: true,
  },
  year: {
    type: Number,
    required: true,
  },
  level: {
    type: String,
    required: true,
  },
  shift: {
    type: String,
  },
  students: [{ type: Schema.Types.ObjectId, ref: "User" }],
};

const ClassroomSchema = new Schema(schemaObj, BaseSchemaOptions);

ClassroomSchema.index({ name: 1, year: 1, level: 1 }, { unique: true });

module.exports = mongoose.model("Classroom", ClassroomSchema);
