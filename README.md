# Pre-requisitos

1. [Node](https://nodejs.org/en/download/)
2. [MongoDB](https://www.mongodb.com/try/download/community)
3. [MongoDB Compass](https://www.mongodb.com/products/compass)
4. Yarn ou NPM

# Baixando as dependências

Execute o seguinte comando na raiz do projeto se estiver utilizando **Yarn**:

```
yarn install
```

# DOTENV

A aplicação faz uso do pacote [dotenv](https://www.npmjs.com/package/dotenv) para carregar configurações a partir de um arquivo `.env`

Cria o arquivo `.env` na raiz do projeto com o seguinte conteúdo:

```
DATABASE_URL=mongodb://localhost:27017/aplicaprovas
```

# Como subir a aplicação

Para inicializar a aplicação localmente execute o script `dev`.