const Permission = {
  CREATE_ROLE: { key: "create-role", label: "Criar", context: "Perfil" },
  READ_ROLE: { key: "read-role", label: "Listar", context: "Perfil" },
  UPDATE_ROLE: { key: "update-role", label: "Editar", context: "Perfil" },
  DELETE_ROLE: { key: "delete-role", label: "Remover", context: "Perfil" },

  CREATE_COURSE: {
    key: "create-course",
    label: "Criar",
    context: "Disciplina",
  },
  READ_COURSE: { key: "read-course", label: "Listar", context: "Disciplina" },
  UPDATE_COURSE: {
    key: "update-course",
    label: "Editar",
    context: "Disciplina",
  },
  DELETE_COURSE: {
    key: "delete-course",
    label: "Remover",
    context: "Disciplina",
  },

  CREATE_CLASSROOM: {
    key: "create-classroom",
    label: "Criar",
    context: "Turma",
  },
  READ_CLASSROOM: { key: "read-classroom", label: "Listar", context: "Turma" },
  UPDATE_CLASSROOM: {
    key: "update-classroom",
    label: "Editar",
    context: "Turma",
  },
  DELETE_CLASSROOM: {
    key: "delete-classroom",
    label: "Remover",
    context: "Turma",
  },

  CREATE_STUDENT: { key: "create-student", label: "Criar", context: "Aluno" },
  READ_STUDENT: { key: "read-student", label: "Listar", context: "Aluno" },
  UPDATE_STUDENT: { key: "update-student", label: "Editar", context: "Aluno" },
  DELETE_STUDENT: { key: "delete-student", label: "Remover", context: "Aluno" },

  CREATE_TEACHER: { key: "create-teacher", label: "Criar", context: "Professor" },
  READ_TEACHER: { key: "read-teacher", label: "Listar", context: "Professor" },
  UPDATE_TEACHER: { key: "update-teacher", label: "Editar", context: "Professor" },
  DELETE_TEACHER: { key: "delete-teacher", label: "Remover", context: "Professor" },

  CREATE_STAFF: { key: "create-staff", label: "Criar", context: "Colaborador" },
  READ_STAFF: { key: "read-staff", label: "Listar", context: "Colaborador" },
  UPDATE_STAFF: {
    key: "update-staff",
    label: "Editar",
    context: "Colaborador",
  },
  DELETE_STAFF: {
    key: "delete-staff",
    label: "Remover",
    context: "Colaborador",
  },

  CREATE_EXAM: { key: "create-exam", label: "Criar", context: "Exame" },
  READ_EXAM: { key: "read-exam", label: "Listar", context: "Exame" },
  UPDATE_EXAM: { key: "update-exam", label: "Editar", context: "Exame" },
  DELETE_EXAM: { key: "delete-exam", label: "Remover", context: "Exame" },
  EXPORT_EXAM: { key: "export-exam", label: "Exportar", context: "Exame" },
  
  CREATE_DOCUMENT: { key: "create-document", label: "Criar", context: "Document" },
  READ_DOCUMENT: { key: "read-document", label: "Listar", context: "Document" },
  UPDATE_DOCUMENT: { key: "update-document", label: "Editar", context: "Document" },
  DELETE_DOCUMENT: { key: "delete-document", label: "Remover", context: "Document" },
  EXPORT_DOCUMENT: { key: "export-document", label: "Exportar", context: "Document" },
};

const UserType = {
  STAFF: "staff",
  TEACHER: "teacher",
  STUDENT: "student",
  SUPERUSER: "superuser",
};

const StorageFolder = {
  EXAMS: "exams",
};

const QuestionType = {
  A: "A", // c,e
  B: "B", // 3 digitos
  C: "C", // a,b,c,d
  D: "D", // texto livre
  ENEM: "ENEM", // a,b,c,d,e
  F: "F", // foto
};

const ExamStudentStatus = {
  PROGRESS: "progress",
  SUBMITTED: "submitted",
};

const GradeType = {
  SCORE: "SCORE",
  PAS: "PAS",
};

module.exports = {
  Permission,
  UserType,
  StorageFolder,
  QuestionType,
  ExamStudentStatus,
  GradeType,
};
