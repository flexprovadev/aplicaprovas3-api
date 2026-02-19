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
- `k6/05-answer-realistic.js`: cenario "prova real" com pausas humanas e revisao.
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

### 4.1 Gerar CSV automaticamente pela API (recomendado)

Script:

- `scripts/generate-students-csv.js`

Esse script:

- autentica com conta admin/superuser,
- encontra alunos elegiveis para uma prova,
- escolhe `question_uuid` valido (ou usa override),
- opcionalmente chama `/take` para preencher `exam_student_uuid`,
- gera arquivo `students-YYYY-MM-DD.csv` em `load-tests/data`.

Modo leitura (nao altera senha de aluno):

```bash
node ./scripts/generate-students-csv.js \
  --base-url "http://localhost:4000" \
  --admin-email "silvagirao@gmail.com" \
  --admin-password "abcd1234" \
  --exam-uuid "1192c2e1-c849-4a9d-a91b-b28eed94dff6" \
  --default-student-password "abc123" \
  --prepare-exam-students true \
  --limit 100
```

Modo garantido (redefine senha dos alunos selecionados):

```bash
node ./scripts/generate-students-csv.js \
  --base-url "http://localhost:4000" \
  --admin-email "silvagirao@gmail.com" \
  --admin-password "abcd1234" \
  --exam-uuid "1192c2e1-c849-4a9d-a91b-b28eed94dff6" \
  --set-student-password "Carga2026!" \
  --prepare-exam-students true \
  --limit 100
```

Observacoes importantes:

- Use `--prepare-exam-students true` para preencher `exam_student_uuid` no CSV.
- Se a prova estiver fora da janela (antes/depois) ou aluno sem permissao de iniciar, o script mostra `WARN` e segue com `exam_student_uuid` vazio para aquele aluno.
- Se um aluno ja tiver prova `submitted`, ele e excluido automaticamente do CSV.
- Se nao passar `--exam-uuid`, o script tenta auto-selecionar a primeira prova elegivel.
- Com `--set-student-password`, o script altera dados reais no ambiente apontado.

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

### 6.5 Cenario prova real (ondas + comportamento humano)

Esse cenario foi criado para estimar experiencia de aluno simultaneo sem flood continuo:

- login + resolucao de contexto 1 vez por VU;
- 1 marcacao de resposta por iteracao;
- pausa humana aleatoria entre `THINK_MIN_SECONDS` e `THINK_MAX_SECONDS`;
- chance de revisao/troca de resposta em `REVIEW_PROBABILITY`.

Comando local (inclui exportacao NDJSON):

```bash
k6 run \
  --summary-export ./reports/05-answer-realistic.json \
  --out json=./reports/05-answer-realistic.ndjson \
  -e BASE_URL="http://localhost:4000" \
  -e EXAM_UUID="SEU_EXAM_UUID" \
  -e STUDENTS_CSV="$(pwd)/data/students.csv" \
  -e REALISTIC_STAGES="2m:100,2m:200,2m:300,2m:400,2m:500,2m:600,2m:700,2m:800,2m:900,2m:1000,4m:0" \
  -e THINK_MIN_SECONDS="4" \
  -e THINK_MAX_SECONDS="20" \
  -e REVIEW_PROBABILITY="0.15" \
  -e ANSWER_ERROR_RATE_MAX="0.01" \
  -e ANSWER_P95_GOAL_MS="1000" \
  ./k6/05-answer-realistic.js
```

Comando producao (rodar somente em janela controlada):

```bash
k6 run \
  --summary-export ./reports/05-answer-realistic-prod.json \
  --out json=./reports/05-answer-realistic-prod.ndjson \
  -e BASE_URL="https://api.seu-dominio.com" \
  -e EXAM_UUID="SEU_EXAM_UUID" \
  -e STUDENTS_CSV="$(pwd)/data/students.csv" \
  -e REALISTIC_STAGES="2m:100,2m:200,2m:300,2m:400,2m:500,2m:600,2m:700,2m:800,2m:900,2m:1000,4m:0" \
  -e THINK_MIN_SECONDS="4" \
  -e THINK_MAX_SECONDS="20" \
  -e REVIEW_PROBABILITY="0.15" \
  -e ANSWER_ERROR_RATE_MAX="0.01" \
  -e ANSWER_P95_GOAL_MS="1000" \
  ./k6/05-answer-realistic.js
```

Metricas principais do script `05`:

- `answer_put_success`: taxa de sucesso do `PUT /answer` (status `204`);
- `endpoint_401_rate`, `endpoint_4xx_rate`, `endpoint_5xx_rate` por endpoint;
- `answer_put_duration`: latencia do endpoint `answer_put` (`p(50)`, `p(90)`, `p(95)`).

## 7. Criterio go/no-go e resposta "ate X alunos"

Criterio inicial recomendado para o alvo de alunos simultaneos:

- erro em `PUT /answer` < `1%` (`answer_put_success >= 0.99`);
- `p95(answer_put)` < `1s` (`answer_put_duration p(95) < 1000ms`);
- `5xx` em `answer_put` idealmente proximo de zero (maximo `1%`).

Como concluir "ate X alunos simultaneos com experiencia aceitavel":

1. Rode o teste `05` com o pico alvo (exemplo: `1000` no ultimo patamar).
2. Se passar nos criterios, aumente o pico e rode novamente.
3. Se falhar, reduza o pico e rode novamente.
4. O maior pico que passa e o seu `X` de capacidade com experiencia aceitavel.

Leitura rapida do resumo JSON:

```bash
jq '{
  answer_put_success: .metrics.answer_put_success.values.rate,
  answer_put_p50_ms: .metrics.answer_put_duration.values["p(50)"],
  answer_put_p90_ms: .metrics.answer_put_duration.values["p(90)"],
  answer_put_p95_ms: .metrics.answer_put_duration.values["p(95)"]
}' ./reports/05-answer-realistic.json
```

Decisao automatica (GO/NO-GO) para os criterios iniciais:

```bash
jq -r '
  .metrics.answer_put_success.values.rate as $success
  | .metrics.answer_put_duration.values["p(95)"] as $p95
  | if ($success >= 0.99 and $p95 < 1000)
      then "GO: experiencia aceitavel no pico testado"
      else "NO-GO: experiencia ruim no pico testado"
    end
  + " | success=" + ($success|tostring)
  + " | p95_ms=" + ($p95|tostring)
' ./reports/05-answer-realistic.json
```

## 8. Como ler o primeiro gargalo

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

## 9. O que monitorar durante o teste

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

## 10. Exportar NDJSON e resumir status HTTP com jq

Comando de exportacao NDJSON (se quiser rodar separado):

```bash
k6 run \
  --out json=./reports/05-answer-realistic.ndjson \
  -e BASE_URL="http://localhost:4000" \
  -e EXAM_UUID="SEU_EXAM_UUID" \
  -e STUDENTS_CSV="$(pwd)/data/students.csv" \
  ./k6/05-answer-realistic.js
```

Resumo de status HTTP por endpoint:

```bash
jq -r 'select(.type=="Point" and .metric=="http_reqs")
  | [(.data.tags.endpoint // "sem_endpoint"), (.data.tags.status // "sem_status")]
  | @tsv' ./reports/05-answer-realistic.ndjson \
| sort \
| uniq -c \
| sort -nr
```

## 11. Regras de seguranca

- Evite rodar em producao no horario de prova.
- Se precisar rodar em producao, use janela controlada e carga gradual.
- Nunca comece direto em 1000+ usuarios sem smoke e rampa intermediaria.
