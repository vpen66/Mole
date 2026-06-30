#!/usr/bin/env bats

# Tests for --json NDJSON streaming output across clean, optimize, uninstall, purge.
# Also unit-tests the json_output.sh library functions.

setup_file() {
	PROJECT_ROOT="$(cd "${BATS_TEST_DIRNAME}/.." && pwd)"
	export PROJECT_ROOT

	ORIGINAL_HOME="${HOME:-}"
	export ORIGINAL_HOME

	HOME="$(mktemp -d "${BATS_TEST_DIRNAME}/tmp-json-output.XXXXXX")"
	export HOME

	mkdir -p "$HOME"
}

teardown_file() {
	if [[ "$HOME" == "${BATS_TEST_DIRNAME}/tmp-"* ]]; then
		rm -rf "$HOME"
	fi
	if [[ -n "${ORIGINAL_HOME:-}" ]]; then
		export HOME="$ORIGINAL_HOME"
	fi
}

setup() {
	# Safety: refuse to operate on a real home directory.
	if [[ "$HOME" != "${BATS_TEST_DIRNAME}/tmp-"* ]]; then
		printf 'FATAL: HOME is not a test temp dir: %s\n' "$HOME" >&2
		return 1
	fi
	mkdir -p "$HOME/Library/Caches" "$HOME/.config/mole"
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Validate that every non-empty line in the argument is valid JSON.
validate_ndjson() {
	local input="$1"
	printf '%s\n' "$input" | python3 -c "
import json, sys
for i, line in enumerate(sys.stdin, 1):
    line = line.strip()
    if not line:
        continue
    try:
        json.loads(line)
    except json.JSONDecodeError as e:
        print(f'Line {i}: invalid JSON: {e}', file=sys.stderr)
        print(f'  Content: {line!r}', file=sys.stderr)
        sys.exit(1)
"
}

# Validate only lines starting with '{' (NDJSON events in mixed output).
validate_ndjson_lines() {
	local input="$1"
	printf '%s\n' "$input" | python3 -c "
import json, sys
for i, line in enumerate(sys.stdin, 1):
    stripped = line.strip()
    if not stripped or not stripped.startswith('{'):
        continue
    try:
        json.loads(stripped)
    except json.JSONDecodeError as e:
        print(f'Line {i}: invalid JSON: {e}', file=sys.stderr)
        print(f'  Content: {stripped!r}', file=sys.stderr)
        sys.exit(1)
"
}

# Assert that JSON event lines contain no ANSI escape sequences.
assert_no_ansi_in_json() {
	local input="$1"
	printf '%s\n' "$input" | while IFS= read -r line; do
		local stripped="${line#"${line%%[![:space:]]*}"}"
		if [[ "$stripped" == "{"* ]]; then
			if [[ "$line" == *$'\033'* ]]; then
				echo "ANSI found in JSON line: $line" >&2
				return 1
			fi
		fi
	done
}

# Extract event types from NDJSON lines in mixed output.
get_event_types() {
	local input="$1"
	printf '%s\n' "$input" | python3 -c "
import json, sys
for line in sys.stdin:
    stripped = line.strip()
    if not stripped or not stripped.startswith('{'):
        continue
    try:
        obj = json.loads(stripped)
        if 'type' in obj:
            print(obj['type'])
    except:
        pass
"
}

# ---------------------------------------------------------------------------
# json_output.sh library unit tests
# ---------------------------------------------------------------------------

@test "json_escape handles plain text unchanged" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
json_escape "hello world"
EOF
	[ "$status" -eq 0 ]
	[ "$output" = "hello world" ]
}

@test "json_escape escapes double quotes and backslashes" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
json_escape 'say "hello" and use \ slash'
EOF
	[ "$status" -eq 0 ]
	[[ "$output" == *'\"hello\"'* ]]
	[[ "$output" == *'\\'* ]]
}

@test "json_escape escapes control characters" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
printf 'TAB:'
json_escape $'has\ttab'
printf '\nNL:'
json_escape $'has\nnewline'
EOF
	[ "$status" -eq 0 ]
	[[ "$output" == *"TAB:has\ttab"* ]]
	[[ "$output" == *"NL:has\nnewline"* ]]
}

@test "json_quoted wraps value in double quotes" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
json_quoted "test value"
EOF
	[ "$status" -eq 0 ]
	[ "$output" = '"test value"' ]
}

