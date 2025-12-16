const { v4: uuidv4 } = require("uuid");

const BaseModel = {
  uuid: {
    type: String,
    required: true,
    immutable: true,
    default: () => uuidv4(),
  },
  enabled: {
    type: Boolean,
    default: true,
  },
};

const BaseSchemaOptions = {
  timestamps: true,
  collation: { locale: "en" },
};

module.exports = { BaseModel, BaseSchemaOptions };
