import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const PDF_URL = (__ENV.PDF_URL || "").trim();
const SLEEP_SECONDS = Number(__ENV.PDF_SLEEP_SECONDS || 1);

if (!PDF_URL) {
  throw new Error("PDF_URL e obrigatorio no teste 04-pdf-download.");
}

const pdfErrors = new Rate("pdf_errors");

export const options = {
  stages: parseStages(__ENV.PDF_STAGES),
  thresholds: {
    checks: ["rate>0.95"],
    http_req_failed: ["rate<0.05"],
    "http_req_duration{endpoint:pdf_download}": ["p(95)<5000"],
    pdf_errors: ["rate<0.05"],
  },
};

export default function () {
  const response = http.get(PDF_URL, {
    responseType: "none",
    tags: { endpoint: "pdf_download" },
  });

  const isOk = check(response, {
    "GET PDF retornou 200/206": (res) => res.status === 200 || res.status === 206,
  });

  pdfErrors.add(!isOk);
  sleep(SLEEP_SECONDS);
}

function parseStages(rawStages) {
  if (!rawStages) {
    return [
      { duration: "2m", target: 20 },
      { duration: "5m", target: 100 },
      { duration: "5m", target: 250 },
      { duration: "2m", target: 0 },
    ];
  }

  // Formato esperado: "2m:20,5m:100,5m:250,2m:0"
  return rawStages.split(",").map((entry) => {
    const [duration, target] = entry.split(":");
    return {
      duration: (duration || "").trim(),
      target: Number((target || "").trim()),
    };
  });
}
