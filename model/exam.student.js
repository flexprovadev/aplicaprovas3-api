const mongoose = require("mongoose");
const { BaseModel, BaseSchemaOptions } = require("./base");
const { ExamStudentStatus } = require("../enumerator");

const Schema = mongoose.Schema;

const schemaObj = {
  ...BaseModel,
  answers: { type: Object, default: {} },
  grade: { type: Object },
  status: {
    type: String,
    required: true,
    default: ExamStudentStatus.PROGRESS,
    enum: Object.values(ExamStudentStatus),
  },
  submittedAt: { type: Date },
  exam: { type: Schema.Types.ObjectId, ref: "Exam" },
  student: { type: Schema.Types.ObjectId, ref: "User" },
};

const ExamStudentSchema = new Schema(schemaObj, BaseSchemaOptions);

ExamStudentSchema.index({ exam: 1, student: 1 }, { unique: true });

module.exports = mongoose.model("ExamStudent", ExamStudentSchema);
