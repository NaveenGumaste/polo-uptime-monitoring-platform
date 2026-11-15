package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func testService(baseURL string) *service {
	return newService(config{baseURL: baseURL, listenAddr: "127.0.0.1:0", interval: 20 * time.Millisecond, timeout: time.Second, concurrency: 2})
}

func TestProbeHTTPAndTLS(t *testing.T) {
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.UserAgent() != "Polo-Probe/1.0" {
			t.Errorf("wrong User-Agent: %s", r.UserAgent())
		}
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "/ok", http.StatusFound)
			return
		}
		if r.URL.Path == "/down" {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()
	s := testService("")
	s.targetClient = target.Client() // Trust only the test server's certificate.
	for _, tc := range []struct {
		path, status string
		code         int
	}{{"/ok", "UP", 200}, {"/redirect", "UP", 200}, {"/down", "DOWN", 500}} {
		t.Run(tc.path, func(t *testing.T) {
			result, tls := s.probe(context.Background(), Monitor{ID: "m1", URL: target.URL + tc.path})
			if result.Status != tc.status || result.StatusCode != tc.code || !tls || result.SSLExpiryDays < 1 || result.CheckedAt.IsZero() || result.LatencyMs < 0 {
				t.Fatalf("unexpected result: %+v, tls=%v", result, tls)
			}
		})
	}
	s.targetClient = &http.Client{Timeout: time.Second}
	result, tls := s.probe(context.Background(), Monitor{ID: "untrusted", URL: target.URL})
	if result.Status != "DOWN" || result.StatusCode != 0 || tls {
		t.Fatalf("untrusted certificate accepted: %+v", result)
	}
}

func TestTimeoutAndInvalidURL(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer target.Close()
	s := testService("")
	s.targetClient.Timeout = 30 * time.Millisecond
	for _, raw := range []string{target.URL, "file:///tmp/test"} {
		result, tls := s.probe(context.Background(), Monitor{ID: "m", URL: raw})
		if result.Status != "DOWN" || result.StatusCode != 0 || result.CheckedAt.IsZero() || tls {
			t.Fatalf("unexpected failure result: %+v", result)
		}
	}
}

func metricsText(t *testing.T, s *service) string {
	t.Helper()
	rec := httptest.NewRecorder()
	s.handler().ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("metrics HTTP %d", rec.Code)
	}
	return rec.Body.String()
}

