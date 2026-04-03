const { resolveUploadFileType } = require("./s3.util");

describe("s3.util resolveUploadFileType", () => {
  test("accepts xlsm with the official mime type", () => {
    expect(
      resolveUploadFileType({
        contentType: "application/vnd.ms-excel.sheet.macroenabled.12",
        originalName: "classificacao.xlsm",
      })
    ).toEqual({
      contentType: "application/vnd.ms-excel.sheet.macroenabled.12",
      extension: "xlsm",
    });
  });

  test("normalizes xlsm mime type variations", () => {
    expect(
      resolveUploadFileType({
        contentType: "APPLICATION/VND.MS-EXCEL.SHEET.MACROENABLED.12; charset=binary",
        originalName: "classificacao.xlsm",
      })
    ).toEqual({
      contentType: "application/vnd.ms-excel.sheet.macroenabled.12",
      extension: "xlsm",
    });
  });

  test("falls back to the original extension when mime type is missing", () => {
    expect(
      resolveUploadFileType({
        contentType: "",
        originalName: "gabarito-final.xlsm",
      })
    ).toEqual({
      contentType: "application/vnd.ms-excel.sheet.macroenabled.12",
      extension: "xlsm",
    });
  });

  test("keeps existing supported formats working", () => {
    expect(
      resolveUploadFileType({
        contentType: "text/csv; charset=utf-8",
        originalName: "inscritos.csv",
      })
    ).toEqual({
      contentType: "text/csv",
      extension: "csv",
    });
  });

  test("rejects unsupported extensions", () => {
    expect(() =>
      resolveUploadFileType({
        contentType: "",
        originalName: "malicioso.exe",
      })
    ).toThrow("Invalid content type");
  });
});
