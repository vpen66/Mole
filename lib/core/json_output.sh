#!/bin/bash
# Mole - JSON Output Helpers
# Provides NDJSON streaming and structured JSON serialization for GUI/CI consumers.
# Sourced by bin/*.sh when --json is passed.
# Pattern parallels lib/core/history.sh history_json_* helpers.

# Prevent multiple sourcing
if [[ -n "${MOLE_JSON_OUTPUT_LOADED:-}" ]]; then
    return 0
fi
readonly MOLE_JSON_OUTPUT_LOADED=1

# ============================================================================
# State
# ============================================================================
# Accumulated clean items (associative arrays not used for portability with bash 3.2).
JSON_ITEMS_DESC=()
JSON_ITEMS_SIZE_KB=()
JSON_ITEMS_SIZE_HUMAN=()
JSON_ITEMS_COUNT=()
JSON_ITEMS_STATUS=()
JSON_ITEMS_SECTION=()

# Section tracking for clean
JSON_SECTION_NAME=""
JSON_SECTION_ITEMS=()
JSON_SECTIONS=()

# Global counters (mirrored from clean.sh globals)
JSON_TOTAL_SIZE_KB=0
JSON_TOTAL_ITEMS=0
JSON_TOTAL_FILES=0
JSON_DRY_RUN=false
JSON_COMMAND=""

# ============================================================================
# Primitive Escaping
# ============================================================================

# Escape a string for safe embedding in JSON values.
# Reuses the same LC_ALL=C byte-walk approach as history_json_escape.
json_escape() {
    local value="${1:-}"
    local LC_ALL=C
    local char code idx

    idx=0
    while [[ "$idx" -lt "${#value}" ]]; do
        char="${value:$idx:1}"
        case "$char" in
            "\\") printf '%s' "\\\\" ;;
            "\"") printf '%s' "\\\"" ;;
            $'\b') printf '%s' "\\b" ;;
            $'\f') printf '%s' "\\f" ;;
            $'\n') printf '%s' "\\n" ;;
            $'\r') printf '%s' "\\r" ;;
            $'\t') printf '%s' "\\t" ;;
            *)
                printf -v code '%d' "'$char"
                if [[ "$code" -lt 0 ]]; then
                    code=$((code + 256))
                fi
                if [[ "$code" -lt 32 ]]; then
                    printf '\\u%04x' "$code"
                else
                    printf '%s' "$char"
                fi
                ;;
        esac
        idx=$((idx + 1))
    done
}

# Print a JSON-quoted string: "escaped_value"
json_quoted() {
    printf '"'
    json_escape "${1:-}"
    printf '"'
}

# ============================================================================
# Field Emitters (indented key-value lines for pretty JSON)
# ============================================================================

# Emit a string field:  "key": "value"<suffix>
json_string_field() {
    local indent="$1"
    local key="$2"
    local value="${3:-}"
    local suffix="${4-,}"

    printf '%s"%s": ' "$indent" "$key"
    json_quoted "$value"
    printf '%s\n' "$suffix"
}

# Emit a number field:  "key": 123<suffix>
json_number_field() {
    local indent="$1"
    local key="$2"
    local value="$3"
    local suffix="${4-,}"

    printf '%s"%s": %s%s\n' "$indent" "$key" "$value" "$suffix"
}

# Emit a boolean field:  "key": true<suffix>
json_bool_field() {
    local indent="$1"
    local key="$2"
    local value="$3"
    local suffix="${4-,}"

    printf '%s"%s": %s%s\n' "$indent" "$key" "$value" "$suffix"
}

# ============================================================================
# NDJSON Streaming Events
# ============================================================================
# Each event is a single-line JSON object written to stdout immediately.
# Tauri/CI consumers read line-by-line. Final summary is also NDJSON.

# Emit a progress event (scanning/cleaning status).
# Usage: json_emit_progress "section_name" "message" [percent]
json_emit_progress() {
    local section="${1:-}"
    local message="${2:-}"
    local percent="${3:-}"

    local line='{"type":"progress"'
    line+=","
    line+="\"section\":"
    line+="$(json_quoted "$section")"
    line+=","
    line+="\"message\":"
    line+="$(json_quoted "$message")"
    if [[ -n "$percent" ]]; then
        line+=","
        line+="\"percent\":${percent}"
    fi
    line+="}"
    printf '%s\n' "$line"
}

# Emit a single cleaned item event.
# Usage: json_emit_item "section" "description" size_kb "size_human" "status"
json_emit_item() {
    local section="${1:-}"
    local description="${2:-}"
    local size_kb="${3:-0}"
    local size_human="${4:-0B}"
    local status="${5:-cleaned}"

    local line='{"type":"item"'
    line+=","
    line+="\"section\":"
    line+="$(json_quoted "$section")"
    line+=","
    line+="\"description\":"
    line+="$(json_quoted "$description")"
    line+=","
    line+="\"size_kb\":${size_kb}"
    line+=","
    line+="\"size_human\":"
    line+="$(json_quoted "$size_human")"
    line+=","
    line+="\"status\":"
    line+="$(json_quoted "$status")"
    line+="}"
    printf '%s\n' "$line"
}

# Emit an error event.
json_emit_error() {
    local message="${1:-}"
    local code="${2:-unknown}"

    local line='{"type":"error"'
    line+=","
    line+="\"code\":"
    line+="$(json_quoted "$code")"
    line+=","
    line+="\"message\":"
    line+="$(json_quoted "$message")"
    line+="}"
    printf '%s\n' "$line"
}

