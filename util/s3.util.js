const config = require("../config");
const { S3Client, HeadObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { v4: uuidv4 } = require("uuid");
const { StorageFolder } = require("../enumerator");

const getExtension = (contentType) => {
  return {
    "image/png": "png",
    "image/jpeg": "jpg",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "image/tiff": "tif",
    "image/tif": "tif",
    // Tipos para namelist
    "text/plain": "txt",
    "text/markdown": "md",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel.sheet.macroEnabled.12": "xlsm",
    "text/csv": "csv",
    "application/vnd.oasis.opendocument.text": "odt",
    "application/vnd.oasis.opendocument.spreadsheet": "ods",
    "application/msword": "doc",
    "application/rtf": "rtf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
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
  const region =
    config.s3.region ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION;

  const clientConfig = {};

  if (region) {
    clientConfig.region = region;
  }

  if (accessKey || secretKey) {
    clientConfig.credentials = {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    };
  }

  return new S3Client(clientConfig);
};

const defaultClient = getClient();

const buildUploadResult = (data, params) => {
  const key = data?.Key || params?.Key;
  const fallbackRegion =
    config.s3.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  const location =
    data?.Location ||
    (key
      ? `https://${config.s3.bucket}.s3${fallbackRegion ? `.${fallbackRegion}` : ""}.amazonaws.com/${key}`
      : "");
  const filename = location.substring(location.lastIndexOf("/") + 1);
  const uuid = filename.substring(0, filename.indexOf("."));
  return { uuid, location };
};

const uploadToS3 = async (params) => {
  const uploader = new Upload({
    client: defaultClient,
    params,
  });
  const data = await uploader.done();
  return buildUploadResult(data, params);
};

const upload = (params, res) => {
  uploadToS3(params)
    .then((result) => res.json(result))
    .catch((err) => {
      console.error("Error uploading file to S3:", err);
      return res.status(500).json({ message: "Erro ao enviar arquivo" });
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

const doPreliminarkeyUpload = (req, res) => {
  const params = buildUploadParams(req, () => {
    return `${StorageFolder.PRELIMINARKEY}`;
  });
  upload(params, res);
};

const doFinalkeyUpload = (req, res) => {
  const params = buildUploadParams(req, () => {
    return `${StorageFolder.FINALKEY}`;
  });
  upload(params, res);
};

const doNamelistUpload = (req, res) => {
  const params = buildUploadParams(req, () => {
    return `${StorageFolder.NAMELIST}`;
  });
  upload(params, res);
};

const doAnswerSheetImageUpload = (req, examUuid) => {
  const params = buildUploadParams(req, () => {
    return `${StorageFolder.ANSWER_SHEET_IMAGES}/${examUuid}`;
  });
  return uploadToS3(params);
};

const doClassification1Upload = (req, examUuid) => {
  const params = buildUploadParams(req, () => {
    return `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.CLASSIFICATION_1}`;
  });
  return uploadToS3(params);
};

const doClassification2Upload = (req, examUuid) => {
  const params = buildUploadParams(req, () => {
    return `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.CLASSIFICATION_2}`;
  });
  return uploadToS3(params);
};

const doIndividualResultsUpload = (req, examUuid) => {
  const params = buildUploadParams(req, () => {
    return `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.INDIVIDUAL_RESULTS}`;
  });
  return uploadToS3(params);
};

const getObject = async (url) => {
  const pathname = url.substring(url.indexOf(config.s3.bucket));
  const fileKey = pathname.substring(pathname.indexOf("/") + 1);

  const params = {
    Key: fileKey,
    Bucket: config.s3.bucket,
  };

  const data = await defaultClient.send(new HeadObjectCommand(params));
  const file = await defaultClient.send(new GetObjectCommand(params));
  const stream = file.Body;

  return {
    stream,
    extension: getExtension(data.ContentType),
  };
};

module.exports = {
  getObject,
  doExamUpload,
  doStudentUpload,
  doPreliminarkeyUpload,
  doFinalkeyUpload,
  doNamelistUpload,
  doAnswerSheetImageUpload,
  doClassification1Upload,
  doClassification2Upload,
  doIndividualResultsUpload,
};