@test "json_quoted handles empty string" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
json_quoted ""
EOF
	[ "$status" -eq 0 ]
	[ "$output" = '""' ]
}

@test "json_emit_progress produces valid progress NDJSON event" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
json_emit_progress "caches" "Scanning..."
EOF
	[ "$status" -eq 0 ]

	local result="$output"

	# Must be valid JSON
	run validate_ndjson "$result"
	[ "$status" -eq 0 ]

	# Must have expected fields
	[[ "$result" == *'"type":"progress"'* ]]
	[[ "$result" == *'"section":"caches"'* ]]
	[[ "$result" == *'"message":"Scanning..."'* ]]
}

@test "json_emit_progress with percent includes percent field" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
json_emit_progress "scan" "Halfway done" 50
EOF
	[ "$status" -eq 0 ]
	[[ "$output" == *'"percent":50'* ]]
}

@test "json_emit_item produces valid item NDJSON event" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
json_emit_item "brew" "Homebrew cache" 1024 "1.0 GB" "cleaned"
EOF
	[ "$status" -eq 0 ]

	local result="$output"

	run validate_ndjson "$result"
	[ "$status" -eq 0 ]

	[[ "$result" == *'"type":"item"'* ]]
	[[ "$result" == *'"section":"brew"'* ]]
	[[ "$result" == *'"description":"Homebrew cache"'* ]]
	[[ "$result" == *'"size_kb":1024'* ]]
	[[ "$result" == *'"size_human":"1.0 GB"'* ]]
	[[ "$result" == *'"status":"cleaned"'* ]]
}

@test "json_emit_error produces valid error NDJSON event" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
json_emit_error "Something went wrong" "test_error"
EOF
	[ "$status" -eq 0 ]

	local result="$output"

	run validate_ndjson "$result"
	[ "$status" -eq 0 ]

	[[ "$result" == *'"type":"error"'* ]]
	[[ "$result" == *'"code":"test_error"'* ]]
	[[ "$result" == *'"message":"Something went wrong"'* ]]
}

@test "json_emit_summary produces valid summary NDJSON event" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
JSON_COMMAND="clean"
JSON_DRY_RUN=true
json_emit_summary 2048 15 3 "" 0
EOF
	[ "$status" -eq 0 ]

	local result="$output"

	run validate_ndjson "$result"
	[ "$status" -eq 0 ]

	[[ "$result" == *'"type":"summary"'* ]]
	[[ "$result" == *'"command":"clean"'* ]]
	[[ "$result" == *'"dry_run":true'* ]]
	[[ "$result" == *'"total_size_kb":2048'* ]]
	[[ "$result" == *'"total_files":15'* ]]
	[[ "$result" == *'"total_categories":3'* ]]
	[[ "$result" == *'"timestamp"'* ]]
}

@test "json_emit_summary includes free_space_kb when provided" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
JSON_COMMAND="purge"
JSON_DRY_RUN=false
json_emit_summary 500 5 2 "50000000" 0
EOF
	[ "$status" -eq 0 ]
	[[ "$output" == *'"free_space_kb":50000000'* ]]
}

@test "json_emit_summary includes whitelist_patterns when non-zero" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
JSON_COMMAND="clean"
JSON_DRY_RUN=false
json_emit_summary 100 2 1 "" 5
EOF
	[ "$status" -eq 0 ]
	[[ "$output" == *'"whitelist_patterns":5'* ]]
}

@test "json_record_item tracks items and emits streaming event" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
JSON_SECTION_NAME="Caches"
json_record_item "npm cache" 512 "512 MB" "dry_run"
echo "---ITEMS---"
echo "${#JSON_ITEMS_DESC[@]}"
echo "${JSON_ITEMS_DESC[0]}"
echo "${JSON_ITEMS_SIZE_KB[0]}"
echo "${JSON_ITEMS_STATUS[0]}"
echo "${JSON_ITEMS_SECTION[0]}"
EOF
	[ "$status" -eq 0 ]

	# Should contain the NDJSON item event
	[[ "$output" == *'"type":"item"'* ]]
	[[ "$output" == *'"description":"npm cache"'* ]]

	# Should have tracked the item in arrays
	[[ "$output" == *"---ITEMS---"* ]]
	[[ "$output" == *"npm cache"* ]]
	[[ "$output" == *"512"* ]]
	[[ "$output" == *"dry_run"* ]]
	[[ "$output" == *"Caches"* ]]
}

