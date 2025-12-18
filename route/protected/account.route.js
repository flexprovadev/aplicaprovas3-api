const express = require("express");
const router = express.Router();

router.get("/me", (req, res) => {
  const { user } = req;
  return res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    type: user.type,
    permissions: user.getPermissions(),
  });
});

router.post("/password", async (req, res) => {
  try {
    const { user } = req;
    const { password } = req.body;

    if (!password) {
      throw new Error("Senha é obrigatória");
    }

    if (password.length < 6) {
      throw new Error("Senha deve possuir no mínimo 6 caracteres");
    }

    user.password = password;

    await user.save();

    return res.sendStatus(204);
  } catch (ex) {
    const { message = "Erro ao atualizar a senha" } = ex;
    return res.status(400).json({ message });
  }
});

module.exports = router;
