const config = require("../config");
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const { StorageFolder } = require("../enumerator");

const getExtension = (contentType) => {
  return {
    "image/png": "png",
    "image/jpeg": "jpg",
    "application/pdf": "pdf",
  }[contentType];
};

const maybeAddStoragePrefix = (key) => {
  if (config.s3.prefix) {
    return `${config.s3.prefix}/${key}`;
  }
  return key;
};

const buildBaseUploadParams = (req) => {
  const file = req.file;

  if (!file) {
    throw new Error("req.file is mandatory");
  }

  const { buffer, size, mimetype } = file;

  return {
    Body: buffer,
    ACL: "public-read",
    ContentLength: size,
    ContentType: mimetype,
    Bucket: config.s3.bucket,
  };
};

const buildUploadParams = (req, prefixGenerator) => {
  const baseParams = buildBaseUploadParams(req);
  const extension = getExtension(baseParams.ContentType);
  const filename = `${uuidv4()}.${extension}`;
  const prefix = prefixGenerator();
  return {
    ...baseParams,
    Key: maybeAddStoragePrefix(`${prefix}/${filename}`),
  };
};

const getClient = () => {
  const { accessKey, secretKey } = config.s3.credentials;
  return new AWS.S3({
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
  });
};

const defaultClient = getClient();

const upload = (params, res) => {
  defaultClient.upload(params, (err, data) => {
    if (err) {
      throw new Error(err);
    }
    const { Location: location } = data;
    const filename = location.substring(location.lastIndexOf("/") + 1);
    const uuid = filename.substring(0, filename.indexOf("."));
    return res.json({ uuid, location });
  });
};

const doExamUpload = (req, res) => {
  const params = buildUploadParams(req, () => {
    return `${StorageFolder.EXAMS}`;
  });
  upload(params, res);
};

const doStudentUpload = (examStudent, req, res) => {
  const { exam, uuid: examStudentUuid } = examStudent;
  const { uuid: examUuid } = exam;
  const params = buildUploadParams(req, () => {
    return `${StorageFolder.EXAMS}/${examUuid}/${examStudentUuid}`;
  });
  upload(params, res);
};

const getObject = async (url) => {
  const pathname = url.substring(url.indexOf(config.s3.bucket));
  const fileKey = pathname.substring(pathname.indexOf("/") + 1);

  const params = {
    Key: fileKey,
    Bucket: config.s3.bucket,
  };

  const data = await defaultClient.headObject(params).promise();

  const stream = await defaultClient.getObject(params).createReadStream();

  return {
    stream,
    extension: getExtension(data.ContentType),
  };
};

module.exports = {
  getObject,
  doExamUpload,
  doStudentUpload,
};
