const express = require("express");
const router = express.Router();
const { Course } = require("../../model");
const { Permission } = require("../../enumerator");
const { hasPermission } = require("../../middleware");
const { addSchoolPrefix, createSchoolFilter } = require("../../util/school.util");

router.get("", hasPermission(Permission.READ_COURSE.key), async (req, res) => {
  try {
    const courseFilter = createSchoolFilter(req.schoolPrefix, "name") || {};

    const courses = await Course.find(courseFilter)
      .select("-_id uuid name enabled")
      .sort({ name: 1 })
      .lean();
    return res.json(courses);
  } catch (ex) {
    return res.status(400).json({ message: "Erro ao recuperar disciplinas" });
  }
});

router.get(
  "/:uuid",
  hasPermission(Permission.READ_COURSE.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;

      const course = await Course.findOne({ uuid }).lean();

      if (!course) {
        throw new Error();
      }

      return res.json(course);
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao recuperar disciplina" });
    }
  }
);

router.post(
  "",
  hasPermission(Permission.CREATE_COURSE.key),
  async (req, res) => {
    try {
      if (!req.schoolPrefix) {
        return res.status(400).json({ message: "Escola não identificada" });
      }

      const prefixedName = addSchoolPrefix(req.body.name, req.schoolPrefix);
      const course = await Course.create({ name: prefixedName });
      const { uuid } = course;
      return res.json({ uuid });
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao criar disciplina" });
    }
  }
);

router.put(
  "/:uuid",
  hasPermission(Permission.UPDATE_COURSE.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;

      if (req.body.name !== undefined && !req.schoolPrefix) {
        return res.status(400).json({ message: "Escola não identificada" });
      }

      const updateQuery = {
        ...req.body,
        ...(req.body.name !== undefined
          ? { name: addSchoolPrefix(req.body.name, req.schoolPrefix) }
          : {}),
      };

      const course = await Course.findOneAndUpdate({ uuid }, updateQuery);

      if (!course) {
        throw new Error();
      }

      return res.json({ message: "Disciplina atualizada com sucesso" });
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao atualizar disciplina" });
    }
  }
);

router.delete(
  "/:uuid",
  hasPermission(Permission.DELETE_COURSE.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;

      const course = await Course.findOneAndDelete({ uuid });

      if (!course) {
        throw new Error();
      }

      return res.json({ message: "Disciplina removida com sucesso" });
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao remover disciplina" });
    }
  }
);

module.exports = router;
