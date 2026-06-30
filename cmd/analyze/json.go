//go:build darwin

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// jsonStdoutMu serialises NDJSON writes to stdout so that progress-ticker
// goroutines and the main emission goroutine never interleave lines.
var jsonStdoutMu sync.Mutex

type jsonOutput struct {
	Path       string          `json:"path"`
	Overview   bool            `json:"overview"`
	Entries    []jsonEntry     `json:"entries"`
	LargeFiles []jsonFileEntry `json:"large_files,omitempty"`
	TotalSize  int64           `json:"total_size"`
	TotalFiles int64           `json:"total_files,omitempty"`
}

type jsonEntry struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Size       int64  `json:"size"`
	IsDir      bool   `json:"is_dir"`
	Insight    bool   `json:"insight,omitempty"`
	Cleanable  bool   `json:"cleanable,omitempty"`
	LastAccess string `json:"last_access,omitempty"`
}

type jsonFileEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Size int64  `json:"size"`
}

func runJSONMode(path string, isOverview bool) {
	// Emit initial progress event.
	scanMsg := fmt.Sprintf("Scanning %s...", path)
	if isOverview {
		scanMsg = "Scanning system overview..."
	}
	emitJSONEvent(map[string]any{
		"type":    "progress",
		"message": scanMsg,
	})

	if isOverview {
		runOverviewJSONStream(path)
	} else {
		runDirectoryJSONStream(path)
	}
}

// runDirectoryJSONStream scans a directory and streams entries as NDJSON events.
// Entries are emitted as soon as each child is measured, so the frontend
// can display progress incrementally instead of waiting for the full scan.
// Event sequence: progress (periodic) → entry* (streamed) → large_file* → summary
func runDirectoryJSONStream(path string) {
	var filesScanned, dirsScanned, bytesScanned int64
	currentPath := &atomic.Value{}
	currentPath.Store("")

	// Emit periodic progress events while the scan runs.
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				cp, _ := currentPath.Load().(string)
				bs := atomic.LoadInt64(&bytesScanned)
				emitJSONScanProgress(cp, bs)
			case <-done:
				return
			}
		}
	}()

	// Stream entries as they are discovered during scanning.
	result, err := scanPathConcurrentAllEntries(path, &filesScanned, &dirsScanned, &bytesScanned, currentPath, func(e dirEntry) {
		entry := jsonEntriesFromDirEntries([]dirEntry{e}, false, nil)
		if len(entry) > 0 {
			emitJSONEntryEvent(entry[0])
		}
	})
	close(done)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to scan directory: %v\n", err)
		os.Exit(1)
	}

	// Entries already streamed during scan; skip re-emission.
	// Only emit large files and summary.
	largeFiles := jsonFileEntriesFromFileEntries(result.LargeFiles)
	for _, file := range largeFiles {
		emitJSONLargeFileEvent(file)
	}

	emitJSONEvent(map[string]any{
		"type":        "summary",
		"path":        path,
		"overview":    false,
		"total_size":  result.TotalSize,
		"total_files": result.TotalFiles,
	})
}

// runOverviewJSONStream scans the system overview and streams entries as they are measured.
func runOverviewJSONStream(path string) {
	// Emit periodic progress while overview entries are measured.
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				jsonStdoutMu.Lock()
				data, _ := json.Marshal(map[string]any{
					"type":    "progress",
					"message": "Measuring directories...",
				})
				fmt.Fprintf(os.Stdout, "%s\n", data)
				jsonStdoutMu.Unlock()
			case <-done:
				return
			}
		}
	}()

	// Stream entries as each directory measurement completes.
	var emittedPaths sync.Map
	result := performOverviewScanForJSON(path, func(e jsonEntry) {
		emittedPaths.Store(e.Path, true)
		emitJSONEntryEvent(e)
	})
	close(done)

	// Emit any entries not yet streamed (e.g. zero-size filtered during measurement).
	for _, entry := range result.Entries {
		if _, emitted := emittedPaths.Load(entry.Path); !emitted {
			emitJSONEntryEvent(entry)
		}
	}

	emitJSONEvent(map[string]any{
		"type":       "summary",
		"path":       result.Path,
		"overview":   result.Overview,
		"total_size": result.TotalSize,
	})
}

// emitJSONEvent writes a single NDJSON line to stdout (thread-safe).
func emitJSONEvent(v any) {
	jsonStdoutMu.Lock()
	defer jsonStdoutMu.Unlock()
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	fmt.Fprintf(os.Stdout, "%s\n", data)
}

// emitJSONScanProgress emits a progress event showing the current scan position.
func emitJSONScanProgress(currentPath string, bytesScanned int64) {
	msg := "Scanning..."
	if currentPath != "" {
		msg = fmt.Sprintf("Scanning %s (%s scanned)...", currentPath, formatSize(bytesScanned))
	} else if bytesScanned > 0 {
		msg = fmt.Sprintf("Scanning... (%s scanned)", formatSize(bytesScanned))
	}
	jsonStdoutMu.Lock()
	data, _ := json.Marshal(map[string]any{
		"type":    "progress",
		"message": msg,
	})
	fmt.Fprintf(os.Stdout, "%s\n", data)
	jsonStdoutMu.Unlock()
}

