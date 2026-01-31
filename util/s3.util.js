const config = require("../config");
const { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
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

const sanitizeFilename = (name) => {
  if (!name) {
    return "";
  }

  const nameWithoutExt = name.replace(/\.[^/.]+$/, "");

  return nameWithoutExt
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 80);
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
  const uuid = uuidv4();
  const originalName = req.file?.originalname || "";
  const sanitizedName = sanitizeFilename(originalName);
  const filename = sanitizedName
    ? `${uuid}_${sanitizedName}.${extension}`
    : `${uuid}.${extension}`;
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

const extractOriginalName = (filename) => {
  const underscoreIdx = filename.indexOf("_");
  if (underscoreIdx > 30 && underscoreIdx < 40) {
    return filename.substring(underscoreIdx + 1);
  }
  return filename;
};

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
  const uuid = filename.split("_")[0].split(".")[0];
  const originalName = extractOriginalName(filename);
  return { uuid, location, originalName };
};

const buildPublicUrl = (key) => {
  const fallbackRegion =
    config.s3.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  return `https://${config.s3.bucket}.s3${fallbackRegion ? `.${fallbackRegion}` : ""}.amazonaws.com/${key}`;
};

const createPresignedUpload = async ({ prefix, contentType, originalName, expiresInSeconds }) => {
  const extension = getExtension(contentType);
  if (!extension) {
    throw new Error(`Invalid content type: ${contentType}`);
  }

  const uuid = uuidv4();
  const sanitizedName = sanitizeFilename(originalName);
  const filename = sanitizedName
    ? `${uuid}_${sanitizedName}.${extension}`
    : `${uuid}.${extension}`;
  const key = maybeAddStoragePrefix(`${prefix}/${filename}`);

  const command = new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
    ContentType: contentType,
    ACL: "public-read",
  });

  const uploadUrl = await getSignedUrl(defaultClient, command, {
    expiresIn: expiresInSeconds || 300,
  });

  const location = buildPublicUrl(key);

  return {
    uuid,
    key,
    uploadUrl,
    location,
    headers: {
      "Content-Type": contentType,
    },
  };
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

const doPreliminarkeyUpload = (req, examUuid) => {
  const params = buildUploadParams(req, () => {
    return `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.PRELIMINARKEY}`;
  });
  return uploadToS3(params);
};

const doFinalkeyUpload = (req, examUuid) => {
  const params = buildUploadParams(req, () => {
    return `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.FINALKEY}`;
  });
  return uploadToS3(params);
};

const doNamelistUpload = (req, examUuid) => {
  const params = buildUploadParams(req, () => {
    return `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.NAMELIST}`;
  });
  return uploadToS3(params);
};

const doAnswerSheetImageUpload = (req, examUuid) => {
  const params = buildUploadParams(req, () => {
    return `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.ANSWER_SHEET_IMAGES}`;
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

const doPrintableAnswerSheetUpload = (req, examUuid) => {
  const params = buildUploadParams(req, () => {
    return `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.PRINTABLE_ANSWER_SHEETS}`;
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
  doPrintableAnswerSheetUpload,
  buildPublicUrl,
  createPresignedUpload,
};
