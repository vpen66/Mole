//go:build darwin

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPerformScanForJSONIncludesAllEntriesAndLargeFiles(t *testing.T) {
	root := t.TempDir()

	totalFiles := maxEntries + 6
	for i := 0; i < totalFiles-1; i++ {
		path := filepath.Join(root, fmt.Sprintf("small-%02d.txt", i))
		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatalf("write small file %d: %v", i, err)
		}
	}

	hugeFile := filepath.Join(root, "huge.bin")
	if err := os.WriteFile(hugeFile, make([]byte, 2<<20), 0o644); err != nil {
		t.Fatalf("write huge file: %v", err)
	}

	result := performScanForJSON(root, false)

	if result.Overview {
		t.Fatalf("expected non-overview JSON result")
	}
	if got := len(result.Entries); got != totalFiles {
		t.Fatalf("expected %d entries, got %d", totalFiles, got)
	}
	if result.TotalFiles != int64(totalFiles) {
		t.Fatalf("expected %d total files, got %d", totalFiles, result.TotalFiles)
	}
	if len(result.LargeFiles) == 0 {
		t.Fatalf("expected large_files to include the large file")
	}

	foundHuge := false
	for _, file := range result.LargeFiles {
		if file.Name == "huge.bin" && file.Path == hugeFile {
			foundHuge = true
			break
		}
	}
	if !foundHuge {
		t.Fatalf("expected huge.bin in large_files, got %#v", result.LargeFiles)
	}
}

func TestJSONEntriesFromDirEntriesIncludesMetadata(t *testing.T) {
	oldAccess := time.Now().AddDate(0, 0, -120)

	entries := jsonEntriesFromDirEntries([]dirEntry{
		{
			Name:       "old.bin",
			Path:       "/tmp/old.bin",
			Size:       42,
			IsDir:      false,
			LastAccess: oldAccess,
		},
		{
			Name:  "node_modules",
			Path:  "/tmp/project/node_modules",
			Size:  128,
			IsDir: true,
		},
	}, false, nil)

	if entries[0].LastAccess == "" {
		t.Fatalf("expected last_access to be populated")
	}
	if entries[1].Cleanable != true {
		t.Fatalf("expected node_modules entry to be marked cleanable")
	}
}

func TestJSONEntriesFromDirEntriesMarksOverviewInsights(t *testing.T) {
	entry := dirEntry{
		Name:  "Old Downloads (90d+)",
		Path:  "/tmp/test-home/Downloads",
		Size:  256,
		IsDir: true,
	}

	entries := jsonEntriesFromDirEntries([]dirEntry{entry}, true, map[string]bool{
		entry.Path: true,
	})

	if len(entries) != 1 {
		t.Fatalf("expected one entry, got %d", len(entries))
	}
	if !entries[0].Insight {
		t.Fatalf("expected entry to be marked as insight")
	}
}

// captureStdout redirects stdout to a buffer, runs fn, then returns the captured output.
func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("create pipe: %v", err)
	}
	os.Stdout = w

	fn()

	w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, r); err != nil {
		t.Fatalf("copy stdout: %v", err)
	}
	r.Close()
	return buf.String()
}

func TestRunJSONModeEmitsNDJSONEvents(t *testing.T) {
	root := t.TempDir()

	// Create a few test files.
	for i := 0; i < 3; i++ {
		path := filepath.Join(root, fmt.Sprintf("file-%d.txt", i))
		if err := os.WriteFile(path, make([]byte, 1024), 0o644); err != nil {
			t.Fatalf("write file %d: %v", i, err)
		}
	}

	output := captureStdout(t, func() {
		runJSONMode(root, false)
	})

	lines := strings.Split(strings.TrimSpace(output), "\n")
	if len(lines) < 3 {
		t.Fatalf("expected at least 3 NDJSON lines (progress + entries + summary), got %d: %s", len(lines), output)
	}

	// First line should be a progress event.
	var first map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &first); err != nil {
		t.Fatalf("first line is not valid JSON: %v\n%s", err, lines[0])
	}
	if first["type"] != "progress" {
		t.Fatalf("expected first event type 'progress', got %q", first["type"])
	}

	// Last line should be a summary event.
	var last map[string]any
	if err := json.Unmarshal([]byte(lines[len(lines)-1]), &last); err != nil {
		t.Fatalf("last line is not valid JSON: %v\n%s", err, lines[len(lines)-1])
	}
	if last["type"] != "summary" {
		t.Fatalf("expected last event type 'summary', got %q", last["type"])
	}
	if last["path"] != root {
		t.Fatalf("expected summary path %q, got %q", root, last["path"])
	}

	// All intermediate lines should be entry events.
	entryCount := 0
	for _, line := range lines[1 : len(lines)-1] {
		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatalf("line is not valid JSON: %v\n%s", err, line)
		}
		if event["type"] == "entry" {
			entryCount++
			if event["path"] == nil || event["size"] == nil {
				t.Fatalf("entry event missing required fields: %s", line)
			}
		}
	}
	if entryCount == 0 {
		t.Fatalf("expected at least one entry event")
	}
}

func TestEmitJSONEntryEventFormatsCorrectly(t *testing.T) {
	output := captureStdout(t, func() {
		emitJSONEntryEvent(jsonEntry{
			Name:      "test dir",
			Path:      "/tmp/test dir",
			Size:      4096,
			IsDir:     true,
			Cleanable: true,
		})
	})

	var event map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(output)), &event); err != nil {
		t.Fatalf("not valid JSON: %v\n%s", err, output)
	}
	if event["type"] != "entry" {
		t.Fatalf("expected type 'entry', got %q", event["type"])
	}
	if event["name"] != "test dir" {
		t.Fatalf("expected name 'test dir', got %q", event["name"])
	}
	if event["is_dir"] != true {
		t.Fatalf("expected is_dir=true")
	}
	if event["cleanable"] != true {
		t.Fatalf("expected cleanable=true")
	}
}
