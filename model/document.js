const mongoose = require("mongoose");
const { BaseModel, BaseSchemaOptions } = require("./base");

const Schema = mongoose.Schema;

const schemaObj = {
  ...BaseModel,
  name: { type: String, required: true },
  description: { type: String },
  questions: [
    {
      uuid: { type: String, required: true },
      teacher: { type: Schema.Types.ObjectId, ref: "User", required: false },
      course: { type: Schema.Types.ObjectId, ref: "Course", required: false },
      state: {
        type: String,
        enum: ["pending", "submitted", "approved", "rejected"],
        default: "pending",
      },
      questionFileUrl: { type: String },
      comments: { type: String },
    },
  ],
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  dates: {
    start: { type: Date, required: true },
    teacher: { type: Date, required: true },
    print: { type: Date, required: true },
    final: { type: Date, required: true },
  },
  state: {
    type: String,
    enum: ["draft", "in_progress", "completed"],
    default: "draft",
  },
};

const DocumentSchema = new Schema(schemaObj, BaseSchemaOptions);

module.exports = mongoose.model("Document", DocumentSchema);