func TestScanConcurrencyPostingAndCleanup(t *testing.T) {
	var active, peak atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := active.Add(1)
		for old := peak.Load(); n > old && !peak.CompareAndSwap(old, n); old = peak.Load() {
		}
		defer active.Add(-1)
		time.Sleep(30 * time.Millisecond)
		w.WriteHeader(200)
	}))
	defer target.Close()
	monitors := make([]Monitor, 6)
	for i := range monitors {
		monitors[i] = Monitor{ID: fmt.Sprintf("m%d", i), URL: target.URL}
	}
	var mu sync.Mutex
	posted := make(map[string]CheckResult)
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/monitors":
			_ = json.NewEncoder(w).Encode(monitors)
		case "/api/check-result":
			if r.Method != "POST" || r.Header.Get("Content-Type") != "application/json" {
				t.Error("invalid submission request")
			}
			var result CheckResult
			if err := json.NewDecoder(r.Body).Decode(&result); err != nil {
				t.Error(err)
			}
			mu.Lock()
			posted[result.MonitorID] = result
			mu.Unlock()
			_, _ = io.WriteString(w, `{"success":true}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer api.Close()
	s := testService(api.URL)
	s.runChecks(context.Background())
	if peak.Load() != 2 {
		t.Fatalf("worker limit not respected, peak=%d", peak.Load())
	}
	mu.Lock()
	if len(posted) != 6 {
		t.Errorf("posted %d results, want 6", len(posted))
	}
	for _, result := range posted {
		if result.Status != "UP" || result.StatusCode != 200 || result.CheckedAt.IsZero() {
			t.Errorf("invalid posted result: %+v", result)
		}
	}
	mu.Unlock()
	text := metricsText(t, s)
	for _, want := range []string{`polo_target_up{monitor_id="m0"} 1`, "polo_scan_success 1", `polo_target_ssl_available{monitor_id="m0"} 0`} {
		if !strings.Contains(text, want) {
			t.Errorf("missing metric %s", want)
		}
	}
	if strings.Contains(text, `polo_target_ssl_expiry_days{`) {
		t.Error("HTTP target has an SSL expiry metric")
	}
	monitors = nil
	s.runChecks(context.Background())
	if strings.Contains(metricsText(t, s), `monitor_id="m0"`) {
		t.Error("deleted monitor metric retained")
	}
}

func TestPostFailureStillRecordsMetrics(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer target.Close()
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/monitors" {
			_ = json.NewEncoder(w).Encode([]Monitor{{ID: "failed", URL: target.URL}})
			return
		}
		w.WriteHeader(500)
	}))
	defer api.Close()
	s := testService(api.URL)
	s.runChecks(context.Background())
	text := metricsText(t, s)
	for _, want := range []string{`polo_target_up{monitor_id="failed"} 0`, "polo_result_post_failures_total 1", "polo_scan_success 0"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing metric %s", want)
		}
	}
}

func TestUnavailableTLSRemovesOldExpiry(t *testing.T) {
	s := testService("")
	result := CheckResult{MonitorID: "m", Status: "UP", SSLExpiryDays: 5}
	s.recordMetrics(result, true)
	if !strings.Contains(metricsText(t, s), `polo_target_ssl_expiry_days{monitor_id="m"} 5`) {
		t.Fatal("missing TLS expiry")
	}
	s.recordMetrics(result, false)
	if strings.Contains(metricsText(t, s), `polo_target_ssl_expiry_days{monitor_id="m"}`) {
		t.Fatal("stale TLS expiry")
	}
}

func TestLoopRepeatsAndCancels(t *testing.T) {
	var scans atomic.Int32
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { scans.Add(1); _, _ = io.WriteString(w, "[]") }))
	defer api.Close()
	s := testService(api.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 110*time.Millisecond)
	defer cancel()
	s.loop(ctx)
	if scans.Load() < 2 {
		t.Fatalf("ticker did not repeat scans: %d", scans.Load())
	}
}

func TestHealthAndPortConflict(t *testing.T) {
	s := testService("")
	rec := httptest.NewRecorder()
	s.handler().ServeHTTP(rec, httptest.NewRequest("GET", "/health", nil))
	if rec.Code != 200 || rec.Body.String() != "ok\n" {
		t.Fatal("health endpoint failed")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	c := s.cfg
	c.listenAddr = listener.Addr().String()
	if err := run(context.Background(), c); err == nil {
		t.Fatal("port conflict accepted")
	}
}

func TestConfigValidation(t *testing.T) {
	for _, key := range []string{"WEB_API_URL", "LISTEN_ADDR", "CHECK_INTERVAL", "HTTP_TIMEOUT", "MAX_CONCURRENCY"} {
		t.Setenv(key, "")
	}
	c, err := loadConfig()
	if err != nil || c.listenAddr != ":8082" || c.interval != time.Minute {
		t.Fatalf("invalid defaults: %+v %v", c, err)
	}
	for _, tc := range []struct{ key, value string }{{"WEB_API_URL", "ftp://host"}, {"HTTP_TIMEOUT", "0s"}, {"CHECK_INTERVAL", "invalid"}, {"MAX_CONCURRENCY", "0"}} {
		t.Run(tc.key, func(t *testing.T) {
			t.Setenv(tc.key, tc.value)
			if _, err := loadConfig(); err == nil {
				t.Fatal("invalid configuration accepted")
			}
		})
	}
}

func TestShutdownCancelsScanWithoutPostingOutage(t *testing.T) {
	started := make(chan struct{})
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
	}))
	defer target.Close()
	var posts atomic.Int32
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/monitors" {
			_ = json.NewEncoder(w).Encode([]Monitor{{ID: "m", URL: target.URL}})
			return
		}
		posts.Add(1)
	}))
	defer api.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- run(ctx, testService(api.URL).cfg) }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("scan did not start")
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown hung")
	}
	if posts.Load() != 0 {
		t.Fatal("shutdown posted a target outage")
	}
}

func TestFailedFetchRecoversOnNextScan(t *testing.T) {
	var requests atomic.Int32
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			w.WriteHeader(503)
			return
		}
		_, _ = io.WriteString(w, "[]")
	}))
	defer api.Close()
	s := testService(api.URL)
	s.runChecks(context.Background())
	if !strings.Contains(metricsText(t, s), "polo_scan_success 0") {
		t.Fatal("fetch failure not reflected")
	}
	s.runChecks(context.Background())
	if !strings.Contains(metricsText(t, s), "polo_scan_success 1") {
		t.Fatal("scan did not recover")
	}
}
