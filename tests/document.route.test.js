/// fail

const request = require("supertest");

const BASE_URL = "http://localhost:4000"; // URL da sua API no Docker

describe("Document Routes", () => {
  let token;
  let createdDocumentUUID;

  // Antes de todos os testes, faça login e obtenha o token
  beforeAll(async () => {
    const loginResponse = await request(BASE_URL)
      .post("/login")
      .send({
        email: "silvagirao@gmail.com", // Substitua pelo email válido
        password: "fJx5A4HFq6Y9NmcNgneT", // Substitua pela senha válida
      });

    token = loginResponse.body.token;
    expect(token).toBeDefined(); // Certifique-se de que o token foi gerado
  });

  test("Deve listar todos os documentos", async () => {
    const response = await request(BASE_URL)
      .get("/document")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200); // Verifica se o status é 200
    expect(Array.isArray(response.body)).toBe(true); // Verifica se o corpo da resposta é um array
  });

  test("Deve criar um novo documento", async () => {
    const response = await request(BASE_URL)
      .post("/document")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Documento Teste",
        description: "Descrição do documento de teste",
        createdBy: "6787ec4ff6b002c32a769605",
        dates: {
          start: "2025-01-01T00:00:00Z",
          teacher: "2025-01-02T00:00:00Z",
          deadline: "2025-01-03T00:00:00Z",
          print: "2025-01-04T00:00:00Z",
          final: "2025-01-05T00:00:00Z",
        },
        intervals: {
          teacherDays: 2,
          reviewDays: 1,
          printDays: 1,
          finalDays: 1,
        },
      });

    expect(response.status).toBe(200); // Verifica se o status é 200
    expect(response.body.uuid).toBeDefined(); // Verifica se o UUID foi retornado

    createdDocumentUUID = response.body.uuid; // Salva o UUID para os próximos testes
  });

  test("Deve obter detalhes de um documento específico", async () => {
    const response = await request(BASE_URL)
      .get(`/document/${createdDocumentUUID}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200); // Verifica se o status é 200
    expect(response.body.uuid).toBe(createdDocumentUUID); // Verifica se o UUID corresponde
  });

  test("Deve atualizar um documento", async () => {
    const response = await request(BASE_URL)
      .put(`/document/${createdDocumentUUID}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Documento Atualizado",
        description: "Descrição atualizada do documento de teste",
      });

    expect(response.status).toBe(200); // Verifica se o status é 200
    expect(response.body.message).toBe("Documento atualizado com sucesso"); // Verifica a mensagem de sucesso
  });

  test("Deve excluir um documento", async () => {
    const response = await request(BASE_URL)
      .delete(`/document/${createdDocumentUUID}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200); // Verifica se o status é 200
    expect(response.body.message).toBe("Documento removido com sucesso"); // Verifica a mensagem de sucesso
  });

    expect(response.status).toBe(400); // Verifica se o status é 400 (Bad Request)
    expect(response.body.message).toBe("Todos os campos obrigatórios devem ser preenchidos");
  });

  test("Não deve atualizar um documento com UUID inválido", async () => {
    const response = await request(BASE_URL)
      .put("/document/uuid-invalido")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Documento Inválido",
      });

    expect(response.status).toBe(400); // Verifica se o status é 400 (Bad Request)
    expect(response.body.message).toBe("Erro ao atualizar documento");
  });

  test("Não deve excluir um documento com UUID inexistente", async () => {
    const response = await request(BASE_URL)
      .delete("/document/uuid-inexistente")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400); // Verifica se o status é 400 (Bad Request)
    expect(response.body.message).toBe("Erro ao remover documento");
  });
});

