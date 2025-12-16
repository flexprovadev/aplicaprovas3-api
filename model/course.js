const mongoose = require("mongoose");
const { BaseModel, BaseSchemaOptions } = require("./base");

const Schema = mongoose.Schema;

const schemaObj = {
  ...BaseModel,
  name: {
    type: String,
    unique: true,
    trim: true,
    required: true,
  },
};

const CourseSchema = new Schema(schemaObj, BaseSchemaOptions);

module.exports = mongoose.model("Course", CourseSchema);