// formatSize returns a human-readable byte size string.
func formatSize(bytes int64) string {
	const (
		KB = 1024
		MB = KB * 1024
		GB = MB * 1024
		TB = GB * 1024
	)
	switch {
	case bytes >= TB:
		return fmt.Sprintf("%.1f TB", float64(bytes)/float64(TB))
	case bytes >= GB:
		return fmt.Sprintf("%.1f GB", float64(bytes)/float64(GB))
	case bytes >= MB:
		return fmt.Sprintf("%.1f MB", float64(bytes)/float64(MB))
	case bytes >= KB:
		return fmt.Sprintf("%.1f KB", float64(bytes)/float64(KB))
	default:
		return fmt.Sprintf("%d B", bytes)
	}
}

// emitJSONEntryEvent emits a single entry as an NDJSON event.
func emitJSONEntryEvent(entry jsonEntry) {
	event := map[string]any{
		"type":      "entry",
		"name":      entry.Name,
		"path":      entry.Path,
		"size":      entry.Size,
		"is_dir":    entry.IsDir,
		"cleanable": entry.Cleanable,
	}
	if entry.Insight {
		event["insight"] = true
	}
	if entry.LastAccess != "" {
		event["last_access"] = entry.LastAccess
	}
	emitJSONEvent(event)
}

// emitJSONLargeFileEvent emits a single large file as an NDJSON event.
func emitJSONLargeFileEvent(file jsonFileEntry) {
	emitJSONEvent(map[string]any{
		"type": "large_file",
		"name": file.Name,
		"path": file.Path,
		"size": file.Size,
	})
}

func performScanForJSON(path string, isOverview bool) jsonOutput {
	if isOverview {
		return performOverviewScanForJSON(path, nil)
	}
	return performDirectoryScanForJSON(path)
}

func performDirectoryScanForJSON(path string) jsonOutput {
	var filesScanned, dirsScanned, bytesScanned int64
	currentPath := &atomic.Value{}
	currentPath.Store("")

	result, err := scanPathConcurrentAllEntries(path, &filesScanned, &dirsScanned, &bytesScanned, currentPath, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to scan directory: %v\n", err)
		os.Exit(1)
	}

	return jsonOutput{
		Path:       path,
		Overview:   false,
		Entries:    jsonEntriesFromDirEntries(result.Entries, false, nil),
		LargeFiles: jsonFileEntriesFromFileEntries(result.LargeFiles),
		TotalSize:  result.TotalSize,
		TotalFiles: result.TotalFiles,
	}
}

func performOverviewScanForJSON(path string, onEntry func(jsonEntry)) jsonOutput {
	insightEntries := createInsightEntries()
	overviewEntries := createOverviewEntriesWithInsights(insightEntries)
	insightPaths := make(map[string]bool, len(insightEntries))
	for _, insight := range insightEntries {
		insightPaths[insight.Path] = true
	}

	var totalSize int64
	entries := make([]dirEntry, 0, len(overviewEntries))
	for _, entry := range measureOverviewEntriesForJSON(overviewEntries, insightPaths, onEntry) {
		// Match the TUI: omit scanned insight/tool entries that ended up empty.
		if entry.Size == 0 {
			continue
		}
		totalSize += entry.Size
		entries = append(entries, entry)
	}

	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].Size > entries[j].Size
	})

	return jsonOutput{
		Path:      path,
		Overview:  true,
		Entries:   jsonEntriesFromDirEntries(entries, true, insightPaths),
		TotalSize: totalSize,
	}
}

func measureOverviewEntriesForJSON(overviewEntries []dirEntry, insightPaths map[string]bool, onEntry func(jsonEntry)) []dirEntry {
	if len(overviewEntries) == 0 {
		return nil
	}

	type measurement struct {
		index int
		entry dirEntry
	}

	measured := make([]dirEntry, len(overviewEntries))
	sem := make(chan struct{}, maxConcurrentOverview)
	results := make(chan measurement, len(overviewEntries))

	var wg sync.WaitGroup
	for index, item := range overviewEntries {
		wg.Go(func() {
			sem <- struct{}{}
			defer func() { <-sem }()

			var (
				size int64
				err  error
			)

			if cached, cacheErr := loadOverviewCachedSize(item.Path); cacheErr == nil && cached > 0 {
				size = cached
			} else if insightPaths[item.Path] {
				size, err = measureInsightSize(item.Path)
			} else {
				size, err = measureOverviewSize(item.Path)
			}

			if err == nil {
				item.Size = size
			}
			// Stream entry as soon as it is measured.
			if onEntry != nil && item.Size > 0 {
				je := jsonEntriesFromDirEntries([]dirEntry{item}, true, insightPaths)
				if len(je) > 0 {
					onEntry(je[0])
				}
			}
			results <- measurement{index: index, entry: item}
		})
	}

	wg.Wait()
	close(results)

	for result := range results {
		measured[result.index] = result.entry
	}
	return measured
}

func jsonEntriesFromDirEntries(entries []dirEntry, isOverview bool, insightPaths map[string]bool) []jsonEntry {
	output := make([]jsonEntry, 0, len(entries))
	for _, entry := range entries {
		item := jsonEntry{
			Name:      entry.Name,
			Path:      entry.Path,
			Size:      entry.Size,
			IsDir:     entry.IsDir,
			Cleanable: entry.IsDir && isCleanableDir(entry.Path),
		}

		if isOverview {
			item.Insight = insightPaths[entry.Path]
		}

		if !entry.LastAccess.IsZero() {
			item.LastAccess = entry.LastAccess.UTC().Format(time.RFC3339)
		}

		output = append(output, item)
	}
	return output
}

func jsonFileEntriesFromFileEntries(files []fileEntry) []jsonFileEntry {
	output := make([]jsonFileEntry, 0, len(files))
	for _, f := range files {
		output = append(output, jsonFileEntry(f))
	}
	return output
}
