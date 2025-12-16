const { encryptPassword, generateSalt } = require("../util/password.util");
const { UserType } = require("../enumerator");
const { User, Classroom } = require("../model");
const emailValidator = require("email-validator");

const isEmptyFilter = (value) => !value;

class EntityValidator {
  cache = {};
  getCache = () => this.cache;

  errors = [];
  getErrors = () => this.errors;
  addError = (index, message) => {
    this.errors.push({ index: index + 1, message });
  };
}

class ClassroomValidator extends EntityValidator {
  validate = (entry, index) => {
    const {
      studentEmail: email,
      classroomName,
      classroomYear,
      classroomLevel,
    } = entry;

    const classroomParts = [classroomName, classroomYear, classroomLevel];

    if (classroomParts.every(isEmptyFilter)) {
      return; // turma nao foi informada
    }

    if (classroomParts.some(isEmptyFilter)) {
      this.addError(index, "Todos os campos da turma devem ser informados");
      return;
    }

    const key = classroomParts.join("|");

    if (this.cache.hasOwnProperty(key)) {
      this.cache[key].indexes.push(index);
      this.cache[key].emails.push(email);
    } else {
      this.cache[key] = { indexes: [index], emails: [email] };
    }
  };

  validateDatabase = async () => {
    await Promise.all(
      Object.keys(this.cache).map(async (key) => {
        const [name, year, level] = key.split("|");

        const classroom = await Classroom.findOne({
          name,
          year,
          level,
          enabled: true,
        });

        if (classroom) {
          this.cache[key].classroom = classroom;
        } else {
          const { indexes } = this.cache[key];

          indexes.forEach((index) => {
            this.addError(
              index,
              "A turma informada não foi cadastrada no sistema"
            );
          });
        }
      })
    );
  };
}

class EmailValidator extends EntityValidator {
  validate = (entry, index) => {
    const { studentEmail: email } = entry;

    if (!email) {
      this.addError(index, "O campo e-mail é obrigatório");
      return;
    }

    if (!emailValidator.validate(email)) {
      this.addError(index, `O email ${email} é inválido`);
      return;
    }

    if (this.cache.hasOwnProperty(email)) {
      this.addError(
        index,
        `O email ${email} já foi utilizado na linha ${this.cache[email] + 1}`
      );
      return;
    }

    this.cache[email] = index;
  };

  validateDatabase = async () => {
    const emails = Object.keys(this.cache);

    const existingEmails = await User.find({ email: { $in: emails } })
      .select("-_id email")
      .lean();

    existingEmails.forEach(({ email }) => {
      const index = this.cache[email];
      this.addError(index, `O e-mail ${email} já foi cadastrado no sistema`);
    });
  };
}

async function getEncryptedPassword(password, salt, passwordCache) {
  if (passwordCache.hasOwnProperty(password)) {
    return passwordCache[password];
  }

  const encryptedPassword = await encryptPassword(password, salt);
  passwordCache[password] = encryptedPassword;
  return encryptedPassword;
}

async function batchImportStudents(entries, classroomCache) {
  const passwordCache = {};

  const salt = await generateSalt();

  const users = await Promise.all(
    entries.map(async (entry) => {
      const {
        studentName: name,
        studentEmail: email,
        studentPassword: password = "abc123",
      } = entry;

      const encryptedPassword = await getEncryptedPassword(
        password,
        salt,
        passwordCache
      );

      return {
        name,
        email,
        password: encryptedPassword,
        type: UserType.STUDENT,
      };
    })
  );

  const persistedUsers = await User.insertMany(users);

  await Promise.all(
    Object.values(classroomCache).map(async ({ emails, classroom }) => {
      const studentsPerClassroom = persistedUsers.filter((user) =>
        emails.includes(user.email)
      );
      classroom.students = classroom.students.concat(studentsPerClassroom);
      await classroom.save();
    })
  );
}

module.exports = {
  ClassroomValidator,
  EmailValidator,
  batchImportStudents,
};
