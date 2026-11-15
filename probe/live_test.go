package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// Explicit opt-in: unlike unit tests, this test posts to the real web API.
func TestLiveAPI(t *testing.T) {
	baseURL := os.Getenv("POLO_LIVE_API_URL")
	if baseURL == "" {
		t.Skip("POLO_LIVE_API_URL is unset; live API writes are disabled")
	}
	if err := validateURL(baseURL); err != nil {
		t.Fatal(err)
	}
	s := testService(strings.TrimRight(baseURL, "/"))
	s.apiClient.Timeout = 10 * time.Second
	s.targetClient.Timeout = 10 * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	before, err := s.fetchMonitors(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(before) == 0 {
		t.Fatal("live verification requires at least one existing monitor")
	}
	started := time.Now().UTC()
	s.runChecks(ctx)
	server := httptest.NewServer(s.handler())
	defer server.Close()
	for _, path := range []string{"/health", "/metrics"} {
		resp, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil || resp.StatusCode != 200 {
			t.Fatalf("%s: HTTP %d, error %v", path, resp.StatusCode, err)
		}
		if path == "/health" && string(body) != "ok\n" {
			t.Fatalf("unexpected health response %q", body)
		}
		if path == "/metrics" {
			for _, expected := range []string{"polo_scan_success 1\n", "polo_result_post_failures_total 0\n", "polo_target_up{", "polo_target_latency_ms{"} {
				if !strings.Contains(string(body), expected) {
					t.Fatalf("missing live metric %q", expected)
				}
			}
		}
		t.Logf("%s: HTTP %d", path, resp.StatusCode)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.baseURL+"/api/monitors", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := s.apiClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer closeBody(resp)
	var stored []struct {
		ID          string    `json:"id"`
		Status      string    `json:"status"`
		LastChecked time.Time `json:"lastChecked"`
	}
	if resp.StatusCode != 200 {
		t.Fatalf("read stored results: HTTP %d", resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(&stored); err != nil {
		t.Fatal(err)
	}
	updated := make(map[string]bool)
	for _, monitor := range stored {
		if monitor.LastChecked.Before(started) {
			t.Fatalf("monitor %s has a stale check timestamp", monitor.ID)
		}
		updated[monitor.ID] = true
		t.Logf("monitor=%s status=%s stored_at=%s", monitor.ID, monitor.Status, monitor.LastChecked.Format(time.RFC3339Nano))
	}
	for _, monitor := range before {
		if !updated[monitor.ID] {
			t.Fatalf("monitor %s result missing", monitor.ID)
		}
	}
}
