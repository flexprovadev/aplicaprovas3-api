const mongoose = require("mongoose");
const { ExamStudentStatus, GradeType } = require("../enumerator");
const { BaseModel, BaseSchemaOptions } = require("./base");

const Schema = mongoose.Schema;

const schemaObj = {
  ...BaseModel,
  name: { type: String, trim: true, required: true },
  startAt: { type: Date },
  endAt: { type: Date },
  durationExam: { type: String },
  instructions: { type: String },
  documentUrl: { type: String },
  questions: [{ type: Object }],
  gradeStrategy: {
    type: String,
    required: true,
    default: GradeType.SCORE,
    enum: Object.values(GradeType),
  },
  gradeOptions: { type: Object },
  classrooms: [{ type: Schema.Types.ObjectId, ref: "Classroom" }],
};

const ExamSchema = new Schema(schemaObj, BaseSchemaOptions);

// Supports prefix-based lookup by exam name.
ExamSchema.index({ name: 1 });

ExamSchema.virtual("examsInProgress", {
  ref: "ExamStudent",
  localField: "_id",
  foreignField: "exam",
  match: {
    enabled: true,
    status: ExamStudentStatus.PROGRESS,
  },
});

ExamSchema.virtual("examsSubmitted", {
  ref: "ExamStudent",
  localField: "_id",
  foreignField: "exam",
  match: {
    enabled: true,
    status: ExamStudentStatus.SUBMITTED,
  },
});

module.exports = mongoose.model("Exam", ExamSchema);