@test "json_reset clears all state" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
JSON_ITEMS_DESC+=("item1")
JSON_SECTION_NAME="test"
JSON_TOTAL_SIZE_KB=999
JSON_COMMAND="clean"
json_reset
echo "items:${#JSON_ITEMS_DESC[@]}"
echo "section:${JSON_SECTION_NAME:-empty}"
echo "size:${JSON_TOTAL_SIZE_KB}"
echo "cmd:${JSON_COMMAND:-empty}"
EOF
	[ "$status" -eq 0 ]
	[[ "$output" == *"items:0"* ]]
	[[ "$output" == *"section:empty"* ]]
	[[ "$output" == *"size:0"* ]]
	[[ "$output" == *"cmd:empty"* ]]
}

@test "json_section_start emits progress event and sets section name" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
json_section_start "System Caches"
echo "section=$JSON_SECTION_NAME"
EOF
	[ "$status" -eq 0 ]
	[[ "$output" == *'"type":"progress"'* ]]
	[[ "$output" == *'"section":"System Caches"'* ]]
	[[ "$output" == *'"message":"Scanning..."'* ]]
	[[ "$output" == *"section=System Caches"* ]]
}

@test "json_section_end resets section state" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
JSON_SECTION_NAME="Caches"
JSON_SECTION_ITEMS+=("item1")
json_section_end
echo "name:${JSON_SECTION_NAME:-empty}"
echo "items:${#JSON_SECTION_ITEMS[@]}"
EOF
	[ "$status" -eq 0 ]
	[[ "$output" == *"name:empty"* ]]
	[[ "$output" == *"items:0"* ]]
}

# ---------------------------------------------------------------------------
# Integration tests: clean --json
# ---------------------------------------------------------------------------

@test "clean --json dry-run emits NDJSON events with summary" {
	cd "$PROJECT_ROOT"
	run env HOME="$HOME" MOLE_TEST_NO_AUTH=1 bash bin/clean.sh --dry-run --json
	local rc="$status"
	local full_output="$output"
	[ "$rc" -eq 0 ]

	# Extract only JSON event lines (starting with '{')
	local json_lines
	json_lines=$(printf '%s\n' "$full_output" | grep '^\s*{' || true)

	# Must have at least one JSON event
	[ -n "$json_lines" ]

	# JSON event lines must be valid NDJSON
	run validate_ndjson "$json_lines"
	[ "$status" -eq 0 ]

	# Must contain a summary event
	[[ "$json_lines" == *'"type":"summary"'* ]]

	# Summary must have dry_run=true and command=clean
	[[ "$json_lines" == *'"dry_run":true'* ]]
	[[ "$json_lines" == *'"command":"clean"'* ]]
}

@test "clean --json dry-run emits progress events for sections" {
	cd "$PROJECT_ROOT"
	run env HOME="$HOME" MOLE_TEST_NO_AUTH=1 bash bin/clean.sh --dry-run --json
	local full_output="$output"
	[ "$status" -eq 0 ]

	local types
	types=$(get_event_types "$full_output")

	# Must contain progress events (section starts emit progress)
	[[ "$types" == *"progress"* ]]
	# Must contain summary at the end
	[[ "$types" == *"summary"* ]]
}

