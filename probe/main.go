package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type Monitor struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url"`
}

type CheckResult struct {
	MonitorID     string    `json:"monitorId"`
	URL           string    `json:"url"`
	Status        string    `json:"status"`
	StatusCode    int       `json:"statusCode"`
	LatencyMs     int64     `json:"latencyMs"`
	SSLExpiryDays int       `json:"sslExpiryDays"`
	CheckedAt     time.Time `json:"checkedAt"`
}

type config struct {
	baseURL, listenAddr string
	interval, timeout   time.Duration
	concurrency         int
}

func loadConfig() (config, error) {
	c := config{baseURL: "http://localhost:3000", listenAddr: ":8082", interval: 60 * time.Second, timeout: 10 * time.Second, concurrency: 10}
	if value := os.Getenv("WEB_API_URL"); value != "" {
		c.baseURL = strings.TrimRight(value, "/")
	}
	if err := validateURL(c.baseURL); err != nil {
		return c, fmt.Errorf("WEB_API_URL: %w", err)
	}
	if value := os.Getenv("LISTEN_ADDR"); value != "" {
		c.listenAddr = value
	}
	for name, destination := range map[string]*time.Duration{"CHECK_INTERVAL": &c.interval, "HTTP_TIMEOUT": &c.timeout} {
		if value := os.Getenv(name); value != "" {
			parsed, err := time.ParseDuration(value)
			if err != nil || parsed <= 0 {
				return c, fmt.Errorf("%s must be a positive duration, such as 60s", name)
			}
			*destination = parsed
		}
	}
	if value := os.Getenv("MAX_CONCURRENCY"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 1000 {
			return c, errors.New("MAX_CONCURRENCY must be between 1 and 1000")
		}
		c.concurrency = parsed
	}
	return c, nil
}

func validateURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u == nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.Fragment != "" {
		return errors.New("expected an HTTP(S) URL without credentials or fragment")
	}
	return nil
}

type service struct {
	cfg                            config
	apiClient, targetClient        *http.Client
	registry                       *prometheus.Registry
	up, latency, ssl, sslAvailable *prometheus.GaugeVec
	postsFailed                    prometheus.Counter
	scanSuccess, lastScan          prometheus.Gauge
	known                          map[string]bool
}

func newService(c config) *service {
	registry := prometheus.NewRegistry()
	gauge := func(name, help string) *prometheus.GaugeVec {
		metric := prometheus.NewGaugeVec(prometheus.GaugeOpts{Name: name, Help: help}, []string{"monitor_id"})
		registry.MustRegister(metric)
		return metric
	}
	s := &service{
		cfg:          c,
		apiClient:    &http.Client{Timeout: c.timeout, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }},
		targetClient: &http.Client{Timeout: c.timeout},
		registry:     registry,
		up:           gauge("polo_target_up", "Target health: 1 for UP, 0 for DOWN."),
		latency:      gauge("polo_target_latency_ms", "Time to final response headers or request failure, in milliseconds."),
		ssl:          gauge("polo_target_ssl_expiry_days", "Whole days until the final connection's verified TLS certificate expires; absent when unavailable."),
		sslAvailable: gauge("polo_target_ssl_available", "Whether this check obtained a verified TLS certificate."),
		postsFailed:  prometheus.NewCounter(prometheus.CounterOpts{Name: "polo_result_post_failures_total", Help: "Failed result submissions to the web API."}),
		scanSuccess:  prometheus.NewGauge(prometheus.GaugeOpts{Name: "polo_scan_success", Help: "Whether the last scan fetched monitors and submitted every result successfully."}),
		lastScan:     prometheus.NewGauge(prometheus.GaugeOpts{Name: "polo_last_scan_timestamp_seconds", Help: "Unix timestamp of the last completed scan, including failed scans."}),
		known:        make(map[string]bool),
	}
	registry.MustRegister(s.postsFailed, s.scanSuccess, s.lastScan, collectors.NewGoCollector(), collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	return s
}

func closeBody(resp *http.Response) {
	// Drain small responses for connection reuse without downloading unbounded bodies.
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	_ = resp.Body.Close()
}

func (s *service) fetchMonitors(ctx context.Context) ([]Monitor, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.baseURL+"/api/monitors", nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.apiClient.Do(req)
	if err != nil {
		return nil, errors.New("fetch monitors: network or timeout error")
	}
	defer closeBody(resp)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch monitors: HTTP %d", resp.StatusCode)
	}
	var monitors []Monitor
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&monitors); err != nil {
		return nil, fmt.Errorf("decode monitors: %w", err)
	}
	seen := make(map[string]bool)
	for _, monitor := range monitors {
		if monitor.ID == "" || seen[monitor.ID] {
			return nil, errors.New("monitor list contains an empty or duplicate ID")
		}
		seen[monitor.ID] = true
	}
	return monitors, nil
}

