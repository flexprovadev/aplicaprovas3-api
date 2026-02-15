#!/bin/bash

# Script de Deploy Automático para API Staging
# Data: 2026-02-15
# Localização: /media/silvagirao/STORAGE/DEV/aplicaprovas/aplicaprovas3/Aplicaprovas3-api

set -e  # Sai imediatamente se algum comando falhar

# Cores para mensagens
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Função para imprimir mensagens com cores
print_message() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERRO]${NC} $1" >&2
}

print_warning() {
    echo -e "${YELLOW}[AVISO]${NC} $1"
}

# Verificar se está no diretório correto
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

print_message "Iniciando deploy automático da API Staging..."
print_message "Diretório atual: $(pwd)"

# Verificar se Docker está instalado
if ! command -v docker &> /dev/null; then
    print_error "Docker não está instalado. Por favor, instale o Docker primeiro."
    exit 1
fi

# Verificar se está logado no Docker Hub
if ! docker info | grep -q "Username"; then
    print_warning "Não está logado no Docker Hub. Será necessário fazer login."
    docker login
fi

# Build da imagem Docker
print_message "Construindo imagem Docker (sem cache)..."
docker build --no-cache -t aplicaprovas3-api-staging .

if [ $? -ne 0 ]; then
    print_error "Falha ao construir a imagem Docker"
    exit 1
fi

print_message "Imagem Docker construída com sucesso!"

# Tag da imagem
print_message "Criando tag da imagem..."
docker tag aplicaprovas3-api-staging flexprova/aplicaprovas3-api-staging:latest

if [ $? -ne 0 ]; then
    print_error "Falha ao criar tag da imagem"
    exit 1
fi

# Push da imagem
print_message "Enviando imagem para Docker Hub..."
docker push flexprova/aplicaprovas3-api-staging:latest

if [ $? -ne 0 ]; then
    print_error "Falha ao enviar imagem para Docker Hub"
    exit 1
fi

print_message "Imagem enviada com sucesso para Docker Hub!"

# Mensagem final
echo ""
echo "========================================"
echo "   ${GREEN}DEPLOY CONCLUÍDO COM SUCESSO!${NC}"
echo "========================================"
echo ""
echo "Próximos passos (Manual Deploy):"
echo "1. Acesse o Dashboard do Render"
echo "2. Vá até o projeto"
echo "3. Entre na instância"
echo "4. Em 'Manual Deploy', vá até 'Deploy latest reference'"
echo ""
echo "========================================"

exit 0