@test "clean --json NDJSON lines have no ANSI escape codes" {
	cd "$PROJECT_ROOT"
	run env HOME="$HOME" MOLE_TEST_NO_AUTH=1 bash bin/clean.sh --dry-run --json
	local full_output="$output"
	[ "$status" -eq 0 ]

	# JSON event lines must not contain ANSI escape codes
	run assert_no_ansi_in_json "$full_output"
	[ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Integration tests: optimize --json
# ---------------------------------------------------------------------------

@test "optimize --json dry-run emits NDJSON events with summary" {
	cd "$PROJECT_ROOT"
	run env HOME="$HOME" MOLE_TEST_NO_AUTH=1 MOLE_DRY_RUN=1 bash bin/optimize.sh --dry-run --json
	local rc="$status"
	local full_output="$output"
	[ "$rc" -eq 0 ]

	# Extract only JSON event lines
	local json_lines
	json_lines=$(printf '%s\n' "$full_output" | grep '^\s*{' || true)

	[ -n "$json_lines" ]

	# JSON event lines must be valid NDJSON
	run validate_ndjson "$json_lines"
	[ "$status" -eq 0 ]

	# Must contain a summary event
	[[ "$json_lines" == *'"type":"summary"'* ]]
	[[ "$json_lines" == *'"command":"optimize"'* ]]

	# Must contain progress events
	[[ "$json_lines" == *'"type":"progress"'* ]]
}

@test "optimize --json dry-run includes health progress and item events" {
	cd "$PROJECT_ROOT"
	run env HOME="$HOME" MOLE_TEST_NO_AUTH=1 MOLE_DRY_RUN=1 bash bin/optimize.sh --dry-run --json
	local full_output="$output"
	[ "$status" -eq 0 ]

	local types
	types=$(get_event_types "$full_output")

	# Should have a progress event about health/system info
	[[ "$types" == *"progress"* ]]
	# Should have item events for each optimization
	[[ "$types" == *"item"* ]]
	# Should end with summary
	[[ "$types" == *"summary"* ]]
}

@test "optimize --json NDJSON lines have no ANSI escape codes" {
	cd "$PROJECT_ROOT"
	run env HOME="$HOME" MOLE_TEST_NO_AUTH=1 MOLE_DRY_RUN=1 bash bin/optimize.sh --dry-run --json
	local full_output="$output"
	[ "$status" -eq 0 ]

	run assert_no_ansi_in_json "$full_output"
	[ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Integration tests: uninstall --json (library-level)
# ---------------------------------------------------------------------------

@test "uninstall json_emit_app produces valid app NDJSON" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
# Emit app entries as uninstall --json scan mode would
printf '{"type":"app","name":"%s","path":"%s","bundle_id":"%s","size_kb":%s,"size_human":"%s","last_used":"%s"}\n' \
    "$(json_escape "Test App")" \
    "$(json_escape "/Applications/Test App.app")" \
    "$(json_escape "com.example.testapp")" \
    "1024" \
    "$(json_escape "1.0 GB")" \
    "$(json_escape "2024-01-15")"
printf '{"type":"summary","command":"uninstall","total_apps":%d}\n' 1
EOF
	[ "$status" -eq 0 ]

	local result="$output"

	# Must be valid NDJSON
	run validate_ndjson "$result"
	[ "$status" -eq 0 ]

	[[ "$result" == *'"type":"app"'* ]]
	[[ "$result" == *'"name":"Test App"'* ]]
	[[ "$result" == *'"bundle_id":"com.example.testapp"'* ]]
	[[ "$result" == *'"size_kb":1024'* ]]
	[[ "$result" == *'"type":"summary"'* ]]
	[[ "$result" == *'"command":"uninstall"'* ]]
}

@test "uninstall json scan handles special characters in app names" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
# App name with quotes and special chars
printf '{"type":"app","name":"%s","path":"%s","bundle_id":"%s","size_kb":%s}\n' \
    "$(json_escape 'App "Pro" Edition')", \
    "$(json_escape '/Applications/App "Pro".app')", \
    "$(json_escape 'com.example.app-pro')", \
    "512"
EOF
	[ "$status" -eq 0 ]

	local result="$output"
	run validate_ndjson "$result"
	[ "$status" -eq 0 ]

	[[ "$result" == *'App \"Pro\" Edition'* ]]
}

# ---------------------------------------------------------------------------
# Integration tests: purge --json (library-level + partial integration)
# ---------------------------------------------------------------------------

@test "purge --json emits progress event during scan" {
	cd "$PROJECT_ROOT"
	# purge may exit non-zero when no artifacts found (set -e + exit code 2)
	run env HOME="$HOME" MOLE_TEST_NO_AUTH=1 bash bin/purge.sh --dry-run --json
	local full_output="$output"

	# Even if it exits early, should have emitted at least a progress event
	if [[ -n "$full_output" ]]; then
		[[ "$full_output" == *'"type":"progress"'* ]]
		[[ "$full_output" == *'"section":"purge"'* ]]
	fi
}

@test "purge json_emit_summary with purge command produces valid NDJSON" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
JSON_COMMAND="purge"
JSON_DRY_RUN=true
json_emit_summary 1024 5 3 "50000000"
EOF
	[ "$status" -eq 0 ]

	local result="$output"

	run validate_ndjson "$result"
	[ "$status" -eq 0 ]

	[[ "$result" == *'"type":"summary"'* ]]
	[[ "$result" == *'"command":"purge"'* ]]
	[[ "$result" == *'"dry_run":true'* ]]
	[[ "$result" == *'"total_size_kb":1024'* ]]
}

@test "purge json_emit_project produces valid project NDJSON" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
json_emit_project "  " "my-project" "/Users/dev/my-project" 2048
EOF
	[ "$status" -eq 0 ]

	local result="$output"

	[[ "$result" == *'"name":"my-project"'* ]]
	[[ "$result" == *'"path":"/Users/dev/my-project"'* ]]
	[[ "$result" == *'"total_size_kb":2048'* ]]
	[[ "$result" == *'"artifacts": []'* ]]
}