func (s *service) probe(ctx context.Context, monitor Monitor) (CheckResult, bool) {
	result := CheckResult{MonitorID: monitor.ID, URL: monitor.URL, Status: "DOWN", SSLExpiryDays: -1}
	start := time.Now()
	finish := func() { result.LatencyMs = time.Since(start).Milliseconds(); result.CheckedAt = time.Now().UTC() }
	if err := validateURL(monitor.URL); err != nil {
		finish()
		return result, false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, monitor.URL, nil)
	if err != nil {
		finish()
		return result, false
	}
	req.Header.Set("User-Agent", "Polo-Probe/1.0")
	resp, err := s.targetClient.Do(req)
	finish()
	if err != nil {
		// Full URLs can contain sensitive query parameters; do not put them in logs.
		log.Printf("monitor=%s request failed (network, timeout, redirect, or TLS error)", monitor.ID)
		return result, false
	}
	defer closeBody(resp)
	result.StatusCode = resp.StatusCode
	if resp.StatusCode >= 200 && resp.StatusCode < 400 {
		result.Status = "UP"
	}
	if resp.TLS != nil && len(resp.TLS.PeerCertificates) > 0 {
		result.SSLExpiryDays = int(math.Floor(time.Until(resp.TLS.PeerCertificates[0].NotAfter).Hours() / 24))
		return result, true
	}
	return result, false
}

func (s *service) recordMetrics(result CheckResult, hasTLS bool) {
	up := 0.0
	if result.Status == "UP" {
		up = 1
	}
	s.up.WithLabelValues(result.MonitorID).Set(up)
	s.latency.WithLabelValues(result.MonitorID).Set(float64(result.LatencyMs))
	if hasTLS {
		s.sslAvailable.WithLabelValues(result.MonitorID).Set(1)
		s.ssl.WithLabelValues(result.MonitorID).Set(float64(result.SSLExpiryDays))
	} else {
		s.sslAvailable.WithLabelValues(result.MonitorID).Set(0)
		s.ssl.DeleteLabelValues(result.MonitorID)
	}
}

func (s *service) postResult(ctx context.Context, result CheckResult) error {
	body, err := json.Marshal(result)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.baseURL+"/api/check-result", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.apiClient.Do(req)
	if err != nil {
		return errors.New("result submission failed (network or timeout error)")
	}
	defer closeBody(resp)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("result submission: HTTP %d", resp.StatusCode)
	}
	return nil
}

func (s *service) runChecks(ctx context.Context) {
	s.scanSuccess.Set(0)
	defer s.lastScan.SetToCurrentTime()
	monitors, err := s.fetchMonitors(ctx)
	if err != nil {
		log.Printf("monitor scan failed: %v", err)
		return
	}
	current := make(map[string]bool)
	for _, monitor := range monitors {
		current[monitor.ID] = true
	}
	for id := range s.known {
		if !current[id] {
			for _, metric := range []*prometheus.GaugeVec{s.up, s.latency, s.ssl, s.sslAvailable} {
				metric.DeleteLabelValues(id)
			}
		}
	}
	s.known = current
	log.Printf("starting scan of %d monitors", len(monitors))
	jobs := make(chan Monitor)
	var wg sync.WaitGroup
	var mu sync.Mutex
	failed := false
	for i := 0; i < min(s.cfg.concurrency, len(monitors)); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for monitor := range jobs {
				if ctx.Err() != nil {
					return
				}
				result, hasTLS := s.probe(ctx, monitor)
				if ctx.Err() != nil {
					return
				} // Shutdown is not a target outage.
				s.recordMetrics(result, hasTLS)
				if err := s.postResult(ctx, result); err != nil {
					s.postsFailed.Inc()
					mu.Lock()
					failed = true
					mu.Unlock()
					log.Printf("monitor=%s %v", monitor.ID, err)
					continue
				}
				log.Printf("monitor=%s status=%s code=%d latency_ms=%d ssl_expiry_days=%d result=posted", result.MonitorID, result.Status, result.StatusCode, result.LatencyMs, result.SSLExpiryDays)
			}
		}()
	}
dispatch:
	for _, monitor := range monitors {
		select {
		case <-ctx.Done():
			break dispatch
		case jobs <- monitor:
		}
	}
	close(jobs)
	wg.Wait()
	if !failed && ctx.Err() == nil {
		s.scanSuccess.Set(1)
	}
	log.Println("scan complete")
}

func (s *service) loop(ctx context.Context) {
	ticker := time.NewTicker(s.cfg.interval)
	defer ticker.Stop()
	s.runChecks(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.runChecks(ctx)
		}
	}
}

func (s *service) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.Handle("GET /metrics", promhttp.HandlerFor(s.registry, promhttp.HandlerOpts{}))
	return mux
}

func run(ctx context.Context, c config) error {
	// Bind before scanning so port conflicts cannot create duplicate check results.
	listener, err := net.Listen("tcp", c.listenAddr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", c.listenAddr, err)
	}
	defer listener.Close()
	s := newService(c)
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	server := &http.Server{Handler: s.handler(), ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	serverErrors := make(chan error, 1)
	go func() { serverErrors <- server.Serve(listener) }()
	log.Printf("Polo probe listening on %s; interval=%s workers=%d", c.listenAddr, c.interval, c.concurrency)
	done := make(chan struct{})
	go func() { defer close(done); s.loop(ctx) }()
	select {
	case <-ctx.Done():
	case err = <-serverErrors:
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
	}
	cancel()
	shutdownCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	if shutdownErr := server.Shutdown(shutdownCtx); shutdownErr != nil {
		_ = server.Close()
		if err == nil {
			err = shutdownErr
		}
	}
	<-done
	s.apiClient.CloseIdleConnections()
	s.targetClient.CloseIdleConnections()
	log.Println("Polo probe stopped")
	return err
}

func main() {
	c, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, c); err != nil {
		log.Fatal(err)
	}
}
