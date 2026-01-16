const express = require("express");
const router = express.Router();
const { User, Classroom } = require("../../model");
const { Permission, UserType } = require("../../enumerator");
const { hasPermission } = require("../../middleware");
const { createSchoolFilter } = require("../../util/school.util");

router.get(
  "",
  hasPermission(Permission.READ_CLASSROOM.key),
  async (req, res) => {
    try {
      const classroomFilter = createSchoolFilter(req.schoolPrefix, "name") || {};

      const classrooms = await Classroom.find(classroomFilter)
        .select("uuid name year level shift enabled")
        .populate({ path: "students", select: "-_id uuid name email" })
        .sort({ name: 1, level: 1, year: 1 })
        .lean();
      return res.json(classrooms);
    } catch (ex) {
      const { message = "Erro ao recuperar turmas" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.get(
  "/:uuid",
  hasPermission(Permission.READ_CLASSROOM.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;

      const classroom = await Classroom.findOne({ uuid })
        .lean()
        .populate({ path: "students", select: "uuid email name" });

      if (!classroom) {
        throw new Error("Erro ao recuperar turma");
      }

      // Converter students para array de UUIDs (mesmo padrão de student.route.js)
      classroom.students = classroom.students.map((x) => x.uuid);

      return res.json(classroom);
    } catch (ex) {
      const { message = "Erro ao recuperar turma" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "",
  hasPermission(Permission.CREATE_CLASSROOM.key),
  async (req, res) => {
    try {
      const { name, level, year } = req.body;

      const students = await User.find({
        type: UserType.STUDENT,
        uuid: req.body.students,
      });

      const classroom = await Classroom.create({ name, level, year, students });

      if (!classroom) {
        throw new Error("Erro ao criar turma");
      }

      const { uuid } = classroom;
      return res.json({ uuid });
    } catch (ex) {
      const { message = "Erro ao criar turma" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.put(
  "/:uuid",
  hasPermission(Permission.CREATE_CLASSROOM.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;

      const students = await User.find({
        type: UserType.STUDENT,
        uuid: req.body.students,
      });

      const updateQuery = { ...req.body, students };

      const classroom = await Classroom.findOneAndUpdate({ uuid }, updateQuery);

      if (!classroom) {
        throw new Error("Erro ao atualizar turma");
      }

      return res.json({ message: "Turma atualizada com sucesso" });
    } catch (ex) {
      const { message = "Erro ao atualizar turma" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.delete(
  "/:uuid",
  hasPermission(Permission.DELETE_CLASSROOM.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;

      const classroom = await Classroom.findOneAndDelete({ uuid });

      if (!classroom) {
        throw new Error("Erro ao remover turma");
      }

      return res.json({ message: "Turma removida com sucesso" });
    } catch (ex) {
      const { message = "Erro ao remover turma" } = ex;
      return res.status(400).json({ message });
    }
  }
);

module.exports = router;
