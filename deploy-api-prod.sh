#!/bin/bash

# Script de Deploy para Produção - API Aplicaprovas3
# ⚠️ CUIDADO: Este script afeta ambiente de PRODUÇÃO na AWS EC2
# 🔒 Estratégia: Copiar arquivos + Build dentro da EC2 (sem Docker Hub/ECR)

set -e  # Sai na primeira falha

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configurações
EC2_USER="ec2-user"
EC2_HOST="52.67.100.195"
SSH_KEY="$HOME/.ssh/id_ed25519"
REMOTE_DIR="/home/ec2-user/aplicaprovas3-api"
CONTAINER_NAME="aplicaprovas3"
PORT_MAPPING="4000:4000"
ENV_FILE="/home/ec2-user/.env-prod"

# ========================================
# FUNÇÕES AUXILIARES
# ========================================

print_error() {
    echo -e "${RED}[ERRO]${NC} $1" >&2
}

print_warning() {
    echo -e "${YELLOW}[AVISO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

confirm_production() {
    echo ""
    echo -e "${RED}==============================================${NC}"
    echo -e "${RED}⚠️  ATENÇÃO: DEPLOY EM PRODUÇÃO${NC}"
    echo -e "${RED}==============================================${NC}"
    echo ""
    echo -e "${YELLOW}Este script irá:${NC}"
    echo "  • Sincronizar arquivos do projeto para EC2 ($EC2_HOST)"
    echo "  • Remover container/imagens antigos"
    echo "  • Buildar imagem Docker DENTRO da EC2"
    echo "  • Iniciar novo container com .env-prod"
    echo "  • Limpar espaço em disco (pós-deploy)"
    echo ""
    echo -e "${RED}⚠️  AMBIENTE DE PRODUÇÃO${NC}"
    echo ""
    
    read -p "Deseja continuar? Digite 'yes' para confirmar: " CONFIRM1
    if [ "$CONFIRM1" != "yes" ]; then
        print_error "Deploy cancelado na primeira confirmação."
        exit 1
    fi
    
    read -p "CONFIRMAÇÃO FINAL: Digite 'yes' novamente para prosseguir: " CONFIRM2
    if [ "$CONFIRM2" != "yes" ]; then
        print_error "Deploy cancelado na segunda confirmação."
        exit 1
    fi
    
    print_success "Double-check aprovado. Iniciando deploy..."
    echo ""
}

# ========================================
# INÍCIO DO SCRIPT
# ========================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

print_info "Iniciando deploy de produção..."
print_info "Diretório: $(pwd)"
print_info "Branch atual: $(git rev-parse --abbrev-ref HEAD)"

# Verifica se está na branch main
if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
    print_warning "Você não está na branch 'main'!"
    read -p "Deseja continuar mesmo assim? (yes/no): " CONTINUE_ANYWAY
    if [ "$CONTINUE_ANYWAY" != "yes" ]; then
        print_error "Deploy abortado. Mude para a branch 'main' primeiro."
        exit 1
    fi
fi

# Double-check rigoroso
confirm_production

# ========================================
# ETAPA 1: Verificar .dockerignore
# ========================================

print_info "=== ETAPA 1: Verificando .dockerignore ==="

if [ ! -f ".dockerignore" ]; then
    print_warning "Arquivo .dockerignore não encontrado. Criando um básico..."
    cat > .dockerignore <<EOF
node_modules
.git
.gitignore
.env
.env-*
.env.*
.env.local
.env.*.local
tests
load-tests
dev
.vscode
.idea
*.log
.DS_Store
npm-debug.log*
yarn-debug.log*
yarn-error.log*
*.pem
*.key
id_rsa*
EOF
    print_success ".dockerignore criado com configurações seguras."
else
    print_success ".dockerignore encontrado."
fi

# ========================================
# ETAPA 2: Sincronizar arquivos para EC2
# ========================================

print_info ""
print_info "=== ETAPA 2: Sincronizando arquivos para EC2 ==="

print_info "Criando diretório remoto se não existir..."
ssh -i "$SSH_KEY" "$EC2_USER@$EC2_HOST" "mkdir -p $REMOTE_DIR"

print_info "Sincronizando arquivos (excluindo node_modules, .git, .env)..."
rsync -avz --delete \
  --exclude 'node_modules/' \
  --exclude 'dev/' \
  --exclude 'tests/' \
  --exclude 'load-tests/' \
  --exclude 'uploads/' \
  --exclude '.git/' \
  --exclude '.gitignore' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.env-*' \
  --exclude '*.log' \
  --exclude '*.pem' \
  --exclude '*.key' \
  --exclude 'id_rsa*' \
  --exclude '.vscode/' \
  --exclude '.idea/' \
  --exclude 'deploy-prod.sh' \
  -e "ssh -i $SSH_KEY" \
  ./ "$EC2_USER@$EC2_HOST:$REMOTE_DIR/"

print_success "Arquivos sincronizados com sucesso!"

# ========================================
# ETAPA 3: Build e Deploy na EC2
# ========================================

print_info ""
print_info "=== ETAPA 3: Build e Deploy na EC2 ==="

DEPLOY_COMMANDS=$(cat <<EOF
echo "=== Iniciando deploy na EC2 ==="
echo "Diretório de trabalho: $REMOTE_DIR"
cd $REMOTE_DIR

echo "Parando container atual..."
docker stop $CONTAINER_NAME 2>/dev/null || echo "Container não existia ou já estava parado"

echo "Removendo container antigo..."
docker rm $CONTAINER_NAME 2>/dev/null || echo "Container não existia"

echo "Removendo imagem antiga (se existir)..."
docker rmi aplicaprovas3:latest 2>/dev/null || echo "Imagem não existia"

echo "=== Buildando nova imagem Docker (sem cache) ==="
docker build --no-cache -t aplicaprovas3:latest .

echo "=== Iniciando novo container com .env-prod ==="
docker run -d \\
  --restart unless-stopped \\
  -p $PORT_MAPPING \\
  --name $CONTAINER_NAME \\
  --env-file $ENV_FILE \\
  aplicaprovas3:latest

echo "=== Aguardando 5 segundos para o container iniciar ==="
sleep 5

echo "=== Verificando status do container ==="
if docker ps | grep -q "$CONTAINER_NAME"; then
    echo "✅ Container está rodando!"
    echo ""
    echo "Logs recentes:"
    docker logs --tail 20 $CONTAINER_NAME
else
    echo "❌ Container NÃO está rodando!"
    echo ""
    echo "Logs completos:"
    docker logs $CONTAINER_NAME || echo "Container não existe ou não gerou logs"
    exit 1
fi

echo ""
echo "=== Limpando espaço em disco (imagens/containers não utilizados) ==="
docker system prune -f

echo ""
echo "=== Deploy concluído com sucesso! ==="
echo "Container: $CONTAINER_NAME"
echo "Porta: $PORT_MAPPING"
echo "Diretório: $REMOTE_DIR"
EOF
)

print_info "Conectando na EC2 e executando comandos..."
ssh -i "$SSH_KEY" "$EC2_USER@$EC2_HOST" "bash -s" <<'SSH_EOF'
#!/bin/bash
set -e
SSH_EOF
printf "%s\n" "$DEPLOY_COMMANDS" | ssh -i "$SSH_KEY" "$EC2_USER@$EC2_HOST" "bash -s"

print_success ""
print_success "========================================"
print_success "   DEPLOY EM PRODUÇÃO CONCLUÍDO! ✅"
print_success "========================================"
print_success ""
print_success "Container '$CONTAINER_NAME' está rodando na EC2 $EC2_HOST"
print_success "Porta: $PORT_MAPPING"
print_success ""
print_success "Próximos passos opcionais:"
print_success "  • Ver logs: ssh -i $SSH_KEY $EC2_USER@$EC2_HOST 'docker logs -f $CONTAINER_NAME'"
print_success "  • Ver status: ssh -i $SSH_KEY $EC2_USER@$EC2_HOST 'docker ps'"
print_success "  • Acessar API: http://$EC2_HOST:$PORT_MAPPING"
print_success ""

exit 0