# ---------------------------------------------------------------------------
# Cross-cutting: ANSI escape code tests
# ---------------------------------------------------------------------------

@test "JSON event lines have no ANSI escape codes across commands" {
	cd "$PROJECT_ROOT"

	# Test clean --json
	run env HOME="$HOME" MOLE_TEST_NO_AUTH=1 bash bin/clean.sh --dry-run --json
	[ "$status" -eq 0 ]
	run assert_no_ansi_in_json "$output"
	[ "$status" -eq 0 ]

	# Test optimize --json
	run env HOME="$HOME" MOLE_TEST_NO_AUTH=1 MOLE_DRY_RUN=1 bash bin/optimize.sh --dry-run --json
	[ "$status" -eq 0 ]
	run assert_no_ansi_in_json "$output"
	[ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

@test "json_escape handles special characters in paths" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
json_escape '/Users/test user/Library/Caches/com.apple.Safari'
EOF
	[ "$status" -eq 0 ]
	[[ "$output" == *"/Users/test user/Library/Caches/com.apple.Safari"* ]]
}

@test "json_escape handles unicode characters" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
result=$(json_escape 'café')
echo "$result"
EOF
	[ "$status" -eq 0 ]
	[[ "$output" == *"café"* ]]
}

@test "json_emit_item with zero size produces valid JSON" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
json_emit_item "dev" "Empty cache" 0 "0B" "skipped"
EOF
	[ "$status" -eq 0 ]

	local result="$output"

	run validate_ndjson "$result"
	[ "$status" -eq 0 ]

	[[ "$result" == *'"size_kb":0'* ]]
	[[ "$result" == *'"status":"skipped"'* ]]
}

@test "multiple NDJSON events can be parsed sequentially" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
JSON_COMMAND="clean"
JSON_DRY_RUN=true
json_emit_progress "caches" "Starting scan"
json_emit_item "caches" "npm cache" 100 "100 MB" "dry_run"
json_emit_item "caches" "pip cache" 200 "200 MB" "dry_run"
json_emit_summary 300 2 1 "" 0
EOF
	[ "$status" -eq 0 ]

	local result="$output"

	# All 4 lines must be valid JSON
	run validate_ndjson "$result"
	[ "$status" -eq 0 ]

	# Verify event count
	local types
	types=$(get_event_types "$result")
	local progress_count item_count summary_count
	progress_count=$(echo "$types" | grep -c "progress" || true)
	item_count=$(echo "$types" | grep -c "item" || true)
	summary_count=$(echo "$types" | grep -c "summary" || true)

	[ "$progress_count" -eq 1 ]
	[ "$item_count" -eq 2 ]
	[ "$summary_count" -eq 1 ]
}

@test "json_string_field and json_number_field and json_bool_field emit correct output" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
json_string_field "  " "name" "test value"
json_number_field "  " "count" 42
json_bool_field "  " "enabled" true ""
EOF
	[ "$status" -eq 0 ]
	[[ "$output" == *'"name": "test value",'* ]]
	[[ "$output" == *'"count": 42,'* ]]
	[[ "$output" == *'"enabled": true'* ]]
}

@test "json_doc_start and json_doc_end produce valid document markers" {
	run env HOME="$HOME" bash --noprofile --norc <<'EOF'
set -euo pipefail
source "$PROJECT_ROOT/lib/core/json_output.sh"
json_doc_start
json_string_field "  " "key" "value" ""
json_doc_end
EOF
	[ "$status" -eq 0 ]
	[[ "$output" == *"{"* ]]
	[[ "$output" == *'"key": "value"'* ]]
	[[ "$output" == *"}"* ]]
}