# ============================================================================
# Section Tracking (for clean command)
# ============================================================================

# Begin a new section; called by start_section override when --json is active.
json_section_start() {
    local name="$1"
    JSON_SECTION_NAME="$name"
    JSON_SECTION_ITEMS=()
    json_emit_progress "$name" "Scanning..."
}

# End current section; called by end_section override.
json_section_end() {
    local status="nothing_to_clean"
    if [[ ${#JSON_SECTION_ITEMS[@]} -gt 0 ]]; then
        status="cleaned"
    fi
    # No separate section-end event needed; items already streamed.
    JSON_SECTION_NAME=""
    JSON_SECTION_ITEMS=()
}

# Record a cleaned item in the current section (called from safe_clean result branch).
# Also emits the streaming item event.
json_record_item() {
    local description="$1"
    local size_kb="$2"
    local size_human="$3"
    local status="${4:-cleaned}"

    JSON_SECTION_ITEMS+=("$description")
    JSON_ITEMS_DESC+=("$description")
    JSON_ITEMS_SIZE_KB+=("$size_kb")
    JSON_ITEMS_SIZE_HUMAN+=("$size_human")
    JSON_ITEMS_STATUS+=("$status")
    JSON_ITEMS_SECTION+=("${JSON_SECTION_NAME:-}")

    json_emit_item "${JSON_SECTION_NAME:-}" "$description" "$size_kb" "$size_human" "$status"
}

# ============================================================================
# Summary Emitter
# ============================================================================
# Called at the end of perform_cleanup when --json is active.
# Emits a single summary NDJSON event with aggregate stats.

json_emit_summary() {
    local total_size_kb="${1:-0}"
    local total_files="${2:-0}"
    local total_categories="${3:-0}"
    local free_space_kb="${4:-}"
    local whitelist_count="${5:-0}"

    local line='{"type":"summary"'
    line+=","
    line+="\"command\":"
    line+="$(json_quoted "${JSON_COMMAND:-clean}")"
    line+=","
    line+="\"dry_run\":${JSON_DRY_RUN}"
    line+=","
    line+="\"total_size_kb\":${total_size_kb}"
    line+=","
    line+="\"total_files\":${total_files}"
    line+=","
    line+="\"total_categories\":${total_categories}"
    if [[ -n "$free_space_kb" ]]; then
        line+=","
        line+="\"free_space_kb\":${free_space_kb}"
    fi
    if [[ "$whitelist_count" -gt 0 ]]; then
        line+=","
        line+="\"whitelist_patterns\":${whitelist_count}"
    fi
    line+=","
    line+="\"timestamp\":"
    line+="$(json_quoted "$(date -u +"%Y-%m-%dT%H:%M:%SZ")")"
    line+="}"
    printf '%s\n' "$line"
}

# ============================================================================
# JSON Document Mode (single-shot, for commands that return one JSON blob)
# ============================================================================
# Used by uninstall --json (scan phase), purge --json, optimize --json.

json_doc_start() {
    printf '{\n'
}

json_doc_end() {
    printf '}\n'
}

json_doc_array_start() {
    local indent="${1:-  }"
    local key="$2"
    printf '%s"%s": [\n' "$indent" "$key"
}

json_doc_array_end() {
    local indent="${1:-  }"
    printf '%s]\n' "$indent"
}

# Emit a complete JSON document for a list of apps (uninstall scan phase).
# Usage: json_emit_app_list <app_name> <app_path> <bundle_id> <size_kb> <is_running> ...
json_emit_app() {
    local indent="$1"
    local name="$2"
    local path="$3"
    local bundle_id="$4"
    local size_kb="$5"
    local is_running="$6"
    local has_brew="$7"
    local is_blocked="$8"
    local suffix="${9-,}"

    printf '%s{\n' "$indent"
    json_string_field "${indent}  " "name" "$name"
    json_string_field "${indent}  " "path" "$path"
    json_string_field "${indent}  " "bundle_id" "$bundle_id"
    json_number_field "${indent}  " "size_kb" "$size_kb"
    json_bool_field "${indent}  " "is_running" "$is_running"
    json_bool_field "${indent}  " "has_brew_cask" "$has_brew"
    json_bool_field "${indent}  " "is_blocked" "$is_blocked" ""
    printf '%s}%s\n' "$indent" "$suffix"
}

# Emit a complete JSON document for a project with artifacts (purge).
json_emit_project() {
    local indent="$1"
    local name="$2"
    local path="$3"
    local total_size_kb="$4"
    local suffix="${5-,}"

    printf '%s{\n' "$indent"
    json_string_field "${indent}  " "name" "$name"
    json_string_field "${indent}  " "path" "$path"
    json_number_field "${indent}  " "total_size_kb" "$total_size_kb"
    printf '%s  "artifacts": []\n' "$indent"
    printf '%s}%s\n' "$indent" "$suffix"
}

# ============================================================================
# Reset State
# ============================================================================

json_reset() {
    JSON_ITEMS_DESC=()
    JSON_ITEMS_SIZE_KB=()
    JSON_ITEMS_SIZE_HUMAN=()
    JSON_ITEMS_COUNT=()
    JSON_ITEMS_STATUS=()
    JSON_ITEMS_SECTION=()
    JSON_SECTION_NAME=""
    JSON_SECTION_ITEMS=()
    JSON_SECTIONS=()
    JSON_TOTAL_SIZE_KB=0
    JSON_TOTAL_ITEMS=0
    JSON_TOTAL_FILES=0
    JSON_DRY_RUN=false
    JSON_COMMAND=""
}
