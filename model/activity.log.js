const mongoose = require("mongoose");
const { UserType } = require("../enumerator");
const { BaseModel, BaseSchemaOptions } = require("./base");

const Schema = mongoose.Schema;

const ActivityAction = {
  UPLOAD: "upload",
  DOWNLOAD: "download",
  DELETE: "delete",
};

const schemaObj = {
  ...BaseModel,
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, trim: true },
  username: { type: String, trim: true },
  email: { type: String, trim: true },
  role: {
    type: String,
    required: true,
    enum: Object.values(UserType),
  },
  action: {
    type: String,
    required: true,
    enum: Object.values(ActivityAction),
  },
  fileTypeKey: { type: String, required: true, trim: true },
  fileName: { type: String, trim: true },
  fileUrl: { type: String, trim: true },
  examUuid: { type: String, trim: true },
  schoolPrefix: { type: String, trim: true },
};

const ActivityLogSchema = new Schema(schemaObj, BaseSchemaOptions);

ActivityLogSchema.index({ createdAt: -1 });
ActivityLogSchema.index({ schoolPrefix: 1, createdAt: -1 });
ActivityLogSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("ActivityLog", ActivityLogSchema);
