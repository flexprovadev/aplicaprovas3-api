#!/bin/bash

# Script de Deploy para Produção - API Aplicaprovas3
# ⚠️ CUIDADO: Este script afeta ambiente de PRODUÇÃO na AWS EC2

set -e  # Sai na primeira falha

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configurações (AJUSTE SE NECESSÁRIO)
EC2_USER="ec2-user"
EC2_HOST="52.67.100.195"
SSH_KEY="$HOME/.ssh/id_ed25519"
DOCKER_IMAGE="flexprova/aplicaprovas3-api-prod:latest"
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
    echo "  • Buildar imagem Docker localmente"
    echo "  • Enviar para Docker Hub"
    echo "  • Conectar na EC2 ($EC2_HOST)"
    echo "  • Parar container atual"
    echo "  • Baixar nova imagem"
    echo "  • Iniciar novo container com .env-prod"
    echo "  • Limpar imagens/containers antigos (pós-deploy)"
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

print_info "Iniciando deploy em produção..."
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
# ETAPA 1: Build e push local
# ========================================

print_info "=== ETAPA 1: Build e push da imagem Docker ==="

if ! command -v docker &> /dev/null; then
    print_error "Docker não encontrado. Instale o Docker primeiro."
    exit 1
fi

print_info "Construindo imagem Docker (sem cache)..."
docker build --no-cache -t aplicaprovas3-api-prod .

print_info "Fazendo login no Docker Hub..."
docker login

print_info "Criando tag..."
docker tag aplicaprovas3-api-prod "$DOCKER_IMAGE"

print_info "Enviando para Docker Hub..."
docker push "$DOCKER_IMAGE"

print_success "Imagem enviada com sucesso para Docker Hub!"

# ========================================
# ETAPA 2: Deploy na EC2 via SSH único
# ========================================

print_info ""
print_info "=== ETAPA 2: Deploy na EC2 ($EC2_HOST) ==="

DEPLOY_COMMANDS=$(cat <<EOF
echo "=== Iniciando deploy na EC2 ==="
echo "Parando container atual..."
docker stop $CONTAINER_NAME 2>/dev/null || echo "Container não existia ou já estava parado"

echo "Removendo container antigo..."
docker rm $CONTAINER_NAME 2>/dev/null || echo "Container não existia"

echo "Baixando nova imagem do Docker Hub..."
docker pull $DOCKER_IMAGE

echo "Iniciando novo container com .env-prod..."
docker run -d \\
  --restart unless-stopped \\
  -p $PORT_MAPPING \\
  --name $CONTAINER_NAME \\
  --env-file $ENV_FILE \\
  $DOCKER_IMAGE

echo "Verificando status do container..."
sleep 3
docker ps | grep $CONTAINER_NAME

echo "=== Limpando espaço em disco (imagens/containers não utilizados) ==="
docker system prune -f

echo "=== Deploy concluído com sucesso! ==="
echo "Container em execução: \$CONTAINER_NAME"
echo "Porta: $PORT_MAPPING"
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
print_success ""

exit 0
