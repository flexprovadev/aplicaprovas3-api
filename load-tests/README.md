# Load Tests (k6)

Guia operacional para testar capacidade da API de prova e download de PDF.

## 1. Objetivo

Responder com dados reais:

- Quantos alunos simultaneos a API suporta antes de degradar.
- Se o primeiro gargalo aparece como lentidao ou erro.
- Se o PDF (S3/CloudFront) aguenta picos de download.

## 2. Estrutura

- `k6/01-smoke.js`: fluxo minimo (login, available, take, salvar resposta).
- `k6/02-answer-ramp.js`: carga sustentada no endpoint de salvar resposta.
- `k6/03-breakpoint-step.js`: teste em degraus para achar o primeiro gargalo.
- `k6/04-pdf-download.js`: carga de download do PDF (S3/CloudFront).
- `k6/lib/*.js`: utilitarios comuns.
- `data/students.example.csv`: modelo de usuarios.

## 3. Pre-requisitos

- Rodar em **ambiente de homologacao/staging** sempre que possivel.
- Ter um `EXAM_UUID` valido para os alunos usados no CSV.
- Ter uma lista de alunos com senha valida.
- `k6` instalado.

Instalacao rapida do k6 (Ubuntu/Debian):

```bash
sudo gpg -k
sudo apt-get update
sudo apt-get install -y gnupg ca-certificates
curl -fsSL https://dl.k6.io/key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/k6-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install -y k6
k6 version
```

## 4. Preparar dados

Entre na pasta:

```bash
cd Aplicaprovas3-api/load-tests
```

Crie seu CSV:

```bash
cp ./data/students.example.csv ./data/students.csv
```

Formato:

```csv
email,password,exam_student_uuid,question_uuid
aluno1@dominio.com,senha123,,
aluno2@dominio.com,senha123,,
```

Observacoes:

- `email,password` sao obrigatorios.
- `exam_student_uuid` e `question_uuid` sao opcionais.
- Se deixar vazio, o script chama `/exams/:uuid/take` e escolhe uma questao automaticamente.
- Se quantidade de VUs for maior que quantidade de linhas, o script reutiliza credenciais.

## 5. Descobrir EXAM_UUID

Exemplo via API:

```bash
BASE_URL="http://localhost:4000"
EMAIL="escola1.aluno1@flexprova.com"
PASS="abc123"

TOKEN=$(curl -s -X POST "$BASE_URL/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | jq -r '.token')

curl -s "$BASE_URL/exams/available" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Pegue o `uuid` da prova em `available` ou `progress`.

## 6. Executar testes

Crie pasta de relatorios:

```bash
mkdir -p ./reports
```

### 6.1 Smoke (validacao inicial obrigatoria)

```bash
k6 run \
  --summary-export ./reports/01-smoke.json \
  -e BASE_URL="http://localhost:4000" \
  -e EXAM_UUID="SEU_EXAM_UUID" \
  -e STUDENTS_CSV="$(pwd)/data/students.csv" \
  ./k6/01-smoke.js
```

Se falhar aqui, nao avance para os testes pesados.

### 6.2 Ramp de respostas (carga sustentada)

```bash
k6 run \
  --summary-export ./reports/02-answer-ramp.json \
  -e BASE_URL="http://localhost:4000" \
  -e EXAM_UUID="SEU_EXAM_UUID" \
  -e STUDENTS_CSV="$(pwd)/data/students.csv" \
  -e RAMP_STAGES="2m:20,5m:80,5m:150,2m:0" \
  -e ANSWER_SLEEP_SECONDS="0.5" \
  ./k6/02-answer-ramp.js
```

### 6.3 Breakpoint (degraus ate achar gargalo)

```bash
k6 run \
  --summary-export ./reports/03-breakpoint-step.json \
  -e BASE_URL="http://localhost:4000" \
  -e EXAM_UUID="SEU_EXAM_UUID" \
  -e STUDENTS_CSV="$(pwd)/data/students.csv" \
  -e STEP_TARGETS="25,50,100,150,200,300,500" \
  -e STEP_DURATION="2m" \
  -e COOLDOWN_DURATION="2m" \
  -e BREAKPOINT_SLEEP_SECONDS="0.2" \
  ./k6/03-breakpoint-step.js
```

### 6.4 Download de PDF (S3/CloudFront)

```bash
k6 run \
  --summary-export ./reports/04-pdf-download.json \
  -e PDF_URL="https://seu-bucket-ou-cloudfront/exams/arquivo.pdf" \
  -e PDF_STAGES="2m:20,5m:100,5m:250,2m:0" \
  -e PDF_SLEEP_SECONDS="1" \
  ./k6/04-pdf-download.js
```

## 7. Como ler o primeiro gargalo

Sinais tipicos (nessa ordem):

1. `p95` de latencia sobe, mas erro ainda baixo.  
   Usuario sente lentidao, mas app continua no ar.
2. `p95` continua subindo e aparecem erros intermitentes (`4xx/5xx`).  
   Usuario comeca a ver falhas de salvar resposta.
3. Erro cresce rapido, timeouts e possiveis `502/503`.  
   Usuario perde acao e pode tentar repetir clique varias vezes.
4. Saturacao total.  
   Queda visivel no servico, filas longas e possivel reinicio de processo.

Em `t2.micro`, um sintoma comum e:

- Inicialmente parece bom.
- Depois de alguns minutos de carga continua, `CPUCreditBalance` cai e a latencia piora de forma brusca.

## 8. O que monitorar durante o teste

EC2:

- `CPUUtilization`
- `CPUCreditBalance` (critico em `t2.micro`)
- `NetworkIn`, `NetworkOut`
- memoria/processo (via CloudWatch Agent, se disponivel)

API (logs):

- taxa de `400/401/403/429/500`
- mensagens de erro em `/exam-students/:uuid/answer/:answerUuid`

Mongo Atlas:

- conexoes ativas
- latencia de leitura/escrita
- uso de CPU e limites do tier
- operacoes por segundo

## 9. Regras de seguranca

- Evite rodar em producao no horario de prova.
- Se precisar rodar em producao, use janela controlada e carga gradual.
- Nunca comece direto em 1000+ usuarios sem smoke e rampa intermediaria.
