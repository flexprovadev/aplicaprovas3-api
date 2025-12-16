#!/bin/bash

# Nome do arquivo de saída
OUTPUT_FILE="project_tree_2_api.txt"

# Diretório inicial (pasta onde o script está localizado)
START_DIR=$(dirname "$0")

# Limpar o arquivo de saída, se já existir
> "$OUTPUT_FILE"

# Função para verificar extensões relevantes
is_relevant_file() {
    local file="$1"
    case "$file" in
        *.js|*.html|*.pug|*.py|*.css|*.scss|*.md) 
            # Ignorar arquivos .min.js
            [[ "$file" != *.min.js ]] && return 0
            ;;
        *.env)
            # Arquivo .env deve ser incluído
            return 0
            ;;
    esac
    return 1
}

# Percorrer os diretórios e arquivos
process_directory() {
    local dir="$1"
    for entry in "$dir"/*; do
        if [[ -d "$entry" ]]; then
            # Ignorar diretórios irrelevantes
            [[ "$(basename "$entry")" == "node_modules" ]] && continue
            # Processar diretórios recursivamente
            process_directory "$entry"
        elif [[ -f "$entry" ]]; then
            # Verificar se o arquivo é relevante
            if is_relevant_file "$entry"; then
                echo ">>> $(realpath "$entry")" >> "$OUTPUT_FILE"
                cat "$entry" >> "$OUTPUT_FILE"
                echo -e "\n\n" >> "$OUTPUT_FILE"
            fi
        fi
    done
}

# Começar a processar do diretório inicial
process_directory "$START_DIR"

echo "Árvore de projeto gerada em $OUTPUT_FILE"
