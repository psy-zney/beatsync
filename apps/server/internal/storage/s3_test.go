package storage

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/psy-zney/beatsync/apps/server/internal/config"
)

func TestUploadStreamUsesBoundedSpoolAndSignedRequest(t *testing.T) {
	var received string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/bucket/room-1/a.mp3" {
			t.Errorf("path=%s", request.URL.Path)
		}
		if !strings.HasPrefix(request.Header.Get("Authorization"), "AWS4-HMAC-SHA256 ") {
			t.Error("request was not signed")
		}
		data, err := io.ReadAll(request.Body)
		if err != nil {
			t.Error(err)
		}
		received = string(data)
		writer.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	client, err := New(config.Config{S3Bucket: "bucket", S3Endpoint: server.URL, S3PublicURL: "https://cdn.test", S3AccessKey: "access", S3SecretKey: "secret", S3Region: "auto"})
	if err != nil {
		t.Fatal(err)
	}
	if err := client.UploadStream(context.Background(), "room-1/a.mp3", "audio/mpeg", strings.NewReader("audio-data"), 32); err != nil {
		t.Fatal(err)
	}
	if received != "audio-data" {
		t.Fatalf("received=%q", received)
	}
}

func TestUploadStreamRejectsOversizedBodyBeforeS3(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { requests++ }))
	defer server.Close()
	client, _ := New(config.Config{S3Bucket: "bucket", S3Endpoint: server.URL, S3PublicURL: "https://cdn.test", S3AccessKey: "access", S3SecretKey: "secret", S3Region: "auto"})
	if err := client.UploadStream(context.Background(), "a", "audio/mpeg", strings.NewReader("too large"), 3); err == nil {
		t.Fatal("oversized upload succeeded")
	}
	if requests != 0 {
		t.Fatalf("sent %d S3 requests", requests)
	}
}
