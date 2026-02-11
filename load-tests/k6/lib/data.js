export function parseStudentsCsv(csvContent) {
  if (!csvContent || !csvContent.trim()) {
    throw new Error("Arquivo CSV de alunos vazio.");
  }

  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (!lines.length) {
    throw new Error("Nenhuma linha valida encontrada no CSV de alunos.");
  }

  const headers = splitCsvLine(lines[0]).map((value) => value.trim().toLowerCase());

  const requiredColumns = ["email", "password"];
  for (const column of requiredColumns) {
    if (!headers.includes(column)) {
      throw new Error(`Coluna obrigatoria ausente no CSV: ${column}`);
    }
  }

  const students = [];
  for (let i = 1; i < lines.length; i += 1) {
    const row = splitCsvLine(lines[i]);
    if (!row.length) {
      continue;
    }

    const entry = {};
    headers.forEach((header, idx) => {
      entry[header] = (row[idx] || "").trim();
    });

    if (!entry.email || !entry.password) {
      throw new Error(`Linha ${i + 1} invalida: email/password obrigatorios.`);
    }

    students.push({
      email: entry.email,
      password: entry.password,
      examStudentUuid: entry.exam_student_uuid || "",
      questionUuid: entry.question_uuid || "",
    });
  }

  if (!students.length) {
    throw new Error("Nenhum aluno valido encontrado no CSV.");
  }

  return students;
}

export function pickStudentForVu(students, vuNumber) {
  if (!students || !students.length) {
    throw new Error("Lista de alunos vazia.");
  }

  const idx = (vuNumber - 1) % students.length;
  return students[idx];
}

function splitCsvLine(line) {
  // Parser simples (sem aspas/escapes). Mantem o CSV fácil para uso operacional.
  return line.split(",").map((entry) => entry.trim());
}
